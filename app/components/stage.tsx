"use client";
/* eslint-disable @next/next/no-img-element -- scene photographs are served as-is from /public/assets */

import { useEffect, useMemo, useRef, useState } from "react";

import { chunkWords, estimateSeconds, PRESETS, type Preset } from "@/lib/presets";
import { tokenize } from "@/lib/tts/models";
import credits from "@/public/assets/credits.json";

import { useActiveWord, usePrefersReducedMotion } from "./hooks";
import { PlayIcon } from "./play-icon";
import { isBusy, useTTS } from "./tts-context";

/** While nothing plays, the stage rehearses the message one caption card at a time. */
const REHEARSAL_MS = 3200;

interface Credit {
  file: string;
  /** "Photo", "Painting" or "Clip", shown before the creator. */
  kind: string;
  creator: string | null;
  license: string;
  licenseUrl: string;
  source: string;
}

/**
 * The stage: the scene's photograph and the message set on it one caption card at a time.
 * While the voice plays, each word lands when AssemblyAI's word boundaries say so.
 */
export function Stage({ preset, text, onPlay }: { preset: Preset; text: string; onPlay: () => void }) {
  const { player, state } = useTTS();
  const live = isBusy(state.status);
  const reduced = usePrefersReducedMotion();

  const words = useMemo(() => tokenize(text), [text]);
  const cards = useMemo(() => chunkWords(words), [words]);
  const cardOf = useMemo(() => {
    const m: number[] = [];
    cards.forEach((c, ci) => c.forEach((w) => (m[w] = ci)));
    return m;
  }, [cards]);

  const timed = useActiveWord(player, state.words, live);
  const now = timed < 0 || !words.length ? -1 : Math.min(timed, words.length - 1);
  const liveIdx = now >= 0 ? (cardOf[now] ?? 0) : 0;

  // Live: the card holding the spoken word. At rest: the rehearsal, which carries on from
  // the last card spoken.
  const [rest, setRest] = useState(0);
  const [track, setTrack] = useState({ live, idx: liveIdx });
  if (track.live !== live || (live && track.idx !== liveIdx)) {
    if (track.live && !live) setRest(track.idx);
    setTrack({ live, idx: liveIdx });
  }
  useEffect(() => {
    if (live || reduced || cards.length < 2) return;
    const t = setInterval(() => setRest((r) => r + 1), REHEARSAL_MS);
    return () => clearInterval(t);
  }, [live, reduced, cards.length]);
  const idx = live ? liveIdx : cards.length ? rest % cards.length : 0;
  const card = cards[idx] ?? [];
  const cardKey = `${preset.id}|${idx}|${card[0] ?? -1}|${live ? "live" : "rest"}`;
  const cardWords = card.map((g) => words[g]);

  // Keep the previous card for one transition, so it can leave while the next one lands.
  const [shown, setShown] = useState<{ key: string; words: string[]; prev: { key: string; words: string[] } | null }>({
    key: cardKey,
    words: cardWords,
    prev: null,
  });
  if (shown.key !== cardKey) setShown({ key: cardKey, words: cardWords, prev: { key: shown.key, words: shown.words } });

  // The new photograph wipes in over the one it replaces.
  const [scene, setScene] = useState<{ id: string; prev: string | null }>({ id: preset.id, prev: null });
  if (scene.id !== preset.id) setScene({ id: preset.id, prev: scene.id });

  // The announcement's length on the run's timeline (the scene sound's lead included). While audio is still
  // streaming in, what has arrived is shorter than the whole, so the word-count estimate
  // stays a floor until the run is done; then the length is exact.
  const lastEnd = state.words.length ? state.words[state.words.length - 1].end : 0;
  const estimate = estimateSeconds(words.length) * 1000;
  const received = Math.max(state.audioMs, lastEnd);
  const voiceMs = state.status === "done" && received ? received : Math.max(estimate, received);
  const total = (live ? player.leadMs() : 0) + voiceMs;
  const done = state.status === "done";

  // The camera: one slow dolly across the photograph, interpolated from the playback
  // position the way a Remotion composition interpolates from its frame. Nothing in it
  // listens to loudness; it only knows how far through the announcement it is.
  const stageRef = useRef<HTMLDivElement>(null);
  useCamera(stageRef, live && !reduced, total, preset.push);

  const wordClass = (g: number) => {
    if (!live) return "";
    if (now < 0) return "is-ahead";
    return g < now ? "is-said" : g === now ? "is-now" : "is-ahead";
  };

  const credit = (credits as Credit[]).find((c) => c.file === (preset.video ?? preset.image));

  return (
    <div className={`stage ${live ? "is-live" : ""}`} ref={stageRef}>
      <div className="scenes-layer" aria-hidden>
        {PRESETS.map((p) => {
          const on = p.id === scene.id;
          const prev = p.id === scene.prev;
          return (
            <div key={p.id} className={`scene ${on ? "is-on" : ""} ${prev ? "is-prev" : ""}`}>
              <div className="scene-mask">
                <div className="scene-counter">
                  <div className="scene-level">
                    {p.video && on ? (
                      <video
                        src={p.video}
                        poster={p.image}
                        style={{ objectPosition: p.focus }}
                        muted
                        loop
                        playsInline
                        autoPlay={!reduced}
                        preload="auto"
                      />
                    ) : (
                      <img
                        src={p.image}
                        alt=""
                        style={{ objectPosition: p.focus }}
                        loading={on || prev ? "eager" : "lazy"}
                        decoding="async"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <img className="sr-only" src={preset.image} alt={preset.alt} />
      <div className="stage-shade" aria-hidden />

      <div className="caption" aria-hidden>
        {shown.prev && !reduced && (
          <p className="card is-leaving" key={shown.prev.key}>
            {shown.prev.words.map((w, j) => (
              <span key={j}>
                {j > 0 && " "}
                <span className="cw" style={{ "--i": j } as React.CSSProperties}>
                  <span className="cw-in">{w}</span>
                </span>
              </span>
            ))}
          </p>
        )}
        <p className={`card ${words.length ? "" : "is-empty"}`} key={cardKey}>
          {words.length
            ? card.map((g, j) => (
                <span key={g}>
                  {j > 0 && " "}
                  <span className={`cw ${wordClass(g)}`} style={{ "--i": j } as React.CSSProperties}>
                    <span className="cw-in">{words[g]}</span>
                  </span>
                </span>
              ))
            : "Type a message"}
        </p>
      </div>

      <div className="stage-foot">
        <div className="stage-bar">
          {/* On a phone the composer is below the fold, so the stage gets its own play button. */}
          <button type="button" className="stage-play" onClick={onPlay} aria-label={live ? "Stop" : "Play"}>
            <PlayIcon live={live} />
          </button>
          <Progress total={total} live={live} done={done} />
        </div>
        {credit && (
          <p className="stage-credit">
            <a href={credit.source}>
              {credit.kind}: {credit.creator ?? "unknown"}
            </a>
            , <a href={credit.licenseUrl}>{credit.license}</a>, via Wikimedia Commons
          </p>
        )}
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  // A clock, not an index.
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

/** Remotion's interpolate(): map `t` from [a, b] onto [c, d], clamped, through an easing. */
function interpolate(t: number, [a, b]: [number, number], [c, d]: [number, number], ease = (x: number) => x): number {
  const p = Math.min(1, Math.max(0, (t - a) / (b - a || 1)));
  return c + (d - c) * ease(p);
}
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

/**
 * Drive the stage's camera from the player's timeline, per frame, without React: a short
 * settle as the voice begins, then a continuous push-in and pan towards the scene's
 * point of interest that arrives exactly as the last word ends. On stop, CSS eases it home.
 */
function useCamera(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean, total: number, push: [number, number]) {
  const { player } = useTTS();
  const totalRef = useRef(total);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      el.style.removeProperty("--cam-s");
      el.style.removeProperty("--cam-x");
      el.style.removeProperty("--cam-y");
      return;
    }
    const [px, py] = push;
    let raf = 0;
    let reached = 0;
    const tick = () => {
      const t = Math.max(0, player.timelineMs());
      // The camera only ever moves forward, even when the length estimate is corrected.
      reached = Math.max(reached, interpolate(t, [0, Math.max(1, totalRef.current)], [0, 1]));
      // A quick settle in the first 900 ms, then the long move over the whole announcement.
      const settle = interpolate(t, [0, 900], [0, 1], easeOutCubic);
      const travel = easeInOutCubic(reached);
      el.style.setProperty("--cam-s", (1 + 0.025 * settle + 0.11 * travel).toFixed(4));
      el.style.setProperty("--cam-x", `${(px * travel).toFixed(3)}%`);
      el.style.setProperty("--cam-y", `${(py * travel).toFixed(3)}%`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref, enabled, player, push]);
}

/** Timecode and a progress bar, drawn per frame from the player while it plays. */
function Progress({ total, live, done }: { total: number; live: boolean; done: boolean }) {
  const { player } = useTTS();
  const fillRef = useRef<HTMLSpanElement>(null);
  const tcRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef(total);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);

  useEffect(() => {
    const fill = fillRef.current;
    const tc = tcRef.current;
    if (!fill || !tc) return;
    if (!live) {
      fill.style.transform = `scaleX(${done ? 1 : 0})`;
      tc.textContent = fmt(done ? totalRef.current : 0);
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = player.timelineMs();
      fill.style.transform = `scaleX(${(t < 0 ? 0 : Math.min(1, t / Math.max(1, totalRef.current))).toFixed(4)})`;
      tc.textContent = fmt(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, done, player]);

  return (
    <div className="progress" data-ui>
      <span className="tc nums" ref={tcRef}>
        0:00
      </span>
      <span className="track">
        <span className="track-fill" ref={fillRef} />
      </span>
      <span className="tc nums">{fmt(total)}</span>
    </div>
  );
}
