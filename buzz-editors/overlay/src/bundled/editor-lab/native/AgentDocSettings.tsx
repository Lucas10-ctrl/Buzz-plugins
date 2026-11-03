import { useCallback, useSyncExternalStore } from "react";
import type { PluginModule } from "../../../plugins/api";
import { Header } from "../../../shared/design-system/ui/Header";
import { SettingsGroup } from "../../../shared/design-system/ui/SettingsGroup";
import { SwitchPreferenceRow } from "../../../shared/design-system/ui/SwitchPreferenceRow";
import { readView, subscribeView, writeView } from "../../../shared/view-state";
import { agentDocCreationKey } from "./agent-bridge";
import { useEditorWorkspace } from "./useEditorWorkspace";

type Ctx = Parameters<PluginModule["apply"]>[0];

/** The owner's switch for agents on this device starting docs from any chat. */
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
    () => readView<unknown>(scope, agentDocCreationKey, false) === true,
    [scope],
  );
  const enabled = useSyncExternalStore(subscribe, read, () => false);
  return (
    <>
      <Header
        title="Agent docs"
        subtitle="Let your agents on this device start a doc when you ask in any chat. New docs go into the workspace selected in Docs and stay in this lab on this device."
      />
      <SettingsGroup>
        <SwitchPreferenceRow
          label="Let agents create docs"
          description={`New docs go to: ${workspace.name}`}
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
