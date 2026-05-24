import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";

function copyPublicPlugin() {
  return {
    name: "copy-public-assets",
    closeBundle() {
      for (const f of ["icon16.svg", "icon48.svg", "icon128.svg", "manifest.json"]) {
        const src = resolve(__dirname, "public", f);
        if (existsSync(src)) copyFileSync(src, resolve(__dirname, "dist", f));
      }
      // Remove crossorigin attributes — extension popup context doesn't need CORS mode
      // and some Chromium builds reject crossorigin on chrome-extension:// same-origin loads.
      const htmlPath = resolve(__dirname, "dist", "index.html");
      if (existsSync(htmlPath)) {
        const html = readFileSync(htmlPath, "utf8").replace(/ crossorigin/g, "");
        writeFileSync(htmlPath, html, "utf8");
      }
    }
  };
}

export default defineConfig(() => ({
  plugins: [react(), copyPublicPlugin()],

  base: "./",

  server: { port: 5174 },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.ts"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "content") return "content.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        format: "es",
      }
    }
  }
}));
