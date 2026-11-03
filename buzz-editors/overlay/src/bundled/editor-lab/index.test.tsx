import { Context } from "@deepseek-ai/cordis";
import { expect, it } from "vitest";
import { PagesService } from "../../features/pages/service";
import { provideNavigation } from "../../features/navigation/service";
import { ConversationService } from "../../features/conversation/service";
import * as editors from ".";

it("registers three topbar workspace destinations and removes them on disable", async () => {
  const root = new Context();
  root.provide("pluginStatus", {
    isActive: () => true,
    subscribe: () => () => {},
  });
  root.provide("host", {});
  const pages = new PagesService(root);
  provideNavigation(root);
  root.provide("agents", { addTool: () => {} });
  root.provide("relay", { snapshot: () => ({}), subscribe: () => () => {} });
  const conversation = new ConversationService(root);
  root.provide("panels", {});
  const scope = root.extend({
    pluginOwner: { id: "local.editor-lab", revision: "test" },
  });
  const fiber = scope.plugin(editors);
  try {
    await fiber.await();
    expect(conversation.tools.snapshot().map((tool) => tool.id)).toEqual([
      "editor-context",
    ]);
    expect(
      pages.snapshot().map(({ id, title, placement, layout }) => ({
        id,
        title,
        placement,
        layout,
      })),
    ).toEqual([
      { id: "docs", title: "Docs", placement: "topbar", layout: "workspace" },
      {
        id: "canvas",
        title: "Canvas",
        placement: "topbar",
        layout: "workspace",
      },
      {
        id: "pages",
        title: "Page Builder",
        placement: "topbar",
        layout: "workspace",
      },
    ]);
    await fiber.dispose();
    expect(pages.snapshot()).toEqual([]);
    expect(conversation.tools.snapshot()).toEqual([]);
  } finally {
    await root.fiber.dispose();
  }
});
