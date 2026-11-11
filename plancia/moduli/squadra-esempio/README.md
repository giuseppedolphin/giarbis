# Example squad

Three roles in `ruoli.json`, the same for everyone who turns the module on:

| Role | Reports to | Job |
|---|---|---|
| `lead` | the person | keeps the backlog short, hands out work |
| `researcher` | `lead` | answers questions about the code, with file and line |
| `reviewer` | `lead` | reads a change before it is committed |

The assistant (the main session on the map) is the **advisor**: the squad writes to it with `ctl.mjs squadra advisor "…"`.

## Turn it on
1. Add `"squadra-esempio": {}` to `"moduli"` in `plancia.config.json`.
2. Restart the server, open the **Squadra** panel and switch the squad on.

## What an agent can do
Each role runs as a Claude Code session in your repo, on your machine only. By default it reads and proposes (`autonomia: "rodaggio"`).
Two knobs, both in `ruoli.json`:
- `permessi`: a list of allow rules passed to `claude` as `--allowedTools`, for example `["Bash(git diff:*)"]`; the session runs with `--permission-mode auto`, so these rules apply before the classifier.
- `autonomia`: `"operativo"` lets a role act inside its mandate; keep `"rodaggio"` until you trust it.

Nothing here talks to a service outside your machine except Claude Code itself.

## Make it yours
Copy this folder, rename the module, and rewrite the three `.md` mandates. One mandate per role: what it does, what it never does.
