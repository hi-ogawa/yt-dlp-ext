import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const git = (cmd: string) => execSync(cmd).toString().trim();
const rev = git("git rev-parse --short HEAD");
const dirty = git("git status --porcelain") ? "-dirty" : "";
const buildTime = new Date();

export default defineConfig({
  publicDir: "./public-ext",
  environments: {
    client: {
      build: {
        outDir: "./dist/ext",
        minify: false,
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
  builder: {
    async buildApp(builder) {
      await builder.build(builder.environments.client);
      await builder.build(builder.environments.background);
      const outDir = builder.environments.client.config.build.outDir;

      // Modify manifest for dev builds
      const manifestPath = path.join(outDir, "manifest.json");
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

      // Copy to main repo's dist/ext-dev for stable Chrome load point during development
      if (process.env.DEV_EXT) {
        const cwd = process.cwd();
        const match = path.basename(cwd).match(/^(.+)-wt\d+$/);
        const mainRepo = match ? path.join(cwd, "..", match[1]) : cwd;
        const dest = path.join(mainRepo, "dist/ext-dev");
        mkdirSync(dest, { recursive: true });
        cpSync(outDir, dest, { recursive: true });
        console.log(`[dev] Copied extension → ${dest}`);
      }
    },
  },
});
