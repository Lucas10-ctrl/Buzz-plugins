import { useCallback, useSyncExternalStore } from "react";
import type { PluginModule } from "../../../plugins/api";
import { Header } from "../../../shared/design-system/ui/Header";
import { SettingsGroup } from "../../../shared/design-system/ui/SettingsGroup";
import { SwitchPreferenceRow } from "../../../shared/design-system/ui/SwitchPreferenceRow";
import { readView, subscribeView, writeView } from "../../../shared/view-state";
import { agentDocCreationKey } from "./agent-bridge";
import { useEditorWorkspace } from "./useEditorWorkspace";

type Ctx = Parameters<PluginModule["apply"]>[0];

/** On by default: agents on this device start docs when asked in any chat. */
export function AgentDocSettings({ ctx }: { ctx: Ctx }) {
  const connection = useSyncExternalStore(
    ctx.relay.subscribe,
    ctx.relay.snapshot,
    ctx.relay.snapshot,
  );
  const scope = connection.scope ?? "";
  const workspace = useEditorWorkspace(connection);
  const subscribe = useCallback(
    (listener: () => void) => subscribeView(scope, listener),
    [scope],
  );
  const read = useCallback(
    () => readView<unknown>(scope, agentDocCreationKey, true) !== false,
    [scope],
  );
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  return (
    <>
      <Header
        title="Agent docs"
        subtitle="Your agents on this device can start a doc whenever someone asks in a chat, and post a link to it. Docs stay on this device."
      />
      <SettingsGroup>
        <SwitchPreferenceRow
          label="Let agents create docs"
          description={`New docs go to the chat’s workspace, otherwise: ${workspace.name}`}
          disabled={!scope}
          checked={enabled}
          onCheckedChange={(checked) =>
            writeView(scope, agentDocCreationKey, checked)
          }
        />
      </SettingsGroup>
    </>
  );
}
