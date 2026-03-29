# CORS Redirect Fix for Long Videos

## Problem

Downloads fail on longer/less popular videos with:

```
Access to fetch at 'https://rr3---sn-oguelnzs.googlevideo.com/...'
(redirected from 'https://rr1---sn-3qqp-ioqzl.googlevideo.com/...')
from origin 'https://www.youtube.com' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## Root cause

The streaming URLs returned by our `ANDROID_VR` player API client have `c=ANDROID_VR` baked in. This tells YouTube's CDN to route requests through mobile-optimized backend servers. Those servers sometimes issue **CMS redirects** (`cms_redirect=yes`, `rrc=191`) to a different CDN node for content that isn't locally cached. The redirect target doesn't include CORS headers, so the browser blocks the response.

The YouTube web player doesn't hit this because it uses the `WEB` client — whose CDN nodes are CORS-configured and don't issue these redirects for web traffic.

## Why yt-dlp is not affected

yt-dlp is a native tool. It follows redirects freely with no CORS constraints. Its `build_fragments` approach (`&range=` query param, `_video.py:3391`) prevents some CDN geo-redirects but not CMS redirects. Our `&range=` fix (in `downloadBytes`) does the same — reduces some redirects but not the CMS kind.

## Why switching clients is hard

The other clients that skip POT and JS-player signature decryption (`android_vr`, `ios`) are all mobile clients and get the same non-web CDN routing. The `tv` (TVHTML5) client routes through web CDN but requires JS-player signature decryption — the exact complexity `ANDROID_VR` was chosen to avoid.

## Hypothesis

`c=ANDROID_VR` is **not** in `sparams` (the signed URL parameters), so it can be modified without breaking the signature:

```
sparams=expire,ei,ip,id,itag,source,requiressl,xpc,bui,spc,vprv,svpuc,mime,rqh,gir,clen,dur,lmt
```

Replacing `c=ANDROID_VR` → `c=WEB` in the URL before fetching may cause YouTube's CDN to route through web servers that have CORS configured, eliminating the redirect entirely. A one-liner in `downloadBytes`:

```ts
const fetchUrl = `${url}&range=${chunkStart}-${chunkEnd - 1}`.replace(
  /([?&]c)=ANDROID_VR\b/,
  "$1=WEB",
);
```

This needs testing against a long video (~40 MB+, ~44 min) that reproduces the `cms_redirect=yes` error.

## References

- yt-dlp client table: `yt_dlp/extractor/youtube/_base.py`
- yt-dlp `build_fragments` (`&range=` approach): `yt_dlp/extractor/youtube/_video.py:3391`
