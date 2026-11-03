// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DocsSlashMenu } from "../../../../portable/copyos-apps/src/client/DocsSlashMenu.tsx";
afterEach(cleanup);
it("keeps manual menu scrolling across equivalent choices and reveals a keyboard-selected row", () => {
  const choices = () =>
    Array.from({ length: 15 }, (_, i) => ({
      id: `item-${i}`,
      label: `Item ${i}`,
    }));
  const anchor = () => ({ left: 20, top: 20, bottom: 40 });
  const props = {
    id: "slash",
    label: "Commands",
    anchor,
    choose() {},
    close() {},
  };
  const { rerender } = render(
    createElement(DocsSlashMenu, { ...props, choices: choices(), index: 0 }),
  );
  const list = screen.getByRole("option", { name: "Item 0" }).parentElement;
  Object.defineProperty(list, "clientHeight", { value: 100 });
  for (const [i, row] of [...list.children].entries()) {
    Object.defineProperty(row, "offsetTop", { value: i * 30 });
    Object.defineProperty(row, "offsetHeight", { value: 30 });
  }
  list.scrollTop = 180;
  fireEvent.scroll(list);
  rerender(
    createElement(DocsSlashMenu, { ...props, choices: choices(), index: 0 }),
  );
  expect(list.scrollTop).toBe(180);
  rerender(
    createElement(DocsSlashMenu, { ...props, choices: choices(), index: 12 }),
  );
  expect(list.scrollTop).toBe(290);
});
