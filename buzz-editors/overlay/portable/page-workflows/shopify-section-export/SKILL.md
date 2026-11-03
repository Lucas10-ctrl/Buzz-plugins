---
name: shopify-section-export
description: Turn HTML into liquid code that can be imported to Shopify
whenToUse: Export to Shopify, converting code into SHopify liquid
disable-model-invocation: false
user-invocable: true
metadata:
  copyos:
    workflows:
      - landing-page-builder
---

---
name: shopify-section-creation
description: "Create fully editable Shopify Liquid sections, or full page-level builds (multiple sections plus a JSON page template), from screenshots or descriptions. Enforces Shopify naming and schema limits (25-character schema names, file, template, and ID rules). Use this skill whenever the user mentions Shopify sections, Liquid files, Customizer blocks, page templates, landing pages in Shopify, or wants a screenshot or design turned into a Shopify section or page, even if they never say 'section'."
---

# Shopify Liquid Section Generator

When this skill is triggered, convert the provided screenshot (or description) into fully customizable Shopify Liquid section file(s) following all requirements below.

## Mode Selection

- **Single-section mode (default):** one section in the screenshot → one `.liquid` file.
- **Full-page mode:** a full-page screenshot, several sections, or the words "page", "template", "landing page", or "full page" → one `.liquid` file per section plus one JSON template that assembles them. Follow FULL-PAGE MODE below in addition to every section rule.

In both modes, run NAMING AND LENGTH RULES before writing any file.

## Before Starting — Ask Clarifying Questions If Needed

If any of the following are unclear, ask the user before generating the file:

- **No screenshot provided?** Ask them to share a screenshot or describe the section layout they want.
- **Section name unclear?** Ask what to name the section (used in the schema and file naming).
- **Ambiguous interactive elements?** E.g. if a button or tab behavior is unclear, ask how it should work.
- **Multiple plausible layouts?** If the screenshot could be interpreted multiple ways, briefly describe the options and ask which they prefer.

Do not ask unnecessary questions — if the intent is obvious from the screenshot, proceed directly.

---

### FILE STRUCTURE

- Single-section mode: output a **single `.liquid` file**. Full-page mode: one `.liquid` file per section plus one template JSON. Never output separate CSS or JS files.
- Section files go in `sections/`; the template JSON goes in `templates/`.
- All CSS lives inside a `<style>` block at the top of the file, scoped to a unique section ID using `{% assign section_id = 'SECTIONNAME-' | append: section.id %}` so it never conflicts with other sections on the page.
- No JavaScript unless absolutely required. If JS is needed, scope it to the section ID too.

---

### BLOCK ARCHITECTURE

Every distinct content element must be its own **independent, reorderable block** in the Shopify Customizer sidebar. Do not hardcode any content as fixed section settings.

There are two categories of blocks: **core blocks** and **design-specific blocks**.

#### Core blocks — ALWAYS define these in every section

These six block types must be defined in the schema of **every** section you generate, whether or not the screenshot shows them. They are the universal building blocks of any web page, and defining them every time means the section can be extended beyond the briefed design later — dropping in an extra heading, a paragraph, a CTA, an image, a checkmark point, or a tag — without rebuilding the section from scratch. Never omit a core block type just because the current screenshot doesn't use it.

- **`heading`** — single-line text block
- **`subtext`** — rich text block (supports bold, italic, links)
- **`button`** — fully styled CTA block
- **`image`** — swappable image block
- **`checkmark`** — a single checkmark icon + line of text; add multiple times to build a checklist / benefits list
- **`tag`** — small microtext / label; renders as eyebrow text or a pill/badge (see TAG & MICROTEXT BLOCKS)

Whether a core block appears on install is controlled by the preset, not by whether the type is defined (see PRESETS). Always define all six types; let the preset decide which are pre-populated.

#### Design-specific blocks — add as the screenshot requires

Any block the design needs beyond the core six — e.g. `comparison_row`, `card`, `icon_row`, etc. Add these based on what the screenshot shows.

Blocks must be:
- Draggable to reorder in the Customizer
- Independently deletable and duplicatable
- Addable multiple times (e.g. two buttons, two headings)

---

### PER-BLOCK SETTINGS — EVERY BLOCK MUST HAVE:

**Typography**
- `checkbox` — "Use theme font & size" (default: true)
- `range` — Font size in px (shown when theme font is off), step: 1
- `checkbox` — "Use custom mobile font size" (default: false, shown when theme font is off)
- `range` — Mobile font size in px (shown when mobile font size is enabled), step: 1
- `text` — Font family name (shown when theme font is off), default: "Georgia"
- Font logic: `{% if block.settings.use_theme_font %}font-size: var(--font-body-size, 1rem); font-family: var(--font-body-family, inherit);{% else %}font-size: {{ block.settings.font_size }}px; font-family: '{{ block.settings.font_family }}', sans-serif;{% endif %}`
- For heading blocks, use `--font-heading-size` and `--font-heading-family` instead
- Mobile font size logic: When `use_custom_mobile_font_size` is enabled, inject a scoped `@media (max-width: 768px)` rule inside the `<style>` block overriding the font size for that block's element. Example: `@media (max-width: 768px) { #{{ section_id }} [data-block-id="{{ block.id }}"] { font-size: {{ block.settings.mobile_font_size }}px !important; } }`

**Heading blocks additionally get:**
- `select` — Font weight (Normal 400 / Semi-bold 600 / Bold 700 / Extra bold 800)

**Color**
- `color` — Text color (with sensible default)

**Alignment** (for heading, subtext, button blocks)
- `select` — Left / Center / Right

**Spacing (in increments of 5px)**
- `range` — Margin top (min: 0, max: 100, step: 5)
- `range` — Margin bottom (min: 0, max: 100, step: 5)

**Heading Tags**
`select` — Heading tag (<h1>-<h4>)

---

### BUTTON BLOCK SPECIFICS

- `text` — Button label (not richtext — avoids `<p>` tag wrapping issues)
- `url` — Destination URL (Shopify native URL picker)
- `checkbox` — Open in new tab
- `checkbox` — Show arrow icon (default: true)
- `select` — Alignment (Left / Center / Right)
- `color` — Background color
- `color` — Text color
- `color` — Border color
- `range` — Border radius (min: 0, max: 60, step: 2)
- `range` — Vertical padding (step: 5)
- `range` — Horizontal padding (step: 5)
- `select` — Font weight
- Typography and spacing settings as above

Button HTML must use `display: inline-flex`, `align-items: center`, `justify-content: center` so text is always vertically and horizontally centred. Never use richtext for button labels.

---

### IMAGE BLOCKS

- `image_picker` — Shopify native image picker
- `text` — Alt text field
- `range` — Max height or max width in px
- `range` — Border radius
- Render using `{{ block.settings.image | image_url: width: 800 }}`

---

### CHECKMARK BLOCKS

A single checkmark row: one icon + one line of text. The user stacks several to form a checklist / benefits list, so it must be addable multiple times.

- `text` — Label text (not richtext — avoids `<p>` wrapping)
- `color` — Checkmark icon color (default: a green like `#1a8a3f`)
- `color` — Text color
- `select` — Icon style (Checkmark / Circle-check / Dash), default: Checkmark
- `range` — Icon size in px (min: 10, max: 40, step: 1)
- `range` — Gap between icon and text in px (min: 0, max: 40, step: 2)
- Typography, alignment, and spacing settings as in PER-BLOCK SETTINGS

Render the icon as inline SVG (not an emoji or font glyph) so color and size are fully controllable. Lay out the row with `display: flex; align-items: center;` so the icon and text align on one line.

---

### TAG & MICROTEXT BLOCKS

Small-format text used as an eyebrow, label, badge, or pill. One block covers both looks via a style toggle.

- `text` — Tag text (not richtext), default: "New"
- `select` — Style (Plain microtext / Pill), default: Plain microtext
- `checkbox` — Uppercase (default: true)
- `color` — Text color
- `color` — Background color (applies in Pill style)
- `color` — Border color (applies in Pill style)
- `range` — Border radius (min: 0, max: 60, step: 2) — applies in Pill style
- `range` — Letter spacing in px (min: 0, max: 6, step: 1)
- `range` — Horizontal padding (step: 2) and `range` — Vertical padding (step: 2) — applies in Pill style
- Typography, alignment, and spacing settings as in PER-BLOCK SETTINGS

In Plain microtext style, render as inline text with no background/border. In Pill style, render with `display: inline-flex; align-items: center;` plus the background, border, radius, and padding. Default microtext font size should be small (e.g. 12–13px) when theme font is off.

---

### SECTION-LEVEL SETTINGS (global, not per-block)

- `color` — Section background color
- `range` — Max section width (min: 400, max: 1400, step: 10, default: 860)
- `range` — Section padding top (step: 5)
- `range` — Section padding bottom (step: 5)
- Any other globals that apply across all blocks (e.g. divider color, alternating row color)

---

### CSS RULES

- Every CSS rule must be prefixed with `#{{ section_id }}` to prevent conflicts.
- Dynamic values (colors, sizes, spacing) from settings must be rendered inline via Liquid inside the `<style>` block — this is correct and expected for Shopify sections.
- Static structural CSS (display, grid, flex, border-radius on non-configurable elements) goes in the `<style>` block.
- Per-block dynamic styles (colors, font sizes, margins set per block) go in `style=""` inline attributes on the block's HTML element.
- Reset `p { margin: 0; padding: 0; }` inside any element that renders richtext output.

---

### NAMING AND LENGTH RULES

Count characters before writing. Long names are the most common failure.

**Shopify hard limits (the theme errors on upload if exceeded):**

| Item | Limit |
|---|---|
| Section schema `"name"` | 25 characters, spaces included |
| Block schema `"name"` | 25 characters, spaces included |
| Sections per JSON template | 25 |
| Blocks per section | 50 |
| Template JSON file size | 512 KB |
| Section IDs and block IDs inside a template JSON | alphanumeric only (no hyphens, underscores, or spaces) |

**House conventions (always follow):**

| Item | Rule |
|---|---|
| Preset `"name"` | 25 characters max, same as the section name |
| Section file name | lowercase, hyphens, no spaces, 2–3 words (e.g. `lp-hero.liquid`) |
| Template file name | `page.<suffix>.json`, suffix lowercase letters, numbers, hyphens, short (e.g. `page.lp.json`) |
| Block `"type"` | short snake_case (e.g. `comparison_row`) |
| Setting `"id"` | snake_case, unique within its section or block |
| Setting `"label"` | under 40 characters so the Customizer sidebar does not truncate |

**How to shorten a name:**
1. Name by function, not design: `Hero`, `Comparison Table`, `FAQ Accordion`.
2. Drop filler words: Section, Block, Container, Wrapper, Custom, Component.
3. If still over 25, cut words, never letters mid-word.

| Too long | Fixed |
|---|---|
| Frequently Asked Questions Accordion (36) | FAQ Accordion (13) |
| Testimonial Carousel Slider (27) | Testimonial Slider (18) |
| Subscription Benefits Comparison Table (38) | Benefits Comparison (19) |

Core block names are fixed: `Heading`, `Subtext`, `Button`, `Image`, `Checkmark`, `Tag`.

---

### FULL-PAGE MODE

1. **Split the page** top to bottom, one section per visually distinct full-width band. Do not merge unrelated bands; do not split one band in two. State the split as one line per section (file name + purpose), then proceed. Ask only if the split is genuinely ambiguous.
2. **Name consistently.** Pick one short page prefix (max 6 characters, lowercase). Section files are `{prefix}-{role}.liquid` (e.g. `lp-hero.liquid`, `lp-faq.liquid`); the template is `page.{prefix}.json`. Each file's `section_id` assign prefix is its own file name stem so IDs never collide across the page.
3. **Build each section to the full spec.** Every section file follows every rule in this skill: six core blocks defined, per-block settings, scoped CSS, schema, preset. Sections are self-contained. No shared snippets, no cross-section dependencies, no header or footer unless asked.
4. **Assemble the template JSON.** JSON templates do not read presets, so repeat each section's preset content in the template. Structure:

```json
{
  "sections": {
    "hero": {
      "type": "lp-hero",
      "blocks": {
        "heading1": { "type": "heading", "settings": { "text": "Your headline" } },
        "button1": { "type": "button", "settings": { "label": "Shop now" } }
      },
      "block_order": ["heading1", "button1"],
      "settings": {}
    }
  },
  "order": ["hero"]
}
```

   - Section keys and block keys: alphanumeric only, unique within the template (`hero`, `faq2`, `heading1`).
   - `type` on a section = the section file name without `.liquid`.
   - `type` on a block = a block type defined in that section's schema.
   - `block_order` lists every block key in display order; `order` lists every section key in display order.
   - Setting keys must exist in the section or block schema. Omit settings left at their defaults.
   - Maximum 25 sections and 50 blocks per section.
5. **Validate** before delivering (see VALIDATION).
6. **Deliver** the files in theme layout:

```
sections/{prefix}-hero.liquid
sections/{prefix}-faq.liquid
templates/page.{prefix}.json
```

---

### VALIDATION

Run before delivering any output, and fix every error:

```bash
python <skill-folder>/scripts/validate_theme_files.py <output-dir>
```

The script checks schema name lengths, JSON validity, setting defaults, range and select definitions, file names, template section and block IDs, order arrays, block types against section schemas, and the section, block, and file size limits.

---

### SCHEMA RULES

- Section `"name"`, every block `"name"`, and the preset `"name"` are 25 characters or fewer (see NAMING AND LENGTH RULES)
- Schema must be valid JSON: no Liquid inside `{% schema %}`, no comments, no trailing commas
- Only one `{% schema %}` tag per file
- Section `"name"` should reflect the design (e.g. `"Comparison Section"`, `"Hero Banner"`)
- Every `text` type setting must have a non-blank `"default"` value (Shopify rejects blank defaults)
- Every `richtext` type setting must have a valid HTML default (e.g. `"<p>Your text here</p>"`)
- All `range` settings must have `min`, `max`, `step`, and `default`; keep (max − min) ÷ step at 100 or fewer
- All `select` settings must have an `options` array and a `default`
- Include a `"presets"` array with one preset named after the section (25 characters max), pre-populated with all blocks matching the screenshot
- Block IDs and section IDs are generated by Shopify in the Customizer; only write them by hand in a template JSON

---

### PRESETS

The preset must pre-populate all blocks with content matching the screenshot so the section looks correct immediately on install — no manual setup required.

Core block types that the screenshot does **not** use stay defined in the schema (so they're available in the "Add block" menu) but are **not** added to the preset. The install matches the brief exactly; the extra core blocks are there only when someone chooses to extend the section.

In full-page mode, the presets stay in every section file (so each section can be added elsewhere), and the template JSON repeats the same block content.

---

### CONFLICT SAFETY CHECKLIST

- [ ] All CSS scoped to `#{{ section_id }}`
- [ ] No global class names that could clash with theme CSS
- [ ] No `id` attributes on inner elements (only on the outer `<section>`)
- [ ] No inline `<script>` tags unless strictly necessary
- [ ] `{% assign section_id = 'SECTIONNAME-' | append: section.id %}` at the very top
- [ ] Every schema, block, and preset name counted at 25 characters or fewer
- [ ] Validator script passes with zero errors

---

### OUTPUT

Single-section mode: deliver a single `.liquid` file, ready to paste into `sections/` with no modifications needed.

Full-page mode: deliver every section file plus the template JSON in theme layout (`sections/`, `templates/`), ready to upload with no modifications needed.

All output works on first upload.
