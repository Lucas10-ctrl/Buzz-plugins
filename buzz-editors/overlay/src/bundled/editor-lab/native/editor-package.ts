/**
 * Which editors this bundle carries. Editor Lab carries all three; each
 * standalone plugin build (plugin-package/build.mjs) defines one.
 */
export type EditorPageId = "docs" | "canvas" | "pages";

declare const __BUZZ_EDITOR_PAGES__: readonly EditorPageId[] | undefined;
declare const __BUZZ_PAGE_BUILDER_PLUGIN__: string | undefined;

export const editorPages: readonly EditorPageId[] =
  typeof __BUZZ_EDITOR_PAGES__ === "undefined"
    ? ["docs", "canvas", "pages"]
    : __BUZZ_EDITOR_PAGES__;

/** Plugin that owns Page Builder, for links from other editors. */
export const pageBuilderPluginId: string =
  typeof __BUZZ_PAGE_BUILDER_PLUGIN__ === "undefined"
    ? "local.editor-lab"
    : __BUZZ_PAGE_BUILDER_PLUGIN__;

export const carriesEditor = (page: EditorPageId) => editorPages.includes(page);
