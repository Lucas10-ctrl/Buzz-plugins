import postcss, { AtRule, type Node as CssNode } from "postcss";
import valueParser, { type Node } from "postcss-value-parser";
import { localProjectPath } from "./PageAssetPath.ts";
import { previewCssResource } from "./PagePreviewStyles.ts";

type FontSource =
  | { readonly kind: "bytes"; readonly blob: Blob }
  | { readonly kind: "css"; readonly value: string }
  | { readonly kind: "missing"; readonly path: string };
export interface PreviewFontFace {
  readonly family: string;
  readonly descriptors: FontFaceDescriptors;
  readonly sizeAdjust?: string;
  readonly sources: readonly FontSource[];
  readonly conditions: readonly {
    readonly kind: "media" | "supports";
    readonly value: string;
  }[];
  readonly css: string;
}

/** Internal comments identify only font declarations present in this frame's actual styles. */
export const PREVIEW_FONT_MARKER = /\/\*\s*buzz-preview-font:(\d+)\s*\*\//gu;

function dataFont(value: string): Blob {
  const comma = value.indexOf(",");
  if (comma < 0) throw new Error("Invalid embedded font URL");
  const metadata = value.slice(5, comma),
    payload = value.slice(comma + 1);
  if (metadata.split(";").some((part) => part.toLowerCase() === "base64")) {
    const bytes = Uint8Array.from(
      atob(decodeURIComponent(payload)),
      (character) => character.charCodeAt(0),
    );
    return new Blob([bytes]);
  }
  const bytes: number[] = [];
  for (let index = 0; index < payload.length; ) {
    const hex = payload.slice(index, index + 3);
    if (/^%[\da-f]{2}$/iu.test(hex)) {
      bytes.push(Number.parseInt(hex.slice(1), 16));
      index += 3;
    } else {
      const character = String.fromCodePoint(payload.codePointAt(index) ?? 0);
      bytes.push(...new TextEncoder().encode(character));
      index += character.length;
    }
  }
  return new Blob([new Uint8Array(bytes)]);
}

function sourceGroups(nodes: readonly Node[]): Node[][] {
  const groups: Node[][] = [[]];
  for (const node of nodes) {
    if (node.type === "div" && node.value === ",") groups.push([]);
    else groups[groups.length - 1]?.push(node);
  }
  return groups;
}

/** Replace font rules with private markers while preserving their CSS for later serialization.
 * @param source - Expanded, project-rooted CSS before temporary URL rewriting.
 * @param blob - Locate a font already read through the scoped asset cache.
 * @param identify - Allocate an identifier in this workspace's preview map.
 * @returns Preview CSS and document-local font definitions; invalid rules remain with errors.
 */
export function extractPreviewFonts(
  source: string,
  blob: (path: string) => Blob | undefined,
  identify: () => string,
) {
  const root = postcss.parse(source, { from: undefined });
  const faces = new Map<string, PreviewFontFace>(),
    errors: string[] = [];
  root.walkAtRules("font-face", (rule) => {
    try {
      const values = new Map<string, string>();
      rule.walkDecls((declaration) => {
        values.set(declaration.prop.toLowerCase(), declaration.value);
      });
      const family = values.get("font-family"),
        src = values.get("src");
      if (!family || !src) return;
      const familyNodes = valueParser(family).nodes.filter(
        (node) => node.type !== "space" && node.type !== "comment",
      );
      const familyName = familyNodes
        .map((node) => previewCssResource(node) ?? "")
        .join(" ");
      if (
        !familyName ||
        familyNodes.some(
          (node) => node.type !== "word" && node.type !== "string",
        )
      )
        throw new Error("Invalid font family");
      const descriptors: FontFaceDescriptors = {};
      for (const [property, key] of [
        ["font-style", "style"],
        ["font-weight", "weight"],
        ["font-stretch", "stretch"],
        ["unicode-range", "unicodeRange"],
        ["font-feature-settings", "featureSettings"],
        ["font-variation-settings", "variationSettings"],
        ["ascent-override", "ascentOverride"],
        ["descent-override", "descentOverride"],
        ["line-gap-override", "lineGapOverride"],
      ] as const) {
        const value = values.get(property);
        if (value !== undefined) descriptors[key] = value;
      }
      const width = values.get("font-width");
      if (width !== undefined) descriptors.stretch = width;
      const display = values.get("font-display");
      if (
        display === "auto" ||
        display === "block" ||
        display === "swap" ||
        display === "fallback" ||
        display === "optional"
      )
        descriptors.display = display;
      const sources: FontSource[] = [];
      for (const group of sourceGroups(valueParser(src).nodes)) {
        const first = group.find(
          (node) => node.type !== "space" && node.type !== "comment",
        );
        if (
          first?.type === "function" &&
          first.value.toLowerCase() === "local"
        ) {
          sources.push({ kind: "css", value: valueParser.stringify(group) });
          continue;
        }
        const url = previewCssResource(first);
        if (url === undefined) continue;
        if (url.startsWith("data:"))
          sources.push({ kind: "bytes", blob: dataFont(url) });
        else {
          const path = localProjectPath(url, "");
          if (path === null)
            sources.push({ kind: "css", value: valueParser.stringify(group) });
          else {
            const bytes = blob(path);
            sources.push(
              bytes
                ? { kind: "bytes", blob: bytes }
                : { kind: "missing", path },
            );
          }
        }
      }
      const conditions: { kind: "media" | "supports"; value: string }[] = [];
      for (
        let parent: CssNode | undefined = rule.parent;
        parent;
        parent = parent.parent
      ) {
        if (
          parent instanceof AtRule &&
          (parent.name === "media" || parent.name === "supports")
        )
          conditions.unshift({ kind: parent.name, value: parent.params });
      }
      const id = identify();
      const sizeAdjust = values.get("size-adjust");
      faces.set(id, {
        family: familyName,
        descriptors,
        sources,
        conditions,
        css: rule.toString(),
        ...(sizeAdjust === undefined ? {} : { sizeAdjust }),
      });
      rule.replaceWith(postcss.comment({ text: `buzz-preview-font:${id}` }));
    } catch (error) {
      errors.push(
        `Font declaration: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return { css: root.toString(), faces, errors };
}

/** Install active faces into one preview document; cancellation removes only this call's faces.
 * @param document - The current same-origin preview document.
 * @param faces - Font declarations actually present in its styles.
 * @param signal - Revoked when the document or applicable conditions change.
 * @returns Failed family messages; successful registrations live until cancellation.
 */
export async function installPreviewFonts(
  document: Document,
  faces: readonly PreviewFontFace[],
  signal: AbortSignal,
): Promise<readonly string[]> {
  const window = document.defaultView;
  if (!window || typeof window.FontFace !== "function" || !document.fonts)
    return faces.length ? ["This preview host cannot load project fonts"] : [];
  const installed: FontFace[] = [];
  const fontSet = document.fonts;
  const remove = () => {
    for (const face of installed) fontSet.delete(face);
    installed.length = 0;
  };
  signal.addEventListener("abort", remove, { once: true });
  const errors: string[] = [];
  for (const spec of faces) {
    if (signal.aborted) break;
    if (
      spec.conditions.some((condition) =>
        condition.kind === "media"
          ? !window.matchMedia(condition.value).matches
          : !window.CSS.supports(condition.value),
      )
    )
      continue;
    let success = false,
      failure = "No usable font source";
    for (const source of spec.sources) {
      let candidate: FontFace | undefined;
      try {
        if (signal.aborted) break;
        if (source.kind === "missing")
          throw new Error(`Missing font asset: ${source.path}`);
        const input =
          source.kind === "bytes"
            ? await source.blob.arrayBuffer()
            : source.value;
        if (signal.aborted) break;
        const face = new window.FontFace(spec.family, input, spec.descriptors);
        if (spec.sizeAdjust !== undefined) {
          if (!("sizeAdjust" in face))
            throw new Error("This preview host does not support size-adjust");
          face.sizeAdjust = spec.sizeAdjust;
        }
        candidate = face;
        fontSet.add(face);
        installed.push(face);
        await face.load();
        if (signal.aborted) break;
        success = true;
        break;
      } catch (error) {
        if (candidate !== undefined) {
          fontSet.delete(candidate);
          const index = installed.indexOf(candidate);
          if (index !== -1) installed.splice(index, 1);
        }
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    if (!success && !signal.aborted) errors.push(`${spec.family}: ${failure}`);
  }
  if (signal.aborted) remove();
  return errors;
}
