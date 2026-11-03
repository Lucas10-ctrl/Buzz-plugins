import { beforeEach, expect, it, vi } from "vitest";
const probe = vi.hoisted(() => ({ inspect: vi.fn(), release: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: probe.inspect }));
vi.mock("node:fs", () => ({ readFileSync: probe.release }));
import { checkMediaSupport } from "../../portable/editor-host/src/media-support.ts";

beforeEach(() => {
  probe.inspect.mockReset();
  probe.release.mockReset().mockReturnValue("ID=arch\n");
});
it("accepts installed media factories without running a package manager", () => {
  expect(checkMediaSupport()).toEqual({ available: true, instruction: "" });
  expect(probe.inspect.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ["/usr/bin/gst-inspect-1.0", ["autoaudiosink"]],
  ]);
});
it("reports missing factories with Arch installation instructions", () => {
  probe.inspect.mockImplementation(() => {
    throw new Error("No such element");
  });
  expect(checkMediaSupport()).toEqual({
    available: false,
    instruction: expect.stringContaining(
      "sudo pacman -S --needed gst-plugins-good",
    ),
  });
});
it("reports a missing inspection executable without accepting an unchecked runtime", () => {
  probe.inspect.mockImplementation(() => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  expect(checkMediaSupport().available).toBe(false);
});
it("retains generic instructions when the distribution cannot be read", () => {
  probe.release.mockImplementation(() => {
    throw new Error("Unavailable");
  });
  probe.inspect.mockImplementation(() => {
    throw new Error("Missing");
  });
  expect(checkMediaSupport().instruction).toContain("your distribution");
});
