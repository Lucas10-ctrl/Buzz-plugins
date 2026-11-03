// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { EditorActionMenu } from "./editor-chrome";

afterEach(cleanup);

function OriginalExportActions({
  selected,
  shopify = true,
}: {
  selected: string[];
  shopify?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const action = (label: string, disabled = false) => ({
    label,
    disabled,
    onSelect: () => {
      selected.push(label);
    },
  });
  return (
    <EditorActionMenu
      open={open}
      onOpenChange={setOpen}
      label="Export"
      ariaLabel="Export page"
      groups={[
        { label: "Download", items: [action("Standalone HTML")] },
        {
          label: "Platforms",
          items: [action("Shopify Liquid", !shopify), action("Vercel project")],
        },
        {
          label: "Copy data",
          items: [action("Page copy"), action("Section JSON")],
        },
      ]}
    />
  );
}

it("keeps every original export action in Buzz's real menu and closes after pointer selection", async () => {
  const selected: string[] = [];
  const user = userEvent.setup();
  render(<OriginalExportActions selected={selected} />);
  const trigger = screen.getByRole("button", { name: "Export page" });
  expect(trigger).toHaveAttribute("data-buzz-ui");
  for (const label of [
    "Standalone HTML",
    "Shopify Liquid",
    "Vercel project",
    "Page copy",
    "Section JSON",
  ]) {
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: label }));
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(selected.at(-1)).toBe(label);
  }
  expect(selected).toHaveLength(5);
});

it("keeps the unavailable Shopify action inert and restores keyboard focus on selection and Escape", async () => {
  const selected: string[] = [];
  const user = userEvent.setup();
  render(<OriginalExportActions selected={selected} shopify={false} />);
  const trigger = screen.getByRole("button", { name: "Export page" });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(
    await screen.findByRole("menuitem", { name: "Shopify Liquid" }),
  ).toHaveAttribute("aria-disabled", "true");
  await user.keyboard("{Home}{ArrowDown}{Enter}");
  expect(selected).toEqual([]);
  expect(
    screen.getByRole("menuitem", { name: "Shopify Liquid" }),
  ).toHaveFocus();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(selected).toEqual(["Vercel project"]);
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard("{ArrowDown}");
  await screen.findByRole("menu");
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
  expect(selected).toEqual(["Vercel project"]);
});
