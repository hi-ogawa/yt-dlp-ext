import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { convertWebmToOpus } from "./lib/convert.ts";
import { createIframeRpc, waitForIframeReady } from "./lib/iframe-rpc.ts";
import { useTheme } from "./lib/theme.ts";
import type { PlayerApiResult, YouTubeStreamingFormat } from "./lib/youtube.ts";
import "./styles.css";

// --- Video ID parsing ---

function parseVideoId(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 11 && /^[\w-]+$/.test(trimmed)) return trimmed;
  if (trimmed.match(/youtube\.com|youtu\.be/)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname === "youtu.be") return url.pathname.substring(1);
      return url.searchParams.get("v") ?? undefined;
    } catch {}
  }
  return undefined;
}

// --- Format helpers ---

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLabel(f: YouTubeStreamingFormat): string {
  const mime = f.mimeType.split(";")[0];
  const codec = f.mimeType.split(";")[1]?.trim() ?? "";
  const size = f.contentLength ? formatBytes(f.contentLength) : "unknown size";
  if (f.width && f.height) {
    return `${mime} ${f.width}x${f.height} ${codec} (${size})`;
  }
  return `${mime} ${codec} (${size})`;
}

function isAudioOnly(f: YouTubeStreamingFormat): boolean {
  return f.mimeType.startsWith("audio/");
}

// --- Iframe + RPC hook ---

function useIframeRpc() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const rpcRef = useRef<ReturnType<typeof createIframeRpc>>(undefined);

  useEffect(() => {
    let cancelled = false;
    waitForIframeReady().then(() => {
      if (cancelled) return;
      if (iframeRef.current) {
        rpcRef.current = createIframeRpc(iframeRef.current);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { iframeRef, ready, rpc: rpcRef };
}

// --- Components ---

function DownloadPage({
  rpc,
  ready,
}: {
  rpc: React.RefObject<ReturnType<typeof createIframeRpc> | undefined>;
  ready: boolean;
}) {
  const [input, setInput] = useState("");
  const [data, setData] = useState<PlayerApiResult>();
  const [searching, setSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rpc.current) {
      toast.error("Content script not ready");
      return;
    }
    const videoId = parseVideoId(input);
    if (!videoId) {
      toast.error("Invalid video ID or URL");
      return;
    }
    setSearching(true);
    setData(undefined);
    try {
      const result = (await rpc.current.getStreamingFormats({
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
      {!ready && (
        <p className="text-sm text-muted-foreground">
          Connecting to YouTube...
        </p>
      )}
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
          disabled={searching || !ready}
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
  rpc: React.RefObject<ReturnType<typeof createIframeRpc> | undefined>;
}) {
  const audioFormats = data.streamingFormats
    .filter(isAudioOnly)
    .filter((f) => f.contentLength)
    .sort((a, b) => (b.contentLength ?? 0) - (a.contentLength ?? 0));

  const [selectedItag, setSelectedItag] = useState<number>(
    audioFormats[0]?.itag ?? 0,
  );
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);

  const handleDownload = async () => {
    if (!rpc.current) return;
    setDownloading(true);
    setDone(false);
    try {
      const result = (await rpc.current.downloadFormat({
        videoId: data.video.youtubeId,
        itag: selectedItag,
      })) as { data: ArrayBuffer; filename: string; size: number };

      // Convert WebM to OPUS with metadata
      const opusData = await convertWebmToOpus(result.data, {
        title: data.video.title,
        artist: data.video.channelName,
      });

      const opusFilename = result.filename.replace(/\.\w+$/, ".opus");
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
  const { iframeRef, ready, rpc } = useIframeRpc();

  return (
    <div className="min-h-screen">
      <header className="flex h-10 items-center border-b px-3">
        <span className="text-sm font-semibold">yt-dlp-ext</span>
      </header>
      {/* Hidden YouTube embed iframe — content script injects here */}
      <iframe
        ref={iframeRef}
        src="https://www.youtube.com/embed/"
        style={{ display: "none" }}
      />
      <DownloadPage rpc={rpc} ready={ready} />
      <Toaster position="top-right" richColors />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
