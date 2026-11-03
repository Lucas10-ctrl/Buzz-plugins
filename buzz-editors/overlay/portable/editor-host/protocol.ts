/** Versioned stdio messages shared by Buzz's editor client and its owned repository worker. */
import { z } from "zod";

export const EDITOR_PROTOCOL_VERSION = 1;
/** Allows the original 25 MB Figma import (33.4 MB of base64) and exported document assets. */
export const EDITOR_FRAME_MAX_UNITS = 128_000_000;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const requestSchema = z
  .object({ id, operation: z.string().min(1).max(64), input: z.unknown() })
  .strict();
export const responseSchema = z.union([
  z
    .object({
      type: z.literal("ready"),
      version: z.literal(EDITOR_PROTOCOL_VERSION),
    })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      id,
      ok: z.literal(true),
      value: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      id,
      ok: z.literal(false),
      error: z.string(),
    })
    .strict(),
  z.object({ type: z.literal("fatal"), error: z.string() }).strict(),
]);
export type EditorResponse = z.infer<typeof responseSchema>;

/** Incremental line framing without repeatedly copying the complete document or splitting JSON across writes. */
export class EditorLines {
  private readonly pieces: string[] = [];
  private units = 0;
  constructor(
    private readonly line: (value: string) => void,
    private readonly maximum = EDITOR_FRAME_MAX_UNITS,
  ) {}
  push(chunk: string): void {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf("\n", start);
      const end = newline < 0 ? chunk.length : newline;
      const piece = chunk.slice(start, end);
      this.units += piece.length;
      if (this.units > this.maximum)
        throw new Error("Editor message exceeds the protocol size limit");
      this.pieces.push(piece);
      if (newline < 0) return;
      const value = this.pieces.join("");
      this.pieces.length = 0;
      this.units = 0;
      if (value.trim()) this.line(value);
      start = newline + 1;
    }
  }
  end(): void {
    if (this.units)
      throw new Error("Editor host ended with an incomplete message");
  }
}
