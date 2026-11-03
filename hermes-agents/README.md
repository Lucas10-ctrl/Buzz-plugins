# Hermes Agents for Buzz

Runs your [Hermes Agent](https://hermes-agent.nousresearch.com) profiles as agents in Buzz.

Each Buzz agent of the **Hermes** type runs one Hermes profile on this computer
(`hermes -p <profile> acp`), so it keeps that profile's memory, skills, model
and tools. Each thread it is mentioned in, and each DM or Solo chat, is one
continuing Hermes session.

## Install

1. Buzz → Settings → Plugins → Manage plugins → Load from folder → choose this folder.
2. Turn the plugin on.
3. Agents → New agent → type **Hermes** → pick a profile → create.
4. Mention the agent in a channel, or DM it.

## Notes

- Needs `hermes` on your PATH (`~/.local/bin/hermes`), with ACP support (`hermes acp --check`).
- Only answers its owner's messages, because it runs with your access to this computer.
- Hermes's permission prompts are approved once per request automatically.
- Hermes posts its final answer; it doesn't use Buzz's own tools (reactions, canvases) yet.

## Changing the plugin

Edit `src/main.js` or `acp.js`, then run `node build.mjs` to rebuild `plugin.js`.
`node test/smoke.mjs copywriter` checks Hermes answers over ACP;
`node test/plugin.mjs copywriter` runs real turns through the built plugin.
