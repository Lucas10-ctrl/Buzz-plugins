// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerTools } from "./ComposerTools.tsx";
afterEach(cleanup);

it("withholds an absent attachment command and revokes retained commands with their contribution", () => {
  let captured;
  const tool = {
    key: "test/attachments",
    pluginId: "test",
    revision: "1",
    id: "attachments",
    title: "Attachments",
    component: (props) => {
      captured = props;
      return null;
    },
  };
  let entries = [tool];
  const registry = { snapshot: () => entries, subscribe: () => () => {} };
  const attachFiles = vi.fn(() => true);
  const props = {
    registry,
    session: {},
    scope: "community",
    channelId: "channel",
    disabled: false,
    recipients: [],
    insertText: () => true,
    insertMention: () => true,
    insertMentions: () => true,
    replaceRecipients: () => true,
    insertResource: () => true,
    focus: () => {},
  };
  const view = render(createElement(ComposerTools, props), {
    reactStrictMode: true,
  });
  expect(captured.attachFiles).toBeUndefined();
  view.rerender(createElement(ComposerTools, { ...props, attachFiles }));
  const command = captured.attachFiles,
    file = new File(["png"], "mark.png");
  expect(command([file])).toBe(true);
  expect(attachFiles).toHaveBeenCalledExactlyOnceWith([file]);
  view.rerender(
    createElement(ComposerTools, { ...props, attachFiles, disabled: true }),
  );
  expect(command([file])).not.toBe(true);
  view.rerender(createElement(ComposerTools, { ...props, attachFiles }));
  entries = [];
  // Revoked immediately even before React processes removal.
  expect(command([file])).not.toBe(true);
  act(() => view.unmount());
  expect(command([file])).not.toBe(true);
  expect(attachFiles).toHaveBeenCalledTimes(1);
});
