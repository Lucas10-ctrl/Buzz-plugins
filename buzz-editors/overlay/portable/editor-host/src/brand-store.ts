import { lstat, mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { CopyOSKnowledgeRepository } from "../../copyos-domain/src/knowledge.ts";
import {
  CopyOSStyleGuideRepository,
  COPYOS_STYLE_GUIDE_FILE,
} from "../../copyos-domain/src/style-guide.ts";

const guideRevision = (guide: unknown) =>
  guide === undefined
    ? null
    : createHash("sha256").update(JSON.stringify(guide)).digest("hex");

export const brandOperations = [
  "listBrands",
  "createBrand",
  "readBrandContext",
  "saveStyleGuide",
] as const;
const base = z.object({ workspaceId: z.string().min(1).max(512) });
const prose = z.string().trim().min(1).max(20_000);

/** Original CopyOS brand files and CSS extraction, scoped by the editor repository. */
export class BrandStore {
  private readonly writes = new Map<string, Promise<unknown>>();
  private readonly knowledge = new CopyOSKnowledgeRepository();
  private readonly guides = new CopyOSStyleGuideRepository();
  constructor(private readonly directory: (id: string) => Promise<string>) {}

  async call(operation: string, input: unknown) {
    const { workspaceId } = base.parse(input);
    if (operation !== "saveStyleGuide")
      return this.perform(operation, input, workspaceId);
    const previous = this.writes.get(workspaceId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.perform(operation, input, workspaceId));
    this.writes.set(workspaceId, next);
    try {
      return await next;
    } finally {
      if (this.writes.get(workspaceId) === next)
        this.writes.delete(workspaceId);
    }
  }

  private async perform(
    operation: string,
    input: unknown,
    workspaceId: string,
  ) {
    const root = await this.directory(workspaceId);
    const brands = join(root, "brand");
    await mkdir(brands, { recursive: true });
    if ((await realpath(brands)) !== brands)
      throw new Error("Brand directory must not be a symbolic link");
    const guideEntry = await lstat(join(root, COPYOS_STYLE_GUIDE_FILE)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (guideEntry?.isSymbolicLink())
      throw new Error("Style guide must not be a symbolic link");
    switch (operation) {
      case "listBrands":
        base.strict().parse(input);
        return this.knowledge.list(root, "brand");
      case "readBrandContext": {
        base.strict().parse(input);
        const guide = await this.guides.get(root);
        return {
          brands: await this.knowledge.list(root, "brand"),
          guide,
          guideRevision: guideRevision(guide),
        };
      }
      case "createBrand": {
        const { workspaceId: _, ...request } = base
          .extend({
            title: z.string().trim().min(1).max(160),
            positioning: prose,
            audience: prose,
            voice: prose,
            differentiators: prose,
            guardrails: z.string().trim().max(20_000),
          })
          .strict()
          .parse(input);
        return this.knowledge.createBrand(root, request);
      }
      case "saveStyleGuide": {
        const {
          workspaceId: _,
          expectedRevision,
          ...request
        } = base
          .extend({
            name: z.string().trim().min(1).max(120),
            css: z.string().min(1).max(1_000_000),
            sourceType: z.enum(["css", "file", "website"]),
            sourceLabel: z.string().trim().min(1).max(2000),
            sourceUrl: z.url().max(4096).optional(),
            expectedRevision: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
          })
          .strict()
          .parse(input);
        const current = await this.guides.get(root);
        if (guideRevision(current) !== expectedRevision)
          throw new Error(
            "The style guide changed. Reload saved settings before replacing it.",
          );
        const { sourceUrl, ...fields } = request;
        const guide = await this.guides.save(root, {
          ...fields,
          ...(sourceUrl === undefined ? {} : { sourceUrl }),
        });
        return { guide, guideRevision: guideRevision(guide) };
      }
      default:
        throw new Error("Unknown brand operation");
    }
  }
}
