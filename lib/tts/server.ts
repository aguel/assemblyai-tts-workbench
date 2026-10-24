import "server-only";

import { AssemblyAITTS } from "./assemblyai-tts";

/**
 * One shared client per server process, built from the ASSEMBLYAI_API_* variables.
 * Route handlers derive per-request copies with `getTTS().with({...})`.
 */
let shared: AssemblyAITTS | null = null;

export function getTTS(): AssemblyAITTS {
  if (!shared) shared = AssemblyAITTS.fromEnv();
  return shared;
}

export function isKeyConfigured(): boolean {
  return Boolean(process.env.ASSEMBLYAI_API_KEY?.trim());
}
