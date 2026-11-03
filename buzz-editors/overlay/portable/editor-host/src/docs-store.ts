import { z } from "zod";
import { CopyOSDocRepository } from "../../copyos-domain/src/docs.ts";
import { actionSchema } from "../../copyos-domain/src/docs-comments.ts";

// Zod's optional fields may contain undefined; repository requests distinguish absence from that value.
type Defined<T> = T extends readonly (infer Item)[]
  ? Defined<Item>[]
  : T extends object
    ? { [Key in keyof T]: Defined<Exclude<T[Key], undefined>> }
    : T;
function defined<T>(value: T): Defined<T> {
  const cleaned = Array.isArray(value)
    ? value.map((item) => defined(item))
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, field]) => field !== undefined)
            .map(([key, field]) => [key, defined(field)]),
        )
      : value;
  // The recursive copy above retains every defined field and removes undefined fields.
  return cleaned as Defined<T>;
}

const uuid = z.string().uuid();
const workspace = z.string().min(1).max(512);
const request = z.object({ workspaceId: workspace });
const document = request.extend({
  docId: uuid,
  token: z.string().max(1000).optional(),
});
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(200_000);
const anchor = z
  .object({ start: z.string().max(4000), end: z.string().max(4000) })
  .strict();
const session = z.string().min(1).max(200);
export const docsOperations = new Set([
  "listDocs",
  "readDoc",
  "createDoc",
  "syncDoc",
  "controlDoc",
  "shareDoc",
  "exportDoc",
  "reviewDocSuggestion",
  "presenceDoc",
  "importDoc",
  "putDocAsset",
  "readDocAsset",
  "commentDoc",
  "listDocHistory",
  "readDocHistory",
  "nameDocVersion",
  "restoreDocVersion",
  "duplicateDoc",
  "trashDoc",
  "suggestDoc",
  "applyDocEdit",
  "outlineDoc",
  "writeDoc",
  "createDocTab",
  "appendDocSections",
  "replyDocComment",
]);

/** Original rich document, review, presence and history operations under the Buzz workspace store. */
export class DocsStore {
  private readonly docs = new CopyOSDocRepository();
  constructor(
    private readonly directory: (workspaceId: string) => Promise<string>,
  ) {}
  async call(operation: string, input: unknown): Promise<unknown> {
    const { workspaceId } = defined(request.parse(input));
    const root = await this.directory(workspaceId);
    switch (operation) {
      case "listDocs":
        return this.docs.list(
          root,
          defined(
            request
              .extend({ trashed: z.boolean().optional() })
              .strict()
              .parse(input),
          ).trashed,
        );
      case "readDoc":
        return this.docs.get(root, defined(document.strict().parse(input)));
      case "createDoc":
        return this.docs.create(
          root,
          defined(
            request
              .extend({
                title: z.string().max(200),
                sections: z.array(z.string().max(200)).max(100),
                sessionId: session.optional(),
              })
              .strict()
              .parse(input),
          ),
        );
      case "importDoc":
        return this.docs.import(
          root,
          defined(
            request
              .extend({
                name: z.string().min(1).max(255),
                dataBase64: z.string().max(8_000_000),
              })
              .strict()
              .parse(input),
          ),
        );
      case "putDocAsset":
        return this.docs.putAsset(
          root,
          defined(
            document
              .extend({
                name: z.string().min(1).max(255),
                dataBase64: z.string().max(24_000_000),
              })
              .strict()
              .parse(input),
          ),
        );
      case "readDocAsset":
        return this.docs.readAsset(
          root,
          defined(
            document.extend({ assetId: z.string() }).strict().parse(input),
          ),
        );
      case "syncDoc":
        return this.docs.sync(
          root,
          defined(
            document
              .extend({
                update: z.string().max(8_000_000),
                contentVersion: z.literal(2),
              })
              .strict()
              .parse(input),
          ),
        );
      case "controlDoc":
        return this.docs.control(
          root,
          defined(
            document.extend({ stopped: z.boolean() }).strict().parse(input),
          ),
        );
      case "shareDoc":
        return this.docs.share(
          root,
          defined(
            document
              .extend({
                role: z.enum(["restricted", "viewer", "commenter", "editor"]),
              })
              .strict()
              .parse(input),
          ),
        );
      case "exportDoc":
        return this.docs.export(
          root,
          defined(
            document
              .extend({ format: z.enum(["markdown", "pdf", "word"]) })
              .strict()
              .parse(input),
          ),
        );
      case "reviewDocSuggestion":
        return this.docs.review(
          root,
          defined(
            document
              .extend({
                suggestionId: uuid,
                decision: z.enum(["accept", "reject"]),
                replacement: text.optional(),
              })
              .strict()
              .parse(input),
          ),
        );
      case "presenceDoc": {
        const { workspaceId: _, ...value } = defined(
          document
            .extend({
              peerId: uuid,
              state: z
                .object({
                  tabId: uuid,
                  cursor: z
                    .object({ blockId: uuid, anchor })
                    .strict()
                    .optional(),
                })
                .strict()
                .nullable(),
            })
            .strict()
            .parse(input),
        );
        return this.docs.presence(root, value);
      }
      case "commentDoc":
        return this.docs.comment(
          root,
          defined(
            document.extend({ action: actionSchema }).strict().parse(input),
          ),
        );
      case "listDocHistory":
        return this.docs.listHistory(
          root,
          defined(
            document
              .extend({ before: revision.optional() })
              .strict()
              .parse(input),
          ),
        );
      case "readDocHistory":
        return this.docs.readHistory(
          root,
          defined(document.extend({ revision }).strict().parse(input)),
        );
      case "nameDocVersion":
        return this.docs.nameHistory(
          root,
          defined(
            document
              .extend({ revision, name: z.string().max(200) })
              .strict()
              .parse(input),
          ),
        );
      case "restoreDocVersion":
        return this.docs.restore(
          root,
          defined(
            document
              .extend({ revision, expectedRevision: revision })
              .strict()
              .parse(input),
          ),
        );
      case "duplicateDoc":
        return this.docs.duplicate(
          root,
          defined(
            document
              .extend({ title: z.string().max(200) })
              .strict()
              .parse(input),
          ),
        );
      case "trashDoc":
        return this.docs.trash(
          root,
          defined(
            document.extend({ trashed: z.boolean() }).strict().parse(input),
          ),
        );
      case "suggestDoc":
        return this.docs.suggest(
          root,
          defined(
            document
              .extend({
                expectedEpoch: revision,
                expectedTabId: uuid.optional(),
                blockId: uuid,
                before: text,
                after: text,
                note: z.string().max(2000),
                start: revision.optional(),
                threadId: uuid.optional(),
                commentRequestId: uuid.optional(),
              })
              .strict()
              .parse(input),
          ),
        );
      case "applyDocEdit":
        return this.docs.applyEdit(
          root,
          defined(
            request
              .extend({
                docId: uuid,
                blockId: uuid,
                epoch: revision,
                sessionId: session,
                before: text,
                after: text,
                start: revision.optional(),
                tabId: uuid.optional(),
              })
              .strict()
              .parse(input),
          ),
        );
      case "outlineDoc":
        return this.docs.outline(
          root,
          defined(
            request
              .extend({
                docId: uuid,
                blockId: uuid,
                epoch: revision,
                sections: z.array(z.string().min(1).max(200)).min(1).max(100),
                sessionId: session,
                title: z
                  .object({
                    before: z.string().max(200),
                    after: z.string().min(1).max(200),
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .parse(input),
          ),
        );
      case "writeDoc":
        return this.docs.write(
          root,
          defined(
            request
              .extend({
                docId: uuid,
                blockId: uuid,
                epoch: revision,
                content: text,
                done: z.boolean(),
                failed: z.boolean().optional(),
              })
              .strict()
              .parse(input),
          ),
        );
      case "createDocTab":
        return this.docs.createTab(
          root,
          defined(
            document
              .extend({
                title: z.string().max(200),
                sections: z.array(z.string().max(200)).max(100),
                epoch: revision,
              })
              .strict()
              .parse(input),
          ),
        );
      case "appendDocSections":
        return this.docs.appendSections(
          root,
          defined(
            request
              .extend({
                docId: uuid,
                epoch: revision,
                sections: z.array(z.string().min(1).max(200)).min(1).max(100),
                sessionId: session,
              })
              .strict()
              .parse(input),
          ),
        );
      case "replyDocComment":
        return this.docs.replyComment(
          root,
          defined(
            request
              .extend({
                docId: uuid,
                threadId: uuid,
                requestId: uuid,
                text: z.string().min(1).max(5000),
                sessionId: session,
              })
              .strict()
              .parse(input),
          ),
        );
      default:
        throw new Error("Unknown Docs operation");
    }
  }
}
