import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import type { ContentRpc } from "./content-rpc.ts";
import { initContentRpc } from "./content-rpc.ts";
import { useTheme } from "./lib/theme.ts";
import {
  formatBytes,
  formatDuration,
  formatLabel,
  isAudioOnly,
  parseTime,
  parseVideoId,
} from "./lib/youtube-utils.ts";
import type { PlayerApiResult } from "./lib/youtube.ts";
import { initWorkerRpc } from "./worker-rpc.ts";
import "./styles.css";

const queryClient = new QueryClient();

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
  const [startTimeStr, setStartTimeStr] = useState("");
  const [endTimeStr, setEndTimeStr] = useState("");

  const downloadMutation = useMutation({
    mutationFn: async (params: {
      itag: number;
      title: string;
      artist: string;
      album?: string;
      startTime?: number;
      endTime?: number;
    }) => {
      const useFastSeek =
        params.startTime !== undefined && params.endTime !== undefined;

      const downloadPromise = useFastSeek
        ? rpc.downloadFormatFastSeek({
            videoId: data.video.youtubeId,
            itag: params.itag,
            startTime: params.startTime!,
            endTime: params.endTime!,
          })
        : rpc.downloadFormat({
            videoId: data.video.youtubeId,
            itag: params.itag,
          });

      const [result, thumbnailData] = await Promise.all([
        downloadPromise,
        rpc.fetchThumbnail({
          videoId: data.video.youtubeId,
        }),
      ]);

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

      <img
        src={`https://i.ytimg.com/vi/${data.video.youtubeId}/hqdefault.jpg`}
        alt=""
        className="w-full rounded"
      />

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
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">Start time</label>
          <input
            type="text"
            value={startTimeStr}
            onChange={(e) => setStartTimeStr(e.target.value)}
            disabled={downloadMutation.isPending}
            placeholder="0:00"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">
            End time
            {data.video.duration > 0 && (
              <span className="ml-1 font-normal text-muted-foreground">
                / {formatDuration(data.video.duration)}
              </span>
            )}
          </label>
          <input
            type="text"
            value={endTimeStr}
            onChange={(e) => setEndTimeStr(e.target.value)}
            disabled={downloadMutation.isPending}
            placeholder={
              data.video.duration > 0
                ? formatDuration(data.video.duration)
                : "m:ss"
            }
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
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
            onClick={() => {
              const startTime = parseTime(startTimeStr);
              const endTime = parseTime(endTimeStr);
              const useTrim =
                startTime !== undefined &&
                endTime !== undefined &&
                startTime < endTime;
              downloadMutation.mutate({
                itag: selectedItag,
                title,
                artist,
                album: album || undefined,
                startTime: useTrim ? startTime : undefined,
                endTime: useTrim ? endTime : undefined,
              });
            }}
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
