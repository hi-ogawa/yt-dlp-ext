import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useTheme } from "./lib/theme.ts";
import "./styles.css";

function App() {
  useTheme();
  return (
    <div className="min-h-screen">
      <header className="flex h-10 items-center border-b px-3">
        <span className="text-sm font-semibold">yt-dlp-ext</span>
      </header>
      <div className="mx-auto max-w-lg p-6">
        <p className="text-sm text-muted-foreground">
          Download page placeholder
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
