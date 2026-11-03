import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PluginModule } from "../../../plugins/api";
import { canMessageAgent } from "../../../features/agents/choices";
import { ConversationChannel } from "../../../features/conversation/Conversation";
import { ChannelPreview } from "../../inbox/ChannelPreview";
import { Select } from "../../../shared/design-system/ui/Select";
import { Button } from "../../../shared/design-system/ui/Button";
import type { EditorAgentBridge, EditorDocPermission } from "./agent-bridge";
import type { RelaySession } from "../../../features/relay/session";
import type { ComposerSessionControl } from "../../../features/messages/ComposerModels";
import type { SessionPlace } from "../../../features/agents/service";
import { EditorComposerOwner } from "./editor-composer";
import styles from "./native-apps.module.css";

import { useEditorWorkspace } from "./useEditorWorkspace";
import { EditorWorkspaceControl } from "./EditorWorkspaceControl";

type Ctx = Parameters<PluginModule["apply"]>[0];

/** Native agent membership, conversation, and send lifecycle shared by the three editor destinations. */
export function useEditorConversation(
  ctx: Ctx,
  bridge: EditorAgentBridge,
  title: string,
) {
  const connection = useSyncExternalStore(
    ctx.relay.subscribe,
    ctx.relay.snapshot,
    ctx.relay.snapshot,
  );
  const session = connection.session;
  const choices = useSyncExternalStore(
    session.agentChoices.subscribe,
    session.agentChoices.snapshot,
    session.agentChoices.snapshot,
  );
  const workspace = useEditorWorkspace(connection);
  const { workspaceId } = workspace;
  const currentWorkspace = useRef(workspaceId);
  currentWorkspace.current = workspaceId;
  const [selected, setSelected] = useState<{
    pubkey: string;
    workspaceId: string;
    session: RelaySession;
  }>();
  const agent =
    selected?.session === session && selected.workspaceId === workspaceId
      ? selected.pubkey
      : "";
  const [composerToken] = useState(() => Symbol("editor-composer"));
  const [conversation, setConversation] = useState<{
    id: string;
    workspaceId: string;
    name: string;
    scope: string;
    agentKey: string;
    pubkey: string;
    session: RelaySession;
  }>();
  const [error, setError] = useState("");
  const pending = useRef(new Set<AbortController>());
  const mounted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching Solo workspace must abort all pending conversation openings.
  useEffect(() => {
    mounted.current = true;
    session.agentChoices.ensure();
    const controllers = pending.current;
    return () => {
      mounted.current = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [session, workspaceId]);
  const openAgent = useCallback(
    async (
      pubkey: string,
      text?: string,
      docs?: EditorDocPermission,
      pageWorkflow?: Readonly<{ requestId: string }>,
      canvasCopy?: Readonly<{ designId: string }>,
      signal?: AbortSignal,
    ) => {
      signal?.throwIfAborted();
      if (workspace.unavailable)
        throw new Error(
          "Choose an available Solo workspace before collaborating.",
        );
      for (const controller of pending.current) controller.abort();
      pending.current.clear();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      pending.current.add(controller);
      try {
        const current = ctx.relay.snapshot();
        const choice = current.session.agentChoices
          .snapshot()
          .selectable.find(
            (item) => item.pubkey === pubkey && canMessageAgent(item),
          );
        if (
          current.status !== "ready" ||
          current.session !== session ||
          currentWorkspace.current !== workspaceId ||
          !current.scope ||
          !choice ||
          !current.session.directMessages.available
        )
          throw new Error(
            "Connect Buzz and choose an available Buzz agent to collaborate",
          );
        const local = ctx.agents.find(choice.pubkey);
        if (!local)
          throw new Error(
            "This agent is not available to the local editor tools",
          );
        const channel = await current.session.directMessages.open(
          [choice.pubkey],
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          currentWorkspace.current !== workspaceId ||
          ctx.relay.snapshot().session !== current.session ||
          ctx.relay.snapshot().scope !== current.scope
        )
          throw new Error("The Buzz community changed; send the request again");
        if (
          !current.session.agentChoices
            .snapshot()
            .selectable.some(
              (item) => item.pubkey === pubkey && canMessageAgent(item),
            ) ||
          ctx.agents.find(pubkey)?.key !== local.key
        )
          throw new Error(
            "This Buzz agent is no longer available to the editor",
          );
        if (
          workspace.projectId &&
          !current.session.soloPreferences
            .snapshot()
            .data?.sections.some((item) => item.id === workspace.projectId)
        )
          throw new Error(
            "This Solo workspace is no longer available. Choose an existing workspace before collaborating.",
          );
        const previousWorkspace = bridge.workspaceFor(local.key, channel);
        const phase = ctx.agents.sessionState(local.key, {
          channelId: channel,
        });
        if (
          previousWorkspace &&
          previousWorkspace !== workspaceId &&
          (phase === "active" || phase === "compacting")
        )
          throw new Error(
            "This agent is still working in another editor workspace. Stop or finish that turn before opening it here.",
          );
        bridge.bind({
          workspaceId,
          agent: choice.pubkey,
          agentKey: local.key,
          channel,
          scope: current.scope,
          ...(docs === undefined ? {} : { docs }),
          ...(pageWorkflow === undefined ? {} : { pageWorkflow }),
          ...(canvasCopy === undefined ? {} : { canvasCopy }),
        });
        if (text !== undefined)
          current.session.messages.send(channel, `${title}: ${text}`, [
            choice.pubkey,
          ]);
        setConversation({
          id: channel,
          workspaceId,
          name: choice.name,
          scope: current.scope,
          agentKey: local.key,
          session: current.session,
          pubkey: choice.pubkey,
        });
        setError("");
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        signal?.removeEventListener("abort", cancel);
        pending.current.delete(controller);
      }
    },
    [
      ctx,
      session,
      bridge,
      title,
      workspaceId,
      workspace.unavailable,
      workspace.projectId,
    ],
  );
  const send = useCallback(
    (
      text: string,
      docs?: EditorDocPermission,
      pageWorkflow?: Readonly<{ requestId: string }>,
      canvasCopy?: Readonly<{ designId: string }>,
      signal?: AbortSignal,
    ) => openAgent(agent, text, docs, pageWorkflow, canvasCopy, signal),
    [openAgent, agent],
  );
  const selectAgent = (pubkey: string) => {
    setSelected({ pubkey, session, workspaceId });
    setConversation(undefined);
    void openAgent(pubkey).catch(() => undefined);
  };
  const currentConversation =
    conversation?.session === session &&
    conversation.workspaceId === workspaceId &&
    conversation.scope === connection.scope
      ? conversation
      : undefined;
  const composerCurrent = useCallback(() => {
    const live = ctx.relay.snapshot();
    return (
      mounted.current &&
      !!currentConversation &&
      currentWorkspace.current === currentConversation.workspaceId &&
      live.session === session &&
      live.scope === currentConversation.scope &&
      ctx.agents.find(currentConversation.pubkey)?.key ===
        currentConversation.agentKey
    );
  }, [ctx, currentConversation, session]);
  const composerAvailable = useSyncExternalStore(
    bridge.composer.subscribe,
    () =>
      composerCurrent() &&
      !!currentConversation &&
      bridge.composer.available(
        composerToken,
        session,
        currentConversation.scope,
        currentConversation.id,
      ),
    () => false,
  );
  const mentionSelection = useCallback(
    (text: string) => {
      if (!currentConversation || !composerCurrent()) return false;
      return bridge.composer.insert(
        composerToken,
        session,
        currentConversation.scope,
        currentConversation.id,
        text,
      );
    },
    [bridge, composerToken, currentConversation, session, composerCurrent],
  );
  const attachPicture = useCallback(
    (file: File): string | null => {
      if (!currentConversation || !composerCurrent())
        return "The Canvas conversation is no longer available.";
      const result = bridge.composer.attachFiles(
        composerToken,
        session,
        currentConversation.scope,
        currentConversation.id,
        [file],
      );
      return result === true ? null : result;
    },
    [bridge, composerToken, currentConversation, session, composerCurrent],
  );
  useSyncExternalStore(
    ctx.agents.subscribe,
    ctx.agents.snapshot,
    ctx.agents.snapshot,
  );
  const place = currentConversation
    ? { channelId: currentConversation.id }
    : undefined;
  const phase =
    place && currentConversation
      ? ctx.agents.sessionState(currentConversation.agentKey, place)
      : "idle";
  const working = phase === "active" || phase === "compacting";
  const revokeRequest = useCallback(
    (pubkey: string, place: SessionPlace) => {
      const live = ctx.relay.snapshot();
      if (
        !mounted.current ||
        !currentConversation ||
        live.session !== session ||
        live.scope !== currentConversation.scope ||
        pubkey !== currentConversation.pubkey ||
        ctx.agents.find(pubkey)?.key !== currentConversation.agentKey ||
        place.channelId !== currentConversation.id ||
        place.root !== undefined
      )
        return false;
      bridge.endDocumentRequest(
        currentConversation.agentKey,
        currentConversation.id,
      );
      bridge.endPageWorkflow(
        currentConversation.agentKey,
        currentConversation.id,
      );
      bridge.endCanvasCopyRequest(
        currentConversation.agentKey,
        currentConversation.id,
      );
      return true;
    },
    [ctx, currentConversation, bridge, session],
  );
  const onSessionControl = useCallback<ComposerSessionControl>(
    (pubkey, place, action) => {
      if (action !== "compact") revokeRequest(pubkey, place);
    },
    [revokeRequest],
  );
  const stop = useCallback(async () => {
    if (
      !currentConversation ||
      !revokeRequest(currentConversation.pubkey, {
        channelId: currentConversation.id,
      })
    )
      return;
    await ctx.agents.session(
      currentConversation.agentKey,
      { channelId: currentConversation.id },
      "interrupt",
    );
  }, [ctx, currentConversation, revokeRequest]);
  const workspaceControls = (
    <div className={styles.workspaceControls}>
      <p className="text-caption text-subtle">{workspace.name}</p>
      <EditorWorkspaceControl
        owner={workspace.workspaceId}
        session={session}
        projectId={workspace.projectId}
        choose={workspace.choose}
        disabled={working}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          void ctx.navigation.open({
            version: 1,
            kind: "settings",
            section: "local.editor-lab/brand",
          })
        }
      >
        Brand settings
      </Button>
      {workspace.unavailable && (
        <p role="alert">
          This workspace is unavailable. Choose an existing Solo workspace or No
          workspace.
        </p>
      )}
    </div>
  );
  const content = (
    <>
      <div className={styles.agentChoice}>
        <Select
          label="Buzz agent"
          value={agent}
          disabled={connection.status !== "ready"}
          placeholder="Choose an agent"
          groups={[
            {
              label: "Available agents",
              options: choices.selectable
                .filter(canMessageAgent)
                .map((item) => ({ value: item.pubkey, label: item.name })),
            },
          ]}
          onValueChange={selectAgent}
        />
      </div>
      {error && (
        <div className="p-panel-inset">
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
          {agent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void openAgent(agent).catch(() => undefined);
              }}
            >
              Retry conversation
            </Button>
          )}
        </div>
      )}
      {currentConversation ? (
        <ConversationChannel
          session={session}
          scope={currentConversation.scope}
          channel={{
            id: currentConversation.id,
            name: currentConversation.name,
          }}
          extensions={ctx.conversation}
          host={ctx}
        >
          <EditorComposerOwner bridge={bridge.composer} token={composerToken}>
            <ChannelPreview
              channelName={currentConversation.name}
              label={`${title} conversation`}
              onSessionControl={onSessionControl}
            />
          </EditorComposerOwner>
        </ConversationChannel>
      ) : (
        <p className="p-panel-inset text-body text-subtle">
          {!connection.scope
            ? "Choose your Buzz community at the top right to collaborate. Manual editing is available locally."
            : connection.status === "ready"
              ? "Choose a Buzz agent. Requests from the editor open your conversation here."
              : "Connect to your Buzz community to collaborate. Manual editing is available locally."}
        </p>
      )}
    </>
  );
  return {
    connection,
    workspaceControls,
    agent,
    workspaceId,
    send,
    content,
    stop,
    working,
    mentionSelection,
    attachPicture,
    composerAvailable,
  };
}
