/** Public-address chimes: soft bells played before the voice. */

import { bus, type SoundRun } from "./engine";

export type ChimeKind = "airport" | "cabin" | "train";

/** [offset in seconds, frequency in Hz] for each note. */
const CHIMES: Record<ChimeKind, [number, number][]> = {
  // Terminal: three rising tones (C5, E5, G5).
  airport: [
    [0, 523.25],
    [0.42, 659.25],
    [0.84, 783.99],
  ],
  // Cabin: a high-low two-tone (A5, F5).
  cabin: [
    [0, 880],
    [0.62, 698.46],
  ],
  // Station: three falling tones (G5, E5, C5).
  train: [
    [0, 783.99],
    [0.4, 659.25],
    [0.8, 523.25],
  ],
};
/** Seconds after the last note before the voice starts (the note is still ringing). */
const CHIME_TAIL = 0.95;
/** Partials of a soft bell: [ratio, gain]. */
const BELL: [number, number][] = [
  [1, 1],
  [2, 0.32],
  [3, 0.1],
  [4.2, 0.04],
];

export function chime(ctx: AudioContext, out: AudioNode, when: number, kind: ChimeKind): SoundRun {
  const b = bus(ctx, out, 0.38);
  for (const [offset, freq] of CHIMES[kind]) {
    const t = when + offset;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, t + 1.7);
    env.connect(b.gain);
    for (const [ratio, gain] of BELL) {
      const osc = b.track(ctx.createOscillator());
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + 1.8);
    }
  }
  return { lead: chimeLead(kind), release: () => {}, stop: () => b.cut() };
}

/** Seconds from the first note until the voice may begin. */
function chimeLead(kind: ChimeKind): number {
  return Math.max(...CHIMES[kind].map(([o]) => o)) + CHIME_TAIL;
}
