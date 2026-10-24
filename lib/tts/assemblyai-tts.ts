import "server-only";

import {
  TTSAbortError,
  TTSConnectionError,
  TTSError,
  TTSStatusError,
  TTSTimeoutError,
} from "./errors";
import {
  DEFAULT_BASE_URL,
  DEFAULT_ENCODING,
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_VOICE_ID,
  type TTSEncoding,
} from "./models";
import { SentenceTokenizer, splitLong } from "./sentences";

/**
 * AssemblyAI Streaming TTS client: a TypeScript port of the LiveKit plugin
 * https://github.com/tom-aai/assemblyai-livekit-tts/blob/main/assemblyai_tts/tts.py
 *
 * The service is WebSocket-only. A session opens a socket, the server replies with
 * `Begin`, and the client drives synthesis with `Generate` (append text), `Flush`
 * (speak what is buffered and mark a boundary) and `Terminate` (flush the rest and
 * close). Audio comes back as base64 `Audio` frames, each `Flush` is answered by
 * `FlushDone` (and, when requested, `WordBoundaries`), and `Terminate` by
 * `Termination`.
 *
 *   const tts = AssemblyAITTS.fromEnv();
 *
 *   // one fixed text (LiveKit: tts.synthesize)
 *   for await (const ev of tts.synthesize("Hello there.")) { ... }
 *
 *   // incremental text, one Generate/Flush per sentence (LiveKit: tts.stream)
 *   const stream = tts.stream();
 *   stream.pushText("Hello there. How are ");
 *   stream.pushText("you today?");
 *   stream.endInput();
 *   for await (const ev of stream) { ... }
 *
 * Server-only: the API key never leaves the process.
 */

// ---------------------------------------------------------------------------
// Options and events
// ---------------------------------------------------------------------------

export interface TTSOptions {
  /** "aai-<name>" for preset and library voices, or one of your voice UUIDs/slugs. */
  voiceId: string;
  /** Full English language name, e.g. "english", "spanish". */
  language: string;
  /** Sent as the `model_id` connect parameter. */
  model: string;
  encoding: TTSEncoding;
  sampleRate: number;
  /** Request `WordBoundaries` frames. */
  wordTimestamps: boolean;
  apiKey: string;
  /** WebSocket endpoint, e.g. wss://tts.us.assemblyai.com/v1/ws */
  baseUrl: string;
}

export interface ConnOptions {
  /** Max wait for `Begin`, and for the next frame while an answer is owed. Default 10 s. */
  timeoutMs?: number;
  /** Abort the stream (closes the socket, the iterator throws TTSAbortError). */
  signal?: AbortSignal;
  /** Called with every frame as it is written to the socket (for logging and debugging). */
  onSend?: (frame: SentFrame) => void;
}

export interface SentFrame {
  type: "Generate" | "Flush" | "Terminate" | "Cancel" | "KeepAlive";
  text?: string;
}

export interface WordBoundary {
  word: string;
  /** Milliseconds on the session's continuous audio timeline. */
  start: number;
  end: number;
  confidence: number;
}

export interface BeginConfiguration {
  language?: string;
  sample_rate?: number;
  encoding?: string;
  voice_id?: string;
  model?: string;
  word_boundaries?: boolean;
  inactivity_timeout?: number;
  session_ttl_sec?: number;
  [key: string]: unknown;
}

export type TTSEvent =
  | { type: "begin"; sessionId: string; expiresAt: number | null; configuration: BeginConfiguration }
  | { type: "audio"; flushId: number; audio: Uint8Array }
  | { type: "flush_done"; flushId: number; audioDurationMs: number }
  | { type: "words"; flushId: number; audioStartMs: number; words: WordBoundary[] }
  | { type: "cancelled"; audioDurationSeconds: number }
  | {
      type: "end";
      sessionDurationSeconds: number;
      totalInputChars: number;
      audioDurationSeconds: number;
    };

export interface VoiceSummary {
  id: string;
  slug: string;
  name: string;
  language: string;
  description: string | null;
  tags: string[];
  publisher: string | null;
}

export interface ListVoicesParams {
  scope?: "owned" | "public" | "all";
  q?: string;
  language?: string;
  tags?: string[];
  sort?: "recent" | "name";
  limit?: number;
  cursor?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const KEEPALIVE_MS = 30_000;

// Node 22's global WebSocket (undici) accepts a non-standard `headers` init, which is
// how the API key is sent. Browsers cannot do this, which is one reason this is server-only.
type WSCtor = new (url: string, init?: { headers?: Record<string, string> }) => WebSocket;

// ---------------------------------------------------------------------------
// The reusable client
// ---------------------------------------------------------------------------

export class AssemblyAITTS {
  private opts: TTSOptions;

  constructor(options: Partial<TTSOptions> & { apiKey?: string } = {}) {
    const apiKey = options.apiKey ?? process.env.ASSEMBLYAI_API_KEY?.trim();
    if (!apiKey) {
      throw new TTSError(
        "AssemblyAI API key is required, either as the `apiKey` option or the ASSEMBLYAI_API_KEY environment variable",
      );
    }
    this.opts = {
      voiceId: options.voiceId ?? DEFAULT_VOICE_ID,
      language: options.language ?? DEFAULT_LANGUAGE,
      model: options.model ?? DEFAULT_MODEL,
      encoding: options.encoding ?? DEFAULT_ENCODING,
      sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
      wordTimestamps: options.wordTimestamps ?? false,
      apiKey,
      baseUrl: resolveBaseUrl(options.baseUrl),
    };
  }

  /** Build a client from ASSEMBLYAI_API_* environment variables (see README). */
  static fromEnv(overrides: Partial<TTSOptions> = {}): AssemblyAITTS {
    const env = process.env;
    const rate = Number(env.ASSEMBLYAI_API_TTS_SAMPLE_RATE);
    return new AssemblyAITTS({
      apiKey: env.ASSEMBLYAI_API_KEY?.trim(),
      baseUrl: env.ASSEMBLYAI_API_TTS_URL?.trim() || undefined,
      model: env.ASSEMBLYAI_API_TTS_MODEL?.trim() || undefined,
      voiceId: env.ASSEMBLYAI_API_TTS_VOICE?.trim() || undefined,
      language: env.ASSEMBLYAI_API_TTS_LANGUAGE?.trim().toLowerCase() || undefined,
      sampleRate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
      ...stripUndefined(overrides),
    });
  }

  get provider(): string {
    return "AssemblyAI";
  }

  get model(): string {
    return this.opts.model;
  }

  /** A copy of the options without the API key, safe to log or return to a browser. */
  get publicOptions(): Omit<TTSOptions, "apiKey"> {
    const { apiKey: _key, ...rest } = this.opts;
    void _key;
    return rest;
  }

  /** Change the voice and/or language used by streams created afterwards. */
  updateOptions(update: { voiceId?: string; language?: string }): void {
    if (update.voiceId) this.opts.voiceId = update.voiceId;
    if (update.language) this.opts.language = update.language;
  }

  /** A copy of this client with some options changed (per-request settings). */
  with(overrides: Partial<Omit<TTSOptions, "apiKey">>): AssemblyAITTS {
    return new AssemblyAITTS({ ...this.opts, ...stripUndefined(overrides) });
  }

  /** Synthesize a fixed string over a one-shot session (`Generate` … `Terminate`). */
  synthesize(text: string, conn: ConnOptions = {}): ChunkedStream {
    return new ChunkedStream({ ...this.opts }, text, conn);
  }

  /** Open a session that accepts text incrementally, one `Generate`/`Flush` per sentence. */
  stream(conn: ConnOptions = {}): SynthesizeStream {
    return new SynthesizeStream({ ...this.opts }, conn);
  }

  /** Synthesize and collect the whole result: PCM bytes, word timings and the session summary. */
  async synthesizeToBuffer(
    text: string,
    conn: ConnOptions = {},
  ): Promise<{ pcm: Uint8Array; sampleRate: number; words: WordBoundary[]; events: TTSEvent[] }> {
    const chunks: Uint8Array[] = [];
    const words: WordBoundary[] = [];
    const events: TTSEvent[] = [];
    let sampleRate = this.opts.sampleRate;
    for await (const ev of this.synthesize(text, conn)) {
      if (ev.type === "audio") chunks.push(ev.audio);
      else {
        events.push(ev);
        if (ev.type === "words") words.push(...ev.words);
        if (ev.type === "begin" && ev.configuration.sample_rate) sampleRate = ev.configuration.sample_rate;
      }
    }
    return { pcm: concat(chunks), sampleRate, words, events };
  }

  /** Every voice matching `params`, following `next_cursor` until the last page. */
  async listAllVoices(
    params: Omit<ListVoicesParams, "cursor" | "limit"> = {},
    signal?: AbortSignal,
  ): Promise<VoiceSummary[]> {
    const all: VoiceSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listVoices({ ...params, limit: 1000, cursor }, signal);
      all.push(...page.voices);
      cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
    } while (cursor);
    return all;
  }

  /** GET /v1/voices on the same host as the WebSocket endpoint. */
  async listVoices(
    params: ListVoicesParams = {},
    signal?: AbortSignal,
  ): Promise<{ voices: VoiceSummary[]; hasMore: boolean; nextCursor: string | null; total: number }> {
    const url = new URL("/v1/voices", httpOrigin(this.opts.baseUrl));
    if (params.scope) url.searchParams.set("scope", params.scope);
    if (params.q) url.searchParams.set("q", params.q);
    if (params.language) url.searchParams.set("language", params.language);
    for (const tag of params.tags ?? []) url.searchParams.append("tag", tag);
    if (params.sort) url.searchParams.set("sort", params.sort);
    if (params.limit) url.searchParams.set("limit", String(params.limit));
    if (params.cursor) url.searchParams.set("cursor", params.cursor);

    const res = await fetch(url, { headers: { Authorization: this.opts.apiKey }, signal, cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new TTSStatusError(String(body.message ?? `Voice list failed with HTTP ${res.status}`), {
        code: res.status,
        errorType: (body.code as string) ?? null,
        param: (body.param as string) ?? null,
      });
    }
    const voices = Array.isArray(body.voices) ? (body.voices as Record<string, unknown>[]) : [];
    return {
      voices: voices.map((v) => ({
        id: String(v.id),
        slug: String(v.slug ?? v.id),
        name: String(v.name ?? v.slug),
        language: String(v.language ?? ""),
        description: (v.description as string) ?? null,
        tags: Array.isArray(v.tags) ? (v.tags as string[]) : [],
        publisher: (v.publisher as string) ?? null,
      })),
      hasMore: Boolean(body.has_more),
      nextCursor: (body.next_cursor as string) ?? null,
      total: Number(body.total_count ?? voices.length),
    };
  }
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/** Shared socket handling for both stream kinds. Iterate it to receive TTSEvents. */
abstract class TTSStream implements AsyncIterable<TTSEvent> {
  /** The `Begin` configuration once the session is open. */
  configuration: BeginConfiguration | null = null;
  sessionId: string | null = null;

  protected readonly opts: TTSOptions;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;
  private readonly onSend?: (frame: SentFrame) => void;
  private readonly queue = new AsyncQueue<TTSEvent>();
  private ws: WebSocket | null = null;
  private opened = false;
  private finished = false;
  private sawTermination = false;
  private terminateSent = false;
  private pendingFrames: SentFrame[] = [];
  private ready = false;
  /** Answers owed by the server (one per Flush, one for Terminate). The idle timer runs while > 0. */
  private owed = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private lastSend = Date.now();
  private onAbort = () => this.fail(new TTSAbortError());

  protected constructor(opts: TTSOptions, conn: ConnOptions) {
    this.opts = opts;
    this.timeoutMs = conn.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.signal = conn.signal;
    this.onSend = conn.onSend;
  }

  [Symbol.asyncIterator](): AsyncIterator<TTSEvent> {
    this.open();
    return this.queue[Symbol.asyncIterator]();
  }

  /** Interrupt the current request: the server stops speaking and answers `Cancelled`. */
  cancel(): void {
    this.sendFrame({ type: "Cancel" }, false);
  }

  /** Close the socket immediately. Iteration ends with TTSAbortError. */
  close(): void {
    this.fail(new TTSAbortError("AssemblyAI TTS stream was closed"));
  }

  /** The query string sent on connect. `model_id` is the current name of the model parameter. */
  wsUrl(): string {
    const params = new URLSearchParams({
      voice_id: this.opts.voiceId,
      language: this.opts.language,
      model_id: this.opts.model,
      sample_rate: String(this.opts.sampleRate),
      encoding: this.opts.encoding,
      word_boundaries: this.opts.wordTimestamps ? "true" : "false",
    });
    return `${this.opts.baseUrl}?${params}`;
  }

  protected open(): void {
    if (this.opened) return;
    this.opened = true;

    if (this.signal?.aborted) return this.fail(new TTSAbortError());
    this.signal?.addEventListener("abort", this.onAbort, { once: true });

    const WS = (globalThis as { WebSocket?: WSCtor }).WebSocket;
    if (!WS) return this.fail(new TTSConnectionError("This runtime has no WebSocket (Node 22+ required)"));

    let ws: WebSocket;
    try {
      // The key is sent raw in Authorization; it is not a Bearer token.
      ws = new WS(this.wsUrl(), { headers: { Authorization: this.opts.apiKey } });
    } catch (e) {
      // Never echo the error: transport errors can carry the URL.
      return this.fail(new TTSConnectionError((e as Error)?.name ?? "connect failed"));
    }
    this.ws = ws;
    this.owed++; // Begin is owed
    this.arm();

    ws.addEventListener("message", (e) => this.onMessage(e.data));
    ws.addEventListener("error", () => {
      if (!this.ready) this.fail(new TTSConnectionError());
    });
    ws.addEventListener("close", (e) => this.onClose(e.code, e.reason));

    this.keepAlive = setInterval(() => {
      if (this.ready && Date.now() - this.lastSend > KEEPALIVE_MS) this.sendFrame({ type: "KeepAlive" }, false);
    }, KEEPALIVE_MS);
    this.onOpen();
  }

  /** Subclasses queue their first frames here. */
  protected abstract onOpen(): void;

  protected sendFrame(frame: SentFrame, expectsAnswer: boolean): void {
    if (this.finished) return;
    if (frame.type === "Terminate") this.terminateSent = true;
    if (expectsAnswer) {
      this.owed++;
      this.arm();
    }
    if (!this.ready || !this.ws) {
      this.pendingFrames.push(frame);
      return;
    }
    this.write(frame);
  }

  private write(frame: SentFrame): void {
    this.lastSend = Date.now();
    this.ws?.send(JSON.stringify(frame));
    try {
      this.onSend?.(frame);
    } catch {
      /* a logging hook must not break the session */
    }
  }

  protected sendText(text: string): void {
    // Consecutive Generate texts are joined verbatim, so keep a trailing space.
    for (const piece of splitLong(text.trim())) {
      if (piece) this.sendFrame({ type: "Generate", text: `${piece} ` }, false);
    }
  }

  private onMessage(raw: unknown): void {
    if (this.finished || typeof raw !== "string") return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    this.arm();

    switch (data.type) {
      case "Begin": {
        this.owed--;
        this.ready = true;
        this.sessionId = String(data.id ?? "");
        this.configuration = (data.configuration as BeginConfiguration) ?? {};
        this.queue.push({
          type: "begin",
          sessionId: this.sessionId,
          expiresAt: typeof data.expires_at === "number" ? data.expires_at : null,
          configuration: this.configuration,
        });
        const frames = this.pendingFrames;
        this.pendingFrames = [];
        for (const f of frames) this.write(f);
        this.arm();
        break;
      }
      case "Audio":
        this.queue.push({
          type: "audio",
          flushId: Number(data.flush_id ?? 0),
          audio: Buffer.from(String(data.audio ?? ""), "base64"),
        });
        break;
      case "FlushDone":
        this.owed = Math.max(0, this.owed - 1);
        this.arm();
        this.queue.push({
          type: "flush_done",
          flushId: Number(data.flush_id ?? 0),
          audioDurationMs: Number(data.audio_duration_ms ?? 0),
        });
        break;
      case "WordBoundaries":
        // `start`/`end` are already on the session timeline (do not add audio_start_ms).
        this.queue.push({
          type: "words",
          flushId: Number(data.flush_id ?? 0),
          audioStartMs: Number(data.audio_start_ms ?? 0),
          words: (Array.isArray(data.words) ? data.words : [])
            .filter((w: Record<string, unknown>) => typeof w?.word === "string" && "start" in w && "end" in w)
            .map((w: Record<string, unknown>) => ({
              word: String(w.word),
              start: Number(w.start),
              end: Number(w.end),
              confidence: Number(w.confidence ?? 0),
            })),
        });
        break;
      case "Cancelled":
        // A cancelled request gets no FlushDone; only the Termination stays owed.
        this.owed = this.terminateSent ? 1 : 0;
        this.arm();
        this.queue.push({ type: "cancelled", audioDurationSeconds: Number(data.audio_duration_seconds ?? 0) });
        break;
      case "Termination":
        this.sawTermination = true;
        this.queue.push({
          type: "end",
          sessionDurationSeconds: Number(data.session_duration_seconds ?? 0),
          totalInputChars: Number(data.total_input_char_length ?? 0),
          audioDurationSeconds: Number(data.audio_duration_seconds ?? 0),
        });
        this.finish();
        break;
      case "Error":
        this.fail(
          new TTSStatusError(`AssemblyAI TTS error ${data.error_code}: ${data.error ?? "unknown error"}`, {
            code: Number(data.error_code ?? -1),
            errorType: (data.error_type as string) ?? null,
            param: (data.param as string) ?? null,
            retryable: (data.retryable as boolean) ?? null,
            retryAfterSeconds: (data.retry_after_seconds as number) ?? null,
            sessionId: this.sessionId,
          }),
        );
        break;
      default:
        // Unknown frame types may be added by the service; ignore them.
        break;
    }
  }

  private onClose(code: number, reason: string): void {
    if (this.finished) return;
    if (this.sawTermination) return this.finish();
    this.fail(
      new TTSStatusError(`AssemblyAI TTS connection closed unexpectedly (${code}${reason ? `: ${reason}` : ""})`, {
        code: code || -1,
        sessionId: this.sessionId,
      }),
    );
  }

  /** Restart the idle timer; it only runs while the server owes us an answer. */
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.finished || this.owed <= 0) return;
    this.timer = setTimeout(() => this.fail(new TTSTimeoutError()), this.timeoutMs);
  }

  private cleanup(): void {
    this.finished = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.signal?.removeEventListener("abort", this.onAbort);
    try {
      if (this.ws && this.ws.readyState <= 1) this.ws.close(1000);
    } catch {
      /* already closed */
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.cleanup();
    this.queue.close();
  }

  private fail(error: Error): void {
    if (this.finished) return;
    this.cleanup();
    this.queue.fail(error);
  }
}

/** Synthesize a fixed string over a one-shot WebSocket session. */
export class ChunkedStream extends TTSStream {
  readonly inputText: string;

  constructor(opts: TTSOptions, text: string, conn: ConnOptions) {
    super(opts, conn);
    this.inputText = text;
  }

  protected onOpen(): void {
    this.sendText(this.inputText);
    this.sendFrame({ type: "Terminate" }, true);
  }
}

/** Stream text into synthesis, one `Generate`/`Flush` per sentence. */
export class SynthesizeStream extends TTSStream {
  private readonly tokenizer = new SentenceTokenizer();
  private inputEnded = false;

  constructor(opts: TTSOptions, conn: ConnOptions) {
    super(opts, conn);
  }

  /** Append text. Complete sentences are sent right away, each followed by `Flush`. */
  pushText(text: string): void {
    if (this.inputEnded) throw new TTSError("pushText() after endInput()");
    this.open();
    for (const sentence of this.tokenizer.push(text)) this.sendSentence(sentence);
  }

  /** Speak whatever is buffered now, even an unfinished sentence. */
  flush(): void {
    this.open();
    for (const sentence of this.tokenizer.flush()) this.sendSentence(sentence);
  }

  /** No more text: flush the rest and `Terminate`. Iteration ends after `Termination`. */
  endInput(): void {
    if (this.inputEnded) return;
    this.flush();
    this.inputEnded = true;
    this.sendFrame({ type: "Terminate" }, true);
  }

  protected onOpen(): void {}

  private sendSentence(sentence: string): void {
    this.sendText(sentence);
    this.sendFrame({ type: "Flush" }, true);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal push-based async iterator. */
class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: { resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void }[] = [];
  private done = false;
  private error: unknown = null;

  push(item: T): void {
    if (this.done) return;
    const w = this.waiters.shift();
    if (w) w.resolve({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w.resolve({ value: undefined as T, done: true });
  }

  fail(error: unknown): void {
    this.error = error;
    this.done = true;
    for (const w of this.waiters.splice(0)) w.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.error) return Promise.reject(this.error);
        if (this.done) return Promise.resolve({ value: undefined as T, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
}

/**
 * Accept the WebSocket endpoint in a few shapes. `https://tts.us.assemblyai.com/v1/ws`
 * becomes `wss://…`; anything that is not a TTS host falls back to the default with a warning
 * (the older `https://api.assemblyai.com/v2/tts` does not exist).
 */
export function resolveBaseUrl(value?: string): string {
  if (!value) return DEFAULT_BASE_URL;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol !== "wss:" && url.protocol !== "ws:") throw new Error("scheme");
    if (/^tts\.[a-z]+\.assemblyai\.com$/.test(url.hostname) || url.hostname === "localhost") {
      if (url.pathname === "/" || url.pathname === "") url.pathname = "/v1/ws";
      return url.toString().replace(/\/$/, "");
    }
    throw new Error("host");
  } catch {
    console.warn(
      `[tts] ASSEMBLYAI_API_TTS_URL=${value} is not a Streaming TTS WebSocket endpoint; using ${DEFAULT_BASE_URL}`,
    );
    return DEFAULT_BASE_URL;
  }
}

function httpOrigin(wsUrl: string): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  return url.origin;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Wrap 16-bit mono PCM in a WAV header. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const write = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  write(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  write(36, "data");
  v.setUint32(40, pcm.length, true);
  return concat([new Uint8Array(header), pcm]);
}
