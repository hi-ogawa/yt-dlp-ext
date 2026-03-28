# Trim UI with live player seeking

## Goal

Let the user set trim start/end times interactively — play the video, seek to a position, capture it as start or end. The actual trimming (mediabunny `trim` option) is already implemented. The missing piece is a UI where the user can control a live player.

## Problem

The extension page lives at `chrome-extension://` origin. Embedding a YouTube player iframe there requires hacks (Referer header injection via `declarativeNetRequest`) and still produces unexplained errors (152-4). The iframe approach is fighting the browser.

## Approaches

### A. Fix embedding in extension page (current branch)

Keep the current architecture, debug error 152-4. Requires `declarativeNetRequest` permission and ongoing maintenance as YouTube changes embed behavior. Error 153 was fixed; 152-4 is undocumented and unclear.

**Verdict**: fragile, fighting the platform.

### B. Move UI to a hosted web page, extension as backend

The extension becomes a drop-in replacement for the server in youtube-dl-web-v2 or the local process in yt-dlp-gui. A web page (hosted at a real `https://` origin, e.g. Cloudflare Pages) handles the full UI including the YouTube player embed. The extension exposes download RPC to the page via `externally_connectable`.

- YouTube embed just works (real HTTP origin, proper Referer)
- Extension page becomes unnecessary
- Requires hosting a web app
- Extension + separate hosted web app = two things to maintain
- Extension is no more self-contained than Electron (user still needs to install something)

### C. Inject UI into the YouTube video page itself (ytsub-v5 style)

Content script on `youtube.com` injects a download/trim panel into the YouTube page alongside the native player. The user seeks using YouTube's own player controls, and the panel reads the current time directly from the page's player API (`ytInitialPlayerResponse`, `yt.player`, etc.).

- No embedding problem — we're on the YouTube page itself
- Native player seeking for free
- Trim UI lives next to the content being trimmed
- Content script on youtube.com is already in the manifest (`all_frames: true`, currently for the hidden iframe trick — would extend to the main frame)
- Tighter coupling to YouTube page DOM

### D. Extension page with no embedded player, manual time entry only

Keep the current extension page UI but drop the live player entirely. User enters start/end times as text (or copies from YouTube's share timestamp). Simpler, no embedding issues, but worse UX.

## Decision

Not decided. All options serve the same end goal. Key trade-offs:

|                             | Self-contained | Live player UX    | Maintenance risk |
| --------------------------- | -------------- | ----------------- | ---------------- |
| A. Fix extension embed      | yes            | yes (if it works) | high             |
| B. Web page + extension RPC | no             | yes               | medium           |
| C. Inject into YouTube page | yes            | yes (native)      | medium           |
| D. Text input only          | yes            | no                | low              |

Option C is attractive: no hosting, no embed hacks, native player. Option B matches youtube-dl-web-v2 lineage. Option D is a valid fallback if player integration proves too costly.
