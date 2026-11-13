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
- Only answers its owner's messages, because it runs with your access to this computer,
  and handoffs from the owner's other agents (checked by the owner's signed
  attestation on their messages).
- **Agents taking turns:** tag only the first agent and say the order, e.g.
  "@Copywriter write it, then Reviewer checks it". When an agent writes `@Name`
  of another of your agents in its reply, that agent is tagged and starts next,
  with the earlier replies in front of it. After 8 agent-to-agent handoffs in a
  row in one conversation, agents stop answering each other until you post again.
  Tagging several agents in one message still starts them all at once.
- Hermes's permission prompts are approved once per request automatically.
- Pictures and files in your message are downloaded through Buzz (they need your sign-in).
  Hermes sees pictures directly and gets each file's local path.
- Hermes posts its final answer; it doesn't use Buzz's own tools (reactions, canvases) yet.

## Changing the plugin

Edit `src/main.js`, `acp.js` or `nostr.js`, then run `node build.mjs` to rebuild `plugin.js`.
`node test/smoke.mjs copywriter` checks Hermes answers over ACP;
`node test/plugin.mjs copywriter` runs real turns through the built plugin;
`node test/image.mjs <picture.png> copywriter` checks Hermes sees an attached picture.
