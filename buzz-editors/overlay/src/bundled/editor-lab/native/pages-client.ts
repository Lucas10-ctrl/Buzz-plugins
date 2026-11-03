import type { PageWorkspaceActions } from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";

export interface EditorStore {
  call<T>(operation: string, input: unknown): Promise<T>;
}

/** Browser development uses Buzz's server; desktop replaces only this transport with its owned worker. */
export const developmentStore: EditorStore = {
  async call<T>(operation: string, input: unknown): Promise<T> {
    const response = await fetch("/api/editor-port", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-buzz-editor-port": "1",
      },
      body: JSON.stringify({ operation, input }),
    });
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("ok" in result))
      throw new Error("Invalid editor response");
    if (result.ok !== true)
      throw new Error(
        "error" in result && typeof result.error === "string"
          ? result.error
          : "Editor request failed",
      );
    if (!("value" in result)) throw new Error("Editor response has no value");
    // The domain repositories validate documents before the trusted host returns them.
    return result.value as T;
  },
};

/** All original Builder actions use the same host operations exposed to Buzz agents. */
export function pageActions(store: EditorStore): PageWorkspaceActions {
  return {
    readPageAsset: (workspaceId, path, knownVersion) =>
      store.call("readPageAsset", {
        workspaceId,
        path,
        ...(knownVersion === undefined ? {} : { knownVersion }),
      }),
    clonePage: (input) => store.call("clonePage", input),
    deletePage: (input) => store.call("deletePage", input),
    restorePage: (input) => store.call("restorePage", input),
    listPages: (input) => store.call("listPages", input),
    createPage: (input) => store.call("createPage", input),
    addPageSection: (input) => store.call("addPageSection", input),
    addPageSectionVariant: (input) =>
      store.call("addPageSectionVariant", input),
    selectPageSectionVariant: (input) =>
      store.call("selectPageSectionVariant", input),
    updatePageSectionVariant: (input) =>
      store.call("updatePageSectionVariant", input),
    updatePageSectionVariants: (input) =>
      store.call("updatePageSectionVariants", input),
    renamePageSection: (input) => store.call("renamePageSection", input),
    deletePageSection: (input) => store.call("deletePageSection", input),
    movePageSection: (input) => store.call("movePageSection", input),
    addPageComment: (input) => store.call("addPageComment", input),
    setPageCommentStatus: (input) => store.call("setPageCommentStatus", input),
    listReusableSections: (input) => store.call("listReusableSections", input),
    saveReusableSection: (input) => store.call("saveReusableSection", input),
    moveReusableSection: (input) => store.call("moveReusableSection", input),
    deleteReusableSection: async (input) => {
      await store.call("deleteReusableSection", input);
    },
    exportPage: (input) => store.call("exportPage", input),
  };
}
