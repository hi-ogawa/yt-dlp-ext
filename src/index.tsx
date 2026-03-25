import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { convertWebmToOpus } from "./lib/convert.ts";
import type { IframeRpc } from "./lib/iframe-rpc.ts";
import { initIframeRpc } from "./lib/iframe-rpc.ts";
import { useTheme } from "./lib/theme.ts";
import {
  formatBytes,
  formatLabel,
  isAudioOnly,
  parseVideoId,
} from "./lib/youtube-utils.ts";
import type { PlayerApiResult } from "./lib/youtube.ts";
import "./styles.css";

const queryClient = new QueryClient();

// --- Components ---

function DownloadPage({ rpc }: { rpc: IframeRpc }) {
  const [input, setInput] = useState("");

  const search = useMutation({
    mutationFn: (videoId: string) =>
      rpc.getStreamingFormats({ videoId }) as Promise<PlayerApiResult>,
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
          search.mutate(videoId);
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
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={search.isPending}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {search.isPending ? "Searching..." : "Search"}
        </button>
      </form>

      {search.data && (
        <>
          <div className="border-t pt-4" />
          <DownloadForm data={search.data} rpc={rpc} />
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
  rpc: IframeRpc;
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

  const download = useMutation({
    mutationFn: async (params: {
      itag: number;
      title: string;
      artist: string;
      album?: string;
    }) => {
      const [result, thumbnailData] = await Promise.all([
        rpc.downloadFormat({
          videoId: data.video.youtubeId,
          itag: params.itag,
        }) as Promise<{ data: ArrayBuffer; filename: string; size: number }>,
        rpc.fetchThumbnail({
          videoId: data.video.youtubeId,
        }) as Promise<ArrayBuffer>,
      ]);

      const opusData = await convertWebmToOpus(result.data, {
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
          disabled={download.isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Artist</label>
        <input
          type="text"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          disabled={download.isPending}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Album</label>
        <input
          type="text"
          value={album}
          onChange={(e) => setAlbum(e.target.value)}
          disabled={download.isPending}
          placeholder="(optional)"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
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
              disabled={download.isPending}
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
              download.mutate({
                itag: selectedItag,
                title,
                artist,
                album: album || undefined,
              })
            }
            disabled={download.isPending || download.isSuccess}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {download.isPending
              ? "Downloading..."
              : download.isSuccess
                ? "Done"
                : "Download"}
          </button>
        </>
      )}
    </div>
  );
}

function App() {
  useTheme();
  const { data: rpc } = useQuery({
    queryKey: ["iframe-rpc"],
    queryFn: initIframeRpc,
    staleTime: Infinity,
  });

  return (
    <div className="min-h-screen">
      <header className="flex h-10 items-center border-b px-3">
        <span className="text-sm font-semibold">yt-dlp-ext</span>
      </header>
      {rpc ? (
        <DownloadPage rpc={rpc} />
      ) : (
        <p className="p-6 text-sm text-muted-foreground">
          Connecting to YouTube...
        </p>
      )}
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
