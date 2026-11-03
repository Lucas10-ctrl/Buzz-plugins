import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ScopedGenerationRepository } from "./generation-repository.ts";
import {
  CopyOSGenerationService,
  CopyOSGenerationError,
  HiggsfieldProvider,
} from "../../copyos-domain/src/generations.ts";

const credentialRef = "HF_CREDENTIALS";
const workspace = z.string().min(1).max(512);
const scoped = z.object({ workspaceId: workspace });
const identity = scoped.extend({ id: z.string().uuid() });
export const generationOperations = [
  "generationSettings",
  "generationCredentialStatus",
  "setGenerationCredential",
  "startGeneration",
  "listGenerations",
  "cancelGeneration",
  "readGenerationImage",
] as const;

/** Provider keys remain in the repository process and OS store; only status/set are client operations. */
export interface GenerationCredentials {
  status(): Promise<{ configured: boolean; writable: boolean }>;
  read(): Promise<string | undefined>;
  set(value: string): Promise<void>;
}
const reply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: z.string().max(300) }).strict(),
]);
/** Fixed-name, private helper protocol; request secrets never enter argv or diagnostic errors. */
export class NativeGenerationCredentials implements GenerationCredentials {
  constructor(private readonly helper: string) {}
  private run(input: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const process = execFile(
        this.helper,
        [],
        { timeout: 15_000, maxBuffer: 8192, encoding: "utf8" },
        (error, stdout) => {
          if (error) {
            reject(
              new Error(
                "Canvas secure credential helper is unavailable; try again in the desktop lab",
              ),
            );
            return;
          }
          let value: z.infer<typeof reply>;
          try {
            value = reply.parse(JSON.parse(stdout));
          } catch {
            reject(
              new Error(
                "Canvas credential helper returned an invalid response",
              ),
            );
            return;
          }
          if (!value.ok) reject(new Error(value.error));
          else resolve(value.value);
        },
      );
      process.stdin?.on("error", () =>
        reject(new Error("Could not send the Canvas credential request")),
      );
      process.stdin?.end(JSON.stringify(input));
    });
  }
  async status() {
    return z
      .object({ configured: z.boolean(), writable: z.boolean() })
      .strict()
      .parse(await this.run({ operation: "status" }));
  }
  async read(): Promise<string | undefined> {
    const value = await this.run({ operation: "read" });
    return value === null
      ? undefined
      : z.string().min(1).max(4096).parse(value);
  }
  async set(value: string): Promise<void> {
    await this.run({ operation: "set", value });
  }
}

const configSchema = z
  .object({
    baseUrl: z.url().refine((value) => /^https?:\/\//u.test(value)),
    model: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/u),
    pollIntervalMs: z.coerce.number().int().min(250).max(60_000),
    requestTimeoutMs: z.coerce.number().int().min(1000).max(180_000),
  })
  .strict();
export type EditorGenerationOptions = {
  config: z.infer<typeof configSchema>;
  credentials: GenerationCredentials;
  fetch?: typeof globalThis.fetch;
};
/** Resolve deployment settings independently of credentials; no provider key is read from an environment file. */
export function editorGenerationOptions(
  env: NodeJS.ProcessEnv = process.env,
  helper = join(
    dirname(process.execPath),
    process.platform === "win32"
      ? "buzz-editor-credentials.exe"
      : "buzz-editor-credentials",
  ),
): EditorGenerationOptions {
  return {
    config: configSchema.parse({
      baseUrl:
        env.BUZZ_EDITOR_HIGGSFIELD_BASE_URL ?? "https://api.higgsfield.ai",
      model:
        env.BUZZ_EDITOR_HIGGSFIELD_MODEL ?? "higgsfield-ai/soul/v2/standard",
      pollIntervalMs: env.BUZZ_EDITOR_GENERATION_POLL_MS ?? 2000,
      requestTimeoutMs: env.BUZZ_EDITOR_GENERATION_TIMEOUT_MS ?? 30_000,
    }),
    credentials: new NativeGenerationCredentials(helper),
  };
}
/** Original durable generation repository/provider/poller behind the editor's scoped host. */
export class GenerationStore {
  private readonly lifetime = new AbortController();
  private readonly service: CopyOSGenerationService;
  private closed = false;
  constructor(
    private readonly directory: (workspaceId: string) => Promise<string>,
    private readonly options: EditorGenerationOptions,
  ) {
    const fetcher = options.fetch ?? globalThis.fetch;
    this.service = new CopyOSGenerationService({
      provider: new HiggsfieldProvider({
        baseUrl: options.config.baseUrl,
        resolveCredentials: () => options.credentials.read(),
        fetch: async (input, init) => {
          try {
            this.lifetime.signal.throwIfAborted();
            return await fetcher(input, {
              ...init,
              signal: AbortSignal.any([
                this.lifetime.signal,
                AbortSignal.timeout(options.config.requestTimeoutMs),
                ...(init?.signal ? [init.signal] : []),
              ]),
            });
          } catch (error) {
            if (this.lifetime.signal.aborted)
              throw new CopyOSGenerationError(
                "Canvas generation host has closed",
              );
            throw error;
          }
        },
      }),
      repository: new ScopedGenerationRepository(),
      model: options.config.model,
      pollIntervalMs: options.config.pollIntervalMs,
    });
  }
  async call(operation: string, input: unknown): Promise<unknown> {
    if (this.closed) throw new Error("Canvas generation service has closed");
    switch (operation) {
      case "generationSettings":
        z.object({}).strict().parse(input);
        return {
          provider: "higgsfield",
          credentialRef,
          model: this.options.config.model,
        };
      case "generationCredentialStatus":
        z.object({ ref: z.literal(credentialRef) })
          .strict()
          .parse(input);
        return this.options.credentials.status();
      case "setGenerationCredential": {
        const parsed = z
          .object({
            ref: z.literal(credentialRef),
            value: z
              .string()
              .min(1)
              .max(4096)
              .regex(/^[^:\s]+:[^:\s]+$/u),
          })
          .strict()
          .safeParse(input);
        if (!parsed.success)
          throw new Error("Enter a Higgsfield KEY_ID:KEY_SECRET credential");
        await this.options.credentials.set(parsed.data.value);
        return null;
      }
      case "startGeneration": {
        const value = scoped
          .extend({
            prompt: z.string().trim().min(1).max(4000),
            aspectRatio: z.enum([
              "1:1",
              "4:3",
              "3:4",
              "16:9",
              "9:16",
              "3:2",
              "2:3",
            ]),
            resolution: z.enum(["720p", "1080p"]),
          })
          .strict()
          .parse(input);
        return this.service.start(
          await this.directory(value.workspaceId),
          value,
        );
      }
      case "listGenerations": {
        const value = scoped.strict().parse(input);
        return this.service.list(await this.directory(value.workspaceId));
      }
      case "cancelGeneration": {
        const value = identity.strict().parse(input);
        return this.service.cancel(
          await this.directory(value.workspaceId),
          value.id,
        );
      }
      case "readGenerationImage": {
        const value = identity
          .extend({ index: z.number().int().min(0).max(3) })
          .strict()
          .parse(input);
        return this.service.readImage(
          await this.directory(value.workspaceId),
          value.id,
          value.index,
        );
      }
      default:
        throw new Error("Unknown Canvas generation operation");
    }
  }
  async dispose(): Promise<void> {
    this.closed = true;
    const stopped = this.service.dispose();
    this.lifetime.abort();
    await stopped;
  }
}
