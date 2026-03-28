import { useCallback } from "react";

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

declare let YT: {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string;
      height?: string;
      events?: { onReady?: (e: { target: YTPlayer }) => void };
    },
  ) => YTPlayer;
};

let iframeApiPromise: Promise<void> | undefined;

export function loadYoutubeIframeApi(): Promise<void> {
  if (iframeApiPromise) return iframeApiPromise;
  iframeApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      iframeApiPromise = undefined; // allow retry
      reject(new Error("Failed to load YouTube IFrame API"));
    };
    document.head.appendChild(script);
    (window as any).onYouTubeIframeAPIReady = () => resolve();
  });
  return iframeApiPromise;
}

async function createYoutubePlayer(options: {
  element: HTMLElement;
  videoId: string;
}): Promise<YTPlayer> {
  await loadYoutubeIframeApi();
  return new Promise((resolve) => {
    const container = document.createElement("div");
    options.element.appendChild(container);
    new YT.Player(container, {
      videoId: options.videoId,
      width: "100%",
      height: "100%",
      events: { onReady: ({ target: p }) => resolve(p) },
    });
  });
}

export function useYoutubePlayerRef(options: {
  videoId: string;
  setPlayer: (player: YTPlayer | undefined) => void;
}) {
  const { videoId, setPlayer } = options;
  return useCallback(
    (el: HTMLDivElement) => {
      let player: YTPlayer | undefined;
      let disposed = false;
      createYoutubePlayer({ element: el, videoId }).then((p) => {
        if (disposed) {
          p.destroy();
        } else {
          player = p;
          setPlayer(p);
        }
      });
      return () => {
        disposed = true;
        player?.destroy();
        setPlayer(undefined);
      };
    },
    [videoId, setPlayer],
  );
}
