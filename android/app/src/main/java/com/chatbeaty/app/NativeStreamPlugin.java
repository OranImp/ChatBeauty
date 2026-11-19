package com.chatbeaty.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
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
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "NativeStream")
public class NativeStreamPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AtomicBoolean> abortedFlags = new ConcurrentHashMap<>();

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
            try {
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
                    if (!call.isSaved()) {
                        // Call not yet resolved
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
            HttpURLConnection conn = null;
            try {
                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(25000);
                conn.setReadTimeout(30000);
                conn.setUseCaches(false);
                conn.setDoInput(true);

                try {
                    conn.setRequestMethod(method);
                } catch (ProtocolException pe) {
                    // Fallback for WebDAV verbs such as PROPFIND/MKCOL if restricted by HttpURLConnection
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("X-HTTP-Method-Override", method);
                }

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

                if (body != null) {
                    conn.setDoOutput(true);
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bytes);
                        os.flush();
                    }
                }

                int status = conn.getResponseCode();
                InputStream stream = (status >= 200 && status < 400)
                        ? conn.getInputStream()
                        : conn.getErrorStream();
                String respBody = readStreamToString(stream);

                JSObject respHeaders = new JSObject();
                for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
                    if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                        respHeaders.put(entry.getKey().toLowerCase(), String.join(", ", entry.getValue()));
                    }
                }

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("statusText", conn.getResponseMessage() != null ? conn.getResponseMessage() : "");
                result.put("headers", respHeaders);
                result.put("body", respBody);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
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
