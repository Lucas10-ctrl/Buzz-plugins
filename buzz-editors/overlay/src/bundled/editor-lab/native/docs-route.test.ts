import { expect, it } from "vitest";
import { parseOpenTarget } from "../../../features/navigation/targets";
import { docTarget, readDocNavigation } from "./docs-route";

it("round-trips document, tab, passage and capability intent through Buzz page routes", () => {
  const intent = {
    workspaceId: "community",
    docId: "11111111-1111-4111-8111-111111111111",
    tabId: null,
    threadId: null,
    passage: { start: "YWJj", end: "ZGVm" },
    token: "capability",
  };
  const target = parseOpenTarget(docTarget(intent, null));
  expect(target.kind).toBe("page");
  if (target.kind !== "page") throw new Error("Expected page target");
  expect(readDocNavigation(target.route?.params)).toEqual(intent);
  expect(target.scope).toBeNull();
});

it("rejects mutation fields and malformed document targets", () => {
  const value = {
    workspaceId: "community",
    docId: "11111111-1111-4111-8111-111111111111",
    tabId: null,
    threadId: null,
    passage: null,
  };
  expect(readDocNavigation({ ...value, delete: true })).toBeNull();
  expect(readDocNavigation({ ...value, docId: "../../private" })).toBeNull();
  expect(readDocNavigation({ ...value, token: "x".repeat(1001) })).toBeNull();
});
