import { z } from "zod";
import type { DocsRoute } from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";
import type {
  NavigationScope,
  OpenTarget,
} from "../../../features/navigation/targets";
import { targetKey } from "../../../features/navigation/targets";

const anchor = z
  .object({
    start: z.string().min(1).max(4000),
    end: z.string().min(1).max(4000),
  })
  .strict();
const route = z
  .object({
    workspaceId: z.string().min(1).max(512),
    docId: z.string().uuid(),
    tabId: z.string().uuid().nullable(),
    threadId: z.string().uuid().nullable(),
    passage: anchor.nullable(),
    token: z.string().max(1000).optional(),
  })
  .strict();
/** Admit only read-only document navigation intent; mutations never travel in a route. */
export function readDocNavigation(value: unknown): DocsRoute | null {
  const parsed = route.safeParse(value);
  return parsed.success ? { ...parsed.data, token: parsed.data.token } : null;
}
/** Keep document, tab, passage and sharing links inside Buzz's page navigation. */
export function docTarget(
  value: DocsRoute,
  scope?: NavigationScope | null,
): Extract<OpenTarget, { kind: "page" }> {
  return {
    version: 1,
    kind: "page",
    pluginId: "local.editor-lab",
    pageId: "docs",
    ...(scope === undefined ? {} : { scope }),
    route: {
      version: 1,
      params: {
        workspaceId: value.workspaceId,
        docId: value.docId,
        tabId: value.tabId,
        threadId: value.threadId,
        passage: value.passage ? { ...value.passage } : null,
        ...(value.token === undefined ? {} : { token: value.token }),
      },
    },
  };
}
/** A host page address; no Harness application fragment is retained. */
export function docLink(
  value: DocsRoute,
  scope?: NavigationScope | null,
): string {
  return `${location.origin}${location.pathname}#buzz=${encodeURIComponent(targetKey(docTarget(value, scope)))}`;
}
