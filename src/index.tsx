import { StrictMode, useEffect, useState } from "react";
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

function useIframeRpc() {
  const [rpc, setRpc] = useState<IframeRpc>();

  useEffect(() => {
    let cancelled = false;
    initIframeRpc().then((rpc) => {
      if (cancelled) return;
      setRpc(rpc);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return rpc;
}

// --- Components ---

function DownloadPage({ rpc }: { rpc: IframeRpc }) {
  const [input, setInput] = useState("");
  const [data, setData] = useState<PlayerApiResult>();
  const [searching, setSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const videoId = parseVideoId(input);
    if (!videoId) {
      toast.error("Invalid video ID or URL");
      return;
    }
    setSearching(true);
    setData(undefined);
    try {
      const result = (await rpc.getStreamingFormats({
        videoId,
      })) as PlayerApiResult;
      setData(result);
    } catch (err) {
      console.error(err);
      toast.error(String(err));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <form onSubmit={handleSearch} className="space-y-3">
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
          disabled={searching}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {searching ? "Searching..." : "Search"}
        </button>
      </form>

      {data && (
        <>
          <div className="border-t pt-4" />
          <DownloadForm data={data} rpc={rpc} />
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
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    setDone(false);
    try {
      // Download audio + fetch thumbnail in parallel
      const [result, thumbnailData] = await Promise.all([
        rpc.downloadFormat({
          videoId: data.video.youtubeId,
          itag: selectedItag,
        }) as Promise<{ data: ArrayBuffer; filename: string; size: number }>,
        rpc.fetchThumbnail({
          videoId: data.video.youtubeId,
        }) as Promise<ArrayBuffer>,
      ]);

      // Convert WebM to OPUS with metadata + thumbnail
      const opusData = await convertWebmToOpus(result.data, {
        title,
        artist,
        album: album || undefined,
        images: [
          {
            data: new Uint8Array(thumbnailData),
            mimeType: "image/jpeg",
            kind: "coverFront",
          },
        ],
      });

      const opusFilename = `${title}.opus`;
      const blob = new Blob([opusData]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = opusFilename;
      a.click();
      URL.revokeObjectURL(url);

      setDone(true);
      toast.success(
        `Downloaded ${opusFilename} (${formatBytes(opusData.byteLength)})`,
      );
    } catch (err) {
      console.error(err);
      toast.error(String(err));
    } finally {
      setDownloading(false);
    }
  };

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
          disabled={downloading}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Artist</label>
        <input
          type="text"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          disabled={downloading}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium">Album</label>
        <input
          type="text"
          value={album}
          onChange={(e) => setAlbum(e.target.value)}
          disabled={downloading}
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
              disabled={downloading}
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
            onClick={handleDownload}
            disabled={downloading || done}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {!downloading && !done && "Download"}
            {downloading && "Downloading..."}
            {done && "Done"}
          </button>
        </>
      )}
    </div>
  );
}

function App() {
  useTheme();
  const rpc = useIframeRpc();

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
    <App />
  </StrictMode>,
);
