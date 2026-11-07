# Agent Cards

Agents ask you questions and for approvals as cards with buttons, instead of plain text.

- **Question card:** up to 5 questions in one card. Each is single choice, multiple choice or free text, with an optional "Something else" answer.
- **Approval card:** Allow once, Deny or Always allow, with an optional note to the agent. Always allow saves a rule, listed in the agent's **Approvals** settings tab, where you can remove it.

When you answer, the agent wakes in the same conversation with your answer and carries on.

Cards take the opposite of your **Vibe level** (Settings → Appearance) so they stand out: in the accent colour on Chillin', neutral on Buzzin'.

## Connect an app

When an agent needs a service you haven't connected, it posts a **Connect** card saying why. Paste a token from that service into the card's password field, choose whether only this agent or all your agents may use it, and click **Test and connect**. Agent Cards checks the token with the service, saves it to your system keychain, and wakes the agent to carry on.

- The token never goes into a message, the relay or the agent. The agent calls the service through its `connections` tool; Agent Cards adds the token and only ever sends it to that service's own API address.
- Services: GitHub, Notion, Asana, Linear, Slack, Airtable, Stripe, Klaviyo and HubSpot.
- Each agent's **Connections** settings tab lists them, connects new ones, replaces tokens and disconnects (which deletes the token from the keychain).
- Keychain: `secret-tool` on Linux (tested), the login keychain through `security` on macOS, and the Credential Vault through PowerShell on Windows (both not yet tested).

## Sign in (logins that aren't a token)

For services that log in another way, the agent posts a **Sign in** card (`cards_signin`):

- **Command-line logins** (`gh auth login --web`, `shopify auth login`, `vercel login`, …): the agent starts the login, and the card shows **Open sign-in page**, the address it opens and the one-time code with a **Copy** button. Click **I've signed in** when you're done.
- **Browser sign-ins** (a service's AI connection with "Sign in with…", like Notion or Linear): the agent adds the service to Claude Code (`claude mcp add`) or Codex, and the card shows the login command and a **Start sign-in** button. Nothing runs until you click it; then your browser opens. The new tools are ready in the agent's next conversation.

Logins already on your computer (like `gh`) need no card: agents running here use them directly.

## Enforced approvals (Claude Code and Codex agents)

Optional: turn on **Ask me before risky actions** in an agent's **Approvals** tab. From then on the agent can't run an action that matches your list until you approve it:

1. The agent tries, say, `git push` or a Gmail send. Agent Cards stops the call and tells the agent to ask.
2. The agent posts an approval card. The card shows the exact call, taken from what was stopped, not from the agent's description.
3. **Allow once** lets that exact call (same tool, same arguments) run one time when the agent retries. **Always allow** approves the tool from then on; for shell commands it approves only that exact command. **Deny** keeps it stopped.

The default list covers tools from other services that send, post, buy or delete, plus `git push`, `rm -r`, `gh pr create/merge`, `npm publish` and `curl` writes. Buzz's own tools are never stopped. You can edit the list; each line is a regular expression matched against the tool name, or `Bash: <command>` for shell commands.

Agents running with Buzz's security review (protected agents) don't run plugin hooks, so the guard can't stop them.

## Agent tools

| Tool | What it does |
| --- | --- |
| `cards_ask` | Posts a question card. Returns the card id; the agent ends its turn and is woken with the answers. |
| `cards_approval` | Posts an approval card for an action, or for a call Agent Cards stopped (`request`). Returns "approved" straight away if you set Always allow. |
| `connections` | Lists connected services, posts a Connect card for a missing one, or makes an authenticated request to a connected one. |
| `cards_answer` | Reads the answer to a card by id, for example after a restart. |

## Limits (v1)

- Answer cards on the computer that runs the agent. Other devices, and people without the plugin, see the card as plain text with the options listed.
- Enforcement works for Claude Code and Codex agents. Other agent types can ask with a card, but nothing stops them skipping it.
- Pattern matching is a safety net, not a sandbox: a determined agent could reach the same result with a command the list doesn't cover, such as a script it wrote itself.
- If the check itself fails, the call is stopped. If the app's overall 25-second hook budget runs out first (for example, another plugin's slow hook), the app lets the call run.
- Codex is wired up but not yet tested live; Claude Code is the tested path.

- Connections: a `call` can do whatever the token allows, and enforced approvals don't cover it. Prefer narrow, read-only tokens.
- Connections: the keychain tool gets 5 seconds; if your keychain asks you to unlock it, unlock it and try again. Two Buzz windows connecting at the same moment can lose one of the tokens.

## Permissions it asks for

- Running `secret-tool`, `security` or `powershell` with fixed arguments, to read and write its one keychain entry.
- Network access to the nine services' API addresses, and nothing else.
- Hooks on Claude Code and Codex agents, used only when you turn on enforced approvals.

## Install

Download or clone this repo, then in Buzz choose **Settings → Plugins → Manage plugins → Load from folder** and pick the `agent-cards` folder.

## Tests

```sh
node --test agent-cards/plugin.test.mjs
```
