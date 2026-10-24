# Text to Speech Workbench

Powered by [AssemblyAI](https://www.assemblyai.com/docs/tts/getting-started/quickstart). A one-page studio for **AssemblyAI's streaming text-to-speech**. Pick a scene (an airport gate, a flight deck, a metro platform…), edit the announcement, choose one of eleven voices and press Play. The speech streams back over a WebSocket, and each word lands on the picture the moment AssemblyAI says it is spoken.

- **A reusable server library.** `lib/tts/` holds `AssemblyAITTS`, a TypeScript port of the LiveKit plugin [`tom-aai/assemblyai-livekit-tts`](https://github.com/tom-aai/assemblyai-livekit-tts/blob/main/assemblyai_tts/tts.py), with the same protocol (`Generate` → `Flush` → `Terminate`), streaming and one-shot modes, word timings and the voice library.
- **The key stays on the server.** The browser only calls this app's own `/api/tts/*` routes; only the server opens the socket to AssemblyAI.
- **No UI framework.** Next.js 16 (App Router), React 19 and plain CSS. Motion is done with CSS and a few `requestAnimationFrame` loops, no animation library.

## Quick start

Requirements: **Node 22 or newer** (its global `WebSocket` accepts an `Authorization` header, which the client needs) and an [AssemblyAI API key](https://www.assemblyai.com/dashboard).

```bash
git clone <this repo> assemblyai-tts-workbench && cd assemblyai-tts-workbench
nvm use                   # optional: Node 22 from .nvmrc
npm install
cp .env.example .env      # then set ASSEMBLYAI_API_KEY
npm run dev               # http://localhost:9000 (APP_HOST:APP_PORT from .env)
```

| Script | What it does |
| --- | --- |
| `npm run dev` | `next dev` on `APP_HOST:APP_PORT` (through `scripts/run.mjs`) |
| `npm run build` / `npm start` | Production build, then `next start` on `APP_HOST:APP_PORT` |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / ESLint |
| `npm run test:tts` | End-to-end smoke test of the internal API against the running app (uses your key) |
| `npm run voices` | Lists voices and their IDs through `/api/tts/voices`. Options: `-- --language spanish`, `-- --q british`, `-- --all --json voices.json` |

The two scripts that talk to the app read `APP_HOST`/`APP_PORT` from `.env`; set `SMOKE_URL` to point them elsewhere.

## Configuration

All settings live in `.env`, which is git-ignored. Start from [`.env.example`](.env.example), which documents every variable:

```bash
cp .env.example .env
```

| Variable | Used for | Default |
| --- | --- | --- |
| `APP_HOST`, `APP_PORT` | The host and port that `npm run dev` / `npm start` bind to | `localhost`, `9000` |
| `ASSEMBLYAI_API_KEY` | Sent raw in the `Authorization` header of the WebSocket upgrade and of `GET /v1/voices` (not as a Bearer token) | required |
| `ASSEMBLYAI_API_TTS_URL` | The streaming endpoint. US: `wss://tts.us.assemblyai.com/v1/ws`. EU: `wss://tts.eu.assemblyai.com/v1/ws`. An `https://tts.*.assemblyai.com` URL is converted to `wss://`; any other host logs a warning and falls back to the US endpoint. | US endpoint |
| `ASSEMBLYAI_API_TTS_MODEL` | Sent as the `model_id` connect parameter | `assemblyai-tts-1` |
| `ASSEMBLYAI_API_TTS_VOICE` | Default `voice_id`: a slug such as `aai-jane` or a voice UUID. `npm run voices` lists them. | `aai-jane` |
| `ASSEMBLYAI_API_TTS_LANGUAGE` | Default `language`, as the English name of the language | `english` |
| `ASSEMBLYAI_API_TTS_SAMPLE_RATE` | Default sample rate: 8000, 16000, 22050, 24000, 44100 or 48000 | `24000` |

Next.js loads `.env` for the server code; `scripts/run.mjs` also reads it early (`process.loadEnvFile`) to pass `-H`/`-p` to Next. A variable already set in the shell wins over `.env`.

## Model and voices

The app uses AssemblyAI's streaming model **`assemblyai-tts-1`** (`ASSEMBLYAI_API_TTS_MODEL`, sent as `model_id`). It speaks six languages: `english`, `spanish`, `german`, `french`, `italian` and `portuguese`.

The page offers the eleven **preset voices**. Each one speaks all six languages; pass either the slug or the UUID as `voiceId` (or as `ASSEMBLYAI_API_TTS_VOICE`).

| Voice | Slug (`voice_id`) | UUID | Used by the preset |
| --- | --- | --- | --- |
| Alba | `aai-alba` | `e3118951-5270-5b3a-9082-0d5319aa1ce8` | |
| Anna | `aai-anna` | `33a0302a-51cd-5b46-81c9-f4aa8328900f` | Bedtime |
| Charles | `aai-charles` | `e1fcbb41-24c8-5d94-83a0-97ae4a7a3ab1` | Pilot |
| Eve | `aai-eve` | `1b043539-185d-577c-909e-1bbf712ed7c6` | Cathedral |
| George | `aai-george` | `7d039df2-8e07-5546-83ca-aee375b44c7d` | Metro |
| Jane | `aai-jane` | `95e643fb-dd55-577f-80ec-134c3118efcc` | Airport (and the default) |
| Jean | `aai-jean` | `788fb050-11bd-5eb9-a716-57a964981ede` | |
| Mary | `aai-mary` | `457d9d04-ba7b-56b7-9625-a5559e41aea2` | |
| Michael | `aai-michael` | `b009cbfa-2237-59ed-95aa-761ccd2ae37e` | Forecast |
| Paul | `aai-paul` | `22485a6b-2422-5df1-a8c8-bfcf2747322a` | |
| Vera | `aai-vera` | `a8c595ee-f642-59fb-a640-de8ac3cd16c1` | |

Beyond the presets, AssemblyAI's public library holds about 4,000 voices (slugs such as `aai-aaron`, each with a description and tags like `accent:british`). The API accepts any of them; list and search them with:

```bash
npm run voices                              # the presets, plus a count per language
npm run voices -- --language spanish        # every Spanish voice
npm run voices -- --q british               # search
npm run voices -- --all --json voices.json  # everything, saved as JSON
```

or `GET /api/tts/voices?q=british&language=english` (see [Internal API](#internal-api)). IDs were read from the live `GET /v1/voices` in October 2026.

## How it fits together

```
Browser                                    Next.js server                         AssemblyAI
───────────────────────────────            ──────────────────────────────         ────────────────────────────────
SpeechPlayer.speak() ── POST /api/tts/speak ─▶ route.ts
  optional scene sound (Web Audio)             getTTS().with({ voiceId, … })
  reads NDJSON events                          .stream() / .synthesize() ──── WebSocket ──▶ wss://tts.us.assemblyai.com/v1/ws
  schedules PCM in Web Audio                   ◀── Begin / Audio / FlushDone / WordBoundaries / Termination / Error
  keeps the word timeline
fetch /api/tts/config ─────────────────────▶ route.ts  (the .env defaults, never the key)
fetch /api/tts/voices ─────────────────────▶ route.ts ── GET /v1/voices ─────────────────▶ https://tts.us.assemblyai.com
```

```
app/
  page.tsx                    the page: <TTSProvider><Studio/></TTSProvider>
  layout.tsx                  font (Geist) and the html.js flag for no-JS-safe entrances
  globals.css                 every style; design tokens at the top
  components/
    studio.tsx                title, scene tabs, message, Voice / Language / Sound, Play, Download WAV
    stage.tsx                 photograph, caption cards, camera move, progress, picture credit
    tts-context.tsx           provider: the SpeechPlayer, settings, .env defaults
    hooks.ts                  useActiveWord, useGlide (tab highlight), usePrefersReducedMotion
    powered-by.tsx            the animated "Powered by AssemblyAI" mark
    play-icon.tsx             the play/stop icon
  api/tts/{config,voices,speak}/route.ts   the internal API
lib/
  tts/                        the server library (see below); only models.ts is browser-safe
  api.ts                      request validation and error-to-HTTP mapping for the routes
  client/speech-player.ts     browser player: NDJSON reader, Web Audio scheduler, word timeline
  client/sounds/              scene sounds synthesised in the browser (no audio files)
    index.ts                  Sound ids, menu labels, startSound()
    engine.ts                 bus, bed player (look-ahead scheduler), plucked voice, reverb
    chimes.ts                 terminal, cabin and station chimes
    scores.ts                 Bach prelude, Pachelbel canon, Moonlight piano, written as notes
  presets.ts                  the six scenes and the caption chunker
public/assets/                scene photographs, the metro clip, credits.json
scripts/                      run.mjs (dev/start on APP_HOST:APP_PORT), smoke.mjs, voices.mjs
.github/workflows/ci.yml      typecheck, lint and build on every push and pull request
```

## The `AssemblyAITTS` class

`AssemblyAITTS` is server-only: the module imports `server-only`, so importing it from a client component fails the build. It mirrors the Python plugin:

| LiveKit plugin (Python) | This port (TypeScript) |
| --- | --- |
| `TTS(voice_id=…, language=…, model=…, sample_rate=…, word_timestamps=…)` | `new AssemblyAITTS({ voiceId, language, model, sampleRate, wordTimestamps, apiKey, baseUrl })` or `AssemblyAITTS.fromEnv()` |
| `tts.synthesize(text)` → `ChunkedStream` | `tts.synthesize(text)` → `ChunkedStream`, one `Generate` and then `Terminate` |
| `tts.stream()` → `SynthesizeStream` | `tts.stream()` → `SynthesizeStream`: `pushText()`, `flush()`, `endInput()`. Each sentence is sent as `Generate` + `Flush`. |
| `update_options(voice_id=…, language=…)` | `updateOptions({ voiceId, language })`, or `with({...})` to get a per-request copy |
| `APIStatusError` / `APITimeoutError` / `APIConnectionError` | `TTSStatusError` (close code, `errorType`, `param`, `retryable`) / `TTSTimeoutError` / `TTSConnectionError` / `TTSAbortError` |

Each stream is an `AsyncIterable<TTSEvent>`:

```ts
import { AssemblyAITTS } from "@/lib/tts";

const tts = AssemblyAITTS.fromEnv({ wordTimestamps: true });

// One fixed text
for await (const ev of tts.synthesize("Hello there.")) {
  if (ev.type === "audio") write(ev.audio);           // Uint8Array, pcm_s16le
  if (ev.type === "words") console.log(ev.words);     // [{ word, start, end, confidence }]
}

// Incremental text, e.g. tokens from an LLM
const stream = tts.stream({ signal: abortController.signal, timeoutMs: 15_000 });
stream.pushText("Hello there. How are ");
stream.pushText("you today?");
stream.endInput();
for await (const ev of stream) { /* begin, audio, flush_done, words, cancelled, end */ }

// Whole result in memory
const { pcm, sampleRate, words } = await tts.synthesizeToBuffer("A file, please.");
const wav = pcmToWav(pcm, sampleRate);

// Voice library: one page, or every page
const { voices } = await tts.listVoices({ scope: "public", language: "spanish", q: "warm" });
const everything = await tts.listAllVoices({ scope: "all" }); // ~4,000 voices, { id, slug, name, language, tags, … }
```

Behaviour worth knowing:

- **Begin first.** Frames you send before `Begin` arrives are queued and written once the server answers `Begin`. An `Error` frame received in place of `Begin` raises a `TTSStatusError`.
- **Spacing.** The service joins consecutive `Generate` texts exactly as sent, so every piece gets a trailing space. Text longer than 2,000 characters is split at word boundaries.
- **Timeouts.** The idle timer runs only while the server still owes an answer: `Begin`, a `FlushDone` for each `Flush`, or the `Termination` after `Terminate`. An open session with nothing pending never times out. A `KeepAlive` is sent after 30 s with no other frame.
- **Word timings.** `WordBoundaries.start` and `.end` are already on the session's continuous timeline. Do not add `audio_start_ms` to them.
- **Abort.** An `AbortSignal` or `close()` closes the socket. `cancel()` sends `Cancel`, which interrupts the current request and keeps the session open.
- **Hooks.** `onSend(frame)` in the connection options is called for every frame written to the socket. The speak route uses it to echo each frame as a `sent` event.
- **Errors never echo the URL or headers,** because both can carry the key.

## Internal API

All responses carry `Cache-Control: no-store`. Every error has the same shape: `{ error, code, param?, retryable?, retryAfterSeconds? }`.

### `GET /api/tts/config`

Returns the defaults from `.env` (never the key) and the choices the UI offers.

```json
{ "keyConfigured": true,
  "defaults": { "voiceId": "aai-jane", "language": "english", "model": "assemblyai-tts-1",
                "sampleRate": 24000, "endpoint": "wss://tts.us.assemblyai.com/v1/ws" },
  "languages": [...], "presetVoices": [...], "sampleRates": [...],
  "limits": { "maxRequestChars": 5000, "maxGenerateChars": 2000 } }
```

### `GET /api/tts/voices?q=&language=&scope=public&sort=name&limit=24&cursor=`

A proxy for AssemblyAI's `GET /v1/voices`. Returns `{ voices: [{ id, slug, name, language, description, tags, publisher }], hasMore, nextCursor, total }`.

### `POST /api/tts/speak`

```json
{ "text": "Hello there. How are you?",
  "voiceId": "aai-jane", "language": "english", "sampleRate": 24000,
  "wordTimestamps": true,
  "mode": "stream",
  "format": "ndjson" }
```

- `mode`: `"stream"` (default) sends the text through `SynthesizeStream`, one `Generate`/`Flush` per sentence. `"chunked"` sends it through `ChunkedStream` as a single request.
- `format`: `"ndjson"` (default) streams events as they arrive. `"wav"` returns one `audio/wav` file.
- Limits: `text` must be 1 to 5,000 characters. `voiceId` is a slug or UUID, `language` one of the six languages, and `sampleRate` one of the six supported rates.

NDJSON events, one per line:

```
{"type":"begin","sessionId":"…","sampleRate":24000,"configuration":{…},"elapsedMs":723}
{"type":"sent","frame":"Generate","text":"Hello there. ","elapsedMs":723}
{"type":"sent","frame":"Flush","elapsedMs":723}
{"type":"audio","flushId":0,"audio":"<base64 pcm_s16le>","elapsedMs":1005,"firstAudioMs":1005}
{"type":"flush_done","flushId":0,"audioDurationMs":1040,"elapsedMs":1478}
{"type":"words","flushId":0,"audioStartMs":0,"words":[{"word":"Hello","start":98,"end":361,"confidence":0.75}],"elapsedMs":1478}
{"type":"end","audioDurationSeconds":2.96,"totalInputChars":45,"sessionDurationSeconds":0,"elapsedMs":2197}
{"type":"error","error":"AssemblyAI TTS error 3012: …","code":"voice_not_found","param":"voice_id","retryable":false}
```

Validation failures and a missing key return a plain JSON error before the stream starts (`400` or `503`). A failure during the session arrives as an `error` event, and then the stream ends. If the client aborts the request, the upstream socket is closed. When `format` is `"wav"`, AssemblyAI failures are mapped to HTTP status codes: `1008` → 401, `3006`/`3012`/`3014` → 400, `3009`/`3010` → 429, everything else → 502, and a timeout → 504.

```bash
curl -N -X POST http://localhost:9000/api/tts/speak \
  -H 'Content-Type: application/json' \
  -d '{"text":"Gate A 14 is now boarding for Lisbon."}'

curl -X POST http://localhost:9000/api/tts/speak -H 'Content-Type: application/json' \
  -d '{"text":"Save me as a file.","format":"wav"}' -o out.wav
```

## The page

One screen: the title and a single column of controls on the left, the stage on the right (above the controls on tablets and phones).

| Part | What it does |
| --- | --- |
| Scene tabs | Six editable presets: **Airport** (final boarding call), **Pilot** (the captain at cruising altitude), **Metro** (a train arriving), **Cathedral** (a guide under Pozzo's painted ceiling in Sant'Ignazio, Rome, with Bach), **Forecast** (a snowy-morning weather report over Pachelbel's Canon), **Bedtime** (blue moonlight and a quiet piano). Each sets the message, a voice and a sound. |
| Message | A free textarea, up to 5,000 characters. ⌘/Ctrl + Enter plays it; *Restore the original text* brings back the preset. |
| Voice, Language, Sound | The eleven preset voices, the six languages each of them speaks, and a scene sound (see below). |
| Play / Download WAV | Streams through `/api/tts/speak` (NDJSON, one `Generate`/`Flush` per sentence), or renders one WAV file. |
| Stage | The scene's photograph (the metro scene is a muted looping clip) and the message, one caption at a time. At rest the captions rehearse; while the voice plays each word lands on its `WordBoundaries` time and the spoken word turns tangerine. A timecode and progress bar sit underneath, with the picture's credit. |

### Scene sounds

Every sound is synthesised in the browser with Web Audio (`lib/client/sounds/`): no audio files, nothing sent to the server, and the WAV download holds the voice only. The player queues the first audio chunk after the sound's lead, so the voice always comes in on cue. Stop, choosing another scene or playing again cuts any sound at once, including a bed that is still fading out.

| Sound | Used by | What it is |
| --- | --- | --- |
| Terminal chime | Airport | Three rising bell tones (C, E, G), then the voice |
| Cabin chime | Pilot | The two-tone high–low cabin chime |
| Station chime | Metro | Three falling bell tones |
| Bach prelude | Cathedral | A bed under the voice: the first eight bars of J. S. Bach's Prelude in C major, BWV 846 (1722, public domain), arranged in code for a soft piano. It plays half a bar alone, then sits quietly under the guide and fades out after the last word. |
| Pachelbel canon | Forecast | A bed under the voice: the opening of Johann Pachelbel's Canon in D major (c. 1680, public domain), arranged in code for a bright, soft piano at 100 beats a minute. As in the score, the ground bass (D A B F# G D G A) repeats and three violins play the same tune a turn apart (F# E D C# B A B C#, then D C# B A G F# G E, then the running D F# A G F# D F# E D B D A G B A G), so it builds from one voice to three. Under the voice it drops to about a fifth of its level so it keeps out of the way; it fades out after the last word. |
| Moonlight piano | Bedtime | A bed under the voice: the rocking triplets and octave bass of the opening of Beethoven's "Moonlight" Sonata (Op. 27 No. 2, 1801, public domain), arranged in code. It plays two beats alone, dips under the voice and fades out after the last word. |

### Motion

Everything moves on a timeline, the way a Remotion composition does, eased with sampled springs (`--spring`, `--spring-pop` in `globals.css`):

- **Entrance:** the title rises line by line out of a mask, then the controls arrive in reading order.
- **Scene change:** the new photograph wipes in from the right with a counter-move, settles from a slight zoom and then drifts slowly. The tab highlight glides to the new tab (FLIP, `useGlide`).
- **While speaking:** one slow camera move, a push-in and a pan towards the scene's point of interest (`push` in `lib/presets.ts`), interpolated from the playback position (`useCamera` in `stage.tsx`) so it lands as the last word ends. It follows time, not loudness, and eases home on stop.
- **Captions:** words spring up one by one and leave upward; the play icon morphs into stop.

Only `transform` and `opacity` animate. Per-frame values are written to the DOM from `requestAnimationFrame`, never through React state. With `prefers-reduced-motion` the content stays and the travel goes; without JavaScript nothing is hidden.

### Design

- **Wordmark:** "Text to Speech" over "Workbench" at the top left, set in semibold over regular; "Powered by AssemblyAI" opposite it in the same two-line build, right-aligned. On load "Powered by" slides up out of a mask and the letters of AssemblyAI spring up one by one; when a request goes out the line reads "Streaming from" and the letters replay.
- **Type:** one family, [Geist](https://vercel.com/font), in three weights. Title and caption at 500 with tight tracking, the message and lede at 19 px, controls at 16 px, labels at 14 px.
- **Colour:** navy `#1f2b4d` on white, a near-black stage, and one tangerine accent `#f7941d`, used only on Play and the spoken word.
- **Shapes:** every button is the same pill; the message field is rounded. No gradients, no shadows at rest, no dividers.

The art direction was produced with the `design-taste-frontend` agent skill (direction *The product performs*); its working files (`.taste-skill/`) are git-ignored and not needed to run the app.

## Adding a scene or a sound

- **A scene:** add an entry to `PRESETS` in `lib/presets.ts` (message, voice, sound, picture, `focus` crop and camera `push`). Put an openly licensed picture in `public/assets/` and credit it in `public/assets/credits.json` and in the table below; the stage shows no credit without it.
- **A chime:** add its notes to `CHIMES` in `lib/client/sounds/chimes.ts` and its id to `ChimeKind`.
- **A bed:** write a `BedPart` in `lib/client/sounds/scores.ts` (a loop of MIDI notes, the lead before the voice, levels, tone and instrument) and add it to `BEDS` in `lib/client/sounds/index.ts`.
- Give either one a label in `SOUND_NAMES`; the Sound menu lists every entry.

Before a pull request, run `npm run typecheck`, `npm run lint` and `npm run build` (CI runs the same), and `npm run test:tts` against a running app if you touched the server.

## Picture credits

The scene pictures are openly licensed works from Wikimedia Commons. They show the places these messages belong to; they are not AssemblyAI products and do not depict any real announcement. Each credit is shown on the stage with its scene and recorded in [`public/assets/credits.json`](public/assets/credits.json).

| File | Title | Creator | Licence | Changes |
| --- | --- | --- | --- | --- |
| `scene-airport.jpg` | [Departure board in gates A at Zurich International Airport](https://commons.wikimedia.org/wiki/File:Departure_board_in_gates_A_at_Zurich_International_Airport.jpg) | Stimpy | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | Resized |
| `scene-cockpit.jpg` | [Boeing 707-123B cockpit, Deutsches Museum](https://commons.wikimedia.org/wiki/File:Boeing_707-123B_cockpit,_Deutsches_Museum.jpg) | Wilfredor | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) | Resized |
| `scene-platform-arrival.webm` + poster | [Southbound train arriving at Harvard station, 2018](https://commons.wikimedia.org/wiki/File:Southbound_train_arriving_at_Harvard_station,_2018.webm) | Beantowndude316 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | Audio removed; poster from a frame |
| `scene-cathedral.jpg` | [Roma, sant'ignazio, interno 01](https://commons.wikimedia.org/wiki/File:Roma,_sant%27ignazio,_interno_01.jpg) | Sailko | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) | Resized |
| `scene-snow.jpg` | [Snowy morning in Sangla, Himachal Pradesh, India](https://commons.wikimedia.org/wiki/File:Snowy_morning_in_Sangla,_Himachal_Pradesh,_India.jpg) | UnpetitproleX | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | Resized |
| `scene-bedtime.jpg` | [Reverie](https://commons.wikimedia.org/wiki/File:Lenoir,_Charles-Amable_-_Reverie.jpg) (painting, 1893) | Charles-Amable Lenoir | [Public domain](https://creativecommons.org/publicdomain/mark/1.0/) | Resized |

The resized CC BY-SA pictures are shared under their original licence. The preset messages (flight LX 318 to Lisbon, gate A 14, the Braintree train, the snowy-morning forecast and so on) are invented for the demo.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `ASSEMBLYAI_API_KEY is not set` on the page, `503 not_configured` from the API | The key is missing from `.env`; restart `npm run dev` after adding it |
| `unauthorized` (close 1008) | The key is wrong or disabled, or the account has no funds |
| `voice_not_found` (3012) | The `voiceId` names no voice your account can use. Preset voices are `aai-<name>`. |
| `rate_limited` (3009) | Too many new sessions this minute; wait `retryAfterSeconds` |
| No sound | Browsers start audio only after a click; check the system output device |
| `This runtime has no WebSocket` | Node is older than 22 |

## Licence

The code is released under the [MIT License](LICENSE). The pictures in `public/assets/` are not covered by it: each keeps its own licence, listed under [Picture credits](#picture-credits). The music in `lib/client/sounds/scores.ts` is arranged from public-domain works.

References: [AssemblyAI Streaming TTS quickstart](https://www.assemblyai.com/docs/tts/getting-started/quickstart) · [Voices](https://www.assemblyai.com/docs/tts/voices) · [Error handling](https://www.assemblyai.com/docs/tts/error-handling) · [LiveKit plugin source](https://github.com/tom-aai/assemblyai-livekit-tts).
