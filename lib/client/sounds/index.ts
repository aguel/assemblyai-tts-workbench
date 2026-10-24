/**
 * Scene sounds, synthesised in the browser with Web Audio: no audio files. They never reach
 * the server: the speech request is unchanged, and the WAV download holds the voice only.
 *
 * Two kinds:
 * - a chime plays before the voice (chimes.ts);
 * - a bed starts before the voice, keeps playing under it, and fades out after the last
 *   word (the Bach prelude, the Pachelbel canon, the moonlight piano: scores.ts).
 *
 * To add one: write it in chimes.ts or scores.ts, add its id to `Sound` and `SOUND_NAMES`,
 * and handle it in `startSound()`.
 */

import { chime, type ChimeKind } from "./chimes";
import { bed, type SoundRun } from "./engine";
import { CANON, MOONLIGHT, PRELUDE } from "./scores";

export type { SoundRun } from "./engine";

const BEDS = { prelude: PRELUDE, canon: CANON, moonlight: MOONLIGHT } as const;

export type Sound = ChimeKind | keyof typeof BEDS;

/** Every sound, in menu order, with its label. */
export const SOUND_NAMES: Record<Sound, string> = {
  airport: "Terminal chime",
  cabin: "Cabin chime",
  train: "Station chime",
  prelude: "Bach prelude",
  canon: "Pachelbel canon",
  moonlight: "Moonlight piano",
};

/** Schedule `kind` to start at context time `when`, into `out`. */
export function startSound(ctx: AudioContext, out: AudioNode, when: number, kind: Sound): SoundRun {
  return isBed(kind) ? bed(ctx, out, when, BEDS[kind]) : chime(ctx, out, when, kind);
}

function isBed(kind: Sound): kind is keyof typeof BEDS {
  return kind in BEDS;
}
