#!/usr/bin/env node
// Builds the extension and zips dist/ into apps/web/public/git-curriculo-extension.zip
import { execSync } from "child_process";
import { createWriteStream, mkdirSync } from "fs";
import { resolve, relative } from "path";
import { readdirSync, statSync } from "fs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const distDir = resolve(root, "apps/extension/dist");
const outDir = resolve(root, "apps/web/public");
const outZip = resolve(outDir, "git-curriculo-extension.zip");

console.log("Building extension...");
execSync("npm run build --workspace=apps/extension", { stdio: "inherit", cwd: root });

console.log("Zipping extension...");
mkdirSync(outDir, { recursive: true });

// Use archiver if available, else fall back to PowerShell/zip
try {
  const { default: archiver } = await import("archiver");
  await new Promise((resolve, reject) => {
    const out = createWriteStream(outZip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    out.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(out);
    archive.directory(distDir, false);
    archive.finalize();
  });
} catch {
  // archiver not available — use system zip
  const { platform } = process;
  if (platform === "win32") {
    execSync(`powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${outZip}' -Force"`, { stdio: "inherit" });
  } else {
    execSync(`cd "${distDir}" && zip -r "${outZip}" .`, { stdio: "inherit" });
  }
}

const { statSync: stat } = await import("fs");
const kb = Math.round(stat(outZip).size / 1024);
console.log(`Done: apps/web/public/git-curriculo-extension.zip (${kb} KB)`);
