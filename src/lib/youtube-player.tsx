import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YT {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      width?: string;
      height?: string;
      events?: { onReady?: () => void };
    },
  ) => YTPlayer;
}

let iframeApiPromise: Promise<YT> | undefined;

function loadYoutubeIframeApi(): Promise<YT> {
  if (iframeApiPromise) return iframeApiPromise;
  iframeApiPromise = new Promise<YT>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
    (window as any).onYouTubeIframeAPIReady = () => {
      resolve((window as any).YT);
    };
  });
  return iframeApiPromise;
}

export function YoutubePlayer({
  videoId,
  onReady,
  className,
}: {
  videoId: string;
  onReady: (player: YTPlayer) => void;
  className?: string;
}) {
  const ytApiQuery = useQuery({
    queryKey: ["youtube-iframe-api"],
    queryFn: loadYoutubeIframeApi,
    staleTime: Infinity,
  });

  const ref = useCallback(
    (el: HTMLDivElement) => {
      if (!ytApiQuery.data) return;
      let cancelled = false;
      const p = new ytApiQuery.data.Player(el, {
        videoId,
        width: "100%",
        height: "100%",
        events: {
          onReady: () => {
            if (!cancelled) onReady(p);
          },
        },
      });
      return () => {
        cancelled = true;
        p.destroy();
      };
    },
    [videoId, ytApiQuery.data, onReady],
  );

  return <div ref={ref} className={className} />;
}
