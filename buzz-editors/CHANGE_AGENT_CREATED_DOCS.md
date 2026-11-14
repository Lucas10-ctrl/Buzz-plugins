---
title: "Editor Lab: let agents create Docs from any chat"
tags: [buzz, editor-lab, docs, spec]
status: active
created: 2026-11-03
---
Source thread: buzz://message?channel=e87b01b8-21c8-4a49-9ed2-a17a2b2e8646&id=9bd7421c32969fb7fe4f2123e329768b452902c02f82e5bdd2f7cf14c45c3d21
Repo: ~/Documents/GitHub/buzz-editor-lab/buzz-app (Editor Lab plugin, CopyOS port)

## Why it fails today
- `buzz_docs` is defined in `src/bundled/editor-lab/native/agent-bridge.ts` (`docsTool()`, ~L415).
- Every call looks up `bindings[agentKey:channel].docs`. If that's missing, it throws "Send a request from Docs before using its document tools" (~L447).
- A binding is only created in `useEditorConversation.tsx` (~L166, `bridge.bind`). That runs when the owner sends a request from the Docs UI, which opens a DM with the agent and binds one docId, scope (draft/document/selection), editMode (suggest/apply) and epoch.
- So the tool works only in that DM, on that one doc. A team channel thread never has a binding, and the agent has no create operation. The store already has `createDoc` (`docs-client.ts` L17); the agent just can't reach it.

## Proposed change
1. **New `createDoc` operation on `buzz_docs`** with input `{title, sections?: string[]}`. It doesn't need an existing binding.
2. **Gate it:** add a per-agent setting, "Let this agent create docs" (off by default). Also require a target workspace: either a "Default Docs workspace" setting, or "No workspace" (the existing unfiled bucket).
3. **Auto-bind after create:** set `bindings[agentKey:channel].docs = {docId, scope: "draft", editMode: "apply", epoch}` so `outlineDoc` / `writeDoc` / `appendDocSections` work straight away in the same turn and channel.
4. **Return a link:** use `docLink` from `docs-route.ts` so the agent can post a link that opens the Docs tab.
5. **Optional, phase 2:** a read-only `listDocs` across the workspace. Also allow re-binding to docs this agent created, so "update the plan doc" works in later turns. Edits to other people's docs still need an owner request from Docs.

## Risks
- Anyone in a channel can mention the agent, so they could get it to write docs on Lucas's machine. Mitigation: the setting is off by default; optionally, only honour createDoc when the triggering message's author is the agent's owner (check whether the tool `context` exposes the author).
- Bindings are in memory and keyed by channel. They are cleared on relay/session change (`install()`), which is acceptable for draft-in-one-turn.
- Docs are local to this lab (no community sync, per README). Teammates on other machines won't see them.

## Work
- agent-bridge.ts: add the op, the gate and the auto-bind.
- Settings UI: the toggle and the default workspace.
- agent-bridge.test.mjs: cases for create without a binding (allowed/denied), auto-bind then writeDoc, and wrong workspace refused.
- Size: small to medium, roughly 1 day including tests.

## Built (2026-11-03)
- `native/agent-bridge.ts`: `createDoc` op, `EditorDocCreation` gate, auto-bind (draft/apply), link via `docLink`.
- `native/AgentDocSettings.tsx` + `index.tsx`: Settings → Agent docs → "Let agents create docs" (off by default; per relay scope; docs go to the workspace selected in Docs).
- Gate as built: toggle on AND the agent runs on this device. Not built: "only when the owner asked" — tool `Context` carries no triggering author.
- Tests: 2 new in agent-bridge.test.mjs; editor-lab vitest 141/142 (index.test.tsx "three topbar destinations" fails before and after this change). tsc clean, biome clean on touched files.
- Package rebuilt (`bin/node plugin-package/build.mjs`) and prepared: editor-plugins/buzz.editors/56511166ec8c99665c4200ae/frontend. Needs import in Settings → Plugins + Buzz restart.
- Untracked lab code, no commit. Pre-change copies: ~/.buzz/.scratch/editor-lab-backup/, old package: ~/.buzz/.scratch/buzz-editors-plugin-package.bak

## Made inherent (2026-11-14)
- "Let agents create docs" is on by default (`readView(..., true) === false` refuses). The owner can still turn it off in Settings → Agent docs.
- Target workspace: the Solo workspace the chat is filed in (`soloPreferences.assignments[channel]`), else the one selected in Docs.
- `createDoc` returns `link` as `buzz://plugin?id=<plugin>&page=docs&route.workspaceId=…&route.docId=…` (`docChatLink`), which chat accepts and opens. `readDocNavigation` accepts that two-field form. Opening a link into another of the owner's workspaces switches Docs to it instead of showing an error.
- People: a **New doc** composer tool (`native/NewDocTool.tsx`) creates a doc in the same workspace and inserts its link or opens it. Hidden inside Docs' own request box.
- Tests: `NewDocTool.test.tsx` (2), `docs-route.test.ts` link round trip. Store-backed tests in agent-bridge/docs-move/docs-navigation fail in vitest before and after this change ("Missing legacy document section text", a Yjs instance mismatch in the test runner); the same store call works through the dev editor port.
