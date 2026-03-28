import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    entries: ["./src/worker.ts"],
  },
  server: {
    forwardConsole: true,
  },
  build: {
    outDir: "./dist/web",
  },
});
