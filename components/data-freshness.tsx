"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

const STALE_AFTER_MS = 30_000;

/** Refresh live listening data when an old browser tab becomes active again. */
export function DataFreshness() {
  const router = useRouter();
  const backgroundedAt = useRef<number | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(() => {
    if (refreshing.current) return;
    refreshing.current = true;
    backgroundedAt.current = null;
    router.refresh();
    window.setTimeout(() => {
      refreshing.current = false;
    }, 2_000);
  }, [router]);

  useEffect(() => {
    const markBackgrounded = () => {
      backgroundedAt.current = Date.now();
    };
    const refreshIfStale = () => {
      const hiddenAt = backgroundedAt.current;
      if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_AFTER_MS) refresh();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") markBackgrounded();
      else refreshIfStale();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("blur", markBackgrounded);
    window.addEventListener("focus", refreshIfStale);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("blur", markBackgrounded);
      window.removeEventListener("focus", refreshIfStale);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [refresh]);

  return null;
}
