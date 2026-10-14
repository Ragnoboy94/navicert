"use client";

import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = [
  "pointerdown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "wheel",
] as const;

/**
 * Когда enabled — любое действие пользователя (мышь/клавиша/скролл/фокус)
 * вызывает onActive (с троттлингом). Так галочки «прочитано» становятся реактивными.
 */
export function useActiveRead(enabled: boolean, onActive: () => void) {
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  const lastRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const ping = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const now = Date.now();
      if (now - lastRef.current < 1200) return;
      lastRef.current = now;
      onActiveRef.current();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") ping();
    };

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, ping, { passive: true });
    }
    window.addEventListener("focus", ping);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, ping);
      }
      window.removeEventListener("focus", ping);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
