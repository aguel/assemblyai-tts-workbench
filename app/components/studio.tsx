"use client";

import { useRef, useState } from "react";

import { downloadWav } from "@/lib/client/speech-player";
import { SOUND_NAMES, type Sound } from "@/lib/client/sounds";
import { PRESETS, presetById } from "@/lib/presets";
import { LANGUAGES, MAX_REQUEST_CHARS, PRESET_VOICES, voiceName } from "@/lib/tts/models";

import { useGlide, usePrefersReducedMotion } from "./hooks";
import { PlayIcon } from "./play-icon";
import { PoweredBy } from "./powered-by";
import { Stage } from "./stage";
import { isBusy, useTTS } from "./tts-context";

const SOUNDS: (Sound | null)[] = [null, ...(Object.keys(SOUND_NAMES) as Sound[])];
const i = (n: number) => ({ "--i": n }) as React.CSSProperties;

/**
 * The whole page. Desktop: the title and the composer on the left, the stage on the right.
 * Phone: title, stage, composer.
 */
export function Studio() {
  const { state, settings, setSettings, speak, stop, config } = useTTS();
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const preset = presetById(presetId);
  const [text, setText] = useState(preset.text);
  const [sound, setSound] = useState<Sound | null>(preset.sound);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();
  const tabsRef = useGlide<HTMLDivElement>(presetId);

  const live = isBusy(state.status);
  const edited = text !== preset.text;

  const choose = (id: string) => {
    const p = presetById(id);
    // Always: a finished run may still be fading its music out.
    stop();
    setPresetId(p.id);
    setText(p.text);
    setSound(p.sound);
    setSettings({ voiceId: p.voiceId });
  };

  const play = () => {
    if (live) return stop();
    if (!text.trim()) return textRef.current?.focus();
    speak(text, sound);
    // On a phone the stage may be scrolled away: bring it back so the words can be watched.
    const el = stageRef.current;
    if (el && window.matchMedia("(max-width: 1000px)").matches) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 120 || r.top > innerHeight * 0.6) el.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await downloadWav({ text, voiceId: settings.voiceId, language: settings.language, sampleRate: settings.sampleRate });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const voices = PRESET_VOICES.some((v) => v.id === settings.voiceId)
    ? PRESET_VOICES
    : [{ id: settings.voiceId, name: settings.voiceId }, ...PRESET_VOICES];
  const notice =
    (state.status === "error" && state.error && `${state.error.message} (${state.error.code})`) ||
    saveError ||
    (config && !config.keyConfigured && "ASSEMBLYAI_API_KEY is not set in .env, so the server cannot open a session.") ||
    null;

  return (
    <div className="studio" id="top">
      <header className="head">
        <div className="topline">
          <a className="wordmark" href="#top" aria-label="Text to Speech Workbench">
            <span className="wm-line" aria-hidden>
              Text to Speech
            </span>
            <span className="wm-line wm-second" aria-hidden>
              Workbench
            </span>
          </a>
          <PoweredBy live={live} />
        </div>
        <h1 className="title lines">
          <span className="line">
            <span data-line style={i(0)}>
              Make the
            </span>
          </span>
          <span className="line">
            <span data-line style={i(1)}>
              announcement
            </span>
          </span>
        </h1>
        <p className="lede" data-rise style={i(2)}>
          Choose a scene, edit the words, pick a voice and play it.
        </p>
      </header>

      <section className="stage-wrap" aria-label="Preview" ref={stageRef}>
        <Stage preset={preset} text={text} onPlay={play} />
      </section>

      <div className="composer">
        <div className="tabs" role="radiogroup" aria-label="Scene" ref={tabsRef} data-rise style={i(3)}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === presetId}
              className="tab"
              title={p.note}
              onClick={() => choose(p.id)}
            >
              {p.id === presetId && <span className="indicator" data-indicator aria-hidden />}
              <span className="tab-label">{p.name}</span>
            </button>
          ))}
        </div>

        <div className="message-field" data-rise style={i(4)}>
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <textarea
            id="message"
            ref={textRef}
            className="message"
            value={text}
            maxLength={MAX_REQUEST_CHARS}
            rows={5}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                play();
              }
            }}
          />
          <div className="message-foot">
            {edited ? (
              <button type="button" className="text-button" onClick={() => setText(preset.text)}>
                Restore the original text
              </button>
            ) : (
              <span className="hint">{preset.note}</span>
            )}
            <span className="count nums">
              {text.length.toLocaleString("en")} / {MAX_REQUEST_CHARS.toLocaleString("en")}
            </span>
          </div>
        </div>

        <div className="settings" data-rise style={i(5)}>
          <Field
            id="voice"
            label="Voice"
            value={settings.voiceId}
            onChange={(v) => setSettings({ voiceId: v })}
            options={voices.map((v) => ({ value: v.id, label: v.name }))}
          />
          <Field
            id="language"
            label="Language"
            value={settings.language}
            onChange={(v) => setSettings({ language: v })}
            options={LANGUAGES.map((l) => ({ value: l.id, label: l.name }))}
          />
          <Field
            id="sound"
            label="Sound"
            value={sound ?? "none"}
            onChange={(v) => setSound(v === "none" ? null : (v as Sound))}
            options={SOUNDS.map((c) => ({ value: c ?? "none", label: c ? SOUND_NAMES[c] : "None" }))}
          />
        </div>

        <div className="actions" data-rise style={i(6)}>
          <button
            type="button"
            className={`button button-accent play ${live ? "is-live" : ""}`}
            onClick={play}
            title="⌘ or Ctrl + Enter"
            aria-keyshortcuts="Meta+Enter Control+Enter"
          >
            <PlayIcon live={live} />
            <span className="play-label" key={live ? "stop" : "play"}>
              {live ? "Stop" : "Play"}
            </span>
          </button>
          <button type="button" className="button button-quiet" onClick={save} disabled={saving || !text.trim()}>
            {saving ? "Rendering…" : "Download WAV"}
          </button>
          <p className="status nums" aria-live="polite">
            {state.status === "done" && state.firstAudioMs != null
              ? `${voiceName(settings.voiceId)}, first audio in ${state.firstAudioMs} ms`
              : ""}
          </p>
        </div>

        {notice && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="select">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg className="chevron" viewBox="0 0 12 8" width="12" height="8" aria-hidden>
          <path d="M1 1.5 L6 6.5 L11 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
    </div>
  );
}
