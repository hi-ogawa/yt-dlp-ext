# Quick-win refactoring

Post-MVP cleanup. Small, independent changes — each can be a separate commit.

## 1. Type-safe RPC abstraction

**Problem**: `iframe-rpc.ts` and `content.ts` both define `RpcRequest`/`RpcResponse` separately. The client returns `Promise<unknown>` and callers cast results manually (`as PlayerApiResult`, `as Promise<{ data: ArrayBuffer; ... }>`). Adding a new method means editing both files and keeping signatures in sync by hand.

**Fix**: Shared RPC type map + typed helpers.

- Define a single `RpcMethodMap` interface mapping method names to `{ params, result }` pairs (in a shared file, e.g. `lib/rpc.ts`).
- Client: generic `call<M>(method, params): Promise<RpcMethodMap[M]['result']>` — one implementation, no per-method wrappers.
- Server: typed handler registration that enforces the map — handler for method `M` must accept `RpcMethodMap[M]['params']` and return `RpcMethodMap[M]['result']`.
- Eliminate duplicate `RpcRequest`/`RpcResponse` interfaces.
- Transferable handling stays in the transport layer, not in business logic.

## 2. Extract pure utilities from index.tsx

**Problem**: `parseVideoId`, `formatBytes`, `formatLabel`, `isAudioOnly` are pure functions sitting in the component file. Not a big deal now, but they'll get in the way when the file grows with trimming UI etc.

**Fix**: Move to `lib/youtube-utils.ts` (or similar). One file, flat — no need to over-organize. Keep component file focused on React components and hooks.

## 3. Eliminate rpc null threading

**Problem**: `rpc` is `RefObject<... | undefined>` passed through `App → DownloadPage → DownloadForm`. Every handler starts with `if (!rpc.current) return`. The `ready` flag is also threaded as a prop.

**Fix**: Bail out early in `App` before rendering `DownloadPage`. Once `DownloadPage` renders, rpc is guaranteed non-null — no more defensive checks in handlers.

Concretely:

- `App` renders a loading state until `ready` is true and `rpc.current` exists.
- `DownloadPage` and `DownloadForm` receive a plain rpc object (not ref, not optional).

## 4. Adopt react-query for async operations

**Problem**: `handleSearch` and `handleDownload` manually manage `searching`/`downloading`/`done` state, try/catch with `toast.error`, and `setData`. This is boilerplate that will multiply as features are added.

**Fix**:

- `useQuery` or `useMutation` from `@tanstack/react-query`.
- Search: `useMutation` (triggered on form submit, not auto-fetched). Gives `isPending`, `data`, `error` for free.
- Download: `useMutation`. The multi-step download+convert+save flow becomes the mutation fn. Progress/done state comes from mutation status.
- Wire up `onError` to `toast.error` in one place (or via a global mutation cache callback).
- `QueryClientProvider` wraps `App`.

**Dependency**: Do item 3 first so the rpc object is cleanly available to pass into mutation fns.

## Non-goals

- Don't split components into separate files yet — not enough components to justify it.
- Don't refactor the convert worker RPC — it's a single method, the ad-hoc pattern is fine there.
- Don't touch `youtube.ts` — it's already clean.
