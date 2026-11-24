# figma-tools: Figma's MCP tools and their Canvas equivalents

Figma's MCP server has 46 tools. These are the ones that matter for designing ads, and what to use in Canvas instead.

| Figma tool | What it does | Canvas |
|---|---|---|
| `use_figma` | Run Plugin API JavaScript | `runCanvasScript {designId, expectedRevision, code}` (same API) |
| `create_new_file` | New design file | `createDesign {title}` |
| `create_session` | File session | Not needed: `workspaceId`/`projectId` is supplied by the host |
| `get_screenshot` | Picture of a node | `viewDesign {designId, artboardId, scale, top?, height?}` (= the export) |
| `get_metadata` | XML layer outline | `getDesignMetadata {designId, nodeId?, depth?}` |
| `get_design_context` | Code + screenshot for design-to-code | `inspectDesign`, `getDesignMetadata`, `readDesign`; pages: `previewDesignPage` / `buildDesignPage` |
| `get_variable_defs` | Variables and styles used | `getDesignSystem {designId}` |
| `search_design_system`, `get_libraries` | Find components/styles in libraries | `getDesignSystem`, `listDesignTemplates {query, category}`, `readDesignTemplate`, `getStyleGuide` |
| `upload_assets` | Put pictures into the file | `figma.createImageAsync(path \| URL)` in scripts, `putDesignImage {source}`, `placeDesignImage {nodeId, source, scaleMode}` |
| `download_assets` | Export node pictures | `exportDesign {designId, artboardId, scale}` (writes the PNG, returns its path) |
| `generate_vector_illustration` | AI vector art | `canvas.icon(name)` (67 line icons, 17 brand marks) + `figma.createNodeFromSvg(svg)` for SVG you write; no AI generation |
| `generate_image` | AI picture | Not in Canvas (paid; Studio's `generate_image` asks the user to approve). Reuse project pictures. |
| `get_comments` | Read comments | `listDesignComments`, `addDesignComment`, `setDesignCommentStatus` |
| `generate_figma_design` | Capture a web page as a design | Not in Canvas; rebuild with a script, or use page building for Studio pages |
| `whoami` | Account | Not needed |
| Fonts (inside `use_figma`) | `loadFontAsync`, `listAvailableFontsAsync` | Same, plus `installDesignFonts {families}`, `uploadDesignFont {source}`, `listDesignFonts` |

Not relevant to ads (no Canvas equivalent planned): Code Connect (`get_code_connect_map`, `add_code_connect_map`,
`get_code_connect_suggestions`, `send_code_connect_mappings`, `get_context_for_code_connect`), FigJam and diagrams
(`get_figjam`, `generate_diagram`), motion and video (`get_motion_context`, `export_video`), shaders and generative plugins
(`list_file_shaders`, `list_shaders`, `get_shader`, `create_shader`, `update_shader`, `list_generative_plugins`,
`get_generative_plugin`, `create_generative_plugin`, `update_generative_plugin`), branching (`create_branch`),
`send_code_to_figma`, and the Weave model runner (`weave_*`, 10 tools).
