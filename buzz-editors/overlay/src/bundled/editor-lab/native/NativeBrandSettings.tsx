import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PluginModule } from "../../../plugins/api";
import type {
  CopyOSBrandDocument,
  CopyOSStyleGuideDocument,
} from "../../../../portable/copyos-domain/src/types";
import { Header, InlineHeader } from "../../../shared/design-system/ui/Header";
import { SettingsGroup } from "../../../shared/design-system/ui/SettingsGroup";
import { Field } from "../../../shared/design-system/ui/Field";
import { Input } from "../../../shared/design-system/ui/Input";
import { Textarea } from "../../../shared/design-system/ui/Textarea";
import { Button } from "../../../shared/design-system/ui/Button";
import { Cube3dSphereIcon } from "../../../shared/design-system/icons";
import { EmptyState } from "../../../shared/design-system/ui/EmptyState";
import type { EditorStore } from "./pages-client";
import { useEditorWorkspace } from "./useEditorWorkspace";
import { EditorWorkspaceControl } from "./EditorWorkspaceControl";
import styles from "./brand-settings.module.css";
import { pageBuilderPluginId } from "./editor-package";

type Ctx = Parameters<PluginModule["apply"]>[0];
type Context = {
  brands: readonly CopyOSBrandDocument[];
  guide?: CopyOSStyleGuideDocument;
  guideRevision: string | null;
};
const emptyBrand = {
  title: "",
  positioning: "",
  audience: "",
  voice: "",
  differentiators: "",
  guardrails: "",
};
const fields = [
  ["title", "Profile name"],
  ["positioning", "Positioning"],
  ["audience", "Audience"],
  ["voice", "Brand voice"],
  ["differentiators", "Differentiators"],
  ["guardrails", "Guardrails (optional)"],
] as const;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Buzz settings framing around CopyOS's existing project brand records and CSS guide. */
export function NativeBrandSettings({
  ctx,
  store,
  active,
}: {
  ctx: Ctx;
  store: EditorStore;
  active(): boolean;
}) {
  const connection = useSyncExternalStore(
    ctx.relay.subscribe,
    ctx.relay.snapshot,
    ctx.relay.snapshot,
  );
  const workspace = useEditorWorkspace(connection);
  return (
    <>
      <Header
        title="Brand settings"
        subtitle="Brand profiles and website styles for an existing Solo workspace. Editor files stay in this lab on this device."
      />
      <EditorWorkspaceControl
        owner={workspace.workspaceId}
        session={connection.session}
        projectId={workspace.projectId}
        choose={workspace.choose}
      />
      {!workspace.projectId || workspace.unavailable ? (
        <EmptyState
          icon={<Cube3dSphereIcon size={24} />}
          title="Choose a Solo workspace"
          description="Create or select a workspace under Messages → Solo. These settings do not create Team workspaces."
        />
      ) : (
        <BrandEditor
          key={workspace.workspaceId}
          workspaceId={workspace.workspaceId}
          workspaceName={workspace.name}
          store={store}
          active={active}
          onWebsiteImport={() =>
            void ctx.navigation.open({
              version: 1,
              kind: "page",
              pluginId: pageBuilderPluginId,
              pageId: "pages",
            })
          }
        />
      )}
    </>
  );
}

function BrandEditor({
  workspaceId,
  workspaceName,
  store,
  active,
  onWebsiteImport,
}: {
  workspaceId: string;
  workspaceName: string;
  store: EditorStore;
  active(): boolean;
  onWebsiteImport(): void;
}) {
  const [context, setContext] = useState<Context>();
  const [name, setName] = useState("Workspace style guide");
  const [css, setCss] = useState("");
  const [source, setSource] = useState<{
    sourceType: "css" | "file" | "website";
    sourceLabel: string;
    sourceUrl?: string;
  }>({ sourceType: "css", sourceLabel: "Pasted CSS" });
  const [draft, setDraft] = useState(emptyBrand);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [reload, setReload] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const loadingFile = useRef(false);
  const inFlight = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: An explicit reload retires the previous read and replaces the saved style draft.
  useEffect(() => {
    alive.current = true;
    let current = true;
    setContext(undefined);
    setError("");
    store.call<Context>("readBrandContext", { workspaceId }).then(
      (result) => {
        if (!current || !active()) return;
        setContext(result);
        setName(result.guide?.name ?? "Workspace style guide");
        setCss(result.guide?.css ?? "");
        setSource(
          result.guide
            ? {
                sourceType: result.guide.sourceType,
                sourceLabel: result.guide.sourceLabel,
                ...(result.guide.sourceUrl
                  ? { sourceUrl: result.guide.sourceUrl }
                  : {}),
              }
            : { sourceType: "css", sourceLabel: "Pasted CSS" },
        );
      },
      (failure) => {
        if (current && active()) setError(message(failure));
      },
    );
    return () => {
      current = false;
      alive.current = false;
    };
  }, [store, workspaceId, active, reload]);
  const run = async (operation: () => Promise<void>) => {
    if (inFlight.current || !alive.current || !active()) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
    } catch (failure) {
      if (alive.current && active()) setError(message(failure));
    } finally {
      inFlight.current = false;
      if (alive.current && active()) setBusy(false);
    }
  };
  const guide = context?.guide;
  return (
    <div className={styles.content}>
      <p className="text-body text-subtle">Workspace: {workspaceName}</p>
      {error && (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      )}
      {!context ? (
        <>
          {!error && <p role="status">Loading brand settings…</p>}
          {error && (
            <Button onClick={() => setReload((value) => value + 1)}>
              Retry loading
            </Button>
          )}
        </>
      ) : (
        <>
          <InlineHeader
            title="Website styleguide"
            subtitle="Paste CSS or import a CSS file. CopyOS extracts the same colours, type, spacing, layout and motion tokens. Imported CSS is stored as content and never applied to Buzz."
          />
          <SettingsGroup layout="form">
            <Field label="Styleguide name">
              <Input
                value={name}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </Field>
            <Field label="CSS source">
              <Textarea
                variant="code"
                rows={12}
                value={css}
                disabled={busy}
                onChange={(event) => {
                  setCss(event.currentTarget.value);
                  setSource({ sourceType: "css", sourceLabel: "Pasted CSS" });
                }}
              />
            </Field>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept=".css,text/css"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file || busy || loadingFile.current) return;
                if (!file.name.toLowerCase().endsWith(".css")) {
                  setError("Choose a .css file.");
                  return;
                }
                if (file.size > 1_000_000) {
                  setError("CSS exceeds the 1 MB styleguide limit.");
                  return;
                }
                loadingFile.current = true;
                void run(async () => {
                  const text = await file.text();
                  if (alive.current && active()) {
                    setCss(text);
                    setSource({ sourceType: "file", sourceLabel: file.name });
                  }
                }).finally(() => {
                  loadingFile.current = false;
                });
              }}
            />
            <div className={styles.actions}>
              <Button disabled={busy} onClick={() => fileRef.current?.click()}>
                Import CSS file
              </Button>
              <Button disabled={busy} onClick={onWebsiteImport}>
                Import website in Page Builder
              </Button>
              <Button
                variant="prominent"
                disabled={busy || !name.trim() || !css.trim()}
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    const saved = await store.call<
                      Pick<Context, "guide" | "guideRevision">
                    >("saveStyleGuide", {
                      workspaceId,
                      name,
                      css,
                      ...source,
                      expectedRevision: context.guideRevision,
                    });
                    if (alive.current && active()) {
                      setContext({ ...context, ...saved });
                      setStatus("Website styleguide saved.");
                    }
                  })
                }
              >
                Save styleguide
              </Button>
            </div>
            <p className="text-caption text-subtle">
              {source.sourceLabel}. Website import uses the existing Clone
              website workflow and your chosen Buzz agent.
            </p>
          </SettingsGroup>
          {guide && (
            <>
              <InlineHeader title={`Saved: ${guide.name}`} />
              <dl className={styles.tokens}>
                {Object.entries(guide.tokens)
                  .filter(
                    ([, value]) =>
                      Array.isArray(value) &&
                      value.length &&
                      value.every((item: unknown) => typeof item === "string"),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-label-sm">{key}</dt>
                      <dd className="text-body">
                        {(value as string[]).join(" · ")}
                      </dd>
                    </div>
                  ))}
                <div>
                  <dt className="text-label-sm">CSS variables</dt>
                  <dd>
                    {Object.entries(guide.tokens.customProperties).map(
                      ([key, value]) => (
                        <div key={key}>
                          <code>{key}</code>: {value}
                        </div>
                      ),
                    )}
                  </dd>
                </div>
              </dl>
            </>
          )}
          <InlineHeader
            title="Brand profiles"
            subtitle="Preserve positioning, audience, voice, differentiators and guardrails as original CopyOS Markdown profiles."
          />
          {context.brands.map((brand) => (
            <SettingsGroup key={brand.id} layout="form">
              <InlineHeader title={brand.title} />
              <dl className={styles.tokens}>
                {fields
                  .filter(([key]) => key !== "title")
                  .map(([key, label]) => (
                    <div key={key}>
                      <dt className="text-label-sm">{label}</dt>
                      <dd className="text-body">{brand[key] || "—"}</dd>
                    </div>
                  ))}
              </dl>
            </SettingsGroup>
          ))}
          <InlineHeader title="New brand profile" />
          <SettingsGroup layout="form">
            {fields.map(([key, label]) => (
              <Field key={key} label={label}>
                {key === "title" ? (
                  <Input
                    value={draft[key]}
                    maxLength={160}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.currentTarget.value })
                    }
                  />
                ) : (
                  <Textarea
                    rows={3}
                    maxLength={20_000}
                    value={draft[key]}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.currentTarget.value })
                    }
                  />
                )}
              </Field>
            ))}
            <div className={styles.actions}>
              <Button
                variant="prominent"
                disabled={
                  busy ||
                  fields.some(
                    ([key]) => key !== "guardrails" && !draft[key].trim(),
                  )
                }
                onClick={() =>
                  void run(async () => {
                    const saved = await store.call<CopyOSBrandDocument>(
                      "createBrand",
                      { workspaceId, ...draft },
                    );
                    if (alive.current && active()) {
                      setContext({
                        ...context,
                        brands: [saved, ...context.brands],
                      });
                      setDraft(emptyBrand);
                      setStatus("Brand profile saved.");
                    }
                  })
                }
              >
                Save brand profile
              </Button>
            </div>
          </SettingsGroup>
          {status && <p role="status">{status}</p>}
          {error && (
            <Button
              disabled={busy}
              onClick={() => setReload((value) => value + 1)}
            >
              Discard style draft and reload saved settings
            </Button>
          )}
        </>
      )}
    </div>
  );
}
