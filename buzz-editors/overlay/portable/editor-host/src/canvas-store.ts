import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CopyOSDesignRepository } from "../../copyos-domain/src/designs.ts";
import { CopyOSDesignCommentRepository } from "../../copyos-domain/src/design-comments.ts";
import { CopyOSDesignTemplateRepository } from "../../copyos-domain/src/design-templates.ts";
import { CopyOSDesignFontStore } from "../../copyos-domain/src/design-font-store.ts";
import { CopyOSDesignImageStore } from "../../copyos-domain/src/design-image-store.ts";
import { parseDesignImageAssetReference } from "../../copyos-domain/src/design-image-assets.ts";
import { getBundledDesignFontMetadata } from "../../copyos-domain/src/design-font-metadata.ts";
import { CopyOSDesignPageConversion } from "../../copyos-domain/src/design-page-conversion.ts";
import { CopyOSStyleGuideRepository } from "../../copyos-domain/src/style-guide.ts";
import { importFigDesign } from "../../copyos-domain/src/fig-import-service.ts";
import { decodeFigClipboardSelection } from "../../copyos-domain/src/fig-clipboard-service.ts";
import { inspectDesignPage } from "../../copyos-tools/src/design-inspection.ts";
import { CanvasComparables } from "./canvas-comparables.ts";
import { CopyOSAssetRepository } from "../../copyos-domain/src/assets.ts";
import { importDesignClipboard } from "../../copyos-domain/src/design-clipboard.ts";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applyDesignChanges } from "../../copyos-domain/src/designs.ts";
import {
  designUsesSymbols,
  installDesignSymbolFont,
  mergeDesignResourcesByName,
  describeDesignSystem,
  designAgentNodeDefaults,
  installDesignDocumentFonts,
  loadAllDesignProjectFonts,
  measureDesignDocumentText,
  readDesignImageSource,
  renderDesignArtboard,
  storeDesignImageSource,
} from "../../copyos-domain/src/design-agent-host.ts";
import { CANVAS_GUIDE_TOPIC_NAMES, canvasGuideTopic } from "./canvas-agent.ts";
import { runCanvasScript } from "../../copyos-tools/src/canvas-script.ts";
import { describeDesignMetadata } from "../../copyos-domain/src/design-metadata.ts";
import { listDesignIcons } from "../../copyos-domain/src/design-icons.ts";
import type { CopyOSDesignDocument } from "../../copyos-domain/src/types.ts";
import {
  GenerationStore,
  generationOperations,
  editorGenerationOptions,
  type EditorGenerationOptions,
} from "./generation-store.ts";

const id = z.string().uuid();
const workspace = z.string().min(1).max(512);
const request = z.object({ workspaceId: workspace });
const design = request.extend({ designId: id });
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const conversion = z.object({
  designId: id,
  nodeId: id,
  expectedRevision: revision,
});
const resolution = z.enum(["keep-page", "use-design"]);
const update = conversion.extend({
  resolutions: z.record(z.string(), resolution).optional(),
});
const names = z.array(z.string()).max(10_000);

/** Canvas repositories behind a Buzz-owned workspace resolver, independent of the former application host. */
export class CanvasStore {
  private readonly designs = new CopyOSDesignRepository();
  private readonly comments = new CopyOSDesignCommentRepository();
  private readonly templates: CopyOSDesignTemplateRepository;
  private readonly templateRoot: string;
  private readonly fonts = new CopyOSDesignFontStore();
  private readonly images = new CopyOSDesignImageStore();
  private readonly conversion = new CopyOSDesignPageConversion();
  private readonly guides = new CopyOSStyleGuideRepository();
  private readonly copy = new CopyOSAssetRepository();
  private readonly comparables: CanvasComparables;
  private readonly generation: GenerationStore;
  constructor(
    root: string,
    private readonly directory: (workspaceId: string) => Promise<string>,
    generation: EditorGenerationOptions = editorGenerationOptions(),
  ) {
    this.generation = new GenerationStore(directory, generation);
    this.comparables = new CanvasComparables(root);
    this.templateRoot = join(root, "design-templates");
    this.templates = new CopyOSDesignTemplateRepository(this.templateRoot);
  }
  private seeded?: Promise<void>;
  /** Copy the bundled ad templates into the template library once; templates the user deleted come back only if the library is reset. */
  private seedTemplates(): Promise<void> {
    this.seeded ??= (async () => {
      const bundled = fileURLToPath(
        new URL("../canvas-templates/library/", import.meta.url),
      );
      const names = await readdir(bundled).catch(() => [] as string[]);
      if (!names.length) return;
      await mkdir(this.templateRoot, { recursive: true, mode: 0o700 });
      const marker = join(this.templateRoot, ".bundled-ad-templates");
      const seen = new Set(
        (await readFile(marker, "utf8").catch(() => "")).split("\n"),
      );
      const entries: string[] = [];
      for (const name of names) {
        if (!/\.(json|png)$/u.test(name)) continue;
        const entry = `${name}:${String((await stat(join(bundled, name))).size)}`;
        entries.push(entry);
        if (!seen.has(entry))
          await copyFile(join(bundled, name), join(this.templateRoot, name));
      }
      await writeFile(marker, entries.join("\n"));
    })();
    return this.seeded;
  }
  async dispose(): Promise<void> {
    await this.generation.dispose();
  }
  async call(operation: string, input: unknown): Promise<unknown> {
    if (generationOperations.some((value) => value === operation))
      return this.generation.call(operation, input);
    const { workspaceRef, ...nativeInput } = z
      .object({
        workspaceRef: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
      })
      .passthrough()
      .parse(input);
    input = nativeInput;
    if (operation === "copyComparableImages") {
      const value = request
        .extend({
          urls: z
            .array(
              z
                .string()
                .refine(
                  (value) =>
                    parseDesignImageAssetReference(value) !== undefined,
                  "Use saved project image references",
                ),
            )
            .min(1)
            .max(1000),
        })
        .strict()
        .parse(input);
      if (workspaceRef === undefined)
        throw new Error("Choose a comparison workspace first");
      await this.images.copyImages(
        await this.comparables.root(workspaceRef),
        await this.directory(value.workspaceId),
        value.urls,
      );
      return { copied: value.urls };
    }
    if (
      workspaceRef !== undefined &&
      ![
        "listComparableDesigns",
        "readDesign",
        "inspectDesign",
        "viewDesign",
        "getStyleGuide",
      ].includes(operation)
    )
      throw new Error("Comparison workspaces are read-only");
    // All calls resolve the workspace before touching repositories; each repository validates stored content.
    const { workspaceId } = request.parse(input);
    const root =
      workspaceRef === undefined
        ? await this.directory(workspaceId)
        : await this.comparables.root(workspaceRef);
    const readDesign = (designId: string) =>
      workspaceRef === undefined
        ? this.designs.get(root, designId)
        : this.comparables.read(root, designId);
    switch (operation) {
      case "listCanvasWorkspaces": {
        const value = request
          .extend({
            offset: z.number().int().nonnegative().default(0),
            limit: z.number().int().min(1).max(20).default(10),
          })
          .strict()
          .parse(input);
        return this.comparables.list(workspaceId, value.offset, value.limit);
      }
      case "listComparableDesigns": {
        const value = request
          .extend({
            offset: z.number().int().nonnegative().default(0),
            limit: z.number().int().min(1).max(20).default(10),
          })
          .strict()
          .parse(input);
        return this.comparables.designs(root, value.offset, value.limit);
      }
      case "listCopyAssets":
      case "readCopyAsset":
      case "createCopyAsset": {
        for (const name of ["copy", "briefs"]) {
          const path = join(root, name);
          await mkdir(path, { recursive: true });
          if (
            !(await lstat(path)).isDirectory() ||
            (await realpath(path)) !== path
          )
            throw new Error("Copy library must not use symbolic links");
        }
        if (operation === "listCopyAssets") {
          request.strict().parse(input);
          return this.copy.list(root, "copy");
        }
        if (operation === "readCopyAsset") {
          const value = request.extend({ copyId: id }).strict().parse(input);
          const copy = await this.copy.get(root, value.copyId);
          if (copy.kind !== "copy")
            throw new Error("The selected asset is not saved copy");
          return copy;
        }
        const { workspaceId: _, ...fields } = request
          .extend({ title: z.string(), label: z.string(), body: z.string() })
          .strict()
          .parse(input);
        return this.copy.createCopy(root, fields);
      }
      case "insertDesignTemplate": {
        const value = design
          .extend({
            templateId: id,
            expectedRevision: revision,
            pageId: id.optional(),
            mergeByName: z.boolean().default(false),
            position: z
              .object({ x: z.number().finite(), y: z.number().finite() })
              .strict()
              .optional(),
          })
          .strict()
          .parse(input);
        const document = await this.designs.get(root, value.designId);
        if (document.revision !== value.expectedRevision)
          throw new Error("Design revision changed; read it again");
        await this.seedTemplates();
        const template = await this.templates.read(value.templateId);
        const roots = document.nodes.filter((node) => node.parentId === null);
        const position = roots.length
          ? {
              x: Math.max(...roots.map((node) => node.x + node.width)) + 80,
              y: Math.min(...roots.map((node) => node.y)),
            }
          : { x: 0, y: 0 };
        await this.seedTemplates();
        const imported = importDesignClipboard(document, template.snapshot, {
          destinationWorkspaceId: workspaceId,
          position: value.position ?? position,
          ...(value.pageId === undefined ? {} : { pageId: value.pageId }),
        });
        const saved = await this.designs.save(
          root,
          value.mergeByName
            ? mergeDesignResourcesByName(document, imported.document)
            : imported.document,
        );
        return {
          document: saved,
          selectedIds: imported.selectedIds,
          removedNodeLinks: imported.removedNodeLinks,
        };
      }
      case "listDesigns":
        return this.designs.list(root);
      case "readDesign":
        return readDesign(design.strict().parse(input).designId);
      case "inspectDesign": {
        const text = z.string().optional();
        const { workspaceId, designId, ...selectors } = design
          .extend({
            section: text,
            owner_id: text,
            property_id: text,
            axis_id: text,
            paint_id: text,
            instance_path_json: text,
            node_ids_json: text,
            page_id_json: text,
            layout_version: text,
            suggestion_seed: text,
            query: text,
            token_mode_id: text,
            cursor: text,
            field_ref: text,
            component_property_id: text,
            component_property_query: text,
            component_property_cursor: z.number().optional(),
            limit: z.number().optional(),
            max_bytes: z.number().optional(),
            revision: z.number().optional(),
          })
          .strict()
          .parse(input);
        return inspectDesignPage(
          await readDesign(designId),
          { ...selectors, workspace_id: workspaceId },
          root,
        );
      }
      case "viewDesign": {
        const value = design
          .extend({
            artboardId: id.optional(),
            expectedRevision: revision.optional(),
            top: z.number().finite().nonnegative().default(0),
            height: z.number().finite().positive().optional(),
            maxWidth: z.number().int().min(320).max(2000).default(1200),
            scale: z.number().min(0.1).max(3).optional(),
          })
          .strict()
          .parse(input);
        const document = await readDesign(value.designId);
        if (
          value.expectedRevision !== undefined &&
          document.revision !== value.expectedRevision
        )
          throw new Error("Design revision changed; read it again");
        const artboards = document.nodes.filter(
          (node) =>
            node.parentId === null &&
            node.kind === "frame" &&
            node.visible &&
            !node.pageLink,
        );
        const artboard =
          value.artboardId === undefined
            ? artboards[0]
            : artboards.find((node) => node.id === value.artboardId);
        if (!artboard)
          throw new Error(
            "Viewing requires a visible top-level frame that is not a linked page screen",
          );
        if (value.top >= artboard.height)
          throw new Error("top must be inside the artboard");
        const height = Math.min(
          value.height ?? 2400,
          2400,
          artboard.height - value.top,
        );
        const scale =
          value.scale ??
          Math.min(2, value.maxWidth / artboard.width, 4000 / height);
        const { png, ...rendered } = await renderDesignArtboard(
          root,
          document,
          artboard.id,
          scale,
          { top: value.top, height },
        );
        return {
          dataBase64: Buffer.from(png).toString("base64"),
          design: {
            id: document.id,
            title: document.title,
            revision: document.revision,
          },
          ...rendered,
          otherArtboards: artboards
            .filter((node) => node.id !== artboard.id)
            .map((node) => ({ id: node.id, name: node.name })),
          rendering:
            "Same renderer, fonts and image crops as exportDesign: at the same scale these are the exported pixels. Notes list substituted fonts and missing images.",
        };
      }
      case "createDesign": {
        const value = request
          .extend({
            title: z.string().min(1).max(160),
            canvasBackground: z
              .object({
                color: z.string(),
                opacity: z.number(),
                visible: z.boolean(),
                variableId: id.nullable().optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .parse(input);
        return this.designs.create(root, value.title, value.canvasBackground);
      }
      case "saveDesign":
        return this.designs.save(
          root,
          request.extend({ document: z.unknown() }).strict().parse(input)
            .document,
        );
      case "editDesign": {
        const value = design
          .extend({ expectedRevision: revision, changes: z.unknown() })
          .strict()
          .parse(input);
        const document = await this.designs.get(root, value.designId);
        if (document.revision !== value.expectedRevision)
          throw new Error(
            "Design changed in another editor. Read the saved design before editing.",
          );
        const candidate = applyDesignChanges(
          document,
          withNewNodeDefaults(document, value.changes),
        );
        await installDesignDocumentFonts(root, candidate).catch(() => []);
        const measured = await measureDesignDocumentText(root, candidate);
        const saved = await this.designs.save(root, measured.document);
        return measured.unmeasured.length
          ? { ...saved, unmeasuredText: measured.unmeasured }
          : saved;
      }
      case "placeDesignImage": {
        const value = design
          .extend({
            expectedRevision: revision,
            nodeId: id,
            source: z.string().min(1),
            scaleMode: z
              .enum(["fill", "fit", "crop", "tile", "stretch", "FILL", "FIT", "CROP", "TILE", "STRETCH"])
              .default("fill"),
            zoom: z.number().positive().max(100).optional(),
            offsetX: z.number().min(-10).max(10).optional(),
            offsetY: z.number().min(-10).max(10).optional(),
            removeStrokes: z.boolean().default(false),
            hideLayers: z.array(z.string()).max(50).default([]),
          })
          .strict()
          .parse(input);
        const document = await this.designs.get(root, value.designId);
        if (document.revision !== value.expectedRevision)
          throw new Error(
            "Design changed in another editor. Read the saved design before editing.",
          );
        const target = document.nodes.find((node) => node.id === value.nodeId);
        if (!target) throw new Error(`Layer not found: ${value.nodeId}`);
        const image = await storeDesignImageSource(root, value.source);
        const scaleMode = value.scaleMode.toLowerCase() as
          | "fill"
          | "fit"
          | "crop"
          | "tile"
          | "stretch";
        const hidden = document.nodes.filter(
          (node) =>
            value.hideLayers.includes(node.name) &&
            isInside(document, node.id, target.id),
        );
        const saved = await this.designs.edit(root, document, {
          upsertNodes: [
            {
              id: target.id,
              fills: [
                {
                  id: randomUUID(),
                  color: "#ffffff",
                  opacity: 1,
                  visible: true,
                  variableId: null,
                  image: {
                    url: image.url,
                    scaleMode,
                    sourceWidth: image.width,
                    sourceHeight: image.height,
                    ...(scaleMode === "crop"
                      ? {
                          zoom: value.zoom ?? 1,
                          offsetX: value.offsetX ?? 0,
                          offsetY: value.offsetY ?? 0,
                        }
                      : {}),
                  },
                },
              ],
              ...(value.removeStrokes
                ? { strokes: [], strokeWidth: 0 }
                : {}),
            },
            ...hidden.map((node) => ({ id: node.id, visible: false })),
          ],
        });
        return {
          revision: saved.revision,
          image,
          nodeId: target.id,
          hidden: hidden.map((node) => node.name),
        };
      }
      case "runCanvasScript": {
        const value = design
          .extend({
            expectedRevision: revision,
            code: z.string().min(1).max(200_000),
            pageId: id.optional(),
            timeoutMs: z.number().int().min(1000).max(120_000).optional(),
          })
          .strict()
          .parse(input);
        const document = await this.designs.get(root, value.designId);
        if (document.revision !== value.expectedRevision)
          throw new Error(
            "Design changed in another editor. Read the saved design before editing.",
          );
        if (designUsesSymbols(value.code) || /\\u2[1-9a-b][0-9a-f]{2}/iu.test(value.code))
          await installDesignSymbolFont(root);
        const outcome = await runCanvasScript(
          document,
          value.code,
          {
            fonts: async (families, needs) => {
              if (needs?.symbols) await installDesignSymbolFont(root);
              return loadAllDesignProjectFonts(root, families, { emoji: needs?.emoji ?? false });
            },
            installFont: async (family) => {
              const result = await this.fonts.installGoogle(root, [family], {
                cssUrl: "https://fonts.googleapis.com/css2",
                fetch: globalThis.fetch,
              });
              if (result.unavailable.length)
                throw new Error(
                  `"${family}" is not a Google font and is not installed in this project. Upload it in Canvas (Fonts) or pick another family.`,
                );
            },
            image: (source) => storeDesignImageSource(root, source),
          },
          {
            ...(value.timeoutMs === undefined
              ? {}
              : { timeoutMs: value.timeoutMs }),
            ...(value.pageId === undefined ? {} : { pageId: value.pageId }),
          },
        );
        // Fonts the final design names (including the symbol fallback) are installed and the text measured with them.
        await installDesignDocumentFonts(root, outcome.document).catch(() => []);
        const measured = await measureDesignDocumentText(root, outcome.document);
        const saved = await this.designs.save(root, measured.document);
        return {
          designId: saved.id,
          revision: saved.revision,
          result: outcome.result,
          created: outcome.created.length,
          ...(outcome.logs.length ? { logs: outcome.logs } : {}),
          ...(outcome.warnings.length ? { warnings: outcome.warnings } : {}),
          ...(measured.unmeasured.length
            ? { unmeasuredText: measured.unmeasured }
            : {}),
        };
      }
      case "readCanvasGuide": {
        const value = request.extend({ topic: z.string().max(80).optional() }).strict().parse(input);
        const guide = canvasGuideTopic(value.topic ?? "canvas-use");
        if (guide === undefined) throw new Error(`No guide topic "${value.topic ?? ""}". Topics: ${CANVAS_GUIDE_TOPIC_NAMES.join(", ")}`);
        return { guide, topics: CANVAS_GUIDE_TOPIC_NAMES };
      }
      case "getDesignMetadata": {
        const value = design
          .extend({ nodeId: id.optional(), depth: z.number().int().min(1).max(64).optional() })
          .strict()
          .parse(input);
        return {
          metadata: describeDesignMetadata(await readDesign(value.designId), {
            ...(value.nodeId ? { nodeId: value.nodeId } : {}),
            ...(value.depth ? { depth: value.depth } : {}),
          }),
        };
      }
      case "listDesignIcons": {
        const value = request.extend({ query: z.string().max(80).optional() }).strict().parse(input);
        return { icons: listDesignIcons(value.query ?? ""), use: "In runCanvasScript: figma.createNodeFromSvg(canvas.icon('search', { color: '#202124', size: 24 }))" };
      }
      case "getDesignSystem":
        return describeDesignSystem(
          await readDesign(design.strict().parse(input).designId),
        );
      case "exportDesign": {
        const value = design
          .extend({
            artboardId: id.optional(),
            expectedRevision: revision.optional(),
            scale: z.number().min(0.25).max(3).default(1),
            fileName: z
              .string()
              .regex(/^[\w .()-]{1,120}$/u)
              .optional(),
          })
          .strict()
          .parse(input);
        const document = await readDesign(value.designId);
        if (
          value.expectedRevision !== undefined &&
          document.revision !== value.expectedRevision
        )
          throw new Error("Design revision changed; read it again");
        const artboard =
          value.artboardId === undefined
            ? document.nodes.find(
                (node) => node.parentId === null && node.kind === "frame" && node.visible,
              )
            : document.nodes.find((node) => node.id === value.artboardId);
        if (!artboard || artboard.parentId !== null || artboard.kind !== "frame")
          throw new Error("Export a visible top-level frame");
        const rendered = await renderDesignArtboard(
          root,
          document,
          artboard.id,
          value.scale,
        );
        const folder = join(root, "exports", "canvas");
        await mkdir(folder, { recursive: true });
        const name = (
          value.fileName ??
          `${document.title} - ${artboard.name} @${String(value.scale)}x`
        )
          .replace(/[^\w .()@-]+/gu, "-")
          .slice(0, 160);
        const path = join(folder, `${name}.png`);
        await writeFile(path, rendered.png);
        return {
          path,
          width: rendered.width,
          height: rendered.height,
          scale: rendered.scale,
          artboard: rendered.artboard,
          text: rendered.text,
          missingImages: rendered.missingImages,
          dataBase64: Buffer.from(rendered.png).toString("base64"),
        };
      }
      case "importDesign": {
        const value = request
          .extend({
            fileName: z.string().min(1).max(255),
            fileBase64: z.string().min(1),
          })
          .strict()
          .parse(input);
        return importFigDesign(root, value.fileName, value.fileBase64);
      }
      case "decodeDesignClipboard":
        return decodeFigClipboardSelection(
          request
            .extend({ dataBase64: z.string().min(1) })
            .strict()
            .parse(input).dataBase64,
        );
      case "getStyleGuide":
        return this.guides.get(root);
      case "listDesignComments":
        return this.comments.list(root, design.strict().parse(input).designId);
      case "addDesignComment": {
        const value = design
          .extend({ body: z.string(), target: z.unknown() })
          .strict()
          .parse(input);
        return this.comments.add(
          root,
          value.designId,
          value.body,
          value.target,
        );
      }
      case "setDesignCommentStatus": {
        const value = design
          .extend({ commentId: id, status: z.enum(["open", "resolved"]) })
          .strict()
          .parse(input);
        return this.comments.setStatus(
          root,
          value.designId,
          value.commentId,
          value.status,
        );
      }
      case "deleteDesignComment": {
        const value = design.extend({ commentId: id }).strict().parse(input);
        await this.comments.delete(root, value.designId, value.commentId);
        return { deleted: true };
      }
      case "listDesignTemplates": {
        const value = request
          .extend({
            category: z.string().optional(),
            query: z.string().optional(),
            thumbnails: z.boolean().default(true),
          })
          .strict()
          .parse(input);
        await this.seedTemplates();
        const words = (value.query ?? "").toLowerCase().split(/\s+/u).filter(Boolean);
        const templates = (await this.templates.list()).filter(
          (template) =>
            (value.category === undefined ||
              template.category.toLowerCase() === value.category.toLowerCase()) &&
            words.every((word) =>
              `${template.title} ${template.description}`.toLowerCase().includes(word),
            ),
        );
        return {
          templates: value.thumbnails
            ? templates
            : templates.map(({ thumbnail: _, ...rest }) => rest),
        };
      }
      case "saveDesignTemplate": {
        const value = design
          .extend({
            nodeId: id,
            title: z.string(),
            category: z.string(),
            description: z.string(),
          })
          .strict()
          .parse(input);
        return this.templates.save({
          root,
          sourceWorkspaceId: workspaceId,
          sourceWorkspaceName: workspaceId,
          document: await this.designs.get(root, value.designId),
          nodeId: value.nodeId,
          title: value.title,
          category: value.category,
          description: value.description,
        });
      }
      case "readDesignTemplate":
        await this.seedTemplates();
        return this.templates.read(
          request.extend({ templateId: id }).strict().parse(input).templateId,
        );
      case "deleteDesignTemplate": {
        await this.templates.delete(
          request.extend({ templateId: id }).strict().parse(input).templateId,
        );
        return { deleted: true };
      }
      case "getDesignFontMetadata":
        return getBundledDesignFontMetadata(
          request
            .extend({ family: z.string().min(1).max(200) })
            .strict()
            .parse(input).family,
        );
      case "listDesignFonts":
        return { faces: await this.fonts.list(root) };
      case "installDesignFonts": {
        const value = request
          .extend({ families: z.array(z.string().min(1).max(200)).max(20) })
          .strict()
          .parse(input);
        return this.fonts.installGoogle(root, value.families, {
          cssUrl: "https://fonts.googleapis.com/css2",
          fetch: globalThis.fetch,
        });
      }
      case "uploadDesignFont": {
        // A brand font file, once per project: bytes from the app, or a path / https URL / data URL from an agent.
        const value = request
          .extend({
            fileName: z.string().max(255).optional(),
            dataBase64: z.string().max(13_400_000).optional(),
            source: z.string().min(1).max(14_000_000).optional(),
          })
          .strict()
          .refine((item) => !!item.dataBase64 !== !!item.source, "Pass either dataBase64 or source")
          .parse(input);
        const bytes = value.source
          ? Buffer.from(await readDesignImageSource(value.source))
          : Buffer.from(value.dataBase64 ?? "", "base64");
        return this.fonts.upload(root, bytes);
      }
      case "readDesignFont": {
        const value = request
          .extend({ file: z.string() })
          .strict()
          .parse(input);
        const { bytes, mimeType } = await this.fonts.read(root, value.file);
        return { dataBase64: bytes.toString("base64"), mimeType };
      }
      case "putDesignImage": {
        const value = request
          .extend({
            dataBase64: z.string().max(28_000_000).optional(),
            source: z.string().min(1).max(28_000_000).optional(),
          })
          .strict()
          .refine(
            (item) => (item.dataBase64 === undefined) !== (item.source === undefined),
            "Give dataBase64 or source (a file path, http(s) URL or data: URL)",
          )
          .parse(input);
        if (value.source !== undefined)
          return storeDesignImageSource(root, value.source);
        return {
          url: await this.images.put(
            root,
            Buffer.from(value.dataBase64 ?? "", "base64"),
          ),
        };
      }
      case "readDesignImage": {
        const value = request
          .extend({ reference: z.string() })
          .strict()
          .parse(input);
        const { bytes, mimeType } = await this.images.read(
          root,
          value.reference,
        );
        return { dataBase64: bytes.toString("base64"), mimeType };
      }
      case "copyDesignImages": {
        const value = request
          .extend({
            sourceWorkspaceId: workspace,
            urls: z.array(z.string()).max(1000),
          })
          .strict()
          .parse(input);
        return this.images.copyImages(
          await this.directory(value.sourceWorkspaceId),
          root,
          value.urls,
        );
      }
      case "findUnusedDesignImages": {
        const value = request.extend({ keep: names }).strict().parse(input);
        return {
          files: await this.images.findUnusedImages(root, {
            keep: value.keep,
            minimumAgeMs: 86_400_000,
            now: Date.now(),
          }),
        };
      }
      case "removeUnusedDesignImages": {
        const value = request
          .extend({ keep: names, fileNames: names })
          .strict()
          .parse(input);
        return {
          files: await this.images.removeUnusedImages(root, value.fileNames, {
            keep: value.keep,
            minimumAgeMs: 86_400_000,
            now: Date.now(),
          }),
        };
      }
      case "previewDesignPage": {
        const { workspaceId: _, ...value } = request
          .extend(conversion.shape)
          .extend({ title: z.string().optional() })
          .strict()
          .parse(input);
        return this.conversion.preview(root, value);
      }
      case "buildDesignPage": {
        const { workspaceId: _, ...value } = request
          .extend(conversion.shape)
          .extend({ title: z.string().optional(), previewHash: z.string() })
          .strict()
          .parse(input);
        return this.conversion.build(root, value);
      }
      case "reviewDesignPageUpdate": {
        const { workspaceId: _, ...value } = request
          .extend(update.shape)
          .strict()
          .parse(input);
        return this.conversion.reviewUpdate(root, value);
      }
      case "applyDesignPageUpdate": {
        const { workspaceId: _, ...value } = request
          .extend(update.shape)
          .extend({
            expectedPageRevision: revision,
            previewHash: z.string(),
            resolution: resolution.optional(),
          })
          .strict()
          .parse(input);
        return this.conversion.applyUpdate(root, value);
      }
      default:
        throw new Error("Unknown Canvas operation");
    }
  }
}

/** An agent's new layers may name only the fields they set; everything else takes Figma-like defaults. */
function withNewNodeDefaults(
  document: CopyOSDesignDocument,
  changes: unknown,
): unknown {
  if (
    !changes ||
    typeof changes !== "object" ||
    !Array.isArray((changes as { upsertNodes?: unknown }).upsertNodes)
  )
    return changes;
  const existing = new Set(document.nodes.map((node) => node.id));
  const value = changes as { upsertNodes: Record<string, unknown>[] };
  return {
    ...value,
    upsertNodes: value.upsertNodes.map((node) => {
      if (
        !node ||
        typeof node !== "object" ||
        typeof node.id !== "string" ||
        existing.has(node.id) ||
        typeof node.kind !== "string"
      )
        return node;
      const base: Record<string, unknown> = {
        ...designAgentNodeDefaults(node.kind as never),
        parentId: null,
      };
      delete base.strokeVariableId;
      return { ...base, ...node };
    }),
  };
}

function isInside(
  document: CopyOSDesignDocument,
  nodeId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  for (
    let cursor = byId.get(nodeId)?.parentId ?? null;
    cursor;
    cursor = byId.get(cursor)?.parentId ?? null
  )
    if (cursor === ancestorId) return true;
  return false;
}
