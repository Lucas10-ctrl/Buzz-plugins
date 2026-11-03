import { expect, it, vi } from "vitest";
import type {
  HostProcess,
  HostProcessOptions,
} from "../../../features/host/service";
import { DesktopEditorStore } from "./desktop-store";

function fixture() {
  let output: HostProcessOptions | undefined;
  let exit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => {
    exit = resolve;
  });
  const process: HostProcess = {
    write: vi.fn(async () => {}),
    end: vi.fn(async () => {
      exit(0);
    }),
    kill: vi.fn(async () => {
      exit(null);
    }),
    exited,
  };
  const spawn = vi.fn(async (_id: string, options?: HostProcessOptions) => {
    output = options;
    return process;
  });
  const store = new DesktopEditorStore({ spawn });
  const send = (value: unknown) =>
    output?.onStdout?.(`${JSON.stringify(value)}\n`);
  return {
    store,
    spawn,
    process,
    send,
    exit,
    get output() {
      return output;
    },
  };
}

it("shares one owned worker and handles responses split across native stream events", async () => {
  const host = fixture();
  const first = host.store.call("listPages", "workspace");
  const second = host.store.call("listDesigns", { workspaceId: "workspace" });
  expect(host.spawn).toHaveBeenCalledTimes(1);
  host.send({ type: "ready", version: 1 });
  await vi.waitFor(() => expect(host.process.write).toHaveBeenCalledTimes(2));
  host.output?.onStdout?.('{"type":"result","id":2,"ok":true,"val');
  host.output?.onStdout?.(
    'ue":["canvas"]}\n{"type":"result","id":1,"ok":true,"value":["page"]}\n',
  );
  expect(await first).toEqual(["page"]);
  expect(await second).toEqual(["canvas"]);
  await host.store.dispose();
  expect(host.process.end).toHaveBeenCalledTimes(1);
});

it("does not replay an uncertain mutation after the worker exits", async () => {
  const host = fixture();
  const save = host.store.call("createPage", {
    workspaceId: "workspace",
    title: "Only once",
  });
  const rejection = expect(save).rejects.toThrow("Inspect saved work");
  host.send({ type: "ready", version: 1 });
  await vi.waitFor(() => expect(host.process.write).toHaveBeenCalledTimes(1));
  host.exit(1);
  await rejection;
  expect(host.spawn).toHaveBeenCalledTimes(1);
  expect(host.process.write).toHaveBeenCalledTimes(1);
  await host.store.dispose();
});

it("fails startup on an incompatible protocol and closes the process", async () => {
  const host = fixture();
  const request = host.store.call("listPages", "workspace");
  const rejection = expect(request).rejects.toThrow("invalid protocol");
  host.send({ type: "ready", version: 99 });
  await rejection;
  expect(host.process.kill).toHaveBeenCalled();
  await host.store.dispose();
});
