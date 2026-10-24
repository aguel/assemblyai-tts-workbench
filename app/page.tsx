import { Studio } from "./components/studio";
import { TTSProvider } from "./components/tts-context";

export default function Home() {
  return (
    <TTSProvider>
      <Studio />
    </TTSProvider>
  );
}
