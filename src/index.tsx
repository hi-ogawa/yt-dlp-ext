import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, queryClient } from "./app.tsx";
import { loadYoutubeIframeApi } from "./lib/youtube-player.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

// preload youtube ifram api script
loadYoutubeIframeApi();
