# CLAUDE.md

Guidance for AI agents working in this repository. Read `AGENTS.md` too. It says that this Next.js (16.4) has breaking changes: read the relevant guide in `node_modules/next/dist/docs/` before you write Next-specific code.

## What this is

**Text to Speech Workbench** is a one-page Next.js studio for AssemblyAI's **Streaming TTS**: scene presets, an editable message, voice/language/scene sound, Play, and a stage that sets the message as captions over a photograph while it is spoken. The browser talks only to this app's internal API (`/api/tts/*`). The server opens the WebSocket to AssemblyAI with the reusable `AssemblyAITTS` class in `lib/tts/`, which is a TypeScript port of `tom-aai/assemblyai-livekit-tts` (`assemblyai_tts/tts.py`). Full documentation is in `README.md`.

## Commands

```bash
cp .env.example .env  # once; set ASSEMBLYAI_API_KEY
npm run dev         # next dev on APP_HOST:APP_PORT from .env (scripts/run.mjs)
npm run build       # production build; must pass
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (react-hooks rules are strict: no setState in effects, no stale useMemo)
npm run test:tts    # end-to-end smoke test against the running app (hits the real AssemblyAI API)
```

Node 22+ is required, because the server uses the global `WebSocket` with a `headers` init.

## Hard rules

1. **The key never leaves the server.** `lib/tts/index.ts`, `assemblyai-tts.ts` and `server.ts` import `server-only`. Client components may import **only** `@/lib/tts/models` (constants and validators) and `@/lib/client/*`. Never return `apiKey` from a route; use `publicOptions`. Never put the WebSocket URL or the headers in an error message.
2. **All browser traffic goes through `/api/tts/*`.** Do not call AssemblyAI from client code.
3. **Keep `AssemblyAITTS` reusable.** It must not depend on Next.js or on the request. Per-request settings use `getTTS().with({...})`. New capabilities go in the class first; routes stay thin, with validation in `lib/api.ts`.
4. **Protocol facts** (verified against the live service, Oct 2026):
   - Endpoint: `wss://tts.us.assemblyai.com/v1/ws` (EU: `tts.eu`). The `https://api.assemblyai.com/v2/tts` URL does not exist; `resolveBaseUrl()` falls back to the US endpoint.
   - Auth: `Authorization: <key>`, raw, not Bearer.
   - The connect parameters are `voice_id`, `language`, `model_id`, `sample_rate`, `encoding`, `word_boundaries`. The Python plugin sends `model`, which the server reports under `unknown_params`; send `model_id`. The `voice` parameter is retired (3006).
   - Client frames: `Generate {text}`, `Flush`, `Terminate`, `Cancel`, `KeepAlive`. Server frames: `Begin`, `Audio {audio, flush_id}`, `FlushDone {flush_id, audio_duration_ms}`, `WordBoundaries {flush_id, audio_start_ms, words}`, `Cancelled`, `Termination`, `Error {error_code, error_type, param, retryable, retry_after_seconds}`.
   - Consecutive `Generate` texts are joined verbatim, so keep a trailing space. A single `Generate` may hold at most 2,000 characters.
   - `WordBoundaries` `start`/`end` are on the session timeline. Do **not** add `audio_start_ms`.
   - Preset voices are `aai-alba|anna|charles|eve|george|jane|jean|mary|michael|paul|vera`, and each speaks english, spanish, german, french, italian and portuguese. Their UUIDs are in the README's voices table; keep it in sync if `PRESET_VOICES` changes. `GET /v1/voices` on the TTS host lists the public library (~4,000 voices).
5. **Do not commit `.env`** (it is git-ignored). Document new variables in `.env.example`, `README.md` and `AssemblyAITTS.fromEnv()`.

## Layout

- `lib/tts/`: the server library (`assemblyai-tts.ts`, `errors.ts`, `models.ts`, `sentences.ts`, `server.ts`, `index.ts`). Only `models.ts` is browser-safe.
- `lib/api.ts`: request parsing and mapping errors to HTTP statuses for the routes.
- `app/api/tts/{config,voices,speak}/route.ts`: the internal API. `speak` streams NDJSON by default, or returns `format: "wav"`.
- `lib/client/speech-player.ts`: the browser player. It reads the NDJSON stream, starts an optional scene sound, schedules PCM in Web Audio and keeps the word timeline (`positionMs()` for the voice, `timelineMs()`/`leadMs()` for sound lead + voice). Exposed through `useSyncExternalStore`.
- `lib/client/sounds/`: scene sounds synthesised with Web Audio, never sent to the server. `index.ts` (the `Sound` ids, `SOUND_NAMES`, `startSound()`), `engine.ts` (`bus()`, `bed()`, `pluck()`, the reverb), `chimes.ts`, `scores.ts` (the `BedPart` scores). A sound returns `{ lead, release(at), stop() }`: the voice is queued after `lead`; a bed (the Bach prelude, the Pachelbel canon, the moonlight piano) keeps playing until `release()` at the voice's end. The player keeps the `SoundRun` after `release()` so `stop()` can still cut the fade; choosing a scene always calls `stop()`. Add a chime to `CHIMES`, a bed to `scores.ts` and `BEDS`, and a label to `SOUND_NAMES` (the menu lists them all); keep it synthesised (no audio files).
- `lib/presets.ts`: the six scenes (message, voice, `sound`, picture, crop `focus`, camera `push`), `chunkWords()` for caption cards, `estimateSeconds()`.
- `app/components/`: `tts-context.tsx` (provider: player, settings, `.env` defaults; `speak(text, sound)`), `studio.tsx` (title, scene tabs, message, three dropdowns, Play, Download WAV), `stage.tsx` (photograph, caption cards, `useCamera`, progress, credit), `hooks.ts` (`useActiveWord`, `useGlide`, `usePrefersReducedMotion`), `powered-by.tsx` (the animated "Powered by AssemblyAI" mark; reads "Streaming from" while live), `play-icon.tsx`.
- `app/globals.css`: all styles, with design tokens at the top. Styles inside interface fragments go under `[data-ui]` selectors.
- `public/assets/`: the scene pictures and the metro clip, with `credits.json` (file, kind, title, creator, licence, source, changes), which the stage renders.
- `scripts/`: `run.mjs` (dev/start on `APP_HOST:APP_PORT`), `smoke.mjs` (`npm run test:tts`), `voices.mjs` (`npm run voices`).
- `.github/workflows/ci.yml`: typecheck, lint and build on Node from `.nvmrc`. Keep `npm run build` working without an API key.

## Design system (keep it)

The page follows the `design-taste-frontend` skill, direction *The product performs*. When you change the UI:

- Use the tokens in `globals.css`: colours (`--bg --surface --surface-2 --ink --muted --accent --field-1 --field-1-ink --field-1-soft`), type steps (`--step-small/body/lead/display/title`), weights (`--w-regular/medium/bold`) and tracking (`--track-*`). Every button is one pill shape (`--pill`); the textarea uses `--field-radius`. Keep the page quiet: no new panels or chips without a reason.
- House rules: no gradients, no shadows on elements at rest, no glass or blur, no eyebrow labels, no small letter-spaced uppercase labels, no 01/02/03 numbering, no hairline dividers, no styled accent word in a headline, and no monospace outside real code blocks. Headlines are at most two lines at every width. Body text is 16px or larger and in full ink.
- The tangerine accent appears only on Play (and the stage's phone play button) and the spoken word.
- Real product fragments carry `data-ui` on their root and must never wrap a heading or a whole section.
- Motion is spring-eased (`--spring`, `--spring-pop`; the same curve is sampled in `hooks.ts` for the Web Animations API). Per-frame values (the camera, timecode, progress) are written to the DOM from rAF, not through React state. The stage camera (`useCamera` in `stage.tsx`) follows the playback timeline, never the loudness.
- Motion uses transform and opacity only, with a `prefers-reduced-motion` fallback, and content is visible without JS (hidden states apply only under `html.js`).
- If the `design-taste-frontend` skill is installed, check UI changes with its `scripts/lint.mjs app` and `scripts/inspect.mjs http://localhost:$APP_PORT`.
- Pictures must be openly licensed, credited in `public/assets/credits.json` (and in the README table), and never presented as AssemblyAI's product. A new scene needs an entry there, or the stage shows no credit.

## Gotchas

- `cacheComponents: true` is on. A route handler that reads `.env` at request time and touches no request data needs `await connection()` (see `app/api/tts/config/route.ts`), or it will be prerendered.
- `devIndicators: false` in `next.config.ts` hides the floating Next.js dev tools button. Compile and runtime error overlays still appear.
- The font is Geist from `next/font/google`, exposed as `--nf-sans` and mapped to `--font` in `globals.css`. Weights and tracking are tokens (`--w-*`, `--track-*`); use them rather than raw values.
- Browsers start audio only after a user gesture. `SpeechPlayer.speak()` resumes the `AudioContext` inside the click.
- The player holds one run at a time; `isBusy(state.status)` is the "playing" flag for the whole page.
- A `SpeechPlayer` run is tagged with a counter. A new `speak()` or `stop()` invalidates the events of the previous run, so check `run === this.run` in any new async path.
