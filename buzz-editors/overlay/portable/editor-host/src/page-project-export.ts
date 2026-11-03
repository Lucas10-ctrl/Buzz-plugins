import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
  readdir,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CopyOSPageRepository,
  standaloneHtml,
} from "../../copyos-domain/src/pages.ts";
import { designImageAssetFiles } from "../../copyos-domain/src/design-image-assets.ts";
import type { CopyOSPageDocument } from "../../copyos-domain/src/types.ts";
import { embedPageResources, pageResourceContext } from "./page-export.ts";
import { PAGE_ASSET_MAX_BYTES, readPageAsset } from "./page-assets.ts";

/** The original formatters read prepared in-memory HTML, which is not a new persisted page. */
class SnapshotPageExports extends CopyOSPageRepository {
  constructor(private readonly preparedPage: CopyOSPageDocument) {
    super();
  }
  override async get(): Promise<CopyOSPageDocument> {
    return this.preparedPage;
  }
}

/** Keep each exported file readable through the existing host API; folders have no aggregate file-size limit. */
async function checkBundleFiles(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Export bundles must not use symbolic links");
    if (entry.isDirectory()) await checkBundleFiles(path);
    else if (!entry.isFile())
      throw new Error("Export bundle contains a non-file resource");
    else if ((await lstat(path)).size > PAGE_ASSET_MAX_BYTES)
      throw new Error("Export file exceeds the host’s 50 MB file limit");
  }
}

/** Run the original project exporter against one prepared snapshot without changing the saved page.
 * @param workspaceRoot - Canonical repository-owned workspace; local resources are resolved only here.
 * @param page - Validated saved page snapshot; only selected variants are rendered/prepared.
 * @param format - Original Vercel static folder or Shopify theme folder.
 * @param sectionLibraryRoot - Optional canonical shared library for imported section resources.
 * @returns A complete original-format folder in a newly published export snapshot; earlier exports remain untouched.
 */
export async function exportProjectPage(
  workspaceRoot: string,
  page: CopyOSPageDocument,
  format: "vercel" | "shopify",
  sectionLibraryRoot?: string,
): Promise<string> {
  const exports = join(workspaceRoot, "exports");
  await mkdir(exports, { recursive: true });
  if ((await realpath(exports)) !== exports)
    throw new Error("Editor exports must not use symbolic links");
  const temporary = await mkdtemp(join(exports, ".buzz-project-"));
  try {
    const staging = join(temporary, "workspace");
    const context = pageResourceContext(standaloneHtml(page));
    const sections = [];
    let preparedBytes = 0;
    for (const section of page.sections) {
      const variants = [];
      for (const variant of section.variants.filter(
        (variant) => variant.id === section.selectedVariantId,
      )) {
        const html = await embedPageResources(workspaceRoot, variant.html, {
          preserveDesignImages: true,
          context,
          sectionLibraryRoot,
        });
        preparedBytes += Buffer.byteLength(html);
        if (format === "vercel" && preparedBytes > PAGE_ASSET_MAX_BYTES)
          throw new Error("Project export exceeds the host’s 50 MB file limit");
        variants.push({ ...variant, html });
      }
      sections.push({ ...section, variants });
    }
    const snapshot = { ...page, sections };
    const selectedHtml = sections
      .map(
        (section) =>
          section.variants.find(
            (variant) => variant.id === section.selectedVariantId,
          )?.html ?? "",
      )
      .join("\n");
    const images = designImageAssetFiles(selectedHtml);
    if (images.length)
      await mkdir(join(staging, "assets/images"), { recursive: true });
    for (const fileName of images) {
      const asset = await readPageAsset(
        workspaceRoot,
        `assets/images/${fileName}`,
      );
      if (asset.unchanged) throw new Error("Export requires image bytes");
      await writeFile(
        join(staging, "assets/images", fileName),
        Buffer.from(asset.dataBase64, "base64"),
        { mode: 0o600 },
      );
    }
    const repository = new SnapshotPageExports(snapshot);
    const rendered =
      format === "vercel"
        ? await repository.exportVercel(staging, page.id)
        : await repository.exportShopify(staging, page.id);
    await checkBundleFiles(rendered);
    const publish = join(temporary, "publish");
    await mkdir(publish);
    const name = `${page.slug}-${format}`;
    await rename(rendered, join(publish, name));
    // Only the original exported files are published, never source pages or their comments/history.
    await rm(staging, { recursive: true, force: true });
    const destination = join(exports, `${name}-${randomUUID()}`);
    await rename(publish, destination);
    return join(destination, name);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
