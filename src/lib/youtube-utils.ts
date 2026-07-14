import type { YouTubeStreamingFormat } from "./youtube.ts";

export function parseVideoId(value: string): string | undefined {
  const trimmed = value.trim();
  if (isVideoId(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.replace(/^www\./, "");
    let videoId: string | undefined;
    if (hostname === "youtu.be") {
      videoId = url.pathname.split("/")[1];
    } else if (
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com")
    ) {
      videoId = url.searchParams.get("v") ?? undefined;
      if (!videoId) {
        const [kind, id] = url.pathname.split("/").filter(Boolean);
        if (["embed", "live", "shorts"].includes(kind ?? "")) {
          videoId = id;
        }
      }
    }
    if (videoId && isVideoId(videoId)) return videoId;
  } catch {
    // Not a URL.
  }
  return undefined;
}

function isVideoId(value: string): boolean {
  return value.length === 11 && /^[\w-]+$/.test(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLabel(f: YouTubeStreamingFormat): string {
  const mime = f.mimeType.split(";")[0];
  const codec = f.mimeType.split(";")[1]?.trim() ?? "";
  const size = f.contentLength ? formatBytes(f.contentLength) : "unknown size";
  if (f.width && f.height) {
    return `${mime} ${f.width}x${f.height} ${codec} (${size})`;
  }
  return `${mime} ${codec} (${size})`;
}

export function isAudioOnly(f: YouTubeStreamingFormat): boolean {
  return f.mimeType.startsWith("audio/");
}

/** Parse time string like "1:23" or "1:02:30" to seconds. */
export function parseTime(s: string): number {
  const parts = s.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0]!;
}

/** Format seconds to "m:ss" or "h:mm:ss". */
export function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
