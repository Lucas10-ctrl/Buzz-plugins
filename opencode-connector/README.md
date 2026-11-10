# OpenCode connector for Buzz

Runs [OpenCode](https://opencode.ai) on this computer as agents in Buzz, on any
model OpenCode knows, including local models served by
[Lemonade](https://lemonade-server.ai) or any other OpenAI-compatible server.

Each Buzz agent of the **OpenCode** type runs `opencode acp` on the model you
pick. Each thread it is mentioned in, and each DM or Solo chat, is one
continuing OpenCode session.

## Install

1. Buzz → Settings → Plugins → Manage plugins → Load from folder → choose this folder.
2. Turn the plugin on.
3. Agents → New agent → type **OpenCode** → pick a model → create.
4. Mention the agent in a channel, or DM it.

## Local models (Lemonade)

The model list comes from `opencode models`, so a local model shows up once it
is in `~/.config/opencode/opencode.json`. For Lemonade:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "lemonade": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Lemonade (local)",
      "options": { "baseURL": "http://127.0.0.1:13305/api/v1", "apiKey": "none" },
      "models": {
        "Qwen3.8-Flash-Next-Halogen": { "name": "Qwen3.8 Flash Next Halogen", "tool_call": true, "limit": { "context": 131072, "output": 32768 } }
      }
    }
  }
}
```

Change the port and model names to match your Lemonade setup. New agents start
on `lemonade/Qwen3.8-Flash-Next-Halogen`; pick another model when you create
the agent or in its Settings tab.

## Notes

- Needs `opencode` on Buzz's PATH, with ACP support (`opencode acp --help`).
- Only answers its owner's messages, because it runs in your home folder with your access to this computer.
- OpenCode's permission prompts are approved once per request automatically.
- The first reply in a new conversation is the slowest, while OpenCode starts and the model reads its system prompt.
- OpenCode posts its final answer; it doesn't use Buzz's own tools (reactions, canvases) yet.

## Changing the plugin

Edit `src/main.js` or `acp.js`, then run `node build.mjs` to rebuild `plugin.js`.
`node test/smoke.mjs <model>` checks OpenCode answers over ACP;
`node test/plugin.mjs <model>` runs real turns through the built plugin.
