import type { YouTubeStreamingFormat } from "./youtube.ts";

export function parseVideoId(value: string): string | undefined {
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

/** Format seconds as "H:MM:SS" or "M:SS". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Parse a time string ("M:SS", "H:MM:SS", or plain seconds) to milliseconds. Returns undefined on invalid input. */
export function parseTime(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Plain number = seconds
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(parseFloat(trimmed) * 1000);
  }

  // M:SS or H:MM:SS
  const parts = trimmed.split(":");
  if (parts.length === 2) {
    const [m, s] = parts.map(Number);
    if (isNaN(m!) || isNaN(s!)) return undefined;
    return Math.round((m! * 60 + s!) * 1000);
  }
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    if (isNaN(h!) || isNaN(m!) || isNaN(s!)) return undefined;
    return Math.round((h! * 3600 + m! * 60 + s!) * 1000);
  }

  return undefined;
}
