// YouTube player API + streaming format extraction.
// Must run in YouTube's main world (same-origin) to bypass POT.

export interface YouTubeVideoData {
  youtubeId: string;
  title: string;
  channelName: string;
  channelId: string;
  duration: number;
}

export interface YouTubeStreamingFormat {
  url: string;
  itag: number;
  mimeType: string;
  contentLength?: number;
  width?: number;
  height?: number;
}

export interface PlayerApiResult {
  video: YouTubeVideoData;
  streamingFormats: YouTubeStreamingFormat[];
}

/**
 * Fetch video metadata via youtubei/v1/player with mobile client spoofing.
 * Mobile clients don't require POT, so streaming URLs work directly.
 * Must run in YouTube page context (same-origin).
 */
export async function fetchPlayerApi(
  videoId: string,
): Promise<PlayerApiResult> {
  // yt-dlp's ANDROID_VR client — no POT policies
  const client = {
    clientId: "28",
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.71.26 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    context: {
      clientName: "ANDROID_VR",
      clientVersion: "1.71.26",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
    },
  };

  // Extract visitorData from ytcfg on the page
  const ytcfg = (
    window as unknown as { ytcfg?: { data_?: Record<string, unknown> } }
  ).ytcfg;
  let visitorData: string | undefined;
  if (ytcfg?.data_) {
    const d = ytcfg.data_;
    visitorData =
      (d.VISITOR_DATA as string) ??
      ((
        (d.INNERTUBE_CONTEXT as Record<string, unknown>)?.client as Record<
          string,
          unknown
        >
      )?.visitorData as string);
  }
  if (!visitorData) {
    throw new Error("Could not extract visitorData from ytcfg");
  }

  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": client.clientId,
      "X-YouTube-Client-Version": client.context.clientVersion,
      "X-Goog-Visitor-Id": visitorData,
      Origin: "https://www.youtube.com",
      "User-Agent": client.userAgent,
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          ...client.context,
          userAgent: client.userAgent,
          hl: "en",
          timeZone: "UTC",
          utcOffsetMinutes: 0,
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Player API returned ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  const details = data.videoDetails as Record<string, unknown>;
  if (!details) {
    throw new Error("videoDetails not found in player API response");
  }

  // Extract streaming formats (adaptiveFormats)
  const streamingData = data.streamingData as
    | Record<string, unknown>
    | undefined;
  const rawFormats = (streamingData?.adaptiveFormats ?? []) as Record<
    string,
    unknown
  >[];
  const streamingFormats: YouTubeStreamingFormat[] = rawFormats
    .filter((f) => typeof f.url === "string")
    .map((f) => ({
      url: String(f.url),
      itag: Number(f.itag),
      mimeType: String(f.mimeType),
      contentLength:
        typeof f.contentLength === "string"
          ? Number(f.contentLength)
          : undefined,
      width: typeof f.width === "number" ? f.width : undefined,
      height: typeof f.height === "number" ? f.height : undefined,
    }));

  return {
    video: {
      youtubeId: String(details.videoId),
      title: String(details.title),
      channelName: String(details.author),
      channelId: String(details.channelId),
      duration: Number(details.lengthSeconds),
    },
    streamingFormats,
  };
}
