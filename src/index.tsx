import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import type { ContentRpc } from "./content-rpc.ts";
import { initContentRpc } from "./content-rpc.ts";
import { useTheme } from "./lib/theme.ts";
import {
  formatBytes,
  formatLabel,
  isAudioOnly,
  parseVideoId,
} from "./lib/youtube-utils.ts";
import type { PlayerApiResult } from "./lib/youtube.ts";
import { initWorkerRpc } from "./worker-rpc.ts";
import "./styles.css";

const queryClient = new QueryClient();

// --- Helpers ---

/** Parse time string like "1:23" or "1:02:30" to seconds. */
function parseTime(s: string): number {
  const parts = s.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0]!;
}

/** Format seconds to "m:ss" or "h:mm:ss". */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// --- YouTube Player Hook ---

/**
 * Controls a YouTube embed iframe via the postMessage API.
 * Tracks currentTime from periodic infoDelivery events.
 */
function useYouTubePlayer(videoId: string) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentTimeRef = useRef(0);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function postToPlayer(data: unknown) {
      iframe!.contentWindow?.postMessage(
        JSON.stringify(data),
        "https://www.youtube.com",
      );
    }

    function handleMessage(e: MessageEvent) {
      if (e.source !== iframe!.contentWindow) return;
      let data: { event?: string; info?: { currentTime?: number } };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (
        (data.event === "infoDelivery" || data.event === "initialDelivery") &&
        typeof data.info?.currentTime === "number"
      ) {
        currentTimeRef.current = data.info.currentTime;
      }
    }

    function handleLoad() {
      postToPlayer({ event: "listening" });
    }

    window.addEventListener("message", handleMessage);
    iframe.addEventListener("load", handleLoad);

    return () => {
      window.removeEventListener("message", handleMessage);
      iframe.removeEventListener("load", handleLoad);
    };
  }, [videoId]);

  const getCurrentTime = () => currentTimeRef.current;

  const seekTo = (seconds: number) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: "command",
        func: "seekTo",
        args: [seconds, true],
      }),
      "https://www.youtube.com",
    );
  };

  return { iframeRef, getCurrentTime, seekTo };
}

// --- Components ---

function DownloadPage() {
  const rpcQuery = useQuery({
    queryKey: ["iframe-rpc"],
    queryFn: initContentRpc,
    staleTime: Infinity,
  });
  const rpc = rpcQuery.data!;

  const [input, setInput] = useState("");

  const searchMutation = useMutation({
    mutationFn: (videoId: string) => rpc.getStreamingFormats({ videoId }),
    onError: (err) => {
      console.error(err);
      toast.error(String(err));
    },
  });

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const videoId = parseVideoId(input);
          if (!videoId) {
            toast.error("Invalid video ID or URL");
            return;
          }
          searchMutation.mutate(videoId);
        }}
        className="space-y-3"
      >
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">Video ID</label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ID or URL"
            disabled={!rpcQuery.isSuccess}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!rpcQuery.isSuccess || searchMutation.isPending}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {searchMutation.isPending ? "Searching..." : "Search"}
        </button>
      </form>

      {rpcQuery.isError && (
        <p className="text-sm text-red-500">Failed to connect to YouTube.</p>
      )}

      {searchMutation.isSuccess && (
        <>
          <div className="border-t pt-4" />
          <DownloadForm data={searchMutation.data} rpc={rpc} />
        </>
      )}
    </div>
  );
}

function DownloadForm({
  data,
  rpc,
}: {
  data: PlayerApiResult;
  rpc: ContentRpc;
}) {
  const audioFormats = data.streamingFormats
    .filter(isAudioOnly)
    .filter((f) => f.contentLength)
    .sort((a, b) => (b.contentLength ?? 0) - (a.contentLength ?? 0));

  const [selectedItag, setSelectedItag] = useState<number>(
    audioFormats[0]?.itag ?? 0,
  );
  const [title, setTitle] = useState(data.video.title);
  const [artist, setArtist] = useState(data.video.channelName);
  const [album, setAlbum] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const player = useYouTubePlayer(data.video.youtubeId);

  const downloadMutation = useMutation({
    mutationFn: async (params: {
      itag: number;
      title: string;
      artist: string;
      album?: string;
      startTime?: number;
      endTime?: number;
    }) => {
      const [result, thumbnailData] = await Promise.all([
        rpc.downloadFormat({
          videoId: data.video.youtubeId,
          itag: params.itag,
        }),
        rpc.fetchThumbnail({
          videoId: data.video.youtubeId,
        }),
      ]);

      const trim =
        params.startTime !== undefined || params.endTime !== undefined
          ? { start: params.startTime, end: params.endTime }
          : undefined;

      const workerRpc = await initWorkerRpc();
      const opusData = await workerRpc.convertWebmToOpus({
        webmData: result.data,
        metadata: {
          title: params.title,
          artist: params.artist,
          album: params.album,
          images: [
            {
              data: new Uint8Array(thumbnailData),
              mimeType: "image/jpeg",
              kind: "coverFront",
            },
          ],
        },
        trim,
      });

      const opusFilename = `${params.title}.opus`;
      const blob = new Blob([opusData]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = opusFilename;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(
        `Downloaded ${opusFilename} (${formatBytes(opusData.byteLength)})`,
      );
    },
    onError: (err) => {
      console.error(err);
      toast.error(String(err));
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{data.video.title}</h1>
        <p className="text-sm text-muted-foreground">
          {data.video.channelName}
        </p>
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded">
        <iframe
          ref={player.iframeRef}
          src={`https://www.youtube.com/embed/${data.video.youtubeId}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}`}
          allow="autoplay; encrypted-media"
          className="absolute h-full w-full"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={downloadMutation.isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Artist</label>
        <input
          type="text"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          disabled={downloadMutation.isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Album</label>
        <input
          type="text"
          value={album}
          onChange={(e) => setAlbum(e.target.value)}
          disabled={downloadMutation.isPending}
          placeholder="(optional)"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["Start time", startTime, setStartTime],
            ["End time", endTime, setEndTime],
          ] as const
        ).map(([label, value, setValue]) => (
          <div key={label} className="space-y-1.5">
            <div className="flex items-center gap-1">
              <label className="text-sm font-medium">{label}</label>
              <button
                type="button"
                className="rounded px-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setValue(formatTime(player.getCurrentTime()))}
              >
                use current
              </button>
              <button
                type="button"
                className="rounded px-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (value) player.seekTo(parseTime(value));
                }}
              >
                seek
              </button>
            </div>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={downloadMutation.isPending}
              placeholder="0:00"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>

      {audioFormats.length === 0 ? (
        <p className="text-sm text-red-500">No audio formats available.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium">Audio format</label>
            <select
              value={selectedItag}
              onChange={(e) => setSelectedItag(Number(e.target.value))}
              disabled={downloadMutation.isPending}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            >
              {audioFormats.map((f) => (
                <option key={f.itag} value={f.itag}>
                  {formatLabel(f)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadMutation.mutate({
                itag: selectedItag,
                title,
                artist,
                album: album || undefined,
                startTime: startTime ? parseTime(startTime) : undefined,
                endTime: endTime ? parseTime(endTime) : undefined,
              })
            }
            disabled={downloadMutation.isPending || downloadMutation.isSuccess}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {downloadMutation.isPending
              ? "Downloading..."
              : downloadMutation.isSuccess
                ? "Done"
                : "Download"}
          </button>
        </>
      )}
    </div>
  );
}

function App() {
  const { cycle, Icon } = useTheme();

  return (
    <div className="min-h-screen">
      <header className="flex h-10 items-center justify-between border-b px-3">
        <span className="text-sm font-semibold">yt-dlp-ext</span>
        <button
          type="button"
          onClick={cycle}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <Icon className="size-4" />
        </button>
      </header>
      <DownloadPage />
      <Toaster position="top-right" richColors />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
