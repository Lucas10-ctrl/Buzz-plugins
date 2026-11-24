# generate-design: building an ad (or a screen) in Canvas

The Canvas counterpart of Figma's `figma-generate-design`. Use it when you design from a brief, rebuild a reference ad, or
lay out a new frame from a brand. Read `canvas-use` first.

## Step 1: understand the deliverable
- Size: 1:1 1080×1080 (feed), 4:5 1080×1350 (feed), 9:16 1080×1920 (Stories/Reels; keep words out of the top 270 px and
  bottom 670 px), or the reference's exact size.
- The one message the ad must land, the proof it shows (stars, numbers, UI, before/after) and the action.
- If there is a reference image, list its parts top to bottom: background (photo, colour, gradient), headline, sub-lines, UI
  mock-ups, stickers/badges, arrows/handwriting, logo. Note fonts (match them to a Google family), colours (hex), sizes as a
  share of the frame, rotations, shadows and blurs.

## Step 2: collect what the project already has
- `getStyleGuide`: brand colours, fonts, voice.
- `getDesignSystem {designId}`: components, text styles, variables and their modes, named layers per frame.
- `listDesignTemplates {query}`: a ready layout may cover most of the ad; insert it and re-brand rather than draw it again.
- Pictures: use the project's own photos and product shots (`createImageAsync` with their paths). Brand marks and icons come
  from `canvas.icon(...)`; never redraw a logo from primitives.
- Fonts: load every family you need at the top of the script. Upload brand fonts once (`uploadDesignFont`).

## Step 3: the frame
```js
for (const n of figma.currentPage.children.filter(n => n.name === 'Ad / Google 9:16')) n.remove()   // idempotent re-runs
const last = figma.currentPage.children.at(-1)
const ad = figma.createFrame(); ad.name = 'Ad / Google 9:16'; ad.resize(1080, 1920); ad.clipsContent = true
ad.x = last ? last.x + last.width + 120 : 0; ad.y = 0
```
Background first (picture fill with `scaleMode: 'FILL'`, or a gradient), then washes and tone layers (gradients, MULTIPLY /
SOFT_LIGHT rectangles), then content.

## Step 4: the content, section by section
- Group related pieces into auto-layout frames (`figma.createAutoLayout`) so text changes reflow: a headline block, a search
  bar (icon + query), a result card (title, stars row, meta), a chip list, a CTA button. Place each block with `x`/`y` on
  the ad, or stack them in one vertical auto-layout column with `SPACE_BETWEEN`.
- Repeated pieces (chips, notification cards, list rows, stat cards) are a component plus instances; override only the text
  and visibility of instance layers.
- UI mock-ups on a phone or laptop screen: a frame sized to the screen area, `clipsContent`, `cornerRadius` (and
  `cornerSmoothing: 0.6` for iOS), placed over the photo's screen; draw the UI inside at real proportions.
- Free decorations last: rotated stickers (auto-layout pill, rotation, drop shadow), handwritten notes (Caveat or another
  script font, rotated), hand-drawn arrows (`createNodeFromSvg` with a round-capped path), circular zooms (an ellipse mask or
  a round clipping frame with a thick ring).
- Effects: drop shadows for lift (radius 16–40, alpha 0.15–0.35), `BACKGROUND_BLUR` for frosted panels, `LAYER_BLUR` for glows.
- Colour in one word: `setRangeFills` on the same text; a second font in one line: `setRangeFontName`.
- Emoji go straight into `characters` (they draw in colour).

## Step 5: validate
1. Read `warnings` and `unmeasuredText` from the script result: fix anything listed.
2. `viewDesign {artboardId, scale: 0.5}` (9:16) or `scale: 1` (1:1). Compare with the reference side by side in your head:
   layout and proportions, type sizes and weights, colours, what is in front of what.
3. One fix script for everything you saw, then one more look. Stop when it matches.
4. `exportDesign {artboardId, scale: 1}`.

## Step 6: updating an existing ad
`getDesignMetadata {designId, nodeId: adId}` for its structure, then a script that finds the layers by name
(`ad.query('TEXT[name=Headline]').first()`) and changes only them. Keep ids stable; do not rebuild unless the layout changes.

## Best practices
- Reach for whatever Plugin API feature expresses the design best; Canvas supports the same set for ads, and refuses (with an
  alternative) rather than drawing something wrong.
- One script per ad is normal; it is atomic and fast (1–5 s).
- Name layers for what they are (`Headline`, `Search bar`, `Sticker`), so later edits and templates can find them.
- Keep component masters off the artboard (below it), so exports stay clean.
- $0 rule: reuse the project's pictures; do not generate images unless the user asked and approved.
