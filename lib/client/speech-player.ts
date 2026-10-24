/**
 * Browser side of the internal API. Posts to /api/tts/speak, reads the NDJSON event
 * stream, plays the PCM through Web Audio as it arrives (with an optional scene sound) and
 * keeps the word timeline, so a component can mark each word as it is spoken.
 * Exposed to React through useSyncExternalStore (subscribe / getState).
 *
 * The browser never talks to AssemblyAI: everything goes through /api/tts/*.
 */

import { startSound, type Sound, type SoundRun } from "./sounds";

export interface SpeakOptions {
  text: string;
  voiceId?: string;
  language?: string;
  sampleRate?: number;
  mode?: "stream" | "chunked";
  wordTimestamps?: boolean;
  /** A scene sound played in the browser before (and for a bed, under) the voice. Never sent to the server. */
  sound?: Sound | null;
}

export interface TimedWord {
  word: string;
  /** Milliseconds on the session's audio timeline. */
  start: number;
  end: number;
  confidence: number;
  flushId: number;
}

export type PlayerStatus = "idle" | "connecting" | "streaming" | "playing" | "done" | "error";

export interface PlayerState {
  status: PlayerStatus;
  /** Word boundaries received so far, on the session timeline. */
  words: TimedWord[];
  /** Sample rate the session reported in `Begin`. */
  sampleRate: number | null;
  /** Milliseconds from the request to the first audio chunk, measured on the server. */
  firstAudioMs: number | null;
  /** Milliseconds of voice audio received (and scheduled) so far. */
  audioMs: number;
  error: { message: string; code: string } | null;
}

const EMPTY: PlayerState = {
  status: "idle",
  words: [],
  sampleRate: null,
  firstAudioMs: null,
  audioMs: 0,
  error: null,
};

interface Scheduled {
  ctxStart: number;
  streamStartMs: number;
  durationMs: number;
}

type ServerEvent = Record<string, unknown> & { type: string };

export class SpeechPlayer {
  private state: PlayerState = EMPTY;
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  /** Everything the run plays (sound and voice) goes through this node to the speakers. */
  private out: GainNode | null = null;
  private abort: AbortController | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private scheduled: Scheduled[] = [];
  private nextTime = 0;
  private streamMs = 0;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private run = 0;
  /** Length of the sound before the voice, in ms (0 without one). */
  private lead = 0;
  /** The current run's scene sound, if any. */
  private sound: SoundRun | null = null;
  /** AudioContext time at which the current run's timeline starts. */
  private runStart = -1;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;
  getServerState = () => EMPTY;

  /** Current position on the session's audio timeline, in ms, or -1 when nothing plays. */
  positionMs(): number {
    if (!this.ctx || !this.scheduled.length) return -1;
    const now = this.ctx.currentTime;
    let pos = -1;
    for (const s of this.scheduled) {
      if (s.ctxStart > now) break;
      pos = s.streamStartMs + Math.min((now - s.ctxStart) * 1000, s.durationMs);
    }
    return pos;
  }

  /** Length of the sound that leads the current run, in ms. */
  leadMs(): number {
    return this.lead;
  }

  /**
   * Position on the whole run's timeline (sound, then voice), in ms, or -1 when nothing
   * has been scheduled. While the lead plays it counts up to leadMs(), then it follows the voice.
   */
  timelineMs(): number {
    if (!this.ctx || this.runStart < 0) return -1;
    const pos = this.positionMs();
    if (pos >= 0) return this.lead + pos;
    return Math.min(this.lead, Math.max(0, (this.ctx.currentTime - this.runStart) * 1000));
  }

  async speak(opts: SpeakOptions): Promise<void> {
    this.stop(false);
    const run = ++this.run;
    const abort = new AbortController();
    this.abort = abort;
    this.ensureAudio();
    await this.ctx?.resume();
    if (run !== this.run) return;
    this.scheduled = [];
    this.streamMs = 0;
    this.nextTime = 0;
    this.lead = 0;
    this.runStart = -1;
    const { sound, ...request } = opts;
    if (this.ctx && this.out) {
      const start = this.ctx.currentTime + 0.06;
      this.runStart = start;
      if (sound) {
        // The sound plays while the socket opens; the first audio chunk is queued after its lead.
        this.sound = startSound(this.ctx, this.out, start, sound);
        this.nextTime = start + this.sound.lead;
        this.lead = this.sound.lead * 1000;
      }
    }
    this.set({ ...EMPTY, status: "connecting" });

    let res: Response;
    try {
      res = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordTimestamps: true, ...request, format: "ndjson" }),
        signal: abort.signal,
      });
    } catch (e) {
      if (run === this.run && !abort.signal.aborted) this.fail(String((e as Error).message), "network");
      return;
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (run === this.run) this.fail(body.error ?? `HTTP ${res.status}`, body.code ?? `http_${res.status}`);
      return;
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line && run === this.run) this.handle(JSON.parse(line) as ServerEvent);
        }
      }
    } catch {
      if (run !== this.run || abort.signal.aborted) return;
      this.fail("The stream was interrupted", "stream_interrupted");
      return;
    }
    if (run === this.run && this.state.status !== "error") this.scheduleEnd();
  }

  /** Stop playback and close the request (the server closes the AssemblyAI socket). */
  stop(markIdle = true): void {
    this.run++;
    this.abort?.abort();
    this.abort = null;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    this.sources = [];
    this.sound?.stop();
    this.sound = null;
    this.scheduled = [];
    this.runStart = -1;
    this.lead = 0;
    if (this.endTimer) clearTimeout(this.endTimer);
    if (markIdle && this.state.status !== "idle") this.set({ ...this.state, status: "idle" });
  }

  /** One NDJSON event from /api/tts/speak (see the route for the full list). */
  private handle(ev: ServerEvent): void {
    switch (ev.type) {
      case "begin":
        this.set({ ...this.state, status: "streaming", sampleRate: Number(ev.sampleRate ?? 24000) });
        break;
      case "audio": {
        this.play(base64ToBytes(String(ev.audio ?? "")));
        const first = typeof ev.firstAudioMs === "number" ? ev.firstAudioMs : this.state.firstAudioMs;
        this.set({ ...this.state, status: "playing", firstAudioMs: first, audioMs: this.streamMs });
        break;
      }
      case "words": {
        const flushId = Number(ev.flushId ?? 0);
        const incoming = ((ev.words as TimedWord[]) ?? []).map((w) => ({ ...w, flushId }));
        const words = [...this.state.words, ...incoming].sort((a, b) => a.flushId - b.flushId || a.start - b.start);
        this.set({ ...this.state, words });
        break;
      }
      case "error":
        this.sound?.stop();
        this.sound = null;
        this.fail(String(ev.error ?? "Unknown error"), String(ev.code ?? "error"));
        break;
      // "sent", "flush_done", "cancelled" and "end" carry nothing the player needs.
    }
  }

  private play(pcm: Uint8Array): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || pcm.length < 2) return;
    const rate = this.state.sampleRate ?? 24000;
    const samples = Math.floor(pcm.length / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
    const buf = ctx.createBuffer(1, samples, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 32768;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    const start = Math.max(this.nextTime, ctx.currentTime + 0.05);
    src.start(start);
    this.sources.push(src);
    const durationMs = (samples / rate) * 1000;
    this.scheduled.push({ ctxStart: start, streamStartMs: this.streamMs, durationMs });
    this.nextTime = start + samples / rate;
    this.streamMs += durationMs;
  }

  private scheduleEnd(): void {
    const ctx = this.ctx;
    const remaining = ctx ? Math.max(0, this.nextTime - ctx.currentTime) : 0;
    const run = this.run;
    // A bed under the voice fades out once the last word has played. Keep the reference:
    // the audio is still playing, and stop() or a new run must still be able to cut it.
    this.sound?.release(this.nextTime);
    this.endTimer = setTimeout(() => {
      if (run === this.run) this.set({ ...this.state, status: "done", audioMs: this.streamMs });
    }, remaining * 1000 + 120);
  }

  private ensureAudio(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
  }

  private fail(message: string, code: string): void {
    this.set({ ...this.state, status: "error", error: { message, code } });
  }

  private set(next: PlayerState): void {
    this.state = next;
    for (const fn of this.listeners) fn();
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Download the result of /api/tts/speak as a WAV file. */
export async function downloadWav(opts: Omit<SpeakOptions, "sound" | "mode">): Promise<void> {
  const res = await fetch("/api/tts/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...opts, format: "wav" }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `tts-${opts.voiceId ?? "voice"}-${Date.now()}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
