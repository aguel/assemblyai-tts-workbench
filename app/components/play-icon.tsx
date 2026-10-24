/** Play and stop, drawn as one shape that morphs between the two (see .play-icon in globals.css). */
export function PlayIcon({ live }: { live: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden className={`play-icon ${live ? "is-live" : ""}`}>
      <path className="pi-play" d="M6 3.5 L16.5 10 L6 16.5 Z" />
      <rect className="pi-stop" x="5" y="5" width="10" height="10" />
    </svg>
  );
}
