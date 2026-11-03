import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

const named = z.string().min(1).max(25);
const valueMap = z.record(z.string(), z.unknown());
const setting = z
  .object({
    type: z.string().min(1),
    id: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    label: z.string().min(1).max(39).optional(),
    default: z.unknown().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    options: z
      .array(
        z
          .object({
            value: z.union([z.string(), z.number()]),
            label: z.string().min(1),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()
  .superRefine((item, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (!["header", "paragraph"].includes(item.type) && !item.id)
      issue("Setting requires an id");
    if (!["header", "paragraph"].includes(item.type) && !item.label)
      issue("Setting requires a label");
    if (
      item.type === "checkbox" &&
      item.default !== undefined &&
      typeof item.default !== "boolean"
    )
      issue("Checkbox default must be boolean");
    if (
      item.type === "text" &&
      (typeof item.default !== "string" || !item.default.trim())
    )
      issue("Text default must be non-blank");
    if (
      item.type === "richtext" &&
      (typeof item.default !== "string" ||
        !/^<(p|ul|ol|h[1-6])\b[^>]*>[\s\S]*<\/\1>$/i.test(item.default.trim()))
    )
      issue("Richtext default requires HTML markup");
    if (item.type === "range") {
      const { min, max, step, default: initial } = item;
      if (
        min === undefined ||
        max === undefined ||
        step === undefined ||
        typeof initial !== "number" ||
        step <= 0 ||
        max <= min ||
        initial < min ||
        initial > max ||
        (max - min) / step > 100 ||
        Math.abs((initial - min) / step - Math.round((initial - min) / step)) >
          1e-8
      )
        issue(
          "Range requires valid min/max/step/default, at most 100 steps, and a default on the step grid",
        );
    }
    if (
      item.type === "select" &&
      (!item.options?.length ||
        !item.options.some((option) => option.value === item.default) ||
        new Set(item.options.map((option) => option.value)).size !==
          item.options.length)
    )
      issue("Select requires unique options and a matching default");
  });
const settings = z.array(setting).superRefine((items, ctx) => {
  const ids = items.flatMap((item) => (item.id ? [item.id] : []));
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: "custom", message: "Setting ids must be unique" });
});
const block = z
  .object({
    type: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: named,
    settings: settings.optional().default([]),
  })
  .passthrough();
const instance = z
  .object({ type: z.string(), settings: valueMap.optional().default({}) })
  .passthrough();
const schema = z
  .object({
    name: named,
    settings: settings.optional().default([]),
    blocks: z.array(block).max(50),
    max_blocks: z.number().int().min(1).max(50).optional(),
    presets: z
      .array(
        z
          .object({
            name: named,
            settings: valueMap.optional().default({}),
            blocks: z.array(instance).max(50).optional().default([]),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough()
  .superRefine((item, ctx) => {
    const types = item.blocks.map((block) => block.type);
    if (new Set(types).size !== types.length)
      ctx.addIssue({ code: "custom", message: "Block types must be unique" });
    for (const type of [
      "heading",
      "subtext",
      "button",
      "image",
      "checkmark",
      "tag",
    ])
      if (!types.includes(type))
        ctx.addIssue({
          code: "custom",
          message: `Missing original guide core block: ${type}`,
        });
  });
type SectionSchema = z.infer<typeof schema>;
type Setting = z.infer<typeof setting>;
const ids = z.string().regex(/^[a-zA-Z0-9]+$/);
const template = z
  .object({
    sections: z.record(
      ids,
      z
        .object({
          type: z.string(),
          settings: valueMap.optional().default({}),
          blocks: z.record(ids, instance).optional().default({}),
          block_order: z.array(ids).optional().default([]),
        })
        .passthrough(),
    ),
    order: z.array(ids),
  })
  .passthrough();

/** Validate the original export guide's schema/template rules; this does not execute Liquid or upload a theme.
 * @param files - Relative sections/templates filenames and their saved UTF-8 content.
 * @param mode - Full-page validation requires a template; section mode permits a standalone section.
 * @returns All detected schema/template errors and the remaining rendering checks.
 */
export function validateShopifyFiles(
  files: ReadonlyMap<string, string>,
  mode: "page" | "section" = "page",
) {
  const errors: string[] = [];
  const sections = new Map<string, SectionSchema>();
  const report = (file: string, message: string) =>
    errors.push(`${file}: ${message}`);
  const checkValues = (
    file: string,
    values: Record<string, unknown>,
    definitions: readonly Setting[],
  ) => {
    for (const [id, value] of Object.entries(values)) {
      const item = definitions.find((item) => item.id === id);
      if (!item) {
        report(file, `Unknown setting ${id}`);
        continue;
      }
      if (
        item.type === "range" &&
        (typeof value !== "number" ||
          value < (item.min ?? 0) ||
          value > (item.max ?? 0) ||
          Math.abs(
            (value - (item.min ?? 0)) / (item.step ?? 1) -
              Math.round((value - (item.min ?? 0)) / (item.step ?? 1)),
          ) > 1e-8)
      )
        report(file, `Invalid range setting ${id}`);
      if (
        item.type === "select" &&
        !item.options?.some((option) => option.value === value)
      )
        report(file, `Unknown select option for ${id}`);
      if (item.type === "checkbox" && typeof value !== "boolean")
        report(file, `Checkbox ${id} must be boolean`);
      if (
        [
          "text",
          "textarea",
          "richtext",
          "url",
          "color",
          "font_picker",
        ].includes(item.type) &&
        typeof value !== "string"
      )
        report(file, `Setting ${id} must be text`);
    }
  };
  const checkBlocks = (
    file: string,
    values: readonly z.infer<typeof instance>[],
    owner: SectionSchema,
  ) => {
    if (values.length > (owner.max_blocks ?? 50))
      report(file, "Too many blocks");
    for (const value of values) {
      const definition = owner.blocks.find(
        (block) => block.type === value.type,
      );
      if (!definition) report(file, `Unknown block type ${value.type}`);
      else checkValues(file, value.settings, definition.settings);
    }
  };
  const checkOrder = (file: string, order: string[], keys: string[]) => {
    if (
      order.length !== keys.length ||
      new Set(order).size !== order.length ||
      order.some((id) => !keys.includes(id))
    )
      report(file, "Order must list each declared id exactly once");
  };
  for (const [file, content] of files) {
    if (!file.startsWith("sections/")) continue;
    if (!/^sections\/[a-z0-9]+(?:-[a-z0-9]+){1,2}\.liquid$/.test(file))
      report(
        file,
        "Section filename requires two or three lowercase hyphenated words",
      );
    const chunks = [
      ...content.matchAll(
        /{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/g,
      ),
    ];
    const schemaSource = chunks[0]?.[1];
    if (
      schemaSource === undefined ||
      chunks.length !== 1 ||
      [...content.matchAll(/{%-?\s*(?:end)?schema\s*-?%}/g)].length !== 2
    ) {
      report(file, "Exactly one schema/endschema pair is required");
      continue;
    }
    try {
      const parsed = schema.safeParse(JSON.parse(schemaSource));
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          report(file, `${issue.path.join(".")}: ${issue.message}`);
        continue;
      }
      sections.set(file.slice(9, -7), parsed.data);
      for (const preset of parsed.data.presets) {
        checkValues(file, preset.settings, parsed.data.settings);
        checkBlocks(file, preset.blocks, parsed.data);
      }
    } catch (error) {
      report(file, error instanceof Error ? error.message : String(error));
    }
  }
  if (!sections.size) errors.push("No valid Liquid sections found");
  if (
    mode === "page" &&
    ![...files.keys()].some((file) => file.startsWith("templates/"))
  )
    errors.push("Full-page export requires a JSON page template");
  for (const [file, content] of files) {
    if (!file.startsWith("templates/")) continue;
    if (!/^templates\/page\.[a-z0-9-]+\.json$/.test(file))
      report(file, "Template filename must be page.<lowercase-suffix>.json");
    if (Buffer.byteLength(content) > 512 * 1024) {
      report(file, "Template exceeds 512 KB");
      continue;
    }
    try {
      const parsed = template.safeParse(JSON.parse(content));
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          report(file, `${issue.path.join(".")}: ${issue.message}`);
        continue;
      }
      const document = parsed.data;
      if (Object.keys(document.sections).length > 25)
        report(file, "Template exceeds 25 sections");
      checkOrder(file, document.order, Object.keys(document.sections));
      for (const section of Object.values(document.sections)) {
        const definition = sections.get(section.type);
        if (!definition) {
          report(file, `Missing section file for ${section.type}`);
          continue;
        }
        checkValues(file, section.settings, definition.settings);
        checkOrder(file, section.block_order, Object.keys(section.blocks));
        checkBlocks(file, Object.values(section.blocks), definition);
      }
    } catch (error) {
      report(file, error instanceof Error ? error.message : String(error));
    }
  }
  return {
    valid: !errors.length,
    errors,
    files: [...files.keys()],
    limitations: [
      "Checks the retained guide's schema and template rules. Full Liquid rendering, CSS/interaction fidelity and actual Shopify theme upload require separate verification.",
    ],
  };
}

/** Read only one export directory inside the editor workspace and validate its flat sections/templates.
 * @param workspaceRoot - The repository-owned workspace directory.
 * @param directory - An export directory resolved inside this workspace's exports folder.
 * @param mode - The intended full-page or standalone-section delivery.
 * @param offset - First validation error to return; the host validates this as a nonnegative integer.
 * @param limit - Number of errors per reply; the host enforces the 1–100 range.
 * @returns Aggregate validity and error count, one error page, and the next offset when available.
 */
export async function validateShopifyExport(
  workspaceRoot: string,
  directory: string,
  mode: "page" | "section" = "page",
  offset = 0,
  limit = 50,
) {
  const exportsRoot = await realpath(join(workspaceRoot, "exports"));
  const root = await realpath(resolve(workspaceRoot, directory));
  const child = relative(exportsRoot, root);
  if (
    isAbsolute(child) ||
    child === ".." ||
    child.startsWith("../") ||
    child.startsWith("..\\")
  )
    throw new Error("Shopify export is outside this workspace's exports");
  const files = new Map<string, string>();
  for (const folder of ["sections", "templates"]) {
    const path = join(root, folder);
    const canonical = await realpath(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (!canonical) continue;
    if (canonical !== path)
      throw new Error("Shopify export folders must not be symlinks");
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile())
        throw new Error("Shopify export contains a non-file or symbolic link");
      files.set(
        `${folder}/${entry.name}`,
        await readFile(join(path, entry.name), "utf8"),
      );
    }
  }
  const result = validateShopifyFiles(files, mode);
  return {
    ...result,
    errorCount: result.errors.length,
    errors: result.errors.slice(offset, offset + limit),
    offset,
    ...(offset + limit < result.errors.length
      ? { nextOffset: offset + limit }
      : {}),
  };
}
