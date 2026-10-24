/**
 * The small Web Audio engine behind the scene sounds: a bus that can be cut, a bed player
 * (a looped part under the voice, driven by a look-ahead scheduler), a plucked-string voice
 * and a generated reverb. Scores live in scores.ts; the chimes in chimes.ts.
 */

/** A sound that has been scheduled for one run of the player. */
export interface SoundRun {
  /** Seconds from the start of the sound until the voice may begin. */
  lead: number;
  /** The voice ends at context time `at`: a bed fades out from there; a chime has already ended. */
  release(at: number): void;
  /** Cut it now (stop, a new run, an error), with a short fade so it does not click. */
  stop(): void;
}

/** Frequency in Hz of a MIDI note number (A4 = 69 = 440 Hz). */
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** A gain node that can fade the whole sound out, and a list of what to stop with it. */
export function bus(ctx: AudioContext, out: AudioNode, level: number) {
  const gain = ctx.createGain();
  gain.gain.value = level;
  gain.connect(out);
  const nodes = new Set<AudioScheduledSourceNode>();
  const track = <T extends AudioScheduledSourceNode>(n: T) => {
    nodes.add(n);
    n.addEventListener("ended", () => nodes.delete(n));
    return n;
  };
  const cut = (fade = 0.08) => {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fade);
    for (const n of nodes) {
      try {
        n.stop(now + fade + 0.02);
      } catch {
        /* already stopped */
      }
    }
  };
  return { gain, track, cut };
}

// ---------------------------------------------------------------------------------------
// Beds: a looped part played under the voice by a look-ahead scheduler. It plays alone for
// `lead` seconds, dips under the voice, and fades out after the last word.

export interface Note {
  /** Seconds from the start of the loop. */
  at: number;
  /** MIDI note number. */
  note: number;
  level: number;
  /** Seconds the note rings. */
  length: number;
}

/** Registers a source with the bed's bus, so stop() can cut it. */
type Track = <T extends AudioScheduledSourceNode>(n: T) => T;

export interface BedPart {
  loop: Note[];
  loopSeconds: number;
  lead: number;
  /** Level alone, and under the voice. */
  solo: number;
  under: number;
  /** Low-pass cut-off, and how much of the generated room to mix in. */
  brightness: number;
  room: number;
  /** One instrument note into `dest` at context time `t`. */
  voice: (ctx: AudioContext, dest: AudioNode, track: Track, n: Note, t: number) => void;
}

export function bed(ctx: AudioContext, out: AudioNode, when: number, part: BedPart): SoundRun {
  const b = bus(ctx, out, 0);
  b.gain.gain.setValueAtTime(0, when);
  b.gain.gain.linearRampToValueAtTime(part.solo, when + 0.6);
  b.gain.gain.setValueAtTime(part.solo, when + part.lead - 0.2);
  b.gain.gain.linearRampToValueAtTime(part.under, when + part.lead + 0.6);

  // Warm it (low-pass) and give it a room (a generated reverb).
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = part.brightness;
  const dry = ctx.createGain();
  dry.gain.value = 1 - part.room * 0.5;
  const wet = ctx.createGain();
  wet.gain.value = part.room;
  const room = ctx.createConvolver();
  room.buffer = reverbImpulse(ctx, 3);
  tone.connect(dry).connect(b.gain);
  tone.connect(room).connect(wet).connect(b.gain);

  // Every 100 ms, queue the notes of the next 1.5 s.
  let index = 0;
  let loopStart = when;
  let ended = false;
  const tick = () => {
    if (ended) return;
    const horizon = ctx.currentTime + 1.5;
    while (loopStart + part.loop[index].at < horizon) {
      const n = part.loop[index];
      part.voice(ctx, tone, b.track, n, Math.max(loopStart + n.at, ctx.currentTime));
      index++;
      if (index === part.loop.length) {
        index = 0;
        loopStart += part.loopSeconds;
      }
    }
  };
  tick();
  const timer = setInterval(tick, 100);
  const finish = () => {
    ended = true;
    clearInterval(timer);
  };

  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    lead: part.lead,
    release: (at) => {
      // Let the last notes ring, then fade over about three seconds.
      const start = Math.max(at, ctx.currentTime) + 0.4;
      b.gain.gain.cancelScheduledValues(start);
      b.gain.gain.setValueAtTime(part.under, start);
      b.gain.gain.linearRampToValueAtTime(0, start + 3.2);
      fadeTimer = setTimeout(() => {
        finish();
        b.cut(0.01);
      }, (start + 3.3 - ctx.currentTime) * 1000);
    },
    stop: () => {
      if (fadeTimer) clearTimeout(fadeTimer);
      finish();
      b.cut(0.2);
    },
  };
}

/** Additive partials, each decaying on its own: [ratio, gain, decay as a share of the note]. */
export function pluck(partials: readonly (readonly [number, number, number, OscillatorType])[], attack: number) {
  return (ctx: AudioContext, dest: AudioNode, track: Track, n: Note, t: number) => {
    const f = midi(n.note);
    for (const [ratio, gain, decay, type] of partials) {
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(n.level * gain, t + attack);
      env.gain.setTargetAtTime(0, t + attack, (n.length * decay) / 4);
      env.connect(dest);
      const osc = track(ctx.createOscillator());
      osc.type = type;
      osc.frequency.value = f * ratio;
      osc.connect(env);
      osc.start(t);
      osc.stop(t + n.length);
    }
  };
}

/** Stereo noise with a steep decay: enough of a room for a soft piano. */
function reverbImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}
