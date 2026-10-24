"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { SpeechPlayer, type PlayerState } from "@/lib/client/speech-player";
import type { Sound } from "@/lib/client/sounds";
import { DEFAULT_LANGUAGE, DEFAULT_SAMPLE_RATE, DEFAULT_VOICE_ID } from "@/lib/tts/models";

export interface Settings {
  voiceId: string;
  language: string;
  sampleRate: number;
}

export interface AppConfig {
  keyConfigured: boolean;
  defaults: { voiceId: string; language: string; model: string; sampleRate: number; endpoint: string | null };
  limits: { maxRequestChars: number; maxGenerateChars: number };
}

interface TTSContextValue {
  player: SpeechPlayer;
  state: PlayerState;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  /** Speak `text` with the current settings; `sound` plays in the browser with the voice. */
  speak: (text: string, sound?: Sound | null) => void;
  stop: () => void;
  config: AppConfig | null;
}

const Ctx = createContext<TTSContextValue | null>(null);

export function TTSProvider({ children }: { children: ReactNode }) {
  const [player] = useState(() => new SpeechPlayer());
  const state = useSyncExternalStore(player.subscribe, player.getState, player.getServerState);
  const [settings, setAll] = useState<Settings>({
    voiceId: DEFAULT_VOICE_ID,
    language: DEFAULT_LANGUAGE,
    sampleRate: DEFAULT_SAMPLE_RATE,
  });
  const [config, setConfig] = useState<AppConfig | null>(null);

  // Defaults come from .env through the internal API.
  useEffect(() => {
    let live = true;
    fetch("/api/tts/config")
      .then((r) => r.json())
      .then((c: AppConfig) => {
        if (!live) return;
        setConfig(c);
        setAll((s) => ({ ...s, voiceId: c.defaults.voiceId, language: c.defaults.language, sampleRate: c.defaults.sampleRate }));
      })
      .catch(() => {});
    return () => {
      live = false;
      player.stop();
    };
  }, [player]);

  const setSettings = useCallback((patch: Partial<Settings>) => setAll((s) => ({ ...s, ...patch })), []);

  const speak = useCallback(
    (text: string, sound: Sound | null = null) => {
      // "stream" sends one Generate/Flush per sentence, the way an LLM's output would arrive.
      void player.speak({ ...settings, text, mode: "stream", sound });
    },
    [player, settings],
  );

  const stop = useCallback(() => player.stop(), [player]);

  const value = useMemo(
    () => ({ player, state, settings, setSettings, speak, stop, config }),
    [player, state, settings, setSettings, speak, stop, config],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTTS(): TTSContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTTS() outside <TTSProvider>");
  return v;
}

export function isBusy(status: PlayerState["status"]): boolean {
  return status === "connecting" || status === "streaming" || status === "playing";
}
