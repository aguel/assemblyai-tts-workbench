#!/usr/bin/env node
// End-to-end check of the internal API against a running app (npm run dev first).
//   npm run test:tts
// Hits /api/tts/config, /api/tts/voices and /api/tts/speak, and prints what came back.
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const base = process.env.SMOKE_URL ?? `http://${process.env.APP_HOST?.trim() || "localhost"}:${process.env.APP_PORT?.trim() || "9000"}`;

let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
};

try {
  const cfg = await (await fetch(`${base}/api/tts/config`)).json();
  check(cfg.keyConfigured, "config", `voice ${cfg.defaults.voiceId}, ${cfg.defaults.language}, ${cfg.defaults.endpoint}`);

  const voices = await (await fetch(`${base}/api/tts/voices?language=english&limit=3`)).json();
  check(Array.isArray(voices.voices), "voices", `${voices.total ?? "?"} public English voices`);

  const t0 = performance.now();
  const res = await fetch(`${base}/api/tts/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Smoke test. Two sentences, two requests." }),
  });
  const counts = {};
  let firstAudio = null;
  let bytes = 0;
  let error = null;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const ev = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      counts[ev.type] = (counts[ev.type] ?? 0) + 1;
      if (ev.type === "audio") {
        firstAudio ??= Math.round(performance.now() - t0);
        bytes += Buffer.from(ev.audio, "base64").length;
      }
      if (ev.type === "error") error = ev;
    }
  }
  check(!error && counts.end === 1, "speak (stream)", error ? `${error.code}: ${error.error}` : `first audio ${firstAudio} ms, ${(bytes / 48000).toFixed(2)} s, ${JSON.stringify(counts)}`);

  const bad = await fetch(`${base}/api/tts/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "" }),
  });
  check(bad.status === 400, "rejects empty text", `HTTP ${bad.status}`);
} catch (e) {
  check(false, `could not reach ${base}`, e.message);
}

process.exit(failed ? 1 : 0);
