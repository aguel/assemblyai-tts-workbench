import { MAX_GENERATE_CHARS } from "./models";

/**
 * A small streaming sentence tokenizer, standing in for the blingfire tokenizer the
 * LiveKit plugin uses. Text is pushed in pieces (as an LLM would stream it); complete
 * sentences come out as soon as the next sentence has started, the rest on flush().
 */
export class SentenceTokenizer {
  private buffer = "";

  /** Append text; returns every sentence that is now complete. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    // A sentence ends at . ! ? … (optionally followed by quotes/brackets) and whitespace.
    const re = /[.!?…]+["'”’)\]]*\s+/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(this.buffer))) {
      const end = match.index + match[0].length;
      const sentence = this.buffer.slice(last, end).trim();
      // Avoid splitting very short fragments such as "Dr." or "3." on their own.
      if (sentence.length >= 12) {
        out.push(sentence);
        last = end;
      }
    }
    this.buffer = this.buffer.slice(last);
    return out.flatMap((s) => splitLong(s));
  }

  /** Return whatever is buffered as a final sentence. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? splitLong(rest) : [];
  }
}

/** Split a piece of text into chunks that fit one `Generate` frame, at word boundaries. */
export function splitLong(text: string, max = MAX_GENERATE_CHARS): string[] {
  if (!(max >= 1)) max = MAX_GENERATE_CHARS;
  if (text.length <= max) return [text];
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (word.length > max) {
      if (current) out.push(current);
      for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
      current = "";
      continue;
    }
    if (current && current.length + 1 + word.length > max) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}
