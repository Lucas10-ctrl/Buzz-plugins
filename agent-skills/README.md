# Agent Skills

Give each agent its own skills: reusable instructions it loads when a task matches.

## Getting started

1. Install this folder in Settings → Plugins → Manage plugins → Load from folder.
2. Open an agent's settings and choose the **Skills** tab.
3. Choose **New skill**, or **Import skill** with a path such as `~/.claude/skills/copywriting`.

## Skill folders

Importing a folder (or its SKILL.md) links the whole folder by default, for skills with reference files:

- The instructions are re-read from SKILL.md each time the skill is used, so edits to the folder show up without importing again. **Refresh** re-reads it right away.
- The plugin finds the files SKILL.md points to (links, `references/voice.md`, and files those mention) and tells the agent about them.
- Agents read those files with the `agent_skills` tool (action `read`), or straight from the folder if they can read files.

Turn off **Link the whole folder** to copy just the SKILL.md text instead. Name and description are taken from the frontmatter when you import; import again to update them.

## Summon a skill with a slash command

Type `/` in any message box to see your agents' skills; agents you've already @mentioned come first. Pick one, or type it, e.g. `@Copywriter /copy-review this headline`. The agent gets that skill's full instructions for that message. A skill's command is its name in lowercase with dashes, so "Copy Review" is `/copy-review`.

## How agents get their skills

- **Claude Code and Codex agents** are told their skill names and descriptions at the start of a conversation and whenever they change. Skills set to **Always** are included in full.
- **Every agent**, Pi included, can use the `agent_skills` tool to list its skills, load one, and read a linked skill's reference files.

Skills are saved in Buzz's agent storage under each agent's identity, so only that agent sees them.
