import { useEffect, useRef, useState } from "react";

export interface PollState<T> {
  data: T | null;
  /** true while the latest poll round-trip succeeded */
  online: boolean;
  error: unknown;
}

/**
 * Poll `fn` every `intervalMs`. Single in-flight request at a time; keeps the
 * last good data on failure (a blip must not blank the screen).
 */
export function usePoll<T>(
  fn: (() => Promise<T>) | null,
  intervalMs: number,
): PollState<T> & { refresh: () => void } {
  const [state, setState] = useState<PollState<T>>({ data: null, online: true, error: null });
  const busy = useRef(false);
  const fnRef = useRef(fn);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!fnRef.current) return;
    let cancelled = false;

    const run = async () => {
      if (busy.current || !fnRef.current) return;
      busy.current = true;
      try {
        const data = await fnRef.current();
        if (!cancelled) setState({ data, online: true, error: null });
      } catch (error) {
        if (!cancelled) setState((s) => ({ data: s.data, online: false, error }));
      } finally {
        busy.current = false;
      }
    };

    void run();
    const timer = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
      // Release the in-flight lock so a remount (React StrictMode) can fetch
      // immediately instead of waiting one full interval.
      busy.current = false;
    };
  }, [intervalMs, fn === null, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, refresh: () => setTick((t) => t + 1) };
}
