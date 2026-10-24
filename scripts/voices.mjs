#!/usr/bin/env node
// List AssemblyAI TTS voices and their voice IDs through the app's internal API
// (/api/tts/voices, which calls AssemblyAITTS.listVoices()). Start the app first.
//
//   npm run voices                         the 11 preset voices + counts per language
//   npm run voices -- --language spanish   every voice for one language
//   npm run voices -- --q british          search
//   npm run voices -- --all --json voices.json   every voice, saved as JSON
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const base = process.env.SMOKE_URL ?? `http://${process.env.APP_HOST?.trim() || "localhost"}:${process.env.APP_PORT?.trim() || "9000"}`;
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true);
};
const PRESETS = ["alba", "anna", "charles", "eve", "george", "jane", "jean", "mary", "michael", "paul", "vera"].map((n) => `aai-${n}`);

async function fetchAll(params) {
  const voices = [];
  let cursor = null;
  do {
    const url = new URL("/api/tts/voices", base);
    for (const [k, v] of Object.entries({ scope: "all", sort: "name", limit: "100", ...params })) if (v) url.searchParams.set(k, v);
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(`${body.code ?? res.status}: ${body.error ?? "request failed"}`);
    voices.push(...body.voices);
    cursor = body.hasMore ? body.nextCursor : null;
  } while (cursor);
  return voices;
}

try {
  const language = flag("language");
  const q = flag("q");
  const voices = await fetchAll({ language: typeof language === "string" ? language : "", q: typeof q === "string" ? q : "" });
  const out = flag("json");

  if (out) {
    const file = typeof out === "string" ? out : "voices.json";
    writeFileSync(file, `${JSON.stringify(voices, null, 2)}\n`);
    console.log(`Saved ${voices.length} voices to ${file}`);
  }

  const counts = {};
  for (const v of voices) counts[v.language] = (counts[v.language] ?? 0) + 1;
  console.log(`${voices.length} voices · ${Object.entries(counts).map(([l, n]) => `${l} ${n}`).join(" · ")}\n`);

  const show = language || q || flag("all") ? voices : PRESETS.map((s) => voices.find((v) => v.slug === s)).filter(Boolean);
  if (!language && !q && !flag("all")) console.log("Preset voices (each speaks all six languages):");
  for (const v of show) {
    const tags = v.tags.filter((t) => t.startsWith("gender:") || t.startsWith("accent:")).map((t) => t.split(":")[1]).join(", ");
    console.log(`${v.slug.padEnd(22)} ${v.id}  ${v.name.padEnd(14)} ${v.language.padEnd(11)} ${tags}`);
  }
} catch (e) {
  console.error(`Could not list voices from ${base}: ${e.message}`);
  process.exit(1);
}
