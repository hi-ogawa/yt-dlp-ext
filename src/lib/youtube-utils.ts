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
