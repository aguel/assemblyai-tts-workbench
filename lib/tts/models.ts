/**
 * Constants shared by the server library, the internal API and the browser.
 * Nothing in this file is secret: it is safe to import from client components.
 *
 * Values follow AssemblyAI's Streaming TTS docs (https://assemblyai.com/docs/tts)
 * and the LiveKit sample plugin this project ports
 * (https://github.com/tom-aai/assemblyai-livekit-tts).
 */

/** Output encodings the service can produce. Only `pcm_s16le` is played by the browser. */
export type TTSEncoding = "pcm_s16le" | "pcm_mulaw" | "pcm_alaw";

/** Production WebSocket endpoint (US data zone). The EU zone is wss://tts.eu.assemblyai.com/v1/ws */
export const DEFAULT_BASE_URL = "wss://tts.us.assemblyai.com/v1/ws";
export const DEFAULT_VOICE_ID = "aai-jane";
export const DEFAULT_LANGUAGE = "english";
export const DEFAULT_MODEL = "assemblyai-tts-1";
export const DEFAULT_SAMPLE_RATE = 24000;
export const DEFAULT_ENCODING: TTSEncoding = "pcm_s16le";

/** The server refuses a single `Generate` frame longer than this (close 3006). */
export const MAX_GENERATE_CHARS = 2000;
/** The internal API refuses longer requests; the service buffers at most 8000 unspoken chars. */
export const MAX_REQUEST_CHARS = 5000;

export const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000] as const;
export type SampleRate = (typeof SAMPLE_RATES)[number];

export const LANGUAGES = [
  { id: "english", name: "English" },
  { id: "spanish", name: "Spanish" },
  { id: "german", name: "German" },
  { id: "french", name: "French" },
  { id: "italian", name: "Italian" },
  { id: "portuguese", name: "Portuguese" },
] as const;
export type LanguageId = (typeof LANGUAGES)[number]["id"];

/** The eleven AssemblyAI preset voices. Each speaks all six languages on assemblyai-tts-1. */
export const PRESET_VOICES = [
  { id: "aai-alba", name: "Alba" },
  { id: "aai-anna", name: "Anna" },
  { id: "aai-charles", name: "Charles" },
  { id: "aai-eve", name: "Eve" },
  { id: "aai-george", name: "George" },
  { id: "aai-jane", name: "Jane" },
  { id: "aai-jean", name: "Jean" },
  { id: "aai-mary", name: "Mary" },
  { id: "aai-michael", name: "Michael" },
  { id: "aai-paul", name: "Paul" },
  { id: "aai-vera", name: "Vera" },
] as const;

export function isLanguage(value: unknown): value is LanguageId {
  return typeof value === "string" && LANGUAGES.some((l) => l.id === value);
}

export function isSampleRate(value: unknown): value is SampleRate {
  return typeof value === "number" && (SAMPLE_RATES as readonly number[]).includes(value);
}

/** A voice_id is a library slug (aai-jane), one of your slugs, or a UUID. */
export function isVoiceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

export function voiceName(voiceId: string): string {
  return PRESET_VOICES.find((v) => v.id === voiceId)?.name ?? voiceId;
}

/** Normalise text the way the internal API sends it: one space between tokens. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Whitespace-delimited tokens, which is how the service counts words in WordBoundaries. */
export function tokenize(text: string): string[] {
  const clean = normalizeText(text);
  return clean ? clean.split(" ") : [];
}
