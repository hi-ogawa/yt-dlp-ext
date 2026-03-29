/**
 * Investigates the CORS redirect issue that occurs when downloading long videos.
 *
 * YouTube's CDN sometimes issues CMS redirects (cms_redirect=yes, rrc=191)
 * for content not cached on the initial CDN node. The redirect target lacks
 * CORS headers, causing browser fetches from youtube.com to fail.
 *
 * Target: https://www.youtube.com/watch?v=YsmSk0cZa6w (~44 min, ~40 MB audio)
 * This video reliably triggers the redirect.
 *
 * Strategy:
 *   1. Node-side (no CORS): probe headers, follow redirects manually, compare
 *      behaviour between Range header vs &range= param vs c=WEB.
 *   2. Browser-side (youtube.com context): run the same fetches and assert
 *      no CORS failure, verifying which URL approach survives in the browser.
 */

import { expect, test } from "@playwright/test";
import { fetchPlayerApi } from "../src/lib/youtube.ts";

// https://www.youtube.com/watch?v=YsmSk0cZa6w
const LONG_VIDEO_ID = "YsmSk0cZa6w";

// ---- helpers ----------------------------------------------------------------

/** Pick the largest audio-only format (most likely to trigger redirects). */
function pickAudioFormat(
  formats: Awaited<ReturnType<typeof fetchPlayerApi>>["streamingFormats"],
) {
  return formats
    .filter((f) => f.mimeType.startsWith("audio/") && f.contentLength)
    .sort((a, b) => (b.contentLength ?? 0) - (a.contentLength ?? 0))[0];
}

// ---- Node-side probes (no CORS, full redirect visibility) -------------------

test("node: probe redirect behaviour — Range header vs &range= param @yt", async ({
  page,
}) => {
  await page.goto(`https://www.youtube.com/watch?v=not-found`);

  // Fetch player API from browser context to get a valid signed URL
  const result = await page.evaluate(fetchPlayerApi, LONG_VIDEO_ID);
  const format = pickAudioFormat(result.streamingFormats);
  expect(format).toBeTruthy();

  const url = format!.url;
  const CHUNK = 5_000_000;

  // --- 1. Range header (current approach before fix) ---
  const rangeHeaderRes = await fetch(url, {
    headers: { range: "bytes=0-4999999" },
    redirect: "manual",
  });
  console.log(
    "Range header — status:",
    rangeHeaderRes.status,
    "type:",
    rangeHeaderRes.type,
  );
  console.log(
    "Range header — location:",
    rangeHeaderRes.headers.get("location"),
  );

  // --- 2. &range= query param (current fix) ---
  const rangeParamRes = await fetch(`${url}&range=0-${CHUNK - 1}`, {
    redirect: "manual",
  });
  console.log(
    "&range= param — status:",
    rangeParamRes.status,
    "type:",
    rangeParamRes.type,
  );
  console.log(
    "&range= param — location:",
    rangeParamRes.headers.get("location"),
  );

  // --- 3. &range= param + c=WEB (hypothesis) ---
  const webUrl = `${url}&range=0-${CHUNK - 1}`.replace(
    /([?&]c)=ANDROID_VR\b/,
    "$1=WEB",
  );
  const webClientRes = await fetch(webUrl, { redirect: "manual" });
  console.log(
    "c=WEB — status:",
    webClientRes.status,
    "type:",
    webClientRes.type,
  );
  console.log("c=WEB — location:", webClientRes.headers.get("location"));

  // Log the final URL after following redirects for each approach
  const [rangeHeaderFinal, rangeParamFinal, webClientFinal] = await Promise.all(
    [
      fetch(url, { headers: { range: "bytes=0-4999999" } }).then((r) => r.url),
      fetch(`${url}&range=0-${CHUNK - 1}`).then((r) => r.url),
      fetch(webUrl).then((r) => r.url),
    ],
  );
  console.log(
    "Range header — final URL host:",
    new URL(rangeHeaderFinal).hostname,
  );
  console.log(
    "&range= param — final URL host:",
    new URL(rangeParamFinal).hostname,
  );
  console.log("c=WEB    — final URL host:", new URL(webClientFinal).hostname);

  // All should eventually succeed in Node (no CORS)
  expect(
    rangeHeaderRes.status === 200 ||
      rangeHeaderRes.status === 206 ||
      rangeHeaderRes.status === 302,
  ).toBe(true);
});

test("node: probe CORS headers on redirect target @yt", async ({ page }) => {
  await page.goto(`https://www.youtube.com/watch?v=not-found`);

  const result = await page.evaluate(fetchPlayerApi, LONG_VIDEO_ID);
  const format = pickAudioFormat(result.streamingFormats);
  expect(format).toBeTruthy();

  const url = `${format!.url}&range=0-4999999`;

  // Follow the redirect manually — get the Location, then fetch it directly
  const initial = await fetch(url, { redirect: "manual" });
  const location = initial.headers.get("location");
  console.log(
    "initial status:",
    initial.status,
    "redirects:",
    initial.status === 302 || initial.status === 301,
  );

  if (location) {
    console.log("redirect location:", location);
    const redirected = await fetch(location, {
      headers: { Origin: "https://www.youtube.com" },
    });
    console.log(
      "redirect target CORS header:",
      redirected.headers.get("access-control-allow-origin"),
    );
    console.log("redirect target status:", redirected.status);
  } else {
    console.log("no redirect — served directly");
    const cors = initial.headers.get("access-control-allow-origin");
    console.log("direct CORS header:", cors);
  }
});

test("node: full range loop completes @yt", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`https://www.youtube.com/watch?v=not-found`);

  const result = await page.evaluate(fetchPlayerApi, LONG_VIDEO_ID);
  const format = pickAudioFormat(result.streamingFormats);
  expect(format).toBeTruthy();

  const totalSize = format!.contentLength!;
  const CHUNK_SIZE = 5_000_000;
  const numChunks = Math.ceil(totalSize / CHUNK_SIZE);
  console.log(
    `full loop: ${totalSize} bytes (~${(totalSize / 1_000_000).toFixed(1)} MB), ${numChunks} chunks`,
  );

  for (let i = 0; i < numChunks; i++) {
    const chunkStart = CHUNK_SIZE * i;
    const chunkEnd = Math.min(CHUNK_SIZE * (i + 1), totalSize) - 1;
    const res = await fetch(`${format!.url}&range=${chunkStart}-${chunkEnd}`);
    const bytes = (await res.arrayBuffer()).byteLength;
    console.log(
      `chunk ${i}: status=${res.status} bytes=${bytes} finalHost=${new URL(res.url).hostname}`,
    );
    expect(res.ok).toBe(true);
  }
});

// ---- Browser-side (youtube.com context, CORS applies) ----------------------

test("browser: &range= param survives CORS on chunk 0 @yt", async ({
  page,
}) => {
  await page.goto(`https://www.youtube.com/watch?v=${LONG_VIDEO_ID}`);

  const result = await page.evaluate(fetchPlayerApi, LONG_VIDEO_ID);
  const format = pickAudioFormat(result.streamingFormats);
  expect(format).toBeTruthy();

  // Fetch chunk 0 via &range= param from youtube.com context
  const chunkResult = await page.evaluate(async (url: string) => {
    try {
      const res = await fetch(`${url}&range=0-4999999`);
      return { ok: res.ok, status: res.status, finalUrl: res.url };
    } catch (e) {
      return { error: String(e) };
    }
  }, format!.url);

  console.log("browser &range= chunk 0:", chunkResult);
  expect(chunkResult).not.toHaveProperty("error");
  expect((chunkResult as { ok: boolean }).ok).toBe(true);
});

test("browser: c=WEB survives CORS on chunk 0 @yt", async ({ page }) => {
  await page.goto(`https://www.youtube.com/watch?v=${LONG_VIDEO_ID}`);

  const result = await page.evaluate(fetchPlayerApi, LONG_VIDEO_ID);
  const format = pickAudioFormat(result.streamingFormats);
  expect(format).toBeTruthy();

  const chunkResult = await page.evaluate(async (url: string) => {
    const webUrl = `${url}&range=0-4999999`.replace(
      /([?&]c)=ANDROID_VR\b/,
      "$1=WEB",
    );
    try {
      const res = await fetch(webUrl);
      return { ok: res.ok, status: res.status, finalUrl: res.url };
    } catch (e) {
      return { error: String(e) };
    }
  }, format!.url);

  console.log("browser c=WEB chunk 0:", chunkResult);
  expect(chunkResult).not.toHaveProperty("error");
  expect((chunkResult as { ok: boolean }).ok).toBe(true);
});

test("browser: full range loop completes without CORS error @yt", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`https://www.youtube.com/watch?v=${LONG_VIDEO_ID}`);

  const result = await page.evaluate(fetchPlayerApi, LONG_VIDEO_ID);
  const format = pickAudioFormat(result.streamingFormats);
  expect(format).toBeTruthy();

  const totalSize = format!.contentLength!;
  console.log(
    `full loop: ${totalSize} bytes (~${(totalSize / 1_000_000).toFixed(1)} MB)`,
  );

  // Mirror downloadBytes exactly: chunk by CHUNK_SIZE until totalSize is covered.
  // Drains the response body of each chunk to exercise streaming (not just headers).
  const chunkResults = await page.evaluate(
    async ({ url, totalSize }: { url: string; totalSize: number }) => {
      const CHUNK_SIZE = 5_000_000;
      const numChunks = Math.ceil(totalSize / CHUNK_SIZE);
      const results = [];
      for (let i = 0; i < numChunks; i++) {
        const chunkStart = CHUNK_SIZE * i;
        const chunkEnd = Math.min(CHUNK_SIZE * (i + 1), totalSize) - 1;
        try {
          const res = await fetch(`${url}&range=${chunkStart}-${chunkEnd}`);
          if (!res.ok) {
            results.push({
              chunk: i,
              ok: false,
              status: res.status,
              finalUrl: res.url,
            });
            break;
          }
          // Drain body to confirm full delivery
          const bytes = (await res.arrayBuffer()).byteLength;
          results.push({
            chunk: i,
            ok: true,
            status: res.status,
            bytes,
            finalUrl: res.url,
          });
        } catch (e) {
          results.push({ chunk: i, error: String(e) });
          break;
        }
      }
      return results;
    },
    { url: format!.url, totalSize },
  );

  console.log("full loop results:", JSON.stringify(chunkResults, null, 2));
  for (const r of chunkResults) {
    expect(r).not.toHaveProperty("error");
    expect((r as { ok: boolean }).ok).toBe(true);
  }
});
