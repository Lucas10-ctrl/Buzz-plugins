import type {
  DocsModel,
  DocsRoute,
} from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";
import { docsActions } from "./docs-client";

/** Publish explicit document/tab choices only after the original model accepts them. */
export function docsNavigationActions(
  model: DocsModel,
  workspaceId: string,
  current: () => boolean,
  open: (route: DocsRoute) => void,
  incoming: DocsRoute | null,
) {
  const actions = docsActions(model);
  let choice = 0;
  const publish = (request: number, expectedDoc?: string) => {
    const state = model.state.getSnapshot();
    if (
      request !== choice ||
      !current() ||
      !state.document ||
      (expectedDoc !== undefined && state.document.id !== expectedDoc)
    )
      return;
    open({
      workspaceId,
      docId: state.document.id,
      tabId: state.activeTab,
      threadId: null,
      passage: null,
      token: state.document.id === incoming?.docId ? incoming.token : undefined,
    });
  };
  const select = async (
    operation: () => Promise<void>,
    expectedDoc?: string,
  ) => {
    const request = ++choice;
    await operation();
    publish(request, expectedDoc);
  };
  return {
    ...actions,
    selectDoc: (id: string) => select(() => actions.selectDoc(id), id),
    createDoc: (title: string) => select(() => actions.createDoc(title)),
    duplicateDoc: (title: string) => select(() => actions.duplicateDoc(title)),
    importDocFile: (file: File) => select(() => actions.importDocFile(file)),
    selectDocTab: (id: string) => {
      // Inbound passage/thread routes also select a tab; applying one is not a new visit.
      if (model.state.getSnapshot().activeTab === id) return;
      actions.selectDocTab(id);
      if (
        incoming &&
        incoming.docId === model.state.getSnapshot().document?.id &&
        incoming.tabId === id
      )
        return;
      if (model.state.getSnapshot().activeTab === id) publish(++choice);
    },
    addDocTab: (title: string) => {
      const previous = model.state.getSnapshot().activeTab;
      actions.addDocTab(title);
      if (model.state.getSnapshot().activeTab !== previous) publish(++choice);
    },
  };
}
