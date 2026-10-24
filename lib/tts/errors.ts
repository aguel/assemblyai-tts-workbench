/**
 * Error types raised by AssemblyAITTS. They mirror the LiveKit plugin's
 * APIError / APIStatusError / APITimeoutError / APIConnectionError split.
 *
 * Close codes and error types: https://assemblyai.com/docs/tts/error-handling
 */

export class TTSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TTSError";
  }
}

export interface TTSStatusDetails {
  /** WebSocket close code / `error_code` (e.g. 1008 unauthorized, 3006 bad input, 3009 rate limited). */
  code: number;
  /** Stable machine-readable cause from the `Error` frame, e.g. `voice_not_found`. */
  errorType?: string | null;
  /** Connection parameter or field at fault, e.g. `voice_id`. */
  param?: string | null;
  /** Whether reconnecting with the same parameters can succeed. */
  retryable?: boolean | null;
  retryAfterSeconds?: number | null;
  sessionId?: string | null;
}

/** The service refused the session or closed it (an `Error` frame or an unexpected close). */
export class TTSStatusError extends TTSError {
  readonly code: number;
  readonly errorType: string | null;
  readonly param: string | null;
  readonly retryable: boolean | null;
  readonly retryAfterSeconds: number | null;
  readonly sessionId: string | null;

  constructor(message: string, details: TTSStatusDetails) {
    super(message);
    this.name = "TTSStatusError";
    this.code = details.code;
    this.errorType = details.errorType ?? null;
    this.param = details.param ?? null;
    this.retryable = details.retryable ?? null;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
    this.sessionId = details.sessionId ?? null;
  }

  /** The HTTP status the internal API answers with for this failure. */
  get httpStatus(): number {
    if (this.code === 1008) return 401;
    if (this.code === 3009 || this.code === 3010) return 429;
    if (this.code === 3006 || this.code === 3012 || this.code === 3014) return 400;
    return 502;
  }
}

/** No `Begin`, audio or answer arrived within the timeout. */
export class TTSTimeoutError extends TTSError {
  constructor(message = "AssemblyAI TTS timed out") {
    super(message);
    this.name = "TTSTimeoutError";
  }
}

/** The socket could not be opened or was lost. Never echoes the URL or headers (they hold the key). */
export class TTSConnectionError extends TTSError {
  constructor(message = "Could not connect to AssemblyAI TTS") {
    super(message);
    this.name = "TTSConnectionError";
  }
}

/** The caller aborted the stream (AbortSignal or cancel()). */
export class TTSAbortError extends TTSError {
  constructor(message = "AssemblyAI TTS stream was aborted") {
    super(message);
    this.name = "TTSAbortError";
  }
}
