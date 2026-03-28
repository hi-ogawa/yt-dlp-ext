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
import { findContainingRange, headerSize } from "./lib/fast-seek.ts";
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

// Initial header fetch size. WebM headers with Cues are typically small,
// but YouTube files may have many cue points. 512 KB is generous.
const HEADER_FETCH_SIZE = 512 * 1024;

/** Fast-seek download: fetch only the byte ranges containing the requested time span. */
async function downloadFastSeek(opts: {
  rpc: ContentRpc;
  workerRpc: Awaited<ReturnType<typeof initWorkerRpc>>;
  videoId: string;
  itag: number;
  startTime: number;
  endTime: number;
}): Promise<ArrayBuffer> {
  const { rpc, workerRpc, videoId, itag, startTime, endTime } = opts;

  // 1. Download header bytes (contains EBML header + Cues)
  const headerResult = await rpc.downloadHeader({
    videoId,
    itag,
    bytes: HEADER_FETCH_SIZE,
  });

  // 2. Parse header with libwebm WASM to extract cue points
  // Clone before sending: workerRpc transfers the ArrayBuffer (neutering it),
  // but we still need headerResult.data below for the metadataSlice.
  const metadata = await workerRpc.parseWebmHeader({
    headerData: headerResult.data.slice(0),
  });

  // 3. Compute byte range from cue points
  const range = findContainingRange(metadata, startTime, endTime);
  const metaSize = headerSize(metadata);

  // 4. Download only the needed clusters
  const clusterData = await rpc.downloadRange({
    videoId,
    itag,
    start: range.start,
    end: range.end,
  });

  // 5. Remux: combine header metadata + partial clusters into valid WebM
  const metadataSlice = headerResult.data.slice(0, metaSize);
  const remuxedData = await workerRpc.remuxWebm({
    metadataBuffer: metadataSlice,
    frameBuffer: clusterData.data,
  });

  return remuxedData;
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
      const hasTrim =
        params.startTime !== undefined || params.endTime !== undefined;

      const workerRpc = await initWorkerRpc();

      let webmData: ArrayBuffer;
      if (hasTrim) {
        // Fast-seek: download only the needed byte ranges
        webmData = await downloadFastSeek({
          rpc,
          workerRpc,
          videoId,
          itag: params.itag,
          startTime: params.startTime ?? 0,
          endTime: params.endTime ?? data.video.duration,
        });
      } else {
        const result = await rpc.downloadFormat({
          videoId,
          itag: params.itag,
        });
        webmData = result.data;
      }

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
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            disabled={downloadMutation.isPending}
            placeholder="0:00"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium">End time</label>
          <input
            type="text"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            disabled={downloadMutation.isPending}
            placeholder="0:00"
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
