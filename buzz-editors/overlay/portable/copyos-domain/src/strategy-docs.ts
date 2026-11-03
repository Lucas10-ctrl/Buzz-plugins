/** Create a Suite document laid out for strategy work. */
import * as Y from 'yjs'
import type { CopyOSDocRepository } from './docs.ts'
import { restoreDocTabs } from './docs-tabs.ts'
import { STRATEGY_STAGE_SECTIONS } from './docs-strategy.ts'
import type { CopyOSDocDocument, CopyOSStrategyDocCreateRequest } from './types.ts'

/** Title of the first tab. */
export const STRATEGY_DOC_MAIN_TAB = 'Strategy'
/** Title of the tab that holds the page sections once the strategist confirms the section order. */
export const STRATEGY_DOC_PAGE_TAB = 'Page'
/**
 * Create a strategy document: one Strategy tab holding the first stage's section, in two commits (the outline, then the tab
 * title). Later stages add their sections as they start.
 * @param docs - Document repository.
 * @param root - Project root.
 * @param request - Title and the Session that should show the document.
 * @returns The saved document.
 */
export async function createStrategyDocument(docs: CopyOSDocRepository, root: string,
  request: Omit<CopyOSStrategyDocCreateRequest, 'workspaceId'>): Promise<CopyOSDocDocument> {
  const created = await docs.create(root, { ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
    title: request.title, sections: [...STRATEGY_STAGE_SECTIONS.why] })
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(created.sync, 'base64'))
    const vector = Y.encodeStateVector(doc)
    restoreDocTabs(doc, [{ id: created.id, title: STRATEGY_DOC_MAIN_TAB }])
    return await docs.sync(root, { docId: created.id, contentVersion: 2,
      update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64') })
  } finally { doc.destroy() }
}
