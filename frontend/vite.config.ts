/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const PRECACHE_MAX_BYTES = 1024 * 1024; // large files (e.g. the 1.6 MB demo bundle) are cached on demand, not up front
const PRECACHE_SKIP = [/^sw\.js$/, /\.map$/, /^demo\//, /^ti\//];

/** Stamps sw.js with a content-derived cache version and the list of built shell files to precache. */
function serviceWorkerManifest(): Plugin {
  let outDir = "";
  return {
    name: "threatlens-sw",
    apply: "build",
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const sw = path.join(outDir, "sw.js");
      if (!existsSync(sw)) return;
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full); else files.push(path.relative(outDir, full).split(path.sep).join("/"));
        }
      };
      walk(outDir);
      const list = files.filter((f) => !PRECACHE_SKIP.some((r) => r.test(f)) && statSync(path.join(outDir, f)).size <= PRECACHE_MAX_BYTES).sort();
      const hash = createHash("sha256");
      for (const f of list) hash.update(f).update(readFileSync(path.join(outDir, f)));
      const urls = ["/", ...list.map((f) => `/${f}`)];
      writeFileSync(sw, readFileSync(sw, "utf8")
        .replace("__CACHE_VERSION__", hash.digest("hex").slice(0, 12))
        .replace("/*__PRECACHE_LIST__*/[]", JSON.stringify(urls)));
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerManifest()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ["recharts"],
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
