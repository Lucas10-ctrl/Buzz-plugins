// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesignerGeneration } from "../../../../portable/copyos-apps/src/client/DesignerGeneration.tsx";
import { EditorChromeProvider } from "../../../../portable/copyos-apps/src/EditorChrome.tsx";
import { en } from "../../../../portable/copyos-apps/src/client/locales.ts";
import { nativeEditorChrome } from "./editor-chrome.tsx";
import { createEditorText } from "./editor-locale.ts";
import { canvasActions } from "./canvas-client.ts";
const t = createEditorText(en);
afterEach(cleanup);
const record = (status = "failed") => ({
  id:
    status === "completed"
      ? "11111111-1111-4111-8111-111111111111"
      : "22222222-2222-4222-8222-222222222222",
  status,
  prompt: "Product scene",
  requestId: "provider-job",
  cancelRequested: false,
  images: status === "completed" ? [{}] : [],
  error: status === "failed" ? "Check provider history before retrying" : null,
});
function mount(call) {
  const place = vi.fn();
  render(
    createElement(
      EditorChromeProvider,
      { value: nativeEditorChrome },
      createElement(DesignerGeneration, {
        workspaceId: "community",
        actions: canvasActions({ call }).generation,
        t,
        place,
      }),
    ),
  );
  return { place };
}
it("keeps the original key setup on native password controls without starting generation automatically", async () => {
  let configured = false,
    finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const call = vi.fn(async (operation) => {
    if (operation === "generationSettings")
      return { credentialRef: "HF_CREDENTIALS" };
    if (operation === "generationCredentialStatus")
      return { configured, writable: true };
    if (operation === "listGenerations") return [];
    if (operation === "setGenerationCredential") {
      await pending;
      configured = true;
      return null;
    }
    throw new Error("Unexpected operation");
  });
  mount(call);
  const key = await screen.findByLabelText(en.designerGenerateKey);
  expect(key).toHaveAttribute("type", "password");
  expect(key).toHaveAttribute("autocomplete", "off");
  expect(key).toHaveAttribute("data-buzz-ui");
  fireEvent.change(key, { target: { value: "unit:key" } });
  fireEvent.click(
    screen.getByRole("button", { name: en.designerGenerateSaveKey }),
  );
  await waitFor(() => expect(key).toBeDisabled());
  expect(call).toHaveBeenCalledWith("setGenerationCredential", {
    ref: "HF_CREDENTIALS",
    value: "unit:key",
  });
  await act(async () => {
    finish();
  });
  expect(
    await screen.findByRole("textbox", { name: en.designerGeneratePrompt }),
  ).toHaveAttribute("data-buzz-ui");
  expect(
    screen.queryByLabelText(en.designerGenerateKey),
  ).not.toBeInTheDocument();
  expect(call.mock.calls.some(([name]) => name === "startGeneration")).toBe(
    false,
  );
  expect(t("designerGenerateKeyHint")).toContain("Buzz");
});
it("preserves the original prompt and output choices after failure and places an existing result through the native action adapter", async () => {
  const completed = record("completed");
  let fail = true;
  const call = vi.fn(async (operation) => {
    if (operation === "generationSettings")
      return { credentialRef: "HF_CREDENTIALS" };
    if (operation === "generationCredentialStatus")
      return { configured: true, writable: true };
    if (operation === "listGenerations") return [completed];
    if (operation === "readGenerationImage")
      return { dataUrl: "data:image/png;base64,fixture" };
    if (operation === "startGeneration") {
      if (fail) throw new Error("Generation unavailable");
      return record();
    }
    throw new Error("Unexpected operation");
  });
  const { place } = mount(call);
  const prompt = await screen.findByRole("textbox", {
    name: en.designerGeneratePrompt,
  });
  fireEvent.change(prompt, { target: { value: "Keep this prompt" } });
  await userEvent.click(
    screen.getByRole("combobox", { name: en.designerGenerateAspect }),
  );
  await userEvent.click(
    await screen.findByRole("option", { name: "16:9", exact: true }),
  );
  await userEvent.click(
    screen.getByRole("combobox", { name: en.designerGenerateResolution }),
  );
  await userEvent.click(
    await screen.findByRole("option", { name: "1080p", exact: true }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.designerGenerateSubmit }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Generation unavailable",
  );
  expect(prompt).toHaveValue("Keep this prompt");
  expect(call).toHaveBeenCalledWith("startGeneration", {
    workspaceId: "community",
    prompt: "Keep this prompt",
    aspectRatio: "16:9",
    resolution: "1080p",
  });
  fail = false;
  fireEvent.click(
    screen.getByRole("button", { name: en.designerGenerateSubmit }),
  );
  expect(
    await screen.findByText("Check provider history before retrying"),
  ).toBeVisible();
  expect(prompt).toHaveValue("Keep this prompt");
  fireEvent.click(
    screen.getByRole("button", { name: en.designerGeneratePlace }),
  );
  await waitFor(() =>
    expect(place).toHaveBeenCalledWith({
      dataUrl: "data:image/png;base64,fixture",
      name: "Product scene",
    }),
  );
});
it("shows an unavailable host as an error and makes no credential lookup or generation request", async () => {
  const call = vi.fn(async () => {
    throw new Error("Open Assets in the desktop lab");
  });
  mount(call);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Open Assets in the desktop lab",
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith("generationSettings", {});
});
