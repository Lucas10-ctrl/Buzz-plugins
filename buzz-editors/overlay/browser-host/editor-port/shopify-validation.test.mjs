import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { validateShopifyFiles } from "../../portable/editor-host/src/shopify-validation.ts";
import { EditorRepository } from "../../portable/editor-host/src/store.ts";
import { shopifyFixture } from "./shopify-fixture.mjs";

let root;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

it("accepts editable full-page and explicit single-section exports and reports the separate rendering checks", () => {
  const fixture = shopifyFixture();
  const result = validateShopifyFiles(fixture.files());
  expect(result).toMatchObject({ valid: true, errors: [] });
  expect(result.limitations[0]).toContain("Full Liquid rendering");
  const files = fixture.files();
  files.delete("templates/page.lp.json");
  expect(validateShopifyFiles(files).valid).toBe(false);
  expect(validateShopifyFiles(files, "section").valid).toBe(true);
});

it.each([
  [
    "long schema name",
    (s) => {
      s.name = "x".repeat(26);
    },
  ],
  [
    "long block name",
    (s) => {
      s.blocks[0].name = "x".repeat(26);
    },
  ],
  [
    "long preset name",
    (s) => {
      s.presets[0].name = "x".repeat(26);
    },
  ],
  [
    "missing core blocks",
    (s) => {
      s.blocks.pop();
    },
  ],
  [
    "duplicate block types",
    (s) => {
      s.blocks.push(s.blocks[0]);
    },
  ],
  [
    "duplicate setting ids",
    (s) => {
      s.blocks[0].settings.push(s.blocks[0].settings[0]);
    },
  ],
  [
    "invalid setting id",
    (s) => {
      s.blocks[0].settings[0].id = "spaces are invalid";
    },
  ],
  [
    "long setting label",
    (s) => {
      s.blocks[0].settings[0].label = "x".repeat(40);
    },
  ],
  [
    "blank text default",
    (s) => {
      s.blocks[0].settings[0].default = " ";
    },
  ],
  [
    "non-HTML richtext default",
    (s) => {
      s.blocks[1].settings[0].default = "Plain copy";
    },
  ],
  [
    "mismatched richtext wrapper",
    (s) => {
      s.blocks[1].settings[0].default = "<p>Copy</ul>";
    },
  ],
  [
    "non-boolean checkbox",
    (s) => {
      s.blocks[0].settings[1].default = "true";
    },
  ],
  [
    "range with too many steps",
    (s) => {
      s.blocks[0].settings[2].max = 1000;
    },
  ],
  [
    "range without a step",
    (s) => {
      delete s.blocks[0].settings[2].step;
    },
  ],
  [
    "range default off its step",
    (s) => {
      s.blocks[0].settings[2].step = 5;
      s.blocks[0].settings[2].default = 24;
    },
  ],
  [
    "unknown select default",
    (s) => {
      s.blocks[0].settings[3].default = "right";
    },
  ],
  [
    "duplicate select options",
    (s) => {
      s.blocks[0].settings[3].options.push(s.blocks[0].settings[3].options[0]);
    },
  ],
  [
    "unknown preset block",
    (s) => {
      s.presets[0].blocks[0].type = "unknown";
    },
  ],
  [
    "unknown preset setting",
    (s) => {
      s.presets[0].settings = { missing: true };
    },
  ],
])("rejects the original guide's %s", (_name, edit) => {
  const fixture = shopifyFixture();
  edit(fixture.schema);
  const result = validateShopifyFiles(fixture.files());
  expect(result.valid).toBe(false);
  expect(
    result.errors.some((error) => error.startsWith("sections/lp-hero.liquid:")),
  ).toBe(true);
});

it.each([
  [
    "non-alphanumeric section id",
    (t) => {
      t.sections["bad-id"] = t.sections.hero;
      t.order.push("bad-id");
    },
  ],
  [
    "missing section file",
    (t) => {
      t.sections.hero.type = "lp-absent";
    },
  ],
  [
    "unknown block type",
    (t) => {
      t.sections.hero.blocks.heading1.type = "unknown";
    },
  ],
  [
    "unknown block setting",
    (t) => {
      t.sections.hero.blocks.heading1.settings.missing = true;
    },
  ],
  [
    "out-of-range instance",
    (t) => {
      t.sections.hero.blocks.heading1.settings.font_size = 61;
    },
  ],
  [
    "incorrect checkbox instance",
    (t) => {
      t.sections.hero.blocks.heading1.settings.use_theme_font = "yes";
    },
  ],
  [
    "missing order",
    (t) => {
      t.order = [];
    },
  ],
  [
    "duplicate order",
    (t) => {
      t.order.push("hero");
    },
  ],
  [
    "missing block order",
    (t) => {
      t.sections.hero.block_order = [];
    },
  ],
  [
    "more than fifty blocks",
    (t) => {
      for (let i = 0; i < 51; i++) {
        const id = `heading${i + 2}`;
        t.sections.hero.blocks[id] = { type: "heading" };
        t.sections.hero.block_order.push(id);
      }
    },
  ],
  [
    "more than twenty-five sections",
    (t) => {
      for (let i = 0; i < 25; i++) {
        const id = `section${i}`;
        t.sections[id] = t.sections.hero;
        t.order.push(id);
      }
    },
  ],
])("rejects template %s", (_name, edit) => {
  const fixture = shopifyFixture();
  edit(fixture.template);
  const result = validateShopifyFiles(fixture.files());
  expect(result.valid).toBe(false);
  expect(
    result.errors.some((error) => error.startsWith("templates/page.lp.json:")),
  ).toBe(true);
});

it("rejects malformed JSON, multiple schemas, invalid names and oversized templates", () => {
  const fixture = shopifyFixture();
  for (const content of [
    "{% schema %}not JSON{% endschema %}",
    "{% schema %}{}{% endschema %}{% schema %}{}{% endschema %}",
  ])
    expect(
      validateShopifyFiles(new Map([["sections/lp-hero.liquid", content]]))
        .valid,
    ).toBe(false);
  const files = fixture.files();
  files.set("sections/INVALID.liquid", files.get("sections/lp-hero.liquid"));
  expect(validateShopifyFiles(files).valid).toBe(false);
  files.delete("sections/INVALID.liquid");
  files.set("templates/page.lp.json", " ".repeat(512 * 1024 + 1));
  expect(validateShopifyFiles(files).errors).toContain(
    "templates/page.lp.json: Template exceeds 512 KB",
  );
});

it("pages validation errors without treating a truncated reply as a valid export", async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-shopify-errors-"));
  const store = new EditorRepository(root);
  const prepared = await store.call({
    operation: "preparePageWorkflow",
    input: { workspaceId: "community", workflow: "shopify-section-export" },
  });
  const fixture = shopifyFixture();
  fixture.schema.name = "x".repeat(26);
  fixture.schema.presets[0].name = "x".repeat(26);
  const output = join(prepared.projectRoot, "exports", "invalid");
  for (const [file, content] of fixture.files()) {
    const destination = join(output, file);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, content);
  }
  const validate = (offset) =>
    store.call({
      operation: "validateShopifyExport",
      input: {
        workspaceId: "community",
        directory: "exports/invalid",
        offset,
        limit: 1,
      },
    });
  const first = await validate(0);
  expect(first).toMatchObject({ valid: false, nextOffset: 1, offset: 0 });
  expect(first.errors).toHaveLength(1);
  expect(first.errorCount).toBeGreaterThan(1);
  const messages = [...first.errors];
  for (let offset = first.nextOffset; offset !== undefined; ) {
    const page = await validate(offset);
    expect(page.valid).toBe(false);
    messages.push(...page.errors);
    offset = page.nextOffset;
  }
  expect(messages).toHaveLength(first.errorCount);
  expect(new Set(messages).size).toBe(messages.length);
});

it("reads only saved exports in the bound workspace and rejects external and symlinked outputs", async () => {
  root = await mkdtemp(join(tmpdir(), "buzz-shopify-validation-"));
  const store = new EditorRepository(root);
  const prepared = await store.call({
    operation: "preparePageWorkflow",
    input: { workspaceId: "community", workflow: "shopify-section-export" },
  });
  const output = join(prepared.projectRoot, "exports", "shopify");
  for (const [file, content] of shopifyFixture().files()) {
    const destination = join(output, file);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, content);
  }
  const validate = (directory, workspaceId = "community") =>
    store.call({
      operation: "validateShopifyExport",
      input: { workspaceId, directory },
    });
  expect(await validate("exports/shopify")).toMatchObject({
    valid: true,
    errors: [],
  });
  await expect(validate(root)).rejects.toThrow("outside");
  await expect(validate(output, "other-community")).rejects.toThrow();
  await symlink(
    join(output, "sections/lp-hero.liquid"),
    join(output, "sections/lp-link.liquid"),
  );
  await expect(validate("exports/shopify")).rejects.toThrow("symbolic link");
  const linked = join(prepared.projectRoot, "exports", "linked");
  await mkdir(linked);
  await symlink(join(output, "sections"), join(linked, "sections"));
  await expect(validate("exports/linked")).rejects.toThrow(
    "must not be symlinks",
  );
});
