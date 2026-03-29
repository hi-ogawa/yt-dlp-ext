import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Toaster, toast } from "sonner";
import type { ContentRpc } from "./content-rpc.ts";
import { initContentRpc } from "./content-rpc.ts";
import type { ProgressCallback } from "./content.ts";
import { downloadFastSeek } from "./lib/fast-seek.ts";
import { useTheme } from "./lib/theme.ts";
import { useYoutubePlayerRef, type YTPlayer } from "./lib/youtube-player.tsx";
import {
  formatBytes,
  formatLabel,
  formatTime,
  isAudioOnly,
  parseTime,
  parseVideoId,
} from "./lib/youtube-utils.ts";
import type { PlayerApiResult } from "./lib/youtube.ts";
import { initWorkerRpc } from "./worker-rpc.ts";

// --- Components ---

function DownloadPage() {
  const rpcQuery = useQuery({
    queryKey: ["iframe-rpc"],
    queryFn: initContentRpc,
    staleTime: Infinity,
  });
  const rpc = rpcQuery.data!;

  const [input, setInput] = useState("");
  const [showCta, setShowCta] = useState(false);

  useEffect(() => {
    if (!rpcQuery.isPending) return;
    const timer = setTimeout(() => setShowCta(true), 2_000);
    return () => clearTimeout(timer);
  }, [rpcQuery.isPending]);

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

      {showCta && rpcQuery.isPending && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">Extension not detected</p>
          <p className="mt-1 text-muted-foreground">
            Install the Chrome extension to use this app.{" "}
            <a
              href="https://github.com/hi-ogawa/yt-dlp-ext/releases"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              Download zip
            </a>{" "}
            then drag and drop it onto{" "}
            <code className="text-xs">chrome://extensions</code>.
          </p>
        </div>
      )}

      {rpcQuery.isError && (
        <p className="text-sm text-red-500">
          {rpcQuery.error instanceof Error
            ? rpcQuery.error.message
            : "Failed to connect to YouTube."}
        </p>
      )}

      {searchMutation.isSuccess && (
        <>
          <div className="border-t pt-4" />
          <DownloadForm data={searchMutation.data} rpc={rpcQuery.data!} />
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

  const [player, setPlayer] = useState<YTPlayer>();
  const playerRef = useYoutubePlayerRef({
    videoId: data.video.youtubeId,
    setPlayer,
  });

  const [downloadPhase, setDownloadPhase] = useState<
    "downloading" | "processing"
  >();
  const [downloadProgress, setDownloadProgress] = useState<{
    bytesReceived: number;
    totalBytes: number;
  }>();

  const downloadMutation = useMutation({
    mutationFn: async (params: {
      itag: number;
      title: string;
      artist: string;
      album?: string;
      startTime?: number;
      endTime?: number;
    }) => {
      const videoId = data.video.youtubeId;
      const trim =
        params.startTime !== undefined || params.endTime !== undefined
          ? { start: params.startTime, end: params.endTime }
          : undefined;

      const workerRpc = await initWorkerRpc();

      const onCallback = (cb: ProgressCallback) => {
        if (cb.kind === "progress") {
          setDownloadProgress({
            bytesReceived: cb.bytesReceived,
            totalBytes: cb.totalBytes,
          });
        }
      };

      setDownloadPhase("downloading");
      let webmData: ArrayBuffer;
      if (trim) {
        // Fast-seek: download only the needed byte ranges
        webmData = await downloadFastSeek({
          rpc,
          workerRpc,
          videoId,
          itag: params.itag,
          startTime: params.startTime ?? 0,
          endTime: params.endTime ?? data.video.duration,
          onCallback,
        });
      } else {
        const result = await rpc.downloadFormat(
          { videoId, itag: params.itag },
          { onCallback },
        );
        webmData = result.data;
      }

      setDownloadPhase("processing");
      const thumbnailData = await rpc.fetchThumbnail({ videoId });

      const opusData = await workerRpc.convertWebmToOpus({
        webmData,
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
    onSettled: () => {
      setDownloadPhase(undefined);
      setDownloadProgress(undefined);
    },
  });

  return (
    <div className="space-y-4">
      <div className="relative w-full aspect-video rounded overflow-hidden bg-black">
        <div ref={playerRef} className="absolute inset-0" />
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
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium">{label}</label>
              <button
                type="button"
                disabled={!player}
                onClick={() => setValue(formatTime(player!.getCurrentTime()))}
                className="rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
              >
                now
              </button>
              <button
                type="button"
                disabled={!player || !value}
                onClick={() => player!.seekTo(parseTime(value))}
                className="rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
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
              ? downloadPhase === "processing"
                ? "Processing..."
                : downloadProgress
                  ? `Downloading... (${Math.round((downloadProgress.bytesReceived / downloadProgress.totalBytes) * 100)}%)`
                  : "Downloading..."
              : downloadMutation.isSuccess
                ? "Done"
                : "Download"}
          </button>
        </>
      )}
    </div>
  );
}

export function App() {
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
