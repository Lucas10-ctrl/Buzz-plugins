import { expect, it } from "vitest";
import {
  EditorLines,
  requestSchema,
  responseSchema,
} from "../../../../portable/editor-host/protocol";
it("parses native ready messages and split JSON responses", () => {
  const messages: unknown[] = [];
  const lines = new EditorLines((line) =>
    messages.push(responseSchema.parse(JSON.parse(line))),
  );
  lines.push('{"type":"ready","version":1}\n{"type":"res');
  lines.push('ult","id":2,"ok":true,"value":"α');
  lines.push('β"}\n{"type":"result","id":1,"ok":false,"error":"Conflict"}\n');
  lines.end();
  expect(messages).toEqual([
    { type: "ready", version: 1 },
    { type: "result", id: 2, ok: true, value: "αβ" },
    { type: "result", id: 1, ok: false, error: "Conflict" },
  ]);
});

it("bounds individual frames across chunks and resets the limit at each newline", () => {
  const messages: string[] = [];
  const lines = new EditorLines((line) => messages.push(line), 4);
  lines.push("ab");
  lines.push("cd\nefg\n");
  expect(messages).toEqual(["abcd", "efg"]);
  lines.push("123");
  expect(() => lines.push("45\n")).toThrow("size limit");
});

it("rejects a truncated final response instead of accepting an unfinished write", () => {
  const lines = new EditorLines(() => undefined);
  lines.push('{"type":"result"');
  expect(() => lines.end()).toThrow("incomplete message");
});

it("rejects invalid versions, missing results and inconsistent response fields", () => {
  for (const message of [
    { type: "ready", version: 2 },
    { type: "result", id: 1, ok: true },
    { type: "result", id: 0, ok: true, value: null },
    { type: "result", id: 1, ok: false, value: "unexpected" },
    { type: "result", id: 1, ok: true, value: null, error: "inconsistent" },
  ])
    expect(responseSchema.safeParse(message).success).toBe(false);
  expect(
    requestSchema.safeParse({ id: 1, operation: "readPage" }).success,
  ).toBe(false);
  expect(
    requestSchema.safeParse({ id: 1, operation: "readPage", input: {} })
      .success,
  ).toBe(true);
});
