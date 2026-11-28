import { useCallback, useEffect, useRef, useState } from 'react';

export function useFlashNotice<T>(durationMs = 2400): {
  notice: T | null;
  setNotice: (value: T | null) => void;
  showNotice: (value: T, overrideMs?: number) => void;
  clearNotice: () => void;
} {
  const [notice, setNoticeState] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const setNotice = useCallback(
    (value: T | null) => {
      clearTimer();
      setNoticeState(value);
    },
    [clearTimer]
  );

  const showNotice = useCallback(
    (value: T, overrideMs?: number) => {
      clearTimer();
      setNoticeState(value);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setNoticeState(null);
      }, overrideMs ?? durationMs);
    },
    [clearTimer, durationMs]
  );

  const clearNotice = useCallback(() => {
    clearTimer();
    setNoticeState(null);
  }, [clearTimer]);

  return { notice, setNotice, showNotice, clearNotice };
}
