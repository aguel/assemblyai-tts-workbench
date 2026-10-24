import type { NextRequest } from "next/server";

import { json, parseSpeakRequest, toApiError } from "@/lib/api";
import { getTTS, isKeyConfigured, pcmToWav, type SentFrame, type TTSEvent } from "@/lib/tts";

/**
 * POST /api/tts/speak
 *
 * Body: { text, voiceId?, language?, sampleRate?, wordTimestamps?, mode?, format? }
 *
 * format "ndjson" (default): a stream of newline-delimited JSON events, as they arrive
 * from AssemblyAI's WebSocket:
 *   {"type":"sent","frame":"Generate","text":"Hello there. "}   (each frame written upstream)
 *   {"type":"begin","sessionId":"…","sampleRate":24000,"configuration":{…}}
 *   {"type":"audio","flushId":0,"audio":"<base64 pcm_s16le>"}
 *   {"type":"flush_done","flushId":0,"audioDurationMs":2640}
 *   {"type":"words","flushId":0,"audioStartMs":0,"words":[{word,start,end,confidence}]}
 *   {"type":"end","audioDurationSeconds":2.64,…}
 *   {"type":"error","error":"…","code":"voice_not_found",…}   (only on failure, then the stream ends)
 *
 * format "wav": the whole result as one audio/wav file.
 *
 * Closing the request (AbortController in the browser) closes the upstream socket.
 */
export async function POST(request: NextRequest) {
  if (!isKeyConfigured()) return json({ error: "ASSEMBLYAI_API_KEY is not set", code: "not_configured" }, 503);

  const parsed = parseSpeakRequest(await request.json().catch(() => null));
  if (!parsed.ok) return json(parsed.error, parsed.status);
  const req = parsed.value;

  const tts = getTTS().with({
    voiceId: req.voiceId,
    language: req.language,
    sampleRate: req.sampleRate,
    wordTimestamps: req.wordTimestamps,
  });
  const conn = { signal: request.signal, timeoutMs: 15_000 };
  const t0 = performance.now();

  if (req.format === "wav") {
    try {
      const { pcm, sampleRate } = await tts.synthesizeToBuffer(req.text, conn);
      return new Response(Buffer.from(pcmToWav(pcm, sampleRate)), {
        headers: {
          "Content-Type": "audio/wav",
          "Content-Disposition": `attachment; filename="tts-${tts.publicOptions.voiceId}.wav"`,
          "Cache-Control": "no-store",
          "X-TTS-Elapsed-Ms": String(Math.round(performance.now() - t0)),
        },
      });
    } catch (e) {
      const { status, body } = toApiError(e);
      return json(body, status);
    }
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      let firstAudio = true;

      // Every frame written to AssemblyAI is echoed as {"type":"sent"}, for clients that log the wire.
      // Frames queued before Begin are held back so the log reads in wire order.
      let begun = false;
      const held: unknown[] = [];
      const streamConn = {
        ...conn,
        onSend: (frame: SentFrame) => {
          const ev = { type: "sent", frame: frame.type, text: frame.text, elapsedMs: Math.round(performance.now() - t0) };
          if (begun) send(ev);
          else held.push(ev);
        },
      };

      // "stream" pushes the text through SynthesizeStream, sentence by sentence, the way an
      // LLM's output would arrive. "chunked" sends it once through ChunkedStream.
      const source: AsyncIterable<TTSEvent> =
        req.mode === "chunked"
          ? tts.synthesize(req.text, streamConn)
          : (() => {
              const s = tts.stream(streamConn);
              s.pushText(req.text);
              s.endInput();
              return s;
            })();

      try {
        for await (const ev of source) {
          const ms = Math.round(performance.now() - t0);
          if (ev.type === "audio") {
            send({
              type: "audio",
              flushId: ev.flushId,
              audio: Buffer.from(ev.audio).toString("base64"),
              elapsedMs: ms,
              ...(firstAudio ? { firstAudioMs: ms } : {}),
            });
            firstAudio = false;
          } else if (ev.type === "begin") {
            send({ ...ev, sampleRate: ev.configuration.sample_rate ?? tts.publicOptions.sampleRate, elapsedMs: ms });
            begun = true;
            held.splice(0).forEach(send);
          } else {
            send({ ...ev, elapsedMs: ms });
          }
        }
      } catch (e) {
        if (!request.signal.aborted) send({ type: "error", ...toApiError(e).body });
      } finally {
        try {
          controller.close();
        } catch {
          /* the client went away */
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
