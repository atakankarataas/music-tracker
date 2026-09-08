"use client";

import Image from "next/image";
import { AudioLines } from "lucide-react";
import { useEffect, useState } from "react";

type NowPlayingData = {
  isPlaying: boolean;
  track: string;
  artist: string;
  imageUrl: string | null;
  progressMs: number;
  durationMs: number;
};

export function NowPlaying() {
  const [data, setData] = useState<NowPlayingData | null>(null);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;

    async function refresh() {
      try {
        const response = await fetch("/api/now-playing", { cache: "no-store" });
        if (!response.ok || response.status === 204) {
          if (mounted) setData(null);
          return;
        }
        const next = (await response.json()) as NowPlayingData;
        if (mounted) setData(next.isPlaying ? next : null);
      } catch {
        if (mounted) setData(null);
      }
    }

    // A backgrounded tab does not need a Spotify round trip every 15 seconds.
    // Polling only while visible saves the rate limit and the battery, and the
    // panel is refreshed the moment the tab comes back.
    function sync() {
      window.clearInterval(timer);
      if (document.hidden) return;
      void refresh();
      timer = window.setInterval(refresh, 15_000);
    }

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  if (!data) return null;

  const progress = data.durationMs
    ? Math.min(100, Math.max(0, (data.progressMs / data.durationMs) * 100))
    : 0;

  return (
    <>
      {/* The card is fixed to the bottom-right, so without this reserve it
          covers whatever content happens to end the page. */}
      <div className="now-playing-reserve" aria-hidden="true" />
      <aside className="now-playing" aria-label="Now playing">
        {data.imageUrl ? (
          <Image alt="" height={44} src={data.imageUrl} width={44} />
        ) : (
          <span className="now-playing-placeholder"><AudioLines size={18} /></span>
        )}
        <div className="now-playing-copy">
          <span className="eyebrow"><i /> Now playing</span>
          <strong>{data.track}</strong>
          <small>{data.artist}</small>
          <span className="progress-track"><span style={{ width: `${progress}%` }} /></span>
        </div>
      </aside>
    </>
  );
}
