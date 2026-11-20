package com.chatbeauty.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.ProtocolException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.internal.http.HttpMethod;

@CapacitorPlugin(name = "NativeStream")
public class NativeStreamPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AtomicBoolean> abortedFlags = new ConcurrentHashMap<>();
    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(25, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build();

    @PluginMethod
    public void startStream(PluginCall call) {
        String requestId = call.getString("requestId");
        String urlStr = call.getString("url");
        String method = call.getString("method", "POST");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body");

        if (requestId == null || urlStr == null) {
            call.reject("Missing requestId or url");
            return;
        }

        AtomicBoolean aborted = new AtomicBoolean(false);
        abortedFlags.put(requestId, aborted);

        executor.execute(() -> {
            HttpURLConnection conn = null;
            boolean opened = false;
            PowerManager.WakeLock streamLock = null;
            try {
                try {
                    PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                    if (pm != null) {
                        streamLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ChatBeauty:StreamLock");
                        streamLock.setReferenceCounted(false);
                        streamLock.acquire(10 * 60 * 1000L);
                    }
                } catch (Exception ignored) {
                    // Best-effort lock
                }
                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                activeConnections.put(requestId, conn);

                conn.setRequestMethod(method);
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(0);
                conn.setUseCaches(false);
                conn.setDoInput(true);

                if (headers != null) {
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        String val = headers.getString(key);
                        if (val != null) {
                            conn.setRequestProperty(key, val);
                        }
                    }
                }

                if (body != null && !body.isEmpty()) {
                    conn.setDoOutput(true);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bytes);
                        os.flush();
                    }
                }

                int status = conn.getResponseCode();
                if (status < 200 || status >= 400) {
                    String errBody = readStreamToString(conn.getErrorStream());
                    if (errBody.isEmpty()) {
                        errBody = conn.getResponseMessage();
                    }
                    call.reject("HTTP " + status + ": " + errBody);
                    return;
                }

                JSObject openResult = new JSObject();
                openResult.put("status", status);
                call.resolve(openResult);
                opened = true;

                InputStream stream = conn.getInputStream();
                try (InputStreamReader reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
                    char[] buf = new char[2048];
                    int n;
                    while (!aborted.get() && (n = reader.read(buf)) != -1) {
                        if (n > 0) {
                            JSObject payload = new JSObject();
                            payload.put("requestId", requestId);
                            payload.put("chunk", new String(buf, 0, n));
                            notifyListeners("streamChunk", payload);
                        }
                    }
                }

                if (!aborted.get()) {
                    JSObject endPayload = new JSObject();
                    endPayload.put("requestId", requestId);
                    notifyListeners("streamEnd", endPayload);
                }
            } catch (Exception e) {
                if (!aborted.get()) {
                    String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                    if (!opened) {
                        call.reject(msg);
                    } else {
                        JSObject errPayload = new JSObject();
                        errPayload.put("requestId", requestId);
                        errPayload.put("error", msg);
                        notifyListeners("streamError", errPayload);
                    }
                }
            } finally {
                activeConnections.remove(requestId);
                abortedFlags.remove(requestId);
                if (conn != null) {
                    conn.disconnect();
                }
                try {
                    if (streamLock != null && streamLock.isHeld()) {
                        streamLock.release();
                    }
                } catch (Exception ignored) {
                    // ignore
                }
            }
        });
    }

    @PluginMethod
    public void abortStream(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId != null) {
            AtomicBoolean flag = abortedFlags.get(requestId);
            if (flag != null) {
                flag.set(true);
            }
            HttpURLConnection conn = activeConnections.remove(requestId);
            if (conn != null) {
                executor.execute(conn::disconnect);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void simpleRequest(PluginCall call) {
        String urlStr = call.getString("url");
        String method = call.getString("method", "GET");
        JSObject headers = call.getObject("headers", new JSObject());
        String body = call.getString("body");

        if (urlStr == null) {
            call.reject("Missing url");
            return;
        }

        executor.execute(() -> {
            try {
                String upperMethod = (method != null && !method.trim().isEmpty())
                        ? method.trim().toUpperCase(Locale.ROOT)
                        : "GET";
                Request.Builder reqBuilder = new Request.Builder().url(urlStr);
                String contentType = null;

                if (headers != null) {
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        String val = headers.getString(key);
                        if (val != null) {
                            reqBuilder.header(key, val);
                            if ("content-type".equalsIgnoreCase(key)) {
                                contentType = val;
                            }
                        }
                    }
                }

                RequestBody requestBody = null;
                if (!"GET".equals(upperMethod) && !"HEAD".equals(upperMethod)) {
                    if (body != null) {
                        MediaType mediaType = MediaType.parse(
                                contentType != null ? contentType : "application/octet-stream"
                        );
                        requestBody = RequestBody.create(body.getBytes(StandardCharsets.UTF_8), mediaType);
                    } else if (HttpMethod.requiresRequestBody(upperMethod)) {
                        requestBody = RequestBody.create(new byte[0], null);
                    }
                }

                reqBuilder.method(upperMethod, requestBody);

                try (Response response = httpClient.newCall(reqBuilder.build()).execute()) {
                    int status = response.code();
                    String respBody = response.body() != null ? response.body().string() : "";

                    JSObject respHeaders = new JSObject();
                    for (String name : response.headers().names()) {
                        List<String> values = response.headers().values(name);
                        if (!values.isEmpty()) {
                            respHeaders.put(name.toLowerCase(Locale.ROOT), String.join(", ", values));
                        }
                    }

                    JSObject result = new JSObject();
                    result.put("status", status);
                    result.put("statusText", response.message());
                    result.put("headers", respHeaders);
                    result.put("body", respBody);
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
            }
        });
    }

    @PluginMethod
    public void saveAndShareFile(PluginCall call) {
        String rawName = call.getString("filename");
        String base64 = call.getString("base64");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (rawName == null || base64 == null) {
            call.reject("Missing filename or base64 data");
            return;
        }

        executor.execute(() -> {
            try {
                String safeName = new File(rawName).getName();
                if (safeName.isEmpty() || ".".equals(safeName) || "..".equals(safeName)) {
                    safeName = "chatbeauty-export.bin";
                }
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                File outFile = new File(getContext().getCacheDir(), safeName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(data);
                    fos.flush();
                }

                Uri uri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        outFile
                );

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType);
                shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, safeName);
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                if (getActivity() != null) {
                    getActivity().runOnUiThread(() -> getActivity().startActivity(chooser));
                } else {
                    getContext().startActivity(chooser);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
            }
        });
    }

    @PluginMethod
    public void getBatteryOptimizationStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                ignoring = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            }
        }
        result.put("ignoring", ignoring);
        result.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "");
        result.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        try {
            String pkg = getContext().getPackageName();
            Intent intent = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                    intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                }
            }
            if (intent == null || intent.resolveActivity(getContext().getPackageManager()) == null) {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            }
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Unable to open battery settings");
        }
    }

    @PluginMethod
    public void setBackgroundGenerationState(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        int count = call.getInt("count", active ? 1 : 0);
        try {
            Intent svc = new Intent(getContext(), BackgroundGenService.class);
            if (active && count > 0) {
                svc.setAction(BackgroundGenService.ACTION_START);
                svc.putExtra("count", count);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(getContext(), svc);
                } else {
                    getContext().startService(svc);
                }
            } else {
                getContext().stopService(svc);
            }
        } catch (Exception ignored) {
            // Fail silently if OEM restricts background service start without foreground window
        }
        call.resolve();
    }

    private static String readStreamToString(InputStream stream) throws IOException {
        if (stream == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = stream.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
