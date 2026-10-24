/**
 * The beds, written out as notes: public-domain pieces arranged in code for the bed player
 * in engine.ts. Each is a `BedPart`: a loop of notes, how long it plays alone before the
 * voice (`lead`), its level alone and under the voice, its tone and the instrument.
 */

import { pluck, type BedPart } from "./engine";

// ---------------------------------------------------------------------------------------
// Bach prelude: the first eight bars of J. S. Bach's Prelude in C major, BWV 846, from The
// Well-Tempered Clavier, Book I (1722, public domain), arranged in code for a soft piano.
// Each bar is one broken chord played twice; the first two notes of each half are held.

const PRELUDE_STEP = 0.27;
/** The eight notes of each half-bar, bars 1-8 (MIDI; C4 = 60). */
const PRELUDE_BARS: number[][] = [
  [60, 64, 67, 72, 76, 67, 72, 76], // C
  [60, 62, 69, 74, 77, 69, 74, 77], // Dm7/C
  [59, 62, 67, 74, 77, 67, 74, 77], // G7/B
  [60, 64, 67, 72, 76, 67, 72, 76], // C
  [60, 64, 69, 76, 81, 69, 76, 81], // Am/C
  [60, 62, 66, 69, 74, 66, 69, 74], // D7/C
  [59, 62, 67, 74, 79, 67, 74, 79], // G/B
  [59, 60, 64, 67, 72, 64, 67, 72], // Cmaj7/B
];

export const PRELUDE: BedPart = {
  loop: PRELUDE_BARS.flatMap((half, bar) =>
    [0, 1].flatMap((rep) => {
      const start = (bar * 16 + rep * 8) * PRELUDE_STEP;
      const end = 8 * PRELUDE_STEP;
      return half.map((note, k) => ({
        at: start + k * PRELUDE_STEP,
        note,
        // The held bass and tenor ring through the half-bar; the figure above is lighter.
        level: k === 0 ? 0.24 : k === 1 ? 0.18 : 0.15,
        length: k < 2 ? end - k * PRELUDE_STEP + 1 : 1.6,
      }));
    }),
  ),
  loopSeconds: PRELUDE_BARS.length * 16 * PRELUDE_STEP,
  lead: 8 * PRELUDE_STEP,
  solo: 0.45,
  under: 0.11,
  brightness: 2400,
  room: 0.6,
  voice: pluck(
    [
      [1, 1, 1, "triangle"],
      [2, 0.2, 0.6, "sine"],
      [3.003, 0.06, 0.4, "sine"],
    ],
    0.005,
  ),
};

// ---------------------------------------------------------------------------------------
// Pachelbel canon: the opening of Johann Pachelbel's Canon in D major (c. 1680, public
// domain), arranged in code for a bright, soft piano. As in the score, a ground bass of eight
// quarter notes repeats, and three violins play the same tune two bars apart, so it builds
// into a round: one voice, then two, then three.

/** One quarter note, in seconds (100 a minute). */
const CANON_BEAT = 0.6;
/** The ground: D3 A2 B2 F#2 G2 D2 G2 A2 (MIDI; D3 = 50). */
const CANON_BASS = [50, 45, 47, 42, 43, 38, 43, 45];
/**
 * The violin tune, one turn of the ground per phrase:
 * F#5 E5 D5 C#5 B4 A4 B4 C#5 (quarters), D5 C#5 B4 A4 G4 F#4 G4 E4 (quarters),
 * D4 F#4 A4 G4 F#4 D4 F#4 E4 D4 B3 D4 A4 G4 B4 A4 G4 (eighths).
 */
const CANON_PHRASES: number[][] = [
  [78, 76, 74, 73, 71, 69, 71, 73],
  [74, 73, 71, 69, 67, 66, 67, 64],
  [62, 66, 69, 67, 66, 62, 66, 64, 62, 59, 62, 69, 67, 71, 69, 67],
];
/** Each violin enters one turn (eight beats) after the one before. */
const CANON_TURNS = CANON_PHRASES.length;

export const CANON: BedPart = {
  loop: [
    ...Array.from({ length: CANON_TURNS }, (_, turn) =>
      CANON_BASS.flatMap((n, k) => [
        { at: (turn * 8 + k) * CANON_BEAT, note: n, level: 0.26, length: 1.2 * CANON_BEAT },
        { at: (turn * 8 + k) * CANON_BEAT, note: n + 12, level: 0.1, length: CANON_BEAT },
      ]),
    ).flat(),
    // Violin v enters at turn v and plays the phrases in order until the loop ends.
    ...Array.from({ length: CANON_TURNS }, (_, violin) =>
      CANON_PHRASES.slice(0, CANON_TURNS - violin).flatMap((phrase, p) => {
        const step = 8 / phrase.length;
        return phrase.map((note, k) => ({
          at: ((violin + p) * 8 + k * step) * CANON_BEAT,
          note,
          level: 0.15,
          length: step * CANON_BEAT + 0.25,
        }));
      }),
    ).flat(),
  ].sort((a, b) => a.at - b.at),
  loopSeconds: CANON_TURNS * 8 * CANON_BEAT,
  lead: 4 * CANON_BEAT,
  solo: 0.45,
  under: 0.1,
  brightness: 3000,
  room: 0.5,
  // A bright, soft piano: a triangle fundamental with a little more shine than the prelude.
  voice: pluck(
    [
      [1, 1, 1, "triangle"],
      [2, 0.26, 0.55, "sine"],
      [3.003, 0.08, 0.35, "sine"],
      [4.006, 0.03, 0.25, "sine"],
    ],
    0.004,
  ),
};

// ---------------------------------------------------------------------------------------
// Moonlight piano: the rocking triplets and slow octave bass of the opening of Beethoven's
// "Moonlight" Sonata (Op. 27 No. 2, 1801, public domain), arranged in code.

/** One beat (a triplet of eighths) at an adagio tempo, in seconds. */
const BEAT = 1.08;

/** Four bars in C-sharp minor: each has its bass octaves and four triplets. */
const BARS: { bass: [number, number][]; triplets: number[][] }[] = [
  // C#m
  { bass: [[0, 37]], triplets: [[56, 61, 64], [56, 61, 64], [56, 61, 64], [56, 61, 64]] },
  // C#m over B
  { bass: [[0, 35]], triplets: [[56, 61, 64], [56, 61, 64], [56, 61, 64], [56, 61, 64]] },
  // A, then D over F#
  { bass: [[0, 33], [2, 30]], triplets: [[57, 61, 64], [57, 61, 64], [57, 62, 66], [57, 62, 66]] },
  // G#7, back towards C#m
  { bass: [[0, 32]], triplets: [[56, 60, 66], [56, 61, 64], [56, 61, 63], [54, 60, 63]] },
];

export const MOONLIGHT: BedPart = {
  loop: BARS.flatMap((bar, bi) => {
    const start = bi * 4 * BEAT;
    const bass = bar.bass.flatMap(([beat, n]) => [
      { at: start + beat * BEAT, note: n, level: 0.42, length: 4.5 },
      { at: start + beat * BEAT, note: n + 12, level: 0.3, length: 4.5 },
    ]);
    const upper = bar.triplets.flatMap((tri, beat) =>
      tri.map((n, k) => ({ at: start + (beat + k / 3) * BEAT, note: n, level: k === 0 ? 0.3 : 0.24, length: 1.9 })),
    );
    return [...bass, ...upper];
  }).sort((a, b) => a.at - b.at),
  loopSeconds: BARS.length * 4 * BEAT,
  lead: BEAT * 2,
  solo: 0.5,
  under: 0.3,
  brightness: 2200,
  room: 0.45,
  // A soft piano: one envelope over a triangle fundamental and two quiet partials.
  voice: pluck(
    [
      [1, 1, 1, "triangle"],
      [2, 0.22, 1, "sine"],
      [3.003, 0.07, 1, "sine"],
    ],
    0.006,
  ),
};
