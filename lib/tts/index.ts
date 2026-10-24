import "server-only";

export {
  AssemblyAITTS,
  ChunkedStream,
  SynthesizeStream,
  pcmToWav,
  resolveBaseUrl,
  type BeginConfiguration,
  type ConnOptions,
  type ListVoicesParams,
  type SentFrame,
  type TTSEvent,
  type TTSOptions,
  type VoiceSummary,
  type WordBoundary,
} from "./assemblyai-tts";
export * from "./errors";
export * from "./models";
export { SentenceTokenizer, splitLong } from "./sentences";
export { getTTS, isKeyConfigured } from "./server";
