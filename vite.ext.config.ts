import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const git = (cmd: string) => execSync(cmd).toString().trim();
const rev = git("git rev-parse --short HEAD");
const dirty = git("git status --porcelain") ? "-dirty" : "";
const buildTime = new Date();

export default defineConfig({
  environments: {
    client: {
      build: {
        outDir: "./dist/ext",
        minify: false,
      },
    },
    page: {
      consumer: "client",
      build: {
        outDir: "./dist/ext",
        minify: false,
        emptyOutDir: false,
        copyPublicDir: false,
        rolldownOptions: {
          input: {
            content: "./src/content.ts",
          },
          output: {
            format: "iife",
            entryFileNames: "[name].js",
          },
        },
      },
    },
    background: {
      consumer: "client",
      build: {
        outDir: "./dist/ext",
        minify: false,
        emptyOutDir: false,
        copyPublicDir: false,
        rolldownOptions: {
          input: {
            background: "./src/background.ts",
          },
          output: {
            format: "iife",
            entryFileNames: "[name].js",
          },
        },
      },
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __BUILD_TIME__: JSON.stringify(buildTime.toISOString()),
    __GIT_REV__: JSON.stringify(rev + dirty),
  },
  plugins: [react(), tailwindcss()],
  builder: {
    async buildApp(builder) {
      await builder.build(builder.environments.client);
      await builder.build(builder.environments.page);
      await builder.build(builder.environments.background);
      const outDir = builder.environments.client.config.build.outDir;

      // Modify manifest for dev builds
      const manifestPath = resolve(outDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (process.env.DEV_EXT) {
        const branch = git("git branch --show-current");
        const time = buildTime.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        manifest.name = `yt-dlp-ext-dev [${branch} ${rev} ${time}]`;
      }
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // Copy to dist/ext-dev for stable Chrome load point during development
      if (process.env.DEV_EXT) {
        const dest = resolve("dist/ext-dev");
        mkdirSync(dest, { recursive: true });
        cpSync(outDir, dest, { recursive: true });
        console.log(`[dev] Copied extension → ${dest}`);
      }
    },
  },
});
