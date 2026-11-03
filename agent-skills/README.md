# Agent Skills

Give each agent its own skills: reusable instructions it loads when a task matches.

## Getting started

1. Install this folder in Settings → Plugins → Manage plugins → Load from folder.
2. Open an agent's settings and choose the **Skills** tab.
3. Choose **New skill**, or **Import SKILL.md** with a path such as `~/.claude/skills/copywriting`.

## Summon a skill with a slash command

Type `/` in any message box to see your agents' skills; agents you've already @mentioned come first. Pick one, or type it, e.g. `@Copywriter /copy-review this headline`. The agent gets that skill's full instructions for that message. A skill's command is its name in lowercase with dashes, so "Copy Review" is `/copy-review`.

## How agents get their skills

- **Claude Code and Codex agents** are told their skill names and descriptions at the start of a conversation and whenever they change. Skills set to **Always** are included in full.
- **Every agent**, Pi included, can use the `agent_skills` tool to list its skills and load one.

Skills are saved in Buzz's agent storage under each agent's identity, so only that agent sees them.
