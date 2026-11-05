import { useEffect, useState } from "react";
import type { RelaySession } from "../../../features/relay/session";
import { WorkspaceControl } from "../../../features/solo/WorkspaceControl";
import { AlertDialog } from "../../../shared/design-system/ui/AlertDialog";
import { Button } from "../../../shared/design-system/ui/Button";

/** Switching projects is explicit because original editors can hold unsaved drafts. */
export function EditorWorkspaceControl({
  session,
  owner,
  projectId,
  choose,
  disabled = false,
  fullWidth = false,
}: {
  session: RelaySession;
  owner: string;
  projectId: string;
  choose(id: string): boolean;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const [pending, setPending] = useState<{
    id: string;
    owner: string;
    session: RelaySession;
  }>();
  useEffect(() => {
    setPending((current) =>
      current &&
      (current.owner !== owner || current.session !== session || disabled)
        ? undefined
        : current,
    );
  }, [owner, session, disabled]);
  const [error, setError] = useState("");
  return (
    <>
      <WorkspaceControl
        session={session}
        value={projectId}
        disabled={disabled}
        fullWidth={fullWidth}
        onChange={(id) => {
          if (id !== projectId && !disabled) setPending({ id, owner, session });
        }}
      />
      {error && <p role="alert">{error}</p>}
      {pending !== undefined &&
        pending.owner === owner &&
        pending.session === session &&
        !disabled && (
          <AlertDialog
            title="Switch editor workspace?"
            description="Save your work first. Switching closes the current editor and agent conversation; unsaved edits may be lost."
            onClose={() => setPending(undefined)}
            actions={
              <>
                <Button onClick={() => setPending(undefined)}>Stay here</Button>
                <Button
                  variant="prominent"
                  onClick={() => {
                    if (
                      !disabled &&
                      pending.owner === owner &&
                      pending.session === session &&
                      choose(pending.id)
                    ) {
                      setPending(undefined);
                      setError("");
                    } else
                      setError(
                        "The workspace choice could not be saved. Your current workspace is unchanged.",
                      );
                  }}
                >
                  Switch workspace
                </Button>
              </>
            }
          />
        )}
    </>
  );
}
