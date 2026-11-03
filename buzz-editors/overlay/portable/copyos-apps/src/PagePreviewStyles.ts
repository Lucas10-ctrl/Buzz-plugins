import postcss, { type AtRule, type Root, type ChildNode } from "postcss";
import valueParser, { type Node } from "postcss-value-parser";
import { localProjectPath } from "./PageAssetPath.ts";

const fragment = (value: string): string =>
  value.includes("#") ? value.slice(value.indexOf("#")) : "";

/** Decode CSS escapes before resolving a quoted or unquoted resource reference. */
function decodeCss(value: string): string {
  return value.replace(
    /\\(?:([\da-f]{1,6})(?:\r\n|[ \t\n\r\f])?|(\r\n|[\n\r\f])|([\s\S]))/giu,
    (
      _whole,
      hex: string | undefined,
      newline: string | undefined,
      character: string | undefined,
    ) => {
      if (newline !== undefined) return "";
      if (hex === undefined) return character ?? "";
      const point = Number.parseInt(hex, 16);
      return point === 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
        ? "\ufffd"
        : String.fromCodePoint(point);
    },
  );
}

function rewriteValue(
  value: string,
  resolve: (value: string) => string | null,
): string {
  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
    const value = previewCssResource(node);
    const replacement = value === undefined ? null : resolve(value);
    if (replacement !== null)
      node.nodes = [
        {
          type: "string",
          quote: '"',
          value: replacement.replaceAll("\\", "\\\\").replaceAll('"', '\\"'),
          sourceIndex: 0,
          sourceEndIndex: 0,
        },
      ];
    return false;
  });
  return parsed.toString();
}

function rewriteUrls(
  root: Root,
  resolve: (value: string) => string | null,
): void {
  root.walkDecls((declaration) => {
    declaration.value = rewriteValue(declaration.value, resolve);
  });
}

/** Extract actual CSS url() values without treating document text as resource requests. */
export function previewStyleReferences(value: string): readonly string[] {
  const references: string[] = [];
  rewriteValue(value, (url) => {
    references.push(url);
    return null;
  });
  return references;
}

/** Resolve an inline style attribute through the same private asset map as linked CSS. */
export function resolvePreviewDeclarationUrls(
  value: string,
  urls: ReadonlyMap<string, string>,
): string {
  return rewriteValue(value, (url) => {
    const path = localProjectPath(url, "");
    const mapped = path === null ? undefined : urls.get(path);
    return mapped === undefined ? null : `${mapped}${fragment(url)}`;
  });
}

/** Replace rooted preview resources with their private URLs, including escaped CSS strings. */
export function resolvePreviewStyleUrls(
  source: string,
  urls: ReadonlyMap<string, string>,
): string {
  const root = postcss.parse(source, { from: undefined });
  rewriteUrls(root, (value) => {
    const path = localProjectPath(value, "");
    const mapped = path === null ? undefined : urls.get(path);
    return mapped === undefined ? null : `${mapped}${fragment(value)}`;
  });
  return root.toString();
}

/** Decode a CSS string or url() token for the private resource resolvers. */
export function previewCssResource(node: Node | undefined): string | undefined {
  if (node?.type === "string" || node?.type === "word")
    return decodeCss(node.value);
  if (node?.type === "function" && node.value.toLowerCase() === "url") {
    const inner = node.nodes.filter(
      (item) => item.type !== "space" && item.type !== "comment",
    );
    if (
      inner.length === 1 &&
      (inner[0]?.type === "string" || inner[0]?.type === "word")
    )
      return decodeCss(inner[0].value);
  }
  return undefined;
}

function importRequest(rule: AtRule) {
  const nodes = valueParser(rule.params).nodes;
  let cursor = 0;
  const skip = () => {
    while (nodes[cursor]?.type === "space" || nodes[cursor]?.type === "comment")
      cursor++;
  };
  skip();
  const url = previewCssResource(nodes[cursor++]);
  if (url === undefined) throw new Error("Invalid CSS import source");
  skip();
  const wrappers: { name: string; params: string }[] = [];
  const layer = nodes[cursor];
  if (layer?.type === "word" && layer.value.toLowerCase() === "layer") {
    wrappers.push({ name: "layer", params: "" });
    cursor++;
  } else if (
    layer?.type === "function" &&
    layer.value.toLowerCase() === "layer"
  ) {
    wrappers.push({
      name: "layer",
      params: valueParser.stringify(layer.nodes),
    });
    cursor++;
  }
  skip();
  const supports = nodes[cursor];
  if (
    supports?.type === "function" &&
    supports.value.toLowerCase() === "supports"
  ) {
    const condition = valueParser.stringify(supports.nodes).trim();
    wrappers.push({
      name: "supports",
      params: /^(?:\(|not\b|selector\()/u.test(condition)
        ? condition
        : `(${condition})`,
    });
    cursor++;
  }
  skip();
  const media = valueParser.stringify(nodes.slice(cursor)).trim();
  if (media) wrappers.push({ name: "media", params: media });
  return { url, wrappers };
}

/** Inline local imports while preserving conditions/order and project-relative asset semantics.
 * @param source - Original stylesheet text.
 * @param baseFile - Its portable project path, or empty for an inline style.
 * @param read - Read another local stylesheet through the existing scoped cache.
 * @returns Preview CSS with project-root URLs, local resource paths and bounded error messages.
 */
export async function compilePreviewStyles(
  source: string,
  baseFile: string,
  read: (path: string) => Promise<string>,
) {
  const resources = new Set<string>();
  const errors: string[] = [];
  const compile = async (
    text: string,
    base: string,
    ancestors: readonly string[],
  ): Promise<Root> => {
    const root = postcss.parse(text, { from: undefined });
    const imports: AtRule[] = [];
    root.walkAtRules("import", (rule) => {
      imports.push(rule);
    });
    for (const rule of imports) {
      try {
        const request = importRequest(rule);
        const path = localProjectPath(request.url, base);
        if (path === null) {
          if (
            request.url.trim() &&
            !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(request.url.trim())
          ) {
            rule.remove();
            errors.push(`${request.url}: CSS import leaves the project`);
          }
          continue;
        }
        resources.add(path);
        if (ancestors.includes(path)) {
          rule.remove();
          errors.push(`${path}: circular CSS import`);
          continue;
        }
        const imported = await compile(await read(path), path, [
          ...ancestors,
          path,
        ]);
        let children: ChildNode[] = imported.nodes;
        for (const wrapper of request.wrappers.toReversed()) {
          const group = postcss.atRule(wrapper);
          group.append(children);
          children = [group];
        }
        rule.replaceWith(...children);
      } catch (error) {
        errors.push(
          `${base || "inline style"}: ${error instanceof Error ? error.message : String(error)}`,
        );
        rule.remove();
      }
    }
    // Imported declarations are already rebased; leading / keeps them rooted on later passes.
    rewriteUrls(root, (value) => {
      const path = localProjectPath(value, base);
      if (path === null) {
        if (
          value.trim() &&
          !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(value.trim())
        ) {
          errors.push(`${value}: CSS resource leaves the project`);
          return "data:application/octet-stream;base64,";
        }
        return null;
      }
      resources.add(path);
      return `/${path}${fragment(value)}`;
    });
    return root;
  };
  let css = "";
  try {
    css = (
      await compile(source, baseFile, baseFile ? [baseFile] : [])
    ).toString();
  } catch (error) {
    errors.push(
      `${baseFile || "inline style"}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { css, resources: [...resources], errors };
}
