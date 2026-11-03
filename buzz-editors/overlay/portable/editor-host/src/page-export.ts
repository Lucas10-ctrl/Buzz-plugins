import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { parseSrcset, stringifySrcset } from "srcset";
import { standaloneHtml } from "../../copyos-domain/src/pages.ts";
import type { CopyOSPageDocument } from "../../copyos-domain/src/types.ts";
import { parseDesignImageAssetReference } from "../../copyos-domain/src/design-image-assets.ts";
import { localProjectPath } from "../../copyos-apps/src/PageAssetPath.ts";
import {
  compilePreviewStyles,
  resolvePreviewDeclarationUrls,
  resolvePreviewStyleUrls,
  previewStyleReferences,
} from "../../copyos-apps/src/PagePreviewStyles.ts";
import { PAGE_ASSET_MAX_BYTES, readPageAsset } from "./page-assets.ts";

type Edit = { start: number; end: number; text: string };
const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");

/** URL/policy metadata from the complete selected document, shared by its section preparations. */
export type PageResourceContext = Readonly<{
  baseHref: string | undefined;
  authoredCsp: boolean;
}>;
function resourceContext(
  tree: DefaultTreeAdapterTypes.Node,
): PageResourceContext {
  let baseHref: string | undefined;
  let authoredCsp = false;
  const metadata = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node) {
      const value = (name: string) =>
        node.attrs.find((item) => item.name === name)?.value;
      if (node.tagName === "base" && baseHref === undefined)
        baseHref = value("href");
      if (
        node.tagName === "meta" &&
        value("http-equiv")?.toLowerCase() === "content-security-policy"
      )
        authoredCsp = true;
    }
    if ("childNodes" in node)
      for (const child of node.childNodes) metadata(child);
  };
  metadata(tree);
  return { baseHref, authoredCsp };
}

/** Read the complete selected document's first base URL and resource-embedding policy.
 * @param source - Original full-document HTML, before preparing individual sections.
 * @returns Metadata applied consistently to every section in this document.
 */
export function pageResourceContext(source: string): PageResourceContext {
  return resourceContext(parse(source));
}

/** Embed workspace-owned rendering resources while retaining the original HTML renderer and untouched markup.
 * @param workspaceRoot - Canonical repository workspace; external URLs are retained and never fetched.
 * @param source - Original selected-section HTML.
 * @param options - Retain managed images for the original folder exporters and optionally share full-document URL/policy metadata.
 * @returns HTML with local stylesheets, images, media and fonts embedded; unresolved resources reject.
 */
export async function embedPageResources(
  workspaceRoot: string,
  source: string,
  options: {
    preserveDesignImages?: boolean;
    context?: PageResourceContext;
    sectionLibraryRoot?: string | undefined;
  } = {},
): Promise<string> {
  const tree = parse(source, { sourceCodeLocationInfo: true });
  const { baseHref, authoredCsp } = options.context ?? resourceContext(tree);
  const externalBase =
    baseHref !== undefined && /^(?:https?:)?\/\//iu.test(baseHref);
  const files = new Map<
    string,
    { data: string; bytes: Buffer; mimeType: string }
  >();
  let totalBytes = 0;
  const read = async (path: string) => {
    if (authoredCsp)
      throw new Error(
        "Embedding local resources under the page’s content security policy requires a reviewed project export",
      );
    if (baseHref !== undefined && !externalBase)
      throw new Error(
        "Resolve the page’s local base URL before embedding project resources",
      );
    const decoded = decodeURIComponent(path);
    const cached = files.get(decoded);
    if (cached) return cached;
    const asset = await readPageAsset(
      workspaceRoot,
      decoded,
      undefined,
      options.sectionLibraryRoot,
    );
    if (asset.unchanged) throw new Error("Export requires resource bytes");
    const bytes = Buffer.from(asset.dataBase64, "base64");
    totalBytes += bytes.length;
    if (totalBytes > PAGE_ASSET_MAX_BYTES)
      throw new Error(
        "Standalone export resources exceed the host’s 50 MB file limit",
      );
    const file = {
      bytes,
      mimeType: asset.mimeType,
      data: `data:${asset.mimeType};base64,${asset.dataBase64}`,
    };
    files.set(decoded, file);
    return file;
  };
  const pathFor = (value: string) => {
    const image = parseDesignImageAssetReference(value);
    if (image) return `assets/images/${image.fileName}`;
    if (externalBase) return null;
    if (/^(?:blob:|file:|\/api\/file\b)/iu.test(value.trim()))
      throw new Error("Export requires portable project asset paths");
    const path = localProjectPath(value, "");
    if (
      path === null &&
      value.trim() &&
      !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(value.trim())
    )
      throw new Error(`Export resource leaves the project: ${value}`);
    return path;
  };
  const embed = async (value: string) => {
    if (options.preserveDesignImages && parseDesignImageAssetReference(value))
      return value;
    const path = pathFor(value);
    if (
      options.preserveDesignImages &&
      path?.startsWith("assets/images/") &&
      parseDesignImageAssetReference(
        `copyos-asset:${path.slice("assets/images/".length)}`,
      )
    ) {
      const suffix = value.search(/[?#]/u);
      return `${path}${suffix < 0 ? "" : value.slice(suffix)}`;
    }
    if (path === null) return value;
    const fragment = value.includes("#") ? value.slice(value.indexOf("#")) : "";
    return `${(await read(path)).data}${fragment}`;
  };
  const compileStyle = async (text: string, base: string) => {
    if (externalBase) return text;
    const compiled = await compilePreviewStyles(text, base, async (path) =>
      (await read(path)).bytes.toString("utf8"),
    );
    if (compiled.errors.length)
      throw new Error(`Export stylesheet: ${compiled.errors.join("; ")}`);
    const urls = new Map<string, string>();
    for (const value of previewStyleReferences(compiled.css)) {
      const path = pathFor(value);
      if (path !== null) urls.set(path, (await read(path)).data);
    }
    return resolvePreviewStyleUrls(compiled.css, urls);
  };
  const edits: Edit[] = [];
  const visit = async (node: DefaultTreeAdapterTypes.Node): Promise<void> => {
    if ("tagName" in node) {
      const location = node.sourceCodeLocation;
      const attribute = (name: string) =>
        node.attrs.find(
          (item) =>
            (item.prefix ? `${item.prefix}:${item.name}` : item.name) === name,
        );
      const relations =
        attribute("rel")?.value.toLowerCase().split(/\s+/u) ?? [];
      const resourceLink =
        node.tagName === "link" &&
        relations.some((value) =>
          [
            "icon",
            "apple-touch-icon",
            "mask-icon",
            "preload",
            "prefetch",
            "modulepreload",
          ].includes(value),
        );
      const replace = (name: string, value: string) => {
        const range = location?.attrs?.[name];
        if (range)
          edits.push({
            start: range.startOffset,
            end: range.endOffset,
            text: `${name}="${escapeAttribute(value)}"`,
          });
      };
      if (
        node.tagName === "link" &&
        (relations.includes("stylesheet") ||
          (relations.includes("preload") && attribute("as")?.value === "style"))
      ) {
        const href = attribute("href")?.value;
        if (href !== undefined) {
          const path = pathFor(href);
          if (path !== null) {
            const css = await compileStyle(
              (await read(path)).bytes.toString("utf8"),
              path,
            );
            replace(
              "href",
              `data:text/css;base64,${Buffer.from(css).toString("base64")}`,
            );
            const integrity = attribute("integrity");
            if (integrity) {
              const algorithms = new Set(
                integrity.value
                  .split(/\s+/u)
                  .map((value) => value.split("-")[0])
                  .filter(
                    (value): value is "sha256" | "sha384" | "sha512" =>
                      value === "sha256" ||
                      value === "sha384" ||
                      value === "sha512",
                  ),
              );
              if (!algorithms.size) algorithms.add("sha384");
              replace(
                "integrity",
                [...algorithms]
                  .map(
                    (algorithm) =>
                      `${algorithm}-${createHash(algorithm).update(css).digest("base64")}`,
                  )
                  .join(" "),
              );
            }
          }
        }
      } else {
        for (const name of [
          ...([
            "img",
            "input",
            "source",
            "audio",
            "video",
            "track",
            "script",
            "iframe",
            "embed",
          ].includes(node.tagName)
            ? ["src"]
            : []),
          ...(node.tagName === "video" ? ["poster"] : []),
          ...(node.tagName === "image" ? ["href", "xlink:href"] : []),
          ...(node.tagName === "object" ? ["data"] : []),
          ...(resourceLink ? ["href"] : []),
        ]) {
          const value = attribute(name)?.value;
          if (value === undefined) continue;
          const path = pathFor(value);
          if (
            path !== null &&
            (node.tagName === "script" ||
              node.tagName === "iframe" ||
              node.tagName === "embed" ||
              node.tagName === "object" ||
              relations.includes("modulepreload"))
          )
            throw new Error(
              `Local ${node.tagName} resources require a reviewed project bundle before standalone export`,
            );
          const mapped = await embed(value);
          if (mapped !== value) replace(name, mapped);
        }
      }
      const srcset = attribute("srcset")?.value;
      if (srcset !== undefined) {
        const candidates = parseSrcset(srcset, { strict: true });
        const mapped = [];
        for (const candidate of candidates)
          mapped.push({ ...candidate, url: await embed(candidate.url) });
        if (
          mapped.some(
            (candidate, index) => candidate.url !== candidates[index]?.url,
          )
        )
          replace("srcset", stringifySrcset(mapped, { strict: true }));
      }
      const inline = attribute("style")?.value;
      if (inline !== undefined) {
        const urls = new Map<string, string>();
        for (const value of previewStyleReferences(inline)) {
          const path = pathFor(value);
          if (path !== null) urls.set(path, (await read(path)).data);
        }
        if (urls.size)
          replace("style", resolvePreviewDeclarationUrls(inline, urls));
      }
      if (node.tagName === "style" && location?.startTag && location.endTag) {
        const start = location.startTag.endOffset,
          end = location.endTag.startOffset;
        edits.push({
          start,
          end,
          text: (await compileStyle(source.slice(start, end), "")).replace(
            /<\/style/giu,
            "<\\/style",
          ),
        });
      }
      if ("content" in node) await visit(node.content);
    }
    if ("childNodes" in node)
      for (const child of node.childNodes) await visit(child);
  };
  await visit(tree);
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (Buffer.byteLength(output) > PAGE_ASSET_MAX_BYTES)
    throw new Error("Standalone export exceeds the host’s 50 MB file limit");
  return output;
}

/** Publish a complete standalone export only after every local resource resolves.
 * @param workspaceRoot - Canonical repository-owned workspace.
 * @param page - One saved page snapshot; unrelated manual edits are never rewritten.
 * @param sectionLibraryRoot - Optional canonical shared library for imported section resources.
 * @returns The original exporter’s destination path, atomically replaced after successful rendering.
 */
export async function exportStandalonePage(
  workspaceRoot: string,
  page: CopyOSPageDocument,
  sectionLibraryRoot?: string,
): Promise<string> {
  const html = await embedPageResources(workspaceRoot, standaloneHtml(page), {
    sectionLibraryRoot,
  });
  const directory = join(workspaceRoot, "exports");
  await mkdir(directory, { recursive: true });
  if ((await realpath(directory)) !== directory)
    throw new Error("Editor exports must not use symbolic links");
  const temporary = await mkdtemp(join(directory, ".buzz-html-"));
  const destination = join(directory, `${page.slug}.html`);
  try {
    const staged = join(temporary, "page.html");
    await writeFile(staged, html, { encoding: "utf8", mode: 0o600 });
    await rename(staged, destination);
    return destination;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
