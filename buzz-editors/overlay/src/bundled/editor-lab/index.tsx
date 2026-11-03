import type { PluginModule } from "../../plugins/api";
import { lazy, Suspense } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { DesktopEditorStore } from "./native/desktop-store";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import { developmentStore } from "./native/pages-client";
import { EditorAgentBridge } from "./native/agent-bridge";
import { readDocNavigation } from "./native/docs-route";
import { EditorComposerCapture } from "./native/editor-composer";

const NativeBrandSettings = lazy(() =>
  import("./native/NativeBrandSettings").then((module) => ({
    default: module.NativeBrandSettings,
  })),
);

const AgentDocSettings = lazy(() =>
  import("./native/AgentDocSettings").then((module) => ({
    default: module.AgentDocSettings,
  })),
);

const NativePageBuilder = lazy(() =>
  import("./native/NativePageBuilder").then((module) => ({
    default: module.NativePageBuilder,
  })),
);
const NativeDocs = lazy(() =>
  import("./native/NativeDocs").then((module) => ({
    default: module.NativeDocs,
  })),
);
const NativeCanvas = lazy(() =>
  import("./native/NativeCanvas").then((module) => ({
    default: module.NativeCanvas,
  })),
);

export const inject = [
  "host",
  "pages",
  "agents",
  "relay",
  "conversation",
  "panels",
  "navigation",
  "settingsCards",
];
export const apply: PluginModule["apply"] = (ctx) => {
  const store = isTauri() ? new DesktopEditorStore(ctx.host) : developmentStore;
  if (store instanceof DesktopEditorStore)
    ctx.effect(() => () => void store.dispose());
  const bridge = new EditorAgentBridge(store);
  bridge.install(ctx);
  ctx.settingsCards.register({
    id: "brand",
    title: "Brand settings",
    group: "App",
    component: ({ active }) => (
      <Suspense fallback={<p role="status">Loading brand settings…</p>}>
        <NativeBrandSettings ctx={ctx} store={store} active={active} />
      </Suspense>
    ),
  });
  ctx.settingsCards.register({
    id: "agent-docs",
    title: "Agent docs",
    group: "App",
    component: () => (
      <Suspense fallback={<p role="status">Loading agent docs…</p>}>
        <AgentDocSettings ctx={ctx} />
      </Suspense>
    ),
  });
  ctx.conversation.registerTool({
    id: "editor-context",
    title: "Editor context",
    component: EditorComposerCapture,
  });
  for (const page of [
    { id: "docs", title: "Docs" },
    { id: "canvas", title: "Canvas" },
    { id: "pages", title: "Page Builder" },
  ] as const) {
    const Editor =
      page.id === "pages"
        ? NativePageBuilder
        : page.id === "canvas"
          ? NativeCanvas
          : NativeDocs;
    ctx.pages.register({
      ...page,
      primary: true,
      placement: "topbar",
      layout: "workspace",
      ...(page.id === "docs"
        ? {
            route: {
              version: 1,
              validate: (params: unknown) => readDocNavigation(params) !== null,
            },
          }
        : {}),
      component: ({ navigation }) => (
        <Suspense
          fallback={<FullPageSurface aria-label={`Loading ${page.title}`} />}
        >
          {page.id === "docs" ? (
            <NativeDocs
              ctx={ctx}
              store={store}
              bridge={bridge}
              navigation={navigation}
            />
          ) : (
            <Editor ctx={ctx} store={store} bridge={bridge} />
          )}
        </Suspense>
      ),
    });
  }
};
