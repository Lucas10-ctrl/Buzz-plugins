import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginModule } from "../../../plugins/api";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../../shared/design-system/ui/PanelHeader";
import { FullPageSurface } from "../../../shared/design-system/ui/FullPageSurface";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import { ArrowLeftIcon } from "../../../shared/design-system/icons";
import {
  PageBuilder,
  BuilderStart,
  buildPageActionPrompt,
  en,
  EditorChromeProvider,
} from "../../../../portable/copyos-apps/dist/copyos-apps.js";
import type { SectionPromptIntent } from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";
import "../../../../portable/copyos-apps/dist/copyos-apps.css";
import { pageActions, type EditorStore } from "./pages-client";
import type { EditorAgentBridge, EditorCreatedPage } from "./agent-bridge";
import { Button } from "../../../shared/design-system/ui/Button";
import { useEditorConversation } from "./useEditorConversation";
import styles from "./native-apps.module.css";
import { createEditorText } from "./editor-locale";
import { pageWorkflowPrompt } from "./page-workflows";
import { nativeEditorChrome } from "./editor-chrome";
import { pickPageFolder } from "./page-folder";
import { BuilderSplit } from "./BuilderSplit";

type Ctx = Parameters<PluginModule["apply"]>[0];
const t = createEditorText(en);
const builderText: typeof t = (key, values) => {
  switch (key) {
    case "returnToCanvas":
      return "Import page";
    case "canvasReturnPending":
      return "Finish saving or resolve pending edits before starting another page.";
    case "eyebrow":
      return "Buzz";
    case "newSessionQuestion":
      return "Start a page";
    case "newSessionDescription":
      return "Choose a starting point for this Buzz workspace.";
    case "websiteImportStart":
      return "Clone with Buzz agent";
    case "existingPageStart":
      return "Import with Buzz agent";
    case "existingPageProjectFolderDescription":
      return "Choose an existing subfolder inside this Buzz editor workspace.";
    case "existingPageConfigureDescription":
      return "Choose the exact source folder before your Buzz agent inspects or changes the page.";
    case "existingPageFolderOutsideProject":
      return "Choose a subfolder inside this Buzz editor workspace.";
    case "sessionCreateFailed":
      return "Could not start workflow.";
    case "strategyReviewHint":
      return "Your Buzz agent will review the strategy and fill gaps with you before building. Linked Notion pages require access through that agent's connected tools; you can also paste the page text.";
    case "pageBuilderBlankDescription":
      return "Create an empty page beside your Buzz conversation. Add your first section from the canvas, or ask your agent to create it.";
    default:
      return t(key, values);
  }
};

/** Original Builder body with Buzz's own agent choices, composer, and conversation. */
export function NativePageBuilder({
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
    send,
    content,
    agent,
    connection,
    workspaceControls,
    mentionSelection,
  } = useEditorConversation(ctx, bridge, "Page Builder");
  const [started, setStarted] = useState<boolean | null>(null);
  const [canReturnToPages, setCanReturnToPages] = useState(false);
  const [workflowPending, setWorkflowPending] = useState(false);
  const [resumePageId, setResumePageId] = useState<string>();
  const [startMode, setStartMode] = useState<"new" | "clone">("new");
  const [loadError, setLoadError] = useState("");
  const pageWorkflowOwner = useMemo(
    () => ({
      workspaceId,
      agent,
      session: connection.session,
      live: true,
      dispose: undefined as (() => void) | undefined,
    }),
    [workspaceId, agent, connection.session],
  );
  const [pageResult, setPageResult] = useState<{
    owner: typeof pageWorkflowOwner;
    page: EditorCreatedPage;
  }>();
  const [navigationRequest, setNavigationRequest] = useState<{
    owner: typeof pageWorkflowOwner;
    request: { requestId: string; pageId: string };
  }>();
  const createdPage =
    pageResult?.owner === pageWorkflowOwner ? pageResult.page : undefined;
  const openPageRequest =
    navigationRequest?.owner === pageWorkflowOwner
      ? navigationRequest.request
      : undefined;
  const [navigationReady, setNavigationReady] = useState(false);
  useEffect(() => {
    pageWorkflowOwner.live = true;
    setPageResult(undefined);
    setNavigationRequest(undefined);
    return () => {
      pageWorkflowOwner.live = false;
      pageWorkflowOwner.dispose?.();
    };
  }, [pageWorkflowOwner]);
  const editorRegion = useRef<HTMLElement>(null);
  const focusAfterSwap = useRef(false);
  useEffect(() => {
    if (started !== null && focusAfterSwap.current) {
      focusAfterSwap.current = false;
      editorRegion.current?.focus();
    }
  }, [started]);
  const workflowOwner = useMemo(
    () => ({ workspaceId, live: true }),
    [workspaceId],
  );
  useEffect(() => {
    workflowOwner.live = true;
    return () => {
      workflowOwner.live = false;
    };
  }, [workflowOwner]);
  const actions = useMemo(() => pageActions(store), [store]);
  useEffect(() => {
    let live = true;
    setStarted(null);
    focusAfterSwap.current = false;
    setCanReturnToPages(false);
    setWorkflowPending(false);
    setResumePageId(undefined);
    setStartMode("new");
    setLoadError("");
    actions.listPages(workspaceId).then(
      (pages) => {
        if (live) {
          setStarted(pages.length > 0);
          setCanReturnToPages(pages.length > 0);
        }
      },
      (error) => {
        if (live)
          setLoadError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      live = false;
    };
  }, [actions, workspaceId]);
  const requestSection = (
    intent: SectionPromptIntent,
    page: string,
    section: string,
    note?: string,
  ) => send(buildPageActionPrompt(t, intent, page, section, note));
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
        <PanelHeader
          title={<PanelHeaderLabel title="Page Builder" />}
          navigation={
            started === false && canReturnToPages ? (
              <IconButton
                icon={<ArrowLeftIcon size={16} />}
                aria-label="Return to saved pages"
                title="Return to saved pages"
                disabled={workflowPending}
                onClick={() => {
                  focusAfterSwap.current = true;
                  setStarted(true);
                }}
              />
            ) : undefined
          }
        />
        {workspaceControls}
        <BuilderSplit
          conversation={
            <aside className={styles.conversation}>
              {createdPage ? (
                <div className={styles.pageHandoff}>
                  <p role="status" className="text-body text-standard">
                    Agent created {createdPage.title}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!navigationReady || started !== true}
                    onClick={() => {
                      setNavigationRequest({
                        owner: pageWorkflowOwner,
                        request: {
                          requestId: crypto.randomUUID(),
                          pageId: createdPage.pageId,
                        },
                      });
                      editorRegion.current?.focus();
                    }}
                  >
                    Open created page
                  </Button>
                  {!navigationReady && started === true ? (
                    <p className="text-body text-subtle">
                      Finish saving or resolve pending edits to open this page.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {content}
            </aside>
          }
        >
          <section
            ref={editorRegion}
            tabIndex={-1}
            className={styles.editor}
            aria-label="Original Page Builder"
          >
            {loadError ? (
              <p role="alert" className="p-panel-inset text-body text-danger">
                {loadError}
              </p>
            ) : started === null ? (
              <p role="status" className="p-panel-inset text-body text-subtle">
                Loading pages…
              </p>
            ) : started ? (
              <PageBuilder
                key={workspaceId}
                workspaceId={workspaceId}
                {...(resumePageId === undefined
                  ? {}
                  : { initialPageId: resumePageId })}
                t={builderText}
                actions={actions}
                {...(openPageRequest === undefined ? {} : { openPageRequest })}
                onNavigationReady={setNavigationReady}
                layout="session"
                onStagePromptSection={(intent, page, section, note) => {
                  if (
                    !mentionSelection(
                      buildPageActionPrompt(t, intent, page, section, note),
                    )
                  )
                    throw new Error(
                      "Open a Buzz agent conversation before adding this mark to its draft.",
                    );
                }}
                onPromptSection={requestSection}
                onReturn={(pageId) => {
                  focusAfterSwap.current = true;
                  setNavigationRequest(undefined);
                  setResumePageId(pageId ?? undefined);
                  setStartMode("clone");
                  setStarted(false);
                }}
              />
            ) : (
              <div className={styles.workflowStart}>
                <BuilderStart
                  matched={{ sessionId: workspaceId }}
                  initialWorkflow="landing-page-builder"
                  initialPageBuilderMode={startMode}
                  t={builderText}
                  startWorkflow={async (_conversation, workflow, prompt) => {
                    setWorkflowPending(true);
                    try {
                      if (workflow === "website-clone") {
                        const media = await store.call<{
                          available: boolean;
                          instruction: string;
                        }>("checkMediaSupport", null);
                        if (!workflowOwner.live || !pageWorkflowOwner.live) {
                          if (workflowOwner.live) setWorkflowPending(false);
                          return;
                        }
                        if (!media.available)
                          throw new Error(
                            `Buzz needs Linux media support before cloning this website. ${media.instruction}`,
                          );
                      }
                    } catch (error) {
                      if (workflowOwner.live) setWorkflowPending(false);
                      throw error;
                    }
                    pageWorkflowOwner.dispose?.();
                    pageWorkflowOwner.dispose = undefined;
                    setPageResult(undefined);
                    setNavigationRequest(undefined);
                    try {
                      if (workflow === "landing-page-builder" && !prompt) {
                        const pages = await actions.listPages(
                          workflowOwner.workspaceId,
                        );
                        if (!workflowOwner.live) return;
                        const title = pages.length
                          ? `Untitled page ${pages.length + 1}`
                          : "Untitled page";
                        await actions.createPage({
                          workspaceId: workflowOwner.workspaceId,
                          title,
                        });
                      } else if (prompt) {
                        const requestId = crypto.randomUUID();
                        pageWorkflowOwner.dispose = bridge.onPageCreated(
                          requestId,
                          (page) => {
                            if (pageWorkflowOwner.live)
                              setPageResult((previous) =>
                                previous?.owner === pageWorkflowOwner
                                  ? previous
                                  : { owner: pageWorkflowOwner, page },
                              );
                          },
                        );
                        try {
                          await send(
                            `Workflow reference: ${requestId}. Pass workflowRequestId: "${requestId}" to buzz_pages createPage for the main result page.\n\n${pageWorkflowPrompt(workflow, prompt)}`,
                            undefined,
                            { requestId },
                          );
                        } catch (error) {
                          pageWorkflowOwner.dispose?.();
                          throw error;
                        }
                      } else
                        throw new Error(
                          "Open this workflow from its own Buzz destination",
                        );
                      if (workflowOwner.live) {
                        focusAfterSwap.current = true;
                        if (workflow === "landing-page-builder" && !prompt)
                          setResumePageId(undefined);
                        setStarted(true);
                        setCanReturnToPages(true);
                      }
                    } finally {
                      if (workflowOwner.live) setWorkflowPending(false);
                    }
                  }}
                  pickExistingPageFolder={() =>
                    pickPageFolder(store, workspaceId)
                  }
                />
              </div>
            )}
          </section>
        </BuilderSplit>
      </FullPageSurface>
    </EditorChromeProvider>
  );
}
