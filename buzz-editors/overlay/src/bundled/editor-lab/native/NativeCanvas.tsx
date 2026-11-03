import { useMemo } from "react";
import type { PluginModule } from "../../../plugins/api";
import { FullPageSurface } from "../../../shared/design-system/ui/FullPageSurface";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../../shared/design-system/ui/PanelHeader";
import {
  Canvas,
  en,
  EditorChromeProvider,
  designerBuildPrompt,
} from "../../../../portable/copyos-apps/dist/copyos-apps.js";
import "../../../../portable/copyos-apps/dist/copyos-apps.css";
import { canvasActions, canvasImageReader } from "./canvas-client";
import { pageActions, type EditorStore } from "./pages-client";
import type { EditorAgentBridge } from "./agent-bridge";
import { useEditorConversation } from "./useEditorConversation";
import styles from "./native-apps.module.css";
import { createEditorText } from "./editor-locale";
import { canvasWebsitePrompt } from "./canvas-website";
import { nativeEditorChrome } from "./editor-chrome";
import { canvasCopyPrompt } from "./canvas-copy";
import type {
  CopyOSAssetListValue,
  CopyOSCopyDocument,
} from "../../../../portable/copyos-domain/src/types";

type Ctx = Parameters<PluginModule["apply"]>[0];
const t = createEditorText(en);

/** Original Canvas tools and layout with Buzz conversations and scoped repositories. */
export function NativeCanvas({
  ctx,
  store,
  bridge,
}: {
  ctx: Ctx;
  store: EditorStore;
  bridge: EditorAgentBridge;
}) {
  const {
    workspaceId,
    workspaceControls,
    content,
    send,
    mentionSelection,
    attachPicture,
    composerAvailable,
  } = useEditorConversation(ctx, bridge, "Canvas");
  const actions = useMemo(() => canvasActions(store), [store]);
  const pages = useMemo(() => pageActions(store), [store]);
  const readImage = useMemo(
    () => canvasImageReader(store, workspaceId),
    [store, workspaceId],
  );
  const listCopy = useMemo(
    () => async () => {
      const result = await store.call<CopyOSAssetListValue>("listCopyAssets", {
        workspaceId,
      });
      return result.assets.filter(
        (asset): asset is CopyOSCopyDocument => asset.kind === "copy",
      );
    },
    [store, workspaceId],
  );
  return (
    <EditorChromeProvider value={nativeEditorChrome}>
      <FullPageSurface
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <PanelHeader title={<PanelHeaderLabel title="Canvas" />} />
        {workspaceControls}
        <div className={`${styles.workspace} ${styles.canvasWorkspace}`}>
          <section className={styles.editor} aria-label="Original Canvas">
            <Canvas
              key={workspaceId}
              workspaceId={workspaceId}
              actions={actions}
              pageActions={pages}
              readProjectImage={readImage}
              t={t}
              layout="session"
              contained
              chat={content}
              onStartAgent={send}
              listCopy={listCopy}
              onBuildFromCopy={(request, design, signal) =>
                send(
                  canvasCopyPrompt(request, design, designerBuildPrompt),
                  undefined,
                  undefined,
                  { designId: design.id },
                  signal,
                )
              }
              websiteBuildPrompt={canvasWebsitePrompt}
              onAttachPicture={composerAvailable ? attachPicture : undefined}
              onMentionSelection={
                composerAvailable ? mentionSelection : undefined
              }
            />
          </section>
        </div>
      </FullPageSurface>
    </EditorChromeProvider>
  );
}
