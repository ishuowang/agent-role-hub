# Claude Code compatibility

Package: `@ishuowang/rolehub-compat-claude-code`
Compatibility id: `claude-code`
Tested target: Claude Code CLI `>=2.1.210 <2.2.0`

This package compiles a verified universal role into Claude Code's native, session-scoped
`--agents` JSON. The host launches one dedicated Claude process for the role. Nothing is
installed into the user's global agents, skills, hooks, plugins, or MCP configuration.

## Why this native surface

`--agents` can define a subagent for one invocation and supports the fields RoleHub needs:
description, prompt, tools, denied tools, model, permission mode, and turn limits. A
dedicated `--bare` process keeps that role's policy and conversation boundary separate from
other room members while skipping auto-discovery of project/user hooks, skills, plugins,
MCP servers, memory, and instructions. The JSON file must be read and passed as a single
argv value—never expanded inside a shell command.

RoleHub instruction-only skills are compiled into that role's prompt. This avoids
Claude's user/project skill discovery, which would make the same skills visible beyond the
invited role. The mapping is reported as degraded where native skill isolation would be
stronger.

The launch recipe also selects Claude Code's `--bare` mode, disables slash-command skill
discovery, ignores ambient MCP configuration, disables browser integration, and passes the
effective tool list explicitly.

## Export

```bash
rolehub compat inspect claude-code
rolehub compat export ./roles/example \
  --using claude-code \
  --policy ./example.claude-code.policy.yaml \
  --scope session --out ./exports/example-claude
```

The session export contains:

```text
agents.json              # ephemeral native subagent definition
rolehub-claude.json      # argv-safe dedicated-process launch recipe
rolehub.lock.json        # source and policy provenance
.rolehub/                # generic compatibility report and lock
```

Project scope is deliberately **report-only**, even when the receipt says
`configuration: isolated`. A project agent file alone cannot prove that project/local
settings, hooks, plugins, MCP servers, skills, and instructions were removed at launch.
Runnable output therefore uses only the session-scoped `--bare --agents --agent` recipe.
The recipe is descriptive; the trusted host must create the process and enforce the
receipt.

## Capability and isolation rules

- Required capabilities must have both a Claude tool mapping and a policy grant.
- Optional capabilities remain absent unless explicitly granted.
- If one granted native tool also implements an ungranted or denied capability, export
  fails closed. For example, `Bash` cannot be granted for `shell.execute` while silently
  exposing an ungranted `source-control.write` capability without a trusted command broker.
- Tool allowlists narrow the model-visible tools; they do not replace host filesystem or
  network enforcement.
- A `dedicated` process receipt is required for runnable output.
- Project scope is never runnable in v0.2.0; strict project export fails and best-effort
  writes only the generic compatibility report.
- Prompt text is never treated as enforcement for secrets, approvals, side effects, or
  path access.
- Strict mode rejects required degraded/unsupported mappings. Best-effort may write a
  report, but no launcher when the plan is unsafe.

## Lifecycle

On invite, verify and pin the role digest, intersect policy, export `--agents`, and start
the dedicated process. On leave, stop message delivery, abort or drain current work,
revoke host grants, and terminate the process. Resume recreates the definition from the
same role digest and compatibility package version before accepting a message.

## Upstream references

- [Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Agent skills](https://code.claude.com/docs/en/skills)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [MCP](https://code.claude.com/docs/en/mcp)
