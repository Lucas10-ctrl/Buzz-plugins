/** A retained-guide export fixture with editable blocks and a full-page template. */
export function shopifyFixture() {
  const schema = {
    name: "Hero",
    settings: [],
    blocks: ["heading", "subtext", "button", "image", "checkmark", "tag"].map(
      (type) => ({
        type,
        name: type[0].toUpperCase() + type.slice(1),
        settings:
          type === "heading"
            ? [
                {
                  type: "text",
                  id: "text",
                  label: "Text",
                  default: "Editable headline",
                },
                {
                  type: "checkbox",
                  id: "use_theme_font",
                  label: "Use theme font",
                  default: true,
                },
                {
                  type: "range",
                  id: "font_size",
                  label: "Font size",
                  min: 10,
                  max: 60,
                  step: 1,
                  default: 24,
                },
                {
                  type: "select",
                  id: "alignment",
                  label: "Alignment",
                  options: [{ value: "left", label: "Left" }],
                  default: "left",
                },
              ]
            : type === "subtext"
              ? [
                  {
                    type: "richtext",
                    id: "text",
                    label: "Text",
                    default: "<p>Body copy</p>",
                  },
                ]
              : [],
      }),
    ),
    presets: [
      {
        name: "Hero",
        blocks: [{ type: "heading", settings: { text: "Editable headline" } }],
      },
    ],
  };
  const template = {
    sections: {
      hero: {
        type: "lp-hero",
        blocks: {
          heading1: {
            type: "heading",
            settings: { text: "User's manual headline" },
          },
        },
        block_order: ["heading1"],
        settings: {},
      },
    },
    order: ["hero"],
  };
  const files = () =>
    new Map([
      [
        "sections/lp-hero.liquid",
        `{% assign section_id = 'lp-hero-' | append: section.id %}\n<section id="{{ section_id }}">{% for block in section.blocks %}{{ block.settings.text }}{% endfor %}</section>\n{% schema %}${JSON.stringify(schema)}{% endschema %}`,
      ],
      ["templates/page.lp.json", JSON.stringify(template)],
    ]);
  return { schema, template, files };
}
