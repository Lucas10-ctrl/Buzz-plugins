import {
  mkdtemp,
  rm,
  writeFile,
  chmod,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorRepository } from "../../portable/editor-host/src/store.ts";
import {
  editorGenerationOptions,
  NativeGenerationCredentials,
} from "../../portable/editor-host/src/generation-store.ts";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVIAAAAASUVORK5CYII=",
  "base64",
);
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let root, store, options, fixture;
const call = (operation, input = {}) => store.call({ operation, input });
const scoped = (operation, input = {}, workspaceId = "generation-target") =>
  call(operation, { workspaceId, ...input });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-generation-"));
  const gate = deferred(),
    started = deferred();
  fixture = {
    gate,
    started,
    key: "unit:key",
    denied: false,
    status: "completed",
    submissions: 0,
    cancels: 0,
    failure: false,
  };
  options = {
    ...editorGenerationOptions({}),
    config: {
      baseUrl: "https://generation.example",
      model: "higgsfield-ai/soul/v2/standard",
      pollIntervalMs: 250,
      requestTimeoutMs: 1000,
    },
    credentials: {
      status: async () => {
        if (fixture.denied) throw new Error("Credential access denied");
        return { configured: fixture.key !== undefined, writable: true };
      },
      read: async () => {
        if (fixture.denied) throw new Error("Credential access denied");
        return fixture.key;
      },
      set: async (value) => {
        if (fixture.denied) throw new Error("Credential access denied");
        fixture.key = value;
      },
    },
    fetch: async (input, init = {}) => {
      const url = new URL(input);
      if (url.hostname === "images.example") {
        expect(init.headers?.Authorization).toBeUndefined();
        return new Response(png, { headers: { "content-type": "image/png" } });
      }
      expect(init.headers.Authorization).toBe(`Key ${fixture.key}`);
      if (url.pathname === "/higgsfield-ai/soul/v2/standard") {
        fixture.submissions++;
        if (fixture.failure) throw new Error("Submission connection lost");
        return json({ request_id: "provider-request" });
      }
      if (url.pathname.endsWith("/cancel")) {
        fixture.cancels++;
        fixture.status = "canceled";
        gate.resolve();
        return json({});
      }
      if (url.pathname.endsWith("/status")) {
        started.resolve();
        await Promise.race([
          gate.promise,
          new Promise((_, reject) =>
            init.signal.addEventListener(
              "abort",
              () => reject(new Error("Stopped")),
              { once: true },
            ),
          ),
        ]);
        return json({
          status: fixture.status,
          ...(fixture.status === "completed"
            ? { images: [{ url: "https://images.example/result.png" }] }
            : {}),
        });
      }
      throw new Error("Unexpected fixture request");
    },
  };
  store = new EditorRepository(root, options);
});
afterEach(async () => {
  await store.dispose();
  await rm(root, { recursive: true, force: true });
});
const start = () =>
  scoped("startGeneration", {
    prompt: "A simple product scene",
    aspectRatio: "1:1",
    resolution: "720p",
  });

it("uses original generation records/results across reopen without changing the manual design", async () => {
  const manual = await scoped("createDesign", { title: "Manual work remains" });
  const settings = await call("generationSettings");
  const status = await call("generationCredentialStatus", {
    ref: settings.credentialRef,
  });
  const record = await start();
  expect(record.status).toBe("queued");
  expect(JSON.stringify([settings, status, record])).not.toContain("unit:key");
  await fixture.started.promise;
  fixture.gate.resolve();
  await vi.waitFor(async () =>
    expect((await scoped("listGenerations"))[0].status).toBe("completed"),
  );
  const image = await scoped("readGenerationImage", {
    id: record.id,
    index: 0,
  });
  expect(image.dataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
  expect(await scoped("readDesign", { designId: manual.id })).toEqual(manual);
  await expect(
    scoped(
      "readGenerationImage",
      { id: record.id, index: 0 },
      "other-workspace",
    ),
  ).rejects.toThrow("Unknown generation");
  await store.dispose();
  store = new EditorRepository(root, options);
  expect((await scoped("listGenerations"))[0].status).toBe("completed");
  expect(
    (await scoped("readGenerationImage", { id: record.id, index: 0 })).dataUrl,
  ).toBe(image.dataUrl);
  expect(fixture.submissions).toBe(1);
});

it("keeps credential errors and rejected secret input from submitting a billable request", async () => {
  fixture.key = undefined;
  await expect(start()).rejects.toThrow("not configured");
  fixture.denied = true;
  await expect(start()).rejects.toThrow("Credential access denied");
  await expect(
    call("setGenerationCredential", {
      ref: "HF_CREDENTIALS",
      value: "new:key",
    }),
  ).rejects.toThrow("Credential access denied");
  fixture.denied = false;
  await expect(
    call("setGenerationCredential", { ref: "other", value: "private-input" }),
  ).rejects.toThrow("Enter a Higgsfield");
  expect(await scoped("listGenerations")).toEqual([]);
  expect(fixture.submissions).toBe(0);
  await call("setGenerationCredential", {
    ref: "HF_CREDENTIALS",
    value: "new:key",
  });
  expect(
    await call("generationCredentialStatus", { ref: "HF_CREDENTIALS" }),
  ).toEqual({ configured: true, writable: true });
});

it("persists an unconfirmed submission as failed and never resubmits it on listing or reopening", async () => {
  fixture.failure = true;
  const record = await start();
  expect(record.status).toBe("failed");
  expect(record.error).toContain("did not confirm");
  await store.dispose();
  store = new EditorRepository(root, options);
  expect((await scoped("listGenerations"))[0].status).toBe("failed");
  expect(fixture.submissions).toBe(1);
});

it("uses provider-confirmed cancellation and keeps the original request history", async () => {
  const record = await start();
  await fixture.started.promise;
  const canceled = await scoped("cancelGeneration", { id: record.id });
  expect(canceled.cancelRequested).toBe(true);
  await vi.waitFor(async () =>
    expect((await scoped("listGenerations"))[0].status).toBe("canceled"),
  );
  expect(fixture.cancels).toBe(1);
  expect(fixture.submissions).toBe(1);
});

it("stops an active poll on disposal and resumes its saved request without another submission", async () => {
  await start();
  await fixture.started.promise;
  await store.dispose();
  await expect(scoped("listGenerations")).rejects.toThrow("has closed");
  store = new EditorRepository(root, options);
  fixture.gate.resolve();
  await vi.waitFor(async () =>
    expect((await scoped("listGenerations"))[0].status).toBe("completed"),
  );
  expect(fixture.submissions).toBe(1);
});

it("rejects redirected generation storage before contacting the provider", async () => {
  const { projectRoot } = await scoped("getPageWorkspace");
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(projectRoot, ".copyos"));
  await expect(start()).rejects.toThrow("symbolic links");
  expect(fixture.submissions).toBe(0);
});

it.runIf(process.platform !== "win32")(
  "keeps helper requests off argv and sanitizes malformed output and stderr",
  async () => {
    const path = join(root, "credential-helper");
    await writeFile(
      path,
      `#!${process.execPath}\nlet input='';for await(const chunk of process.stdin)input+=chunk;if(process.argv.length!==2)process.exit(2);const request=JSON.parse(input);process.stdout.write(JSON.stringify({ok:true,value:request.operation==='status'?{configured:true,writable:true}:request.operation==='read'?'unit:key':null}));\n`,
    );
    await chmod(path, 0o755);
    const credentials = new NativeGenerationCredentials(path);
    await credentials.set("unit:key");
    expect(await credentials.status()).toEqual({
      configured: true,
      writable: true,
    });
    expect(await credentials.read()).toBe("unit:key");
    await writeFile(
      path,
      `#!${process.execPath}\nprocess.stdout.write('unit:key invalid-json');process.stderr.write('unit:key');\n`,
    );
    await expect(credentials.status()).rejects.toThrow("invalid response");
  },
);
