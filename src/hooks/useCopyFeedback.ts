import { useCallback, useEffect, useRef, useState } from 'react';
import { copyTextSafe } from '@/services/media/clipboard';

export function useCopyFeedback(resetMs = 1500): {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
  reset: () => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setCopied(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyTextSafe(text);
      if (ok) {
        setCopied(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setCopied(false);
        }, resetMs);
      }
      return ok;
    },
    [resetMs]
  );

  return { copied, copy, reset };
}
