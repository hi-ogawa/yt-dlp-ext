# YouTube embed in extension page

Goal: show a live YouTube player in the extension page so the user can play the video and use "use current" / "seek" buttons to set trim start/end times.

## Problem statement

Chrome extension pages have a `chrome-extension://` origin. When an iframe on such a page loads `https://www.youtube.com/embed/VIDEO_ID`, Chrome does not send a `Referer` header with the request. YouTube requires this header to verify the embedder's identity — without it the player refuses to initialize.

## Errors encountered

| Code  | Meaning                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------- |
| 153   | `embedder.identity.missing.referrer` — no `Referer` header sent by Chrome from `chrome-extension://` origin |
| 152-4 | Undocumented YouTube innertube/player error. Appeared after the Referer fix. Root cause unclear.            |

## Approaches tried

### 1. Plain `youtube.com` embed — failed (error 153)

```tsx
<iframe
  src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=...`}
/>
```

Chrome omits `Referer` from `chrome-extension://` origins → YouTube rejects with error 153.

### 2. `youtube-nocookie.com` embed — failed (error 153)

Same missing-Referer problem; `youtube-nocookie.com` is not a meaningful bypass for this specific error.

### 3. `declarativeNetRequest` — inject synthetic `Referer` header — failed (error 152-4)

Registered a dynamic rule in `background.ts` to set `Referer: https://www.youtube.com` on all `sub_frame` requests to `youtube.com` initiated from the extension itself:

```ts
chrome.declarativeNetRequest.updateDynamicRules({
  addRules: [
    {
      id: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "referer",
            operation: "set",
            value: "https://www.youtube.com",
          },
        ],
      },
      condition: {
        urlFilter: "||youtube.com/",
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["sub_frame"],
      },
    },
  ],
});
```

Error 153 was resolved, but the player now shows error 152-4 (undocumented). Unclear if this is a different embedding restriction, an API key / client identity issue, or something else.

## Next options to investigate

- **Relay page**: embed the YouTube player inside an intermediate HTTPS page (hosted externally or as an extension resource served via `web_accessible_resources`) that has a real HTTP origin. The relay page handles the `postMessage` API and forwards time events to the extension page. More complex but avoids all origin/header issues.
- **`web_accessible_resources` trick**: serve a small HTML file from the extension itself as a `web_accessible_resource` and embed it in an iframe; that inner page then embeds the YouTube iframe — unclear if the inner iframe's origin improves anything.
- **Inspect what 152-4 actually is**: open the embed URL directly in a browser tab (with DevTools) or check network requests in the extension page to see what YouTube's innertube API returns in the `playabilityStatus` field.
