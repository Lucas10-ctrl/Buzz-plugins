// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ComposerToolProps } from "../../../features/conversation/contracts";
import { composerLinkUrl } from "../../../features/messages/composer-link";
import { createNewDocTool } from "./NewDocTool";
import { readDocNavigation } from "./docs-route";

afterEach(cleanup);

const docId = "11111111-1111-4111-8111-111111111111";
function setup(assignments: Record<string, string> = {}) {
  const opened: unknown[] = [];
  const ctx = {
    relay: {
      snapshot: () => ({
        scope: "community",
        session: {
          soloPreferences: {
            snapshot: () => ({
              data: {
                sections: [{ id: "launch", name: "Launch plan" }],
                assignments,
              },
            }),
          },
        },
      }),
    },
    navigation: {
      open: async (target: unknown) => {
        opened.push(target);
        return true;
      },
    },
  };
  const store = {
    call: vi.fn(async () => ({ id: docId })),
  };
  const insertResource = vi.fn(
    (resource: { uri: string; label: string }) =>
      composerLinkUrl(resource.uri) === resource.uri || "rejected",
  );
  const Tool = createNewDocTool(ctx as never, store as never);
  const props = {
    channelId: "channel-1",
    disabled: false,
    insertResource,
    focus: () => {},
  } as unknown as ComposerToolProps;
  render(<Tool {...props} />);
  return { store, insertResource, opened };
}

it("starts a doc in the chat's Solo workspace and adds its link to the message", async () => {
  const user = userEvent.setup();
  const { store, insertResource, opened } = setup({ "channel-1": "launch" });
  await user.click(screen.getByRole("button", { name: "New doc" }));
  await user.type(
    await screen.findByLabelText("New doc title"),
    "Launch brief",
  );
  await user.click(screen.getByRole("button", { name: "Add to message" }));
  await waitFor(() => expect(insertResource).toHaveBeenCalled());
  const workspaceId = JSON.stringify(["solo", "community", "launch"]);
  expect(store.call).toHaveBeenCalledWith("createDoc", {
    workspaceId,
    title: "Launch brief",
    sections: [],
  });
  const [resource] = insertResource.mock.calls[0] ?? [];
  expect(resource?.label).toBe("Launch brief");
  expect(insertResource.mock.results[0]?.value).toBe(true);
  const params = Object.fromEntries(
    [...new URL(resource?.uri ?? "").searchParams]
      .filter(([key]) => key.startsWith("route."))
      .map(([key, value]) => [key.slice(6), value]),
  );
  expect(readDocNavigation(params)).toMatchObject({ workspaceId, docId });
  expect(opened).toEqual([]);
});

it("falls back to the Docs workspace and can open the new doc straight away", async () => {
  const user = userEvent.setup();
  const { store, opened } = setup();
  await user.click(screen.getByRole("button", { name: "New doc" }));
  await user.click(
    await screen.findByRole("button", { name: "Create and open" }),
  );
  await waitFor(() => expect(opened).toHaveLength(1));
  expect(store.call).toHaveBeenCalledWith("createDoc", {
    workspaceId: "community",
    title: "Untitled",
    sections: [],
  });
  expect(opened[0]).toMatchObject({
    kind: "page",
    pageId: "docs",
    route: { params: { workspaceId: "community", docId } },
  });
});
