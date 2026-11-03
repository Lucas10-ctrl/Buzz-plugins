import { join } from "node:path";
import { z } from "zod";
import { CopyOSDesignRepository } from "../../copyos-domain/src/designs.ts";
import { CopyOSDesignCommentRepository } from "../../copyos-domain/src/design-comments.ts";
import { CopyOSDesignTemplateRepository } from "../../copyos-domain/src/design-templates.ts";
import {
  CopyOSDesignFontStore,
  loadDesignProjectFonts,
} from "../../copyos-domain/src/design-font-store.ts";
import { CopyOSDesignImageStore } from "../../copyos-domain/src/design-image-store.ts";
import { parseDesignImageAssetReference } from "../../copyos-domain/src/design-image-assets.ts";
import { getBundledDesignFontMetadata } from "../../copyos-domain/src/design-font-metadata.ts";
import { CopyOSDesignPageConversion } from "../../copyos-domain/src/design-page-conversion.ts";
import { CopyOSStyleGuideRepository } from "../../copyos-domain/src/style-guide.ts";
import { importFigDesign } from "../../copyos-domain/src/fig-import-service.ts";
import { decodeFigClipboardSelection } from "../../copyos-domain/src/fig-clipboard-service.ts";
import { createDesignRasterizer } from "../../copyos-domain/src/design-raster.ts";
import { loadBundledDesignMeasurementFonts } from "../../copyos-domain/src/design-text-measurement.ts";
import { inspectDesignPage } from "../../copyos-tools/src/design-inspection.ts";
import { CanvasComparables } from "./canvas-comparables.ts";
import { CopyOSAssetRepository } from "../../copyos-domain/src/assets.ts";
import { importDesignClipboard } from "../../copyos-domain/src/design-clipboard.ts";
import { lstat, mkdir, realpath } from "node:fs/promises";
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
    this.templates = new CopyOSDesignTemplateRepository(
      join(root, "design-templates"),
    );
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
          })
          .strict()
          .parse(input);
        const document = await this.designs.get(root, value.designId);
        if (document.revision !== value.expectedRevision)
          throw new Error("Design revision changed; read it again");
        const template = await this.templates.read(value.templateId);
        const roots = document.nodes.filter((node) => node.parentId === null);
        const position = roots.length
          ? {
              x: Math.max(...roots.map((node) => node.x + node.width)) + 80,
              y: Math.min(...roots.map((node) => node.y)),
            }
          : { x: 0, y: 0 };
        const imported = importDesignClipboard(document, template.snapshot, {
          destinationWorkspaceId: workspaceId,
          position,
          ...(value.pageId === undefined ? {} : { pageId: value.pageId }),
        });
        const saved = await this.designs.save(root, imported.document);
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
        const renderer = await createDesignRasterizer([
          ...(await loadBundledDesignMeasurementFonts()),
          ...(await loadDesignProjectFonts(root, document)),
        ]);
        try {
          const { png, ...rendered } = await renderer.render(document, {
            artboardId: artboard.id,
            maxWidth: value.maxWidth,
            maxHeight: 4000,
            region: { top: value.top, height },
            readImage: async (fileName) =>
              (await this.images.read(root, `copyos-asset:${fileName}`)).bytes,
          });
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
              "Original host renderer; substitution notes identify unavailable fonts and images. Browser effects may differ.",
          };
        } finally {
          renderer.dispose();
        }
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
        return this.designs.edit(root, document, value.changes);
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
      case "listDesignTemplates":
        return { templates: await this.templates.list() };
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
        const value = request
          .extend({
            fileName: z.string().max(255),
            dataBase64: z.string().max(13_400_000),
          })
          .strict()
          .parse(input);
        return this.fonts.upload(root, Buffer.from(value.dataBase64, "base64"));
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
          .extend({ dataBase64: z.string().max(28_000_000) })
          .strict()
          .parse(input);
        return {
          url: await this.images.put(
            root,
            Buffer.from(value.dataBase64, "base64"),
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
