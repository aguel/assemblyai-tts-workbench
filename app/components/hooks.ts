"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { SpeechPlayer, TimedWord } from "@/lib/client/speech-player";

/** Index of the word being spoken right now, or -1. Re-renders only when it changes. */
export function useActiveWord(player: SpeechPlayer, words: TimedWord[], enabled: boolean): number {
  const [idx, setIdx] = useState(-1);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const tick = () => {
      const pos = player.positionMs();
      let i = -1;
      if (pos >= 0) {
        for (let k = 0; k < words.length; k++) {
          if (words[k].start <= pos) i = k;
          else break;
        }
      }
      setIdx((prev) => (prev === i ? prev : i));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player, words, enabled]);
  return enabled ? idx : -1;
}

/** Tracks the user's reduced-motion preference. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** A critically damped spring (stiffness 170, damping 22), sampled for `linear()`. Same curve as `--spring` in globals.css. */
const SPRING =
  "linear(0, 0.053, 0.161, 0.301, 0.433, 0.555, 0.661, 0.75, 0.825, 0.879, 0.92, 0.95, 0.973, 0.987, 0.996, 1.001, 1.004, 1.006, 1.006, 1.006, 1.005, 1.004, 1.003, 1.003, 1)";

/**
 * A shared selection highlight, like a layout animation between two places: the
 * `[data-indicator]` element is rendered inside the selected option only, and when the
 * selection moves it is played from the old option's box to the new one (FLIP, transform only).
 */
export function useGlide<T extends HTMLElement>(selected: unknown) {
  const ref = useRef<T>(null);
  const last = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    const ind = root?.querySelector<HTMLElement>("[data-indicator]");
    if (!root || !ind) {
      last.current = null;
      return;
    }
    const base = root.getBoundingClientRect();
    const r = ind.getBoundingClientRect();
    const now = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    const prev = last.current;
    last.current = now;
    if (!prev || !now.w || !now.h || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = `translate(${prev.x - now.x}px, ${prev.y - now.y}px) scale(${prev.w / now.w}, ${prev.h / now.h})`;
    let anim: Animation | null = null;
    try {
      anim = ind.animate([{ transform: from }, { transform: "none" }], { duration: 560, easing: SPRING });
    } catch {
      anim = ind.animate([{ transform: from }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }
    return () => anim?.cancel();
  }, [selected]);
  return ref;
}
