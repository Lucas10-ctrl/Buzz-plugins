import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PluginModule } from "../../../plugins/api";
import type { PageNavigation } from "../../../features/navigation/service";
import { Button } from "../../../shared/design-system/ui/Button";
import { FullPageSurface } from "../../../shared/design-system/ui/FullPageSurface";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../../shared/design-system/ui/PanelHeader";
import {
  Docs,
  DocsModel,
  en,
  EditorChromeProvider,
} from "../../../../portable/copyos-apps/dist/copyos-apps.js";
import type {
  DocsAppProps,
  DocsSnapshot,
  DocsRoute,
} from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";
import "../../../../portable/copyos-apps/dist/copyos-apps.css";
import { docsTransport } from "./docs-client";
import { docsNavigationActions } from "./docs-navigation";
import type { EditorStore } from "./pages-client";
import type { EditorAgentBridge } from "./agent-bridge";
import { useEditorConversation } from "./useEditorConversation";
import { docLink, docTarget, readDocNavigation } from "./docs-route";
import { targetKey } from "../../../features/navigation/targets";
import styles from "./native-apps.module.css";
import { createEditorText } from "./editor-locale";
import { nativeEditorChrome } from "./editor-chrome";

type Ctx = Parameters<PluginModule["apply"]>[0];
const t: DocsAppProps["t"] = createEditorText(en);

/** Original Docs library/editor/model, hosted by Buzz instead of the previous application's Session slots. */
export function NativeDocs({
  ctx,
  store,
  bridge,
  navigation,
}: {
  ctx: Ctx;
  store: EditorStore;
  bridge: EditorAgentBridge;
  navigation?: PageNavigation | undefined;
}) {
  const conversation = useEditorConversation(ctx, bridge, "Docs");
  const { workspaceId } = conversation;
  const [owned, setOwned] = useState<{
    store: EditorStore;
    workspaceId: string;
    model: DocsModel;
  }>();
  useEffect(() => {
    const model = new DocsModel(docsTransport(store));
    setOwned({ store, workspaceId, model });
    return () => {
      void model.dispose();
    };
  }, [store, workspaceId]);
  return (
    <FullPageSurface
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <PanelHeader title={<PanelHeaderLabel title="Docs" />} />
      {conversation.workspaceControls}
      {owned?.store === store && owned.workspaceId === workspaceId ? (
        <EditorChromeProvider value={nativeEditorChrome}>
          <DocsView
            ctx={ctx}
            model={owned.model}
            conversation={conversation}
            navigation={navigation}
          />
        </EditorChromeProvider>
      ) : (
        <p role="status" className="p-panel-inset text-body text-subtle">
          Loading documents…
        </p>
      )}
    </FullPageSurface>
  );
}

function DocsView({
  ctx,
  model,
  conversation,
  navigation,
}: {
  ctx: Ctx;
  model: DocsModel;
  conversation: ReturnType<typeof useEditorConversation>;
  navigation?: PageNavigation | undefined;
}) {
  const { workspaceId, content, send, stop, working } = conversation;
  const target = navigation?.target;
  const route = useMemo(
    () =>
      target?.kind === "page" && target.route?.version === 1
        ? readDocNavigation(target.route.params)
        : null,
    [target],
  );
  const connection = ctx.relay.snapshot();
  const { session, scope } = connection;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const actions = useMemo(
    () =>
      docsNavigationActions(
        model,
        workspaceId,
        () => {
          const live = ctx.relay.snapshot();
          const entry = ctx.navigation.snapshot().entry;
          return (
            mounted.current &&
            !!navigation &&
            !navigation.signal.aborted &&
            live.session === session &&
            live.scope === scope &&
            entry.id === navigation.entryId &&
            targetKey(entry.target) === targetKey(navigation.target)
          );
        },
        (intent) => {
          const next = docTarget(
            intent,
            target?.kind === "page" ? target.scope : undefined,
          );
          if (target && targetKey(next) === targetKey(target)) return;
          void ctx.navigation.open(next, { focus: "preserve" });
        },
        route,
      ),
    [ctx, model, workspaceId, navigation, target, route, session, scope],
  );
  const snapshot = useSyncExternalStore(
    model.state.subscribe,
    model.state.getSnapshot,
    model.state.getSnapshot,
  );
  const useDocs = useCallback(
    <T,>(selector: (state: DocsSnapshot) => T): T => selector(snapshot),
    [snapshot],
  );
  const useDocsRoute = useCallback(
    <T,>(selector: (route: DocsRoute | null) => T): T => selector(route),
    [route],
  );
  if (route && route.workspaceId !== workspaceId)
    return (
      <div className="p-panel-inset">
        <p role="alert" className="text-body text-danger">
          This document belongs to a different Buzz workspace. Select its Solo
          workspace or community to open it.
        </p>
        <Button
          onClick={() =>
            void ctx.navigation.open({
              version: 1,
              kind: "page",
              pluginId: "local.editor-lab",
              pageId: "docs",
              ...(target?.kind === "page" && target.scope !== undefined
                ? { scope: target.scope }
                : {}),
            })
          }
        >
          Open selected workspace’s documents
        </Button>
      </div>
    );
  return (
    <div className={`${styles.workspace} ${styles.docsWorkspace}`}>
      <Docs
        key={workspaceId}
        {...actions}
        workspaceId={workspaceId}
        useDocs={useDocs}
        useDocsRoute={useDocsRoute}
        documentLink={(intent) =>
          docLink(intent, target?.kind === "page" ? target.scope : undefined)
        }
        t={t}
        assistantWorking={working}
        conversation={(visible) => (visible ? content : null)}
        stopAssistant={stop}
        draftDoc={async (_workspace, prompt, docId, threadId, presentation) => {
          await model.flush();
          const document = model.state.getSnapshot().document;
          if (!document || document.id !== docId)
            throw new Error(
              "Open the requested document before asking an agent",
            );
          const cancelTiming =
            presentation?.scope === "draft" ? model.beginOutline() : undefined;
          try {
            await send(presentation?.request ?? prompt, {
              docId: document.id,
              context: prompt,
              epoch: document.epoch,
              ...(threadId ? { threadId } : {}),
              ...(presentation ?? {
                title: document.title,
                request: prompt,
                scope: "document",
              }),
            });
          } catch (error) {
            cancelTiming?.();
            throw error;
          }
        }}
      />
    </div>
  );
}
