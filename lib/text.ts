export interface Token {
  w: string;
  accent: boolean;
}

/** Splits copy into words; words wrapped in *asterisks* are flagged as accent (italic gold). */
export function parseAccent(text: string): Token[] {
  return text
    .split(/(\*[^*]+\*)/g)
    .filter(Boolean)
    .flatMap((chunk) => {
      const accent = chunk.startsWith("*") && chunk.endsWith("*");
      const clean = accent ? chunk.slice(1, -1) : chunk;
      return clean
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => ({ w, accent }));
    });
}
