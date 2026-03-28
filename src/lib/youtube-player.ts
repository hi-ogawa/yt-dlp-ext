import { useEffect, useRef, useState } from "react";

declare let YT: {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      width?: string;
      height?: string;
      events?: { onReady?: () => void };
    },
  ) => YTPlayer;
};

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

let iframeApiPromise: Promise<void> | undefined;

function loadYoutubeIframeApi(): Promise<void> {
  if (iframeApiPromise) return iframeApiPromise;
  iframeApiPromise = new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
    (window as unknown as Record<string, unknown>).onYouTubeIframeAPIReady =
      () => resolve();
  });
  return iframeApiPromise;
}

export function useYouTubePlayer(youtubeId: string) {
  const [player, setPlayer] = useState<YTPlayer>();
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer>(undefined);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let destroyed = false;
    loadYoutubeIframeApi().then(() => {
      if (destroyed) return;
      const p = new YT.Player(el, {
        videoId: youtubeId,
        width: "100%",
        height: "100%",
        events: {
          onReady: () => {
            if (destroyed) return;
            playerRef.current = p;
            setPlayer(p);
          },
        },
      });
    });
    return () => {
      destroyed = true;
      playerRef.current?.destroy();
      playerRef.current = undefined;
      setPlayer(undefined);
    };
  }, [youtubeId]);

  return { ref: containerRef, player };
}
