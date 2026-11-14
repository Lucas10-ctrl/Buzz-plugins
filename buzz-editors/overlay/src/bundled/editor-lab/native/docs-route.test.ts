import { expect, it } from "vitest";
import { parseOpenTarget } from "../../../features/navigation/targets";
import { docChatLink, docTarget, readDocNavigation } from "./docs-route";
import { buzzLinkTarget } from "../../../features/navigation/buzz-links";
import { composerLinkUrl } from "../../../features/messages/composer-link";

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

it("posts a buzz:// doc link that chat accepts and that opens the doc", () => {
  const workspaceId = JSON.stringify(["solo", "community", "project-1"]);
  const docId = "11111111-1111-4111-8111-111111111111";
  const link = docChatLink(workspaceId, docId);
  expect(composerLinkUrl(link)).toBe(link);
  const target = buzzLinkTarget(link, {
    viewer: "a".repeat(64),
    communityOrigin: "wss://relay.example.com",
  });
  expect(target).toMatchObject({
    kind: "plugin",
    pluginId: "local.editor-lab",
    pageId: "docs",
  });
  if (target?.kind !== "plugin") throw new Error("Expected plugin target");
  expect(readDocNavigation(target.params)).toEqual({
    workspaceId,
    docId,
    tabId: null,
    threadId: null,
    passage: null,
    token: undefined,
  });
  expect(readDocNavigation({ workspaceId, docId: "../x" })).toBeNull();
});
