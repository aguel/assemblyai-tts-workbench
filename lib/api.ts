import "server-only";

import {
  isLanguage,
  isSampleRate,
  isVoiceId,
  MAX_REQUEST_CHARS,
  normalizeText,
  TTSAbortError,
  TTSConnectionError,
  TTSStatusError,
  TTSTimeoutError,
  type SampleRate,
} from "@/lib/tts";

/** The body POST /api/tts/speak accepts. Every field but `text` is optional. */
export interface SpeakRequest {
  text: string;
  voiceId?: string;
  language?: string;
  sampleRate?: SampleRate;
  wordTimestamps?: boolean;
  /** "stream": one Generate/Flush per sentence (SynthesizeStream). "chunked": one-shot (ChunkedStream). */
  mode?: "stream" | "chunked";
  /** "ndjson" (default) streams events; "wav" returns one audio file. */
  format?: "ndjson" | "wav";
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; status: number; error: ApiError };

export interface ApiError {
  error: string;
  code: string;
  param?: string | null;
  retryable?: boolean | null;
  retryAfterSeconds?: number | null;
}

export function parseSpeakRequest(body: unknown): Parsed<Required<Omit<SpeakRequest, "voiceId" | "language" | "sampleRate">> & Pick<SpeakRequest, "voiceId" | "language" | "sampleRate">> {
  if (!body || typeof body !== "object") return bad("Body must be a JSON object", "invalid_body");
  const b = body as Record<string, unknown>;
  if (typeof b.text !== "string") return bad("`text` is required", "invalid_parameter", "text");
  const text = normalizeText(b.text);
  if (!text) return bad("`text` is empty", "invalid_parameter", "text");
  if (text.length > MAX_REQUEST_CHARS)
    return bad(`\`text\` is over ${MAX_REQUEST_CHARS} characters`, "invalid_parameter", "text");
  if (b.voiceId !== undefined && !isVoiceId(b.voiceId))
    return bad("`voiceId` must be a voice slug such as aai-jane, or a UUID", "invalid_parameter", "voiceId");
  if (b.language !== undefined && !isLanguage(b.language))
    return bad("`language` must be english, spanish, german, french, italian or portuguese", "invalid_parameter", "language");
  if (b.sampleRate !== undefined && !isSampleRate(b.sampleRate))
    return bad("`sampleRate` must be one of 8000, 16000, 22050, 24000, 44100, 48000", "invalid_parameter", "sampleRate");
  if (b.mode !== undefined && b.mode !== "stream" && b.mode !== "chunked")
    return bad('`mode` must be "stream" or "chunked"', "invalid_parameter", "mode");
  if (b.format !== undefined && b.format !== "ndjson" && b.format !== "wav")
    return bad('`format` must be "ndjson" or "wav"', "invalid_parameter", "format");

  return {
    ok: true,
    value: {
      text,
      voiceId: b.voiceId as string | undefined,
      language: b.language as string | undefined,
      sampleRate: b.sampleRate as SampleRate | undefined,
      wordTimestamps: b.wordTimestamps === undefined ? true : Boolean(b.wordTimestamps),
      mode: (b.mode as "stream" | "chunked") ?? "stream",
      format: (b.format as "ndjson" | "wav") ?? "ndjson",
    },
  };
}

function bad(error: string, code: string, param?: string): { ok: false; status: number; error: ApiError } {
  return { ok: false, status: 400, error: { error, code, param: param ?? null } };
}

/** Map a library error onto the internal API's error shape and HTTP status. */
export function toApiError(e: unknown): { status: number; body: ApiError } {
  if (e instanceof TTSStatusError) {
    return {
      status: e.httpStatus,
      body: {
        error: e.message,
        code: e.errorType ?? `close_${e.code}`,
        param: e.param,
        retryable: e.retryable,
        retryAfterSeconds: e.retryAfterSeconds,
      },
    };
  }
  if (e instanceof TTSTimeoutError) return { status: 504, body: { error: e.message, code: "timeout", retryable: true } };
  if (e instanceof TTSConnectionError) return { status: 502, body: { error: e.message, code: "connection_failed", retryable: true } };
  if (e instanceof TTSAbortError) return { status: 499, body: { error: e.message, code: "aborted" } };
  const message = e instanceof Error ? e.message : "Unexpected error";
  return { status: 500, body: { error: message, code: "internal_error" } };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
