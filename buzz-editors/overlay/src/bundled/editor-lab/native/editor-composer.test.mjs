// @vitest-environment jsdom
import { createElement, createRef, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  EditorComposerBridge,
  EditorComposerCapture,
  EditorComposerOwner,
} from "./editor-composer.tsx";
import { EditableInput } from "../../../features/messages/EditableInput";
import { mentionDraft } from "../../../features/messages/mention-draft";
import { composerDOMFixture } from "../../../features/messages/composer-testing";

composerDOMFixture();

afterEach(cleanup);
const editor = (extra = {}) => ({
  session: {},
  scope: "community",
  channelId: "canvas-dm",
  disabled: false,
  insertText: vi.fn(() => true),
  focus: vi.fn(),
  ...extra,
});
const capture = (bridge, token, props) =>
  createElement(
    EditorComposerOwner,
    { bridge, token },
    createElement(EditorComposerCapture, props),
  );

it("inserts unchanged Canvas context only into its own native editor placement", () => {
  const bridge = new EditorComposerBridge(),
    token = Symbol(),
    other = Symbol();
  const first = editor(),
    second = editor({ session: first.session });
  const view = render(
    createElement(
      "div",
      null,
      capture(bridge, token, first),
      capture(bridge, other, second),
    ),
  );
  const text =
    'Canvas selection {"design_id":"design-1","revision":4,"layers":[{"id":"hero"}]}\n';
  expect(
    bridge.insert(token, first.session, first.scope, first.channelId, text),
  ).toBe(true);
  expect(first.insertText).toHaveBeenCalledExactlyOnceWith(text);
  expect(first.focus).toHaveBeenCalledTimes(1);
  expect(second.insertText).not.toHaveBeenCalled();
  for (const [owner, session, scope, channel] of [
    [Symbol(), first.session, first.scope, first.channelId],
    [token, {}, first.scope, first.channelId],
    [token, first.session, "other-community", first.channelId],
    [token, first.session, first.scope, "other-conversation"],
  ])
    expect(bridge.insert(owner, session, scope, channel, text)).toBe(false);
  view.unmount();
  expect(
    bridge.insert(token, first.session, first.scope, first.channelId, text),
  ).toBe(false);
});

it("revokes insertion while disabled or in a thread and recovers without replacing the draft", () => {
  const bridge = new EditorComposerBridge(),
    token = Symbol(),
    original = editor();
  const view = render(capture(bridge, token, original));
  const available = () =>
    bridge.available(
      token,
      original.session,
      original.scope,
      original.channelId,
    );
  expect(available()).toBe(true);
  view.rerender(capture(bridge, token, { ...original, disabled: true }));
  expect(available()).toBe(false);
  expect(
    bridge.insert(
      token,
      original.session,
      original.scope,
      original.channelId,
      "note",
    ),
  ).toBe(false);
  view.rerender(
    capture(bridge, token, { ...original, threadRootId: "thread" }),
  );
  expect(available()).toBe(false);
  view.rerender(capture(bridge, token, original));
  expect(
    bridge.insert(
      token,
      original.session,
      original.scope,
      original.channelId,
      "note",
    ),
  ).toBe(true);
  original.insertText.mockReturnValueOnce(false);
  expect(
    bridge.insert(
      token,
      original.session,
      original.scope,
      original.channelId,
      "locked",
    ),
  ).toBe(false);
  expect(original.focus).toHaveBeenCalledTimes(1);
});

it("ignores composers outside the editor and prevents old cleanup from retiring a replacement", () => {
  const bridge = new EditorComposerBridge(),
    token = Symbol(),
    first = editor(),
    second = editor({ session: first.session });
  render(createElement(EditorComposerCapture, first));
  expect(
    bridge.available(token, first.session, first.scope, first.channelId),
  ).toBe(false);
  const old = bridge.attach(token, first);
  const latest = bridge.attach(token, second);
  old();
  expect(
    bridge.insert(
      token,
      second.session,
      second.scope,
      second.channelId,
      "latest",
    ),
  ).toBe(true);
  expect(second.insertText).toHaveBeenCalledExactlyOnceWith("latest");
  bridge.clear();
  expect(
    bridge.available(token, second.session, second.scope, second.channelId),
  ).toBe(false);
  latest();
});

it("inserts into Buzz's real rich composer without replacing the user's existing draft", () => {
  const bridge = new EditorComposerBridge(),
    token = Symbol(),
    input = createRef();
  const original = "Manual draft before the selected Canvas note.\n";
  const note =
    'Canvas selection {"design_id":"design","revision":2,"layers":[{"id":"hero"}]}\n';
  const props = editor({
    insertText: (text) => input.current?.insertText(text) ?? false,
    focus: () => input.current?.focus(),
  });
  function Composer() {
    const [draft, setDraft] = useState(() => mentionDraft(original));
    return createElement(
      EditorComposerOwner,
      { bridge, token },
      createElement(EditableInput, {
        ref: input,
        draft,
        value: draft.text,
        disabled: false,
        placeholder: "Canvas conversation",
        maxLength: 16000,
        decorationsFor: () => [],
        onFormatsChange: () => {},
        onDraftChange: setDraft,
      }),
      createElement(EditorComposerCapture, props),
    );
  }
  render(createElement(Composer), { reactStrictMode: true });
  act(() => {
    input.current.focus();
    input.current.setSelectionRange(original.length, original.length);
    expect(
      bridge.insert(token, props.session, props.scope, props.channelId, note),
    ).toBe(true);
  });
  expect(input.current.value).toBe(original + note);
  expect(document.activeElement).toBe(input.current);
});

it("queues the original PNG only through its matching live native composer and preserves refusals", () => {
  const bridge = new EditorComposerBridge(),
    token = Symbol();
  const attachFiles = vi.fn(() => true);
  const first = editor({ attachFiles });
  const view = render(capture(bridge, token, first), { reactStrictMode: true });
  const file = new File(["cropped png"], "Hero mark.png", {
    type: "image/png",
  });
  const attach = (
    owner = token,
    session = first.session,
    scope = first.scope,
    channel = first.channelId,
  ) => bridge.attachFiles(owner, session, scope, channel, [file]);
  expect(attach()).toBe(true);
  expect(attachFiles).toHaveBeenCalledExactlyOnceWith([file]);
  expect(first.insertText).not.toHaveBeenCalled();
  for (const args of [
    [Symbol()],
    [token, {}],
    [token, first.session, "other"],
    [token, first.session, first.scope, "other"],
  ])
    expect(attach(...args)).not.toBe(true);
  attachFiles.mockReturnValue("Finish editing before attaching new files.");
  expect(attach()).toBe("Finish editing before attaching new files.");
  view.rerender(capture(bridge, token, { ...first, disabled: true }));
  expect(attach()).not.toBe(true);
  view.rerender(capture(bridge, token, { ...first, threadRootId: "thread" }));
  expect(attach()).not.toBe(true);
  view.rerender(capture(bridge, token, { ...first, attachFiles: undefined }));
  expect(attach()).not.toBe(true);
  view.unmount();
  expect(attach()).not.toBe(true);
  expect(attachFiles).toHaveBeenCalledTimes(2);
});
