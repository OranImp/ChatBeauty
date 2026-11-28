import { useCallback, useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { getAndroidBatteryStatus, getRuntimeEnvironment } from '@/services/transport/streamHttp';

export function useAndroidBatteryStatus(enabled: boolean): {
  ignoring: boolean | null;
  supported: boolean;
  checking: boolean;
  refresh: () => Promise<void>;
} {
  const [ignoring, setIgnoring] = useState<boolean | null>(null);
  const [supported, setSupported] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (getRuntimeEnvironment() !== 'capacitor') return;
    setChecking(true);
    try {
      const status = await getAndroidBatteryStatus();
      setSupported(Boolean(status.supported));
      setIgnoring(Boolean(status.ignoring));
    } catch {
      // Ignore probe error on unsupported runtime
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled || getRuntimeEnvironment() !== 'capacitor') {
      setSupported(false);
      return;
    }

    let cancelled = false;
    const syncBattery = async () => {
      setChecking(true);
      try {
        const status = await getAndroidBatteryStatus();
        if (!cancelled) {
          setSupported(Boolean(status.supported));
          setIgnoring(Boolean(status.ignoring));
        }
      } catch {
        // Ignore probe error on unsupported runtime
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    void syncBattery();

    let handlePromise: Promise<{ remove: () => Promise<void> }> | null = null;
    try {
      handlePromise = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void syncBattery();
      });
    } catch {
      // Ignore outside Capacitor native shell
    }

    return () => {
      cancelled = true;
      if (handlePromise) {
        void handlePromise.then((h) => h.remove()).catch(() => undefined);
      }
    };
  }, [enabled]);

  return { ignoring, supported, checking, refresh };
}
