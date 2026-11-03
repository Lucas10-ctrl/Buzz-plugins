import { mkdir, readFile, realpath, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { managePage } from "../../copyos-domain/src/page-management.ts";
import { CopyOSPageRepository } from "../../copyos-domain/src/pages.ts";
import { CopyOSReusableSectionRepository } from "../../copyos-domain/src/reusable-sections.ts";
import { CanvasStore } from "./canvas-store.ts";
import { DocsStore, docsOperations } from "./docs-store.ts";
import { pageWorkflowSchema, preparePageWorkflow } from "./page-workflows.ts";
import { validateShopifyExport } from "./shopify-validation.ts";
import { readPageAsset } from "./page-assets.ts";
import { checkMediaSupport } from "./media-support.ts";
import { validatePageFolder } from "./page-folder.ts";
import { exportStandalonePage } from "./page-export.ts";
import { exportProjectPage } from "./page-project-export.ts";
import {
  generationOperations,
  type EditorGenerationOptions,
} from "./generation-store.ts";

import { BrandStore, brandOperations } from "./brand-store.ts";

const identity = z.string().uuid();
const revision = z.number().int().nonnegative();
const workspace = z.string().min(1).max(512);
const page = z.object({ workspaceId: workspace, pageId: identity });
const edit = page.extend({ expectedRevision: revision.optional() });
const section = edit.extend({ sectionId: identity });
const variant = section.extend({ variantId: identity });
const html = z.string().min(1).max(8_000_000);
const text = z.string().min(1).max(160);
const template = z.enum([
  "hero-centered",
  "hero-split",
  "hero-editorial",
  "proof-bar",
  "proof-metrics",
  "benefit-grid",
  "benefit-steps",
  "testimonial",
  "testimonial-pair",
  "comparison",
  "pricing",
  "faq",
  "cta-banner",
  "cta-proof",
  "custom-html",
]);
const envelope = z.object({ operation: z.string(), input: z.unknown() });

/** Original page repositories with a private Buzz-owned root; no application or agent runtime. */
export class EditorRepository {
  private readonly pages = new CopyOSPageRepository();
  private readonly sections: CopyOSReusableSectionRepository;
  private readonly canvas: CanvasStore;
  private readonly docs: DocsStore;
  private readonly brands: BrandStore;
  constructor(
    private readonly root: string,
    generation?: EditorGenerationOptions,
  ) {
    this.sections = new CopyOSReusableSectionRepository(
      join(root, "section-library"),
    );
    this.canvas = new CanvasStore(root, (id) => this.directory(id), generation);
    this.docs = new DocsStore((id) => this.directory(id));
    this.brands = new BrandStore((id) => this.directory(id));
  }
  async dispose(): Promise<void> {
    await this.canvas.dispose();
  }
  private async directory(workspaceId: string) {
    const id = createHash("sha256").update(workspaceId).digest("hex");
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root);
    const parent = join(root, "workspaces");
    await mkdir(parent, { recursive: true });
    if ((await realpath(parent)) !== parent)
      throw new Error("Editor workspace parent must not be a symbolic link");
    const path = join(parent, id);
    await mkdir(path, { recursive: true });
    if ((await realpath(path)) !== path)
      throw new Error("Editor workspace must not be a symbolic link");
    const exportsEntry = await lstat(join(path, "exports")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (exportsEntry?.isSymbolicLink())
      throw new Error("Editor exports must not be a symbolic link");
    return path;
  }
  async call(request: unknown): Promise<unknown> {
    const { operation, input } = envelope.parse(request);
    if (brandOperations.some((item) => item === operation))
      return this.brands.call(operation, input);
    switch (operation) {
      case "checkMediaSupport": {
        z.null().parse(input);
        return checkMediaSupport();
      }
      case "getPageWorkspace": {
        const value = z
          .object({ workspaceId: workspace })
          .strict()
          .parse(input);
        return { projectRoot: await this.directory(value.workspaceId) };
      }
      case "validatePageFolder": {
        const value = z
          .object({ workspaceId: workspace, path: z.string().min(1).max(4096) })
          .strict()
          .parse(input);
        return validatePageFolder(
          await this.directory(value.workspaceId),
          value.path,
        );
      }
      case "readPageAsset": {
        const value = z
          .object({
            workspaceId: workspace,
            path: z.string().min(1).max(4096),
            knownVersion: z.string().max(256).optional(),
          })
          .strict()
          .parse(input);
        return readPageAsset(
          await this.directory(value.workspaceId),
          value.path,
          value.knownVersion,
          join(this.root, "section-library"),
        );
      }
      case "validateShopifyExport": {
        const value = z
          .object({
            workspaceId: workspace,
            directory: z.string().min(1),
            mode: z.enum(["page", "section"]).optional().default("page"),
            offset: z.number().int().nonnegative().optional().default(0),
            limit: z.number().int().min(1).max(100).optional().default(50),
          })
          .strict()
          .parse(input);
        return validateShopifyExport(
          await this.directory(value.workspaceId),
          value.directory,
          value.mode,
          value.offset,
          value.limit,
        );
      }
      case "preparePageWorkflow": {
        const value = z
          .object({ workspaceId: workspace, workflow: pageWorkflowSchema })
          .strict()
          .parse(input);
        return preparePageWorkflow(
          await this.directory(value.workspaceId),
          value.workflow,
        );
      }
      case "listPages": {
        const id = workspace.parse(input);
        return this.pages.list(await this.directory(id));
      }
      case "readPage": {
        const value = page.strict().parse(input);
        return this.pages.get(
          await this.directory(value.workspaceId),
          value.pageId,
        );
      }
      case "clonePage":
      case "deletePage":
      case "restorePage": {
        const value = page
          .extend({ expectedRevision: revision })
          .strict()
          .parse(input);
        return managePage(
          await this.directory(value.workspaceId),
          value,
          operation === "clonePage"
            ? "clone"
            : operation === "deletePage"
              ? "delete"
              : "restore",
        );
      }
      case "createPage": {
        const value = z
          .object({
            workspaceId: workspace,
            title: text,
            slug: z.string().optional(),
          })
          .strict()
          .parse(input);
        return this.pages.create(await this.directory(value.workspaceId), {
          title: value.title,
          ...(value.slug === undefined ? {} : { slug: value.slug }),
        });
      }
      case "addPageSection": {
        const value = edit
          .extend({
            title: text,
            templateId: template,
            label: text,
            html,
            toIndex: z.number().int().nonnegative().optional(),
          })
          .strict()
          .parse(input);
        const { toIndex, ...fields } = value;
        return this.pages.addSection(await this.directory(value.workspaceId), {
          ...fields,
          ...(toIndex === undefined ? {} : { toIndex }),
        });
      }
      case "addPageSectionVariant": {
        const value = section
          .extend({ label: text, html })
          .strict()
          .parse(input);
        return this.pages.addVariant(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "selectPageSectionVariant": {
        const value = variant.strict().parse(input);
        return this.pages.selectVariant(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "updatePageSectionVariant": {
        const value = variant.extend({ html }).strict().parse(input);
        return this.pages.updateVariant(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "updatePageSectionVariants": {
        const value = page
          .extend({
            expectedRevision: revision,
            changes: z
              .array(
                z
                  .object({ sectionId: identity, variantId: identity, html })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict()
          .parse(input);
        return this.pages.updateVariants(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "renamePageSection": {
        const value = section.extend({ title: text }).strict().parse(input);
        return this.pages.renameSection(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "deletePageSection": {
        const value = section.strict().parse(input);
        return this.pages.deleteSection(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "movePageSection": {
        const value = section
          .extend({ toIndex: z.number().int().nonnegative() })
          .strict()
          .parse(input);
        return this.pages.moveSection(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "addPageComment": {
        const value = variant
          .extend({
            elementId: z.string().optional(),
            elementIndex: z.number().int().nonnegative(),
            elementLabel: text,
            body: z.string().min(1).max(4000),
          })
          .strict()
          .parse(input);
        return this.pages.addComment(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "setPageCommentStatus": {
        const value = edit
          .extend({ commentId: identity, status: z.enum(["open", "resolved"]) })
          .strict()
          .parse(input);
        return this.pages.setCommentStatus(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "listReusableSections": {
        const id = workspace.parse(input);
        return this.sections.listShared([await this.directory(id)]);
      }
      case "saveReusableSection": {
        const value = z
          .object({
            workspaceId: workspace,
            title: text,
            category: text,
            description: z.string().max(1000),
            html,
          })
          .strict()
          .parse(input);
        const { workspaceId, ...fields } = value;
        return this.sections.saveShared(
          await this.directory(workspaceId),
          fields,
        );
      }
      case "moveReusableSection": {
        const value = z
          .object({
            workspaceId: workspace,
            sectionId: identity,
            category: text,
          })
          .strict()
          .parse(input);
        return this.sections.moveShared(value.sectionId, value.category, [
          await this.directory(value.workspaceId),
        ]);
      }
      case "deleteReusableSection": {
        const value = z
          .object({
            workspaceId: workspace,
            sectionId: identity,
            confirmDelete: z.literal(true),
          })
          .strict()
          .parse(input);
        return this.sections.deleteShared(value.sectionId, true, [
          await this.directory(value.workspaceId),
        ]);
      }
      case "exportPage": {
        const value = page
          .extend({
            format: z
              .enum(["html", "json", "copy", "shopify", "vercel"])
              .optional(),
          })
          .strict()
          .parse(input);
        const root = await this.directory(value.workspaceId);
        const path =
          value.format === "json"
            ? await this.pages.exportJson(root, value.pageId)
            : value.format === "copy"
              ? await this.pages.exportCopy(root, value.pageId)
              : value.format === "shopify" || value.format === "vercel"
                ? await exportProjectPage(
                    root,
                    await this.pages.get(root, value.pageId),
                    value.format,
                    join(this.root, "section-library"),
                  )
                : await exportStandalonePage(
                    root,
                    await this.pages.get(root, value.pageId),
                    join(this.root, "section-library"),
                  );
        return { path };
      }
      case "readExport": {
        const value = z
          .object({ workspaceId: workspace, path: z.string() })
          .strict()
          .parse(input);
        const root = await this.directory(value.workspaceId);
        const path = await realpath(resolve(value.path));
        const child = relative(await realpath(join(root, "exports")), path);
        if (
          isAbsolute(child) ||
          child === ".." ||
          child.startsWith("../") ||
          child.startsWith("..\\")
        )
          throw new Error("Export is outside this workspace");
        return {
          name: path.split(/[\\/]/).pop(),
          content: await readFile(path, "base64"),
        };
      }
      default:
        if (generationOperations.some((value) => value === operation))
          return this.canvas.call(operation, input);
        if (docsOperations.has(operation))
          return this.docs.call(operation, input);
        if (
          /^(?:list|read|view|inspect|create|save|edit|import|decode|preview|build|review|apply|add|set|delete|install|upload|put|copy|find|remove|get)Design/.test(
            operation,
          ) ||
          operation === "getStyleGuide" ||
          [
            "listCanvasWorkspaces",
            "listComparableDesigns",
            "listCopyAssets",
            "readCopyAsset",
            "createCopyAsset",
            "copyComparableImages",
            "insertDesignTemplate",
          ].includes(operation)
        )
          return this.canvas.call(operation, input);
        throw new Error("Unknown editor operation");
    }
  }
}
