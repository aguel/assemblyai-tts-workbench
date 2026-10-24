const NAME = "AssemblyAI";

/**
 * "Powered by AssemblyAI", set as a two-line mark opposite the wordmark. Its letters spring
 * in on load, and again each time a request goes out: while the voice is streaming the
 * first line reads "Streaming from" (see .powered in globals.css).
 */
export function PoweredBy({ live }: { live: boolean }) {
  return (
    <a
      className={`powered ${live ? "is-live" : ""}`}
      href="https://www.assemblyai.com/docs/tts/getting-started/quickstart"
      aria-label="Powered by AssemblyAI streaming text-to-speech"
    >
      <span className="powered-mask" aria-hidden>
        <span className="powered-by" key={live ? "live" : "rest"}>
          {live ? "Streaming from" : "Powered by"}
        </span>
      </span>
      {/* Keyed on the live state, so the letters replay their entrance when a run starts. */}
      <span className="powered-name" aria-hidden key={live ? "live" : "rest"}>
        {[...NAME].map((ch, i) => (
          <span key={i} className="pl" style={{ "--i": i } as React.CSSProperties}>
            {ch}
          </span>
        ))}
      </span>
    </a>
  );
}
