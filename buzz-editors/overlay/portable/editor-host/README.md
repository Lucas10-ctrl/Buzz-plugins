# Editor repository worker

This lab-owned process exposes the retained Page Builder, Canvas and Docs repositories to the original views and scoped Buzz agent tools. The original content formats and revision checks remain with those repositories. The desktop process resolves its own data directory; the development HTTP adapter has a separately configured lab root.

Canvas generation reuses the original Higgsfield provider, generation service and durable records. The desktop worker reads its separate lab credential through `buzz-editor-credentials`; frontend actions expose status/set, generation jobs and image reads, never a credential read. The development HTTP adapter refuses all seven generation operations. Credential setup does not submit a provider job.

Deployment configuration uses `BUZZ_EDITOR_HIGGSFIELD_BASE_URL`, `BUZZ_EDITOR_HIGGSFIELD_MODEL`, `BUZZ_EDITOR_GENERATION_POLL_MS` and `BUZZ_EDITOR_GENERATION_TIMEOUT_MS`; `generation-store.ts` validates defaults and ranges. No credential is read from environment variables. Stored generation records and image reads remain scoped to the selected lab workspace. Worker disposal stops polling, preserving submitted jobs for resume without resubmission.

Focused tests use simulated credentials, provider responses and isolated temporary files. OS keyring use, real provider jobs, desktop placement/Undo and live agent collaboration require separate acceptance.

Page Builder project exports prepare selected-section CSS, fonts and media through the same scoped resource reader as standalone HTML, then use the unchanged original Vercel/Shopify formatters. Managed-image copy and Shopify Liquid rewriting remain with those formatters. Full-document base URL and CSP metadata applies to every section. Each successful export returns an original-format folder inside a fresh snapshot under exports/; earlier exports/manual changes are preserved. Each exported file is bounded by the host’s 50 MB read limit; folders retain multiple independent assets. Local scripts, nested documents and CSP-restricted embedding still require further project-bundle support and currently fail explicitly.
