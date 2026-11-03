import { localProjectPath } from "./PageAssetPath.ts";
import {
  compilePreviewStyles,
  resolvePreviewStyleUrls,
  previewStyleReferences,
} from "./PagePreviewStyles.ts";
export { localProjectPath } from "./PageAssetPath.ts";
import {
  extractPreviewFonts,
  type PreviewFontFace,
} from "./PagePreviewFonts.ts";
/** Workspace-private preview resources; persisted HTML keeps its original portable paths. */
interface PageAssetIdentity {
  readonly path: string;
  readonly version: string;
}
export type PageAssetFile = PageAssetIdentity &
  (
    | { readonly unchanged: true }
    | {
        readonly unchanged: false;
        readonly mimeType: string;
        readonly dataBase64: string;
      }
  );
export interface PageAssetView {
  readonly revision: number;
  readonly urls: ReadonlyMap<string, string>;
  readonly stylesheets: ReadonlyMap<string, string>;
  readonly inlineStyles: ReadonlyMap<string, string>;
  readonly fontFaces: ReadonlyMap<string, PreviewFontFace>;
  readonly errors: readonly string[];
  /** Keep resources alive while a frame still renders this snapshot. */
  readonly retain: () => () => void;
  /** Release the prepare caller's ownership once the view is superseded or discarded. */
  readonly release: () => void;
}

interface AssetEntry {
  url: string;
  blob: Blob;
  text?: string;
  version: string;
  generation: number;
  references: number;
  current: boolean;
}

/** Own object URLs until this workspace editor closes; late reads cannot recreate disposed URLs. */
export class PagePreviewAssets {
  private readonly files = new Map<string, AssetEntry>();
  private readonly entries = new Set<AssetEntry>();
  private readonly pending = new Map<string, Promise<void>>();
  private revision = 0;
  private generation = 0;
  private preparation = 0;
  private disposed = false;
  constructor(
    private readonly read: (
      path: string,
      knownVersion?: string,
    ) => Promise<PageAssetFile>,
  ) {}

  private collect(entry: AssetEntry): void {
    if (!entry.current && entry.references === 0 && this.entries.delete(entry))
      URL.revokeObjectURL(entry.url);
  }

  private hold(entries: readonly AssetEntry[]): () => void {
    for (const entry of entries) entry.references++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      for (const entry of entries) {
        entry.references--;
        this.collect(entry);
      }
    };
  }

  private load(path: string): Promise<void> {
    if (this.disposed)
      return Promise.reject(new Error("Preview assets have closed"));
    const generation = this.generation;
    const previous = this.files.get(path);
    if (previous?.generation === generation) return Promise.resolve();
    const existing = this.pending.get(path);
    if (existing) return existing;
    const pending = this.read(decodeURIComponent(path), previous?.version)
      .then((file) => {
        if (this.disposed) throw new Error("Preview assets have closed");
        if (generation !== this.generation)
          throw new Error("Preview asset refresh was superseded");
        if (file.unchanged) {
          if (!previous || previous.version !== file.version)
            throw new Error("Unknown cached asset version");
          previous.generation = generation;
          return;
        }
        const bytes = Uint8Array.from(atob(file.dataBase64), (value) =>
          value.charCodeAt(0),
        );
        const text =
          file.mimeType === "text/css"
            ? new TextDecoder().decode(bytes)
            : undefined;
        const blob = new Blob([bytes], { type: file.mimeType });
        const url = URL.createObjectURL(blob);
        const entry: AssetEntry = {
          url,
          blob,
          version: file.version,
          generation,
          references: 0,
          current: true,
          ...(text === undefined ? {} : { text }),
        };
        this.entries.add(entry);
        this.files.set(path, entry);
        if (previous) {
          previous.current = false;
          this.collect(previous);
        }
        this.revision++;
      })
      .finally(() => {
        if (this.pending.get(path) === pending) this.pending.delete(path);
      });
    this.pending.set(path, pending);
    return pending;
  }

  /** Load resources named by the original sections and reusable-library previews.
   * @param sources - Unmodified section HTML.
   * @param revalidate - Check resource versions again and fence prior outstanding refreshes.
   * @returns A stable URL snapshot, stylesheet text and failures. The caller releases its ownership when discarded or superseded; rendered frames retain their own ownership.
   */
  async prepare(
    sources: readonly string[],
    revalidate = false,
  ): Promise<PageAssetView> {
    const preparation = ++this.preparation;
    if (revalidate) {
      this.generation++;
      this.pending.clear();
    }
    const paths = new Set<string>();
    const stylesheets = new Set<string>();
    const inlineStyles = new Set<string>();
    const errors: string[] = [];
    const add = (value: string, base = "") => {
      const path = localProjectPath(value, base);
      if (path !== null) paths.add(path);
      return path;
    };
    for (const source of sources) {
      const template = document.createElement("template");
      template.innerHTML = source;
      for (const style of template.content.querySelectorAll("style"))
        inlineStyles.add(style.textContent ?? "");
      for (const node of template.content.querySelectorAll(
        "[src], [poster], [srcset], image",
      )) {
        for (const attribute of ["src", "poster"]) {
          const value = node.getAttribute(attribute);
          if (value) add(value);
        }
        if (node.tagName.toLowerCase() === "image") {
          const value =
            node.getAttribute("href") ?? node.getAttribute("xlink:href");
          if (value) add(value);
        }
        const srcset = node.getAttribute("srcset");
        if (srcset && !srcset.includes("data:"))
          for (const candidate of srcset.split(","))
            add(candidate.trim().split(/\s+/u)[0] ?? "");
      }
      for (const link of template.content.querySelectorAll(
        'link[rel~="stylesheet"][href]',
      )) {
        const path = add(link.getAttribute("href") ?? "");
        if (path !== null) stylesheets.add(path);
      }
      for (const node of template.content.querySelectorAll("[style]"))
        for (const value of previewStyleReferences(
          node.getAttribute("style") ?? "",
        ))
          add(value);
    }
    const load = async (path: string) => {
      try {
        await this.load(path);
      } catch (error) {
        errors.push(
          `${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    // Sequential reads avoid multiplying the worker's per-file memory allowance.
    for (const path of paths) await load(path);
    const css = new Map<string, string>();
    const inlineCss = new Map<string, string>();
    const readCss = async (path: string): Promise<string> => {
      paths.add(path);
      await load(path);
      const file = this.files.get(path);
      if (!file) throw new Error(`Stylesheet unavailable: ${path}`);
      const text = file.text ?? (await file.blob.text());
      file.text = text;
      return text;
    };
    const compile = async (source: string, path: string): Promise<string> => {
      const result = await compilePreviewStyles(source, path, readCss);
      errors.push(...result.errors);
      for (const resource of result.resources) {
        paths.add(resource);
        await load(resource);
      }
      return result.css;
    };
    for (const path of stylesheets) {
      const file = this.files.get(path);
      const source = file?.text ?? (await file?.blob.text());
      if (source === undefined) continue;
      if (file) file.text = source;
      css.set(path, await compile(source, path));
    }
    for (const source of inlineStyles)
      inlineCss.set(source, await compile(source, ""));
    if (preparation === this.preparation)
      for (const [path, entry] of this.files) {
        if (paths.has(path)) continue;
        this.files.delete(path);
        entry.current = false;
        this.collect(entry);
        this.revision++;
      }
    const entries = [...this.files.values()];
    const urls = new Map(
      [...this.files].map(([path, file]) => [path, file.url]),
    );
    const fontFaces = new Map<string, PreviewFontFace>();
    let fontSequence = 0;
    const previewCss = (source: string): string => {
      const result = extractPreviewFonts(
        source,
        (path) => this.files.get(path)?.blob,
        () => String(++fontSequence),
      );
      for (const [id, face] of result.faces) fontFaces.set(id, face);
      errors.push(...result.errors);
      return resolvePreviewStyleUrls(result.css, urls);
    };
    const previewStylesheets = new Map(
      [...css].map(([path, source]) => [path, previewCss(source)]),
    );
    const previewInlineStyles = new Map(
      [...inlineCss].map(([source, compiled]) => [
        source,
        previewCss(compiled),
      ]),
    );
    return {
      revision: this.revision,
      urls,
      stylesheets: previewStylesheets,
      inlineStyles: previewInlineStyles,
      fontFaces,
      errors,
      retain: () => this.hold(entries),
      release: this.hold(entries),
    };
  }

  /** Release only this editor's resources and fence outstanding reads. */
  dispose(): void {
    this.disposed = true;
    for (const file of this.entries) URL.revokeObjectURL(file.url);
    this.entries.clear();
    this.files.clear();
  }
}
