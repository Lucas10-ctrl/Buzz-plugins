import { useEffect, useState } from "react";
import type { RelaySession } from "../../../features/relay/session";
import styles from "../../../features/solo/WorkspaceControl.module.css";
import {
  CaretDownIcon,
  Cube3dSphereIcon,
} from "../../../shared/design-system/icons";
import { Button } from "../../../shared/design-system/ui/Button";
import {
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuTrigger,
} from "../../../shared/design-system/ui/Menu";
import { workspacePreferences } from "./workspace";

/**
 * Workspace dropdown for the editors. Buzz's own WorkspaceControl reads
 * `session.soloPreferences`, which Buzz 1.0.6 removed, so the editors read
 * workspaces through `workspacePreferences` instead.
 */
export function WorkspacePicker({
  session,
  value,
  onChange,
  disabled = false,
  fullWidth = false,
}: {
  session: RelaySession;
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
  /** A labelled dropdown that fills its row and always names the choice, including No workspace. */
  fullWidth?: boolean;
}) {
  const store = workspacePreferences(session);
  const [snapshot, setSnapshot] = useState(() => store.snapshot());
  useEffect(() => {
    setSnapshot(store.snapshot());
    if (typeof store.ensure === "function")
      void Promise.resolve(store.ensure()).catch(() => {});
    return store.subscribe(() => setSnapshot(store.snapshot()));
  }, [store]);
  const status = snapshot.status;
  const sections = snapshot.data?.sections ?? [];
  const project = sections.find((item) => item.id === value);
  const name = project ? `Workspace: ${project.name}` : "Add workspace";
  return (
    <span
      className={
        fullWidth ? `${styles.control} ${styles.fullWidth}` : styles.control
      }
    >
      <MenuRoot>
        <MenuTrigger
          disabled={disabled || status === "loading"}
          render={(props) => (
            <Button
              {...props}
              variant="ghost"
              size="sm"
              shape={project || fullWidth ? "capsule" : "icon"}
              style={
                fullWidth
                  ? { width: "100%", justifyContent: "flex-start" }
                  : { maxWidth: "100%" }
              }
              aria-label={name}
              title={name}
            >
              <Cube3dSphereIcon size={16} aria-hidden="true" />
              {(project || fullWidth) && (
                <>
                  <span className={styles.name}>
                    {project?.name ?? "No workspace"}
                  </span>
                  <CaretDownIcon
                    size={12}
                    className="buzz-dropdown-chevron"
                    aria-hidden="true"
                  />
                </>
              )}
            </Button>
          )}
        />
        <MenuPopup
          side={fullWidth ? "bottom" : "top"}
          align={fullWidth ? "start" : "end"}
          aria-label="Choose workspace"
        >
          <MenuRadioGroup value={value} onValueChange={onChange}>
            <MenuRadioItem value="" closeOnClick>
              No workspace
            </MenuRadioItem>
            {sections.map((item) => (
              <MenuRadioItem key={item.id} value={item.id} closeOnClick>
                {item.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {status === "error" && store.refresh && (
            <MenuItem onClick={() => void store.refresh?.()}>
              Retry workspaces
            </MenuItem>
          )}
        </MenuPopup>
      </MenuRoot>
    </span>
  );
}
