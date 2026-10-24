import { connection } from "next/server";

import { json } from "@/lib/api";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_VOICE_ID,
  getTTS,
  isKeyConfigured,
  LANGUAGES,
  MAX_GENERATE_CHARS,
  MAX_REQUEST_CHARS,
  PRESET_VOICES,
  SAMPLE_RATES,
} from "@/lib/tts";

/**
 * GET /api/tts/config
 * The defaults from .env (never the key) and the choices the UI offers.
 */
export async function GET() {
  await connection();
  const configured = isKeyConfigured();
  const defaults = configured
    ? getTTS().publicOptions
    : { voiceId: DEFAULT_VOICE_ID, language: DEFAULT_LANGUAGE, model: DEFAULT_MODEL, sampleRate: DEFAULT_SAMPLE_RATE };

  return json({
    keyConfigured: configured,
    provider: "AssemblyAI",
    defaults: {
      voiceId: defaults.voiceId,
      language: defaults.language,
      model: defaults.model,
      sampleRate: defaults.sampleRate,
      endpoint: "baseUrl" in defaults ? defaults.baseUrl : null,
    },
    languages: LANGUAGES,
    presetVoices: PRESET_VOICES,
    sampleRates: SAMPLE_RATES,
    limits: { maxRequestChars: MAX_REQUEST_CHARS, maxGenerateChars: MAX_GENERATE_CHARS },
  });
}
