/**
 * Scene presets: a message, a suggested voice, a scene sound, and a picture of the place
 * the message belongs to. Client-safe: no secrets.
 */

import type { Sound } from "@/lib/client/sounds";

export interface Preset {
  id: string;
  name: string;
  /** A short description, shown under the message and as the tab's tooltip. */
  note: string;
  text: string;
  voiceId: string;
  /** Played in the browser with the voice (see lib/client/sounds/); never sent to the server. */
  sound: Sound | null;
  /** Photograph of the scene (or the clip's poster), under /public. Its credit is in public/assets/credits.json. */
  image: string;
  /** A muted looping clip of the scene, played over its poster where motion is allowed. */
  video?: string;
  alt: string;
  /** CSS object-position for the stage crop. */
  focus: string;
  /** Where the stage camera pans while the message plays, in % of the frame [x, y]. */
  push: [number, number];
}

export const PRESETS: Preset[] = [
  {
    id: "airport",
    name: "Airport",
    note: "Final boarding call, three-tone chime",
    text: "Good evening, ladies and gentlemen. This is the final boarding call for flight LX 318 to Lisbon. All remaining passengers, please make your way to gate A 14 immediately. The gate will close in five minutes.",
    voiceId: "aai-jane",
    sound: "airport",
    image: "/assets/scene-airport.jpg",
    alt: "A departure board above the gates at Zurich Airport",
    focus: "50% 40%",
    push: [0, 2.5],
  },
  {
    id: "pilot",
    name: "Pilot",
    note: "The captain at cruising altitude",
    text: "Good afternoon from the flight deck, this is your captain speaking. We have reached our cruising altitude of thirty-seven thousand feet, and the skies ahead look smooth. Our flight time to Singapore is six hours and ten minutes. Sit back, relax, and enjoy the flight.",
    voiceId: "aai-charles",
    sound: "cabin",
    image: "/assets/scene-cockpit.jpg",
    alt: "The cockpit of a Boeing 707 at the Deutsches Museum",
    focus: "50% 55%",
    push: [-2.5, -1],
  },
  {
    id: "metro",
    name: "Metro",
    note: "A train arriving, stand back from the edge",
    text: "The next train to arrive on platform two is southbound, to Braintree. Please stand back from the platform edge, and let passengers off the train before you board.",
    voiceId: "aai-george",
    sound: "train",
    image: "/assets/scene-platform-arrival-poster.jpg",
    video: "/assets/scene-platform-arrival.webm",
    alt: "A southbound train pulling into Harvard station, Cambridge, Massachusetts",
    focus: "50% 50%",
    push: [3, 0],
  },
  {
    id: "cathedral",
    name: "Cathedral",
    note: "A guide in Sant'Ignazio, Rome, with Bach",
    text: "Welcome to the Church of Sant'Ignazio. Look up: high above the nave, Andrea Pozzo's painted ceiling opens into a sky of saints and golden light. Below it, warm marble columns lead the eye to the high altar, glowing in gold. Take a seat, and let the colour of this great church surround you.",
    voiceId: "aai-eve",
    sound: "prelude",
    image: "/assets/scene-cathedral.jpg",
    alt: "The nave of Sant'Ignazio, Rome: a warm, vividly painted ceiling high above, gilded marble walls and the high altar",
    focus: "50% 50%",
    push: [0, 1.5],
  },
  {
    id: "snow",
    name: "Forecast",
    note: "A snowy-morning weather report over Pachelbel's Canon",
    text: "This is your morning weather flash. Heavy snow fell overnight across the valley, with up to twenty centimetres on higher ground. Light flurries will continue until midday, and temperatures stay just below freezing. Roads are slow this morning, so allow extra time. More updates on the hour.",
    voiceId: "aai-michael",
    sound: "canon",
    image: "/assets/scene-snow.jpg",
    alt: "Snow-covered roofs and pine trees on a winter morning in Sangla, Himachal Pradesh",
    focus: "50% 50%",
    push: [-2, 1],
  },
  {
    id: "bedtime",
    name: "Bedtime",
    note: "Blue moonlight and a quiet piano",
    text: "The room is dark and quiet, and the moon has come to the window. Its blue light falls softly across the bed. Close your eyes now, and listen to the night. The moon will keep watch until morning.",
    voiceId: "aai-anna",
    sound: "moonlight",
    image: "/assets/scene-bedtime.jpg",
    alt: "Reverie by Charles-Amable Lenoir, 1893: a woman resting in bed by a moonlit window",
    focus: "50% 45%",
    push: [2, -1.5],
  },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/**
 * Group words into caption cards of at most `budget` characters, breaking after the end
 * of a sentence or a long clause, the way a motion designer would set them.
 * Returns the word indices of each card.
 */
export function chunkWords(words: string[], budget = 26): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  // A word that ends a sentence or clause may run a little over, so it is never orphaned
  // at the top of the next card.
  const slack = Math.round(budget * 0.4);
  const ends = (w: string) => /[.!?…,;:]["'”’)]*$/.test(w);
  words.forEach((w, i) => {
    const next = len + (len ? 1 : 0) + w.length;
    if (cur.length && next > budget && !(ends(w) && next <= budget + slack)) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(i);
    len += (len ? 1 : 0) + w.length;
    const sentence = /[.!?…]["'”’)]*$/.test(w);
    const clause = /[,;:]$/.test(w) && len > budget * 0.55;
    if ((sentence && len >= 6) || clause) {
      out.push(cur);
      cur = [];
      len = 0;
    }
  });
  if (cur.length) out.push(cur);
  // A last card of one short word joins the card before it.
  if (out.length > 1 && out[out.length - 1].length === 1 && words[out[out.length - 1][0]].length <= slack) {
    const last = out.pop()!;
    out[out.length - 1].push(...last);
  }
  return out;
}

/** Rough speaking time for text that has not been synthesised yet (~2.6 words per second). */
export function estimateSeconds(words: number): number {
  return Math.max(1, Math.round(words / 2.6));
}
