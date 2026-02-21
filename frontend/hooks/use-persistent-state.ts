import { useState, useEffect, Dispatch, SetStateAction } from "react";

/**
 * Drop-in replacement for useState that persists to sessionStorage.
 * State survives client-side navigation (switching pages) but resets
 * when the browser tab is closed.
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const stored = sessionStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // quota exceeded or private browsing — fail silently
    }
  }, [key, state]);

  return [state, setState];
}
