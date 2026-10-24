#!/usr/bin/env node
// Start Next.js on APP_HOST:APP_PORT from .env.
//   node scripts/run.mjs dev     (npm run dev)
//   node scripts/run.mjs start   (npm start, after npm run build)
// Next.js itself loads .env for the server code; this only reads it early to pick the port.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const mode = process.argv[2] === "start" ? "start" : "dev";
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file); // does not override variables already set
    } catch (e) {
      console.warn(`[run] could not read ${file}: ${e.message}`);
    }
  }
}

const host = process.env.APP_HOST?.trim() || "localhost";
const port = process.env.APP_PORT?.trim() || "9000";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

console.log(`[run] next ${mode} on http://${host}:${port}`);
const child = spawn(process.execPath, [nextBin, mode, "-H", host, "-p", port, ...process.argv.slice(3)], {
  stdio: "inherit",
  env: process.env,
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
