# OpenCode adapter

> **Safe CLI default:** current RoleHub exports compile instruction-only skills into the
> agent prompt instead of emitting a workspace-relative `skills.paths`. This prevents an
> untrusted working tree from satisfying the role's skill allowlist. Runnable output is
> generated only with a digest-bound effective-policy receipt; network capabilities under
> `approval-required` become `ask`, not `allow`.

This adapter materializes a verified RoleHub role as an OpenCode custom agent. OpenCode
is an implementation target, not part of the RoleHub protocol: OpenCode-specific names
must stay in this adapter and its export report.

## Compatibility baseline

This document was checked against:

- OpenCode `v1.18.18` (released 2026-08-13);
- the stable `https://opencode.ai/config.json` schema available on 2026-08-15; and
- the stable OpenCode documentation, not the beta V2 plugin API.

The adapter must record the OpenCode version and schema digest used for every export.
Unknown newer versions are unsupported in strict mode until their schema passes the
adapter compatibility tests.

## Native representation

OpenCode has a close native representation for a RoleHub role:

- a Markdown custom agent supplies the role description, system prompt, model hints,
  mode, and per-agent permissions;
- portable skills remain `SKILL.md` directories and are loaded on demand by the native
  `skill` tool;
- optional prompt commands become Markdown files in `commands/`; and
- built-in, custom, and MCP tools are restricted with the agent's `permission` map.

Use `OPENCODE_CONFIG_DIR` for generated output. Do not install community roles in
`~/.config/opencode`, and do not modify the user's repository-level `.opencode`
directory.

## Support matrix

| RoleHub concept                  | OpenCode target                                                | Support              | Notes                                                                                            |
| -------------------------------- | -------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Role id                          | `agents/<slug>.md` filename                                    | Native               | The exporter creates a collision-resistant, lowercase slug and records the reverse mapping.      |
| Display name and description     | Agent `description` and export metadata                        | Native               | `description` is required by OpenCode. The full display name is not used as a filename.          |
| Role prompt                      | Agent Markdown body                                            | Native               | It becomes the custom agent prompt. Harness-neutral safety policy remains host-owned.            |
| Agent mode                       | `mode: primary`, `subagent`, or `all`                          | Native               | Default RoleHub export is `all`; a host may narrow it.                                           |
| Skills                           | `skills/<name>/SKILL.md` plus `skills.paths`                   | Native               | Names are prefixed when necessary to avoid collisions and must match their directory.            |
| Skill visibility                 | `permission.skill` patterns                                    | Native               | Emit deny-by-default rules, then exact allows for this role's skills.                            |
| Prompt commands                  | `commands/<name>.md`                                           | Partial              | The portable subset is Markdown plus `$ARGUMENTS` and positional `$1`, `$2`, ... placeholders.   |
| Built-in tool requests           | Agent `permission`                                             | Native               | Role requests are intersected with host and room policy before generation.                       |
| Approval (`ask`)                 | Permission action `ask`                                        | Native               | A headless broker must service permission requests; otherwise strict export fails.               |
| Path or command constraints      | Pattern-valued `read`, `edit`, `bash`, and related permissions | Native               | OpenCode uses wildcard patterns and last-match-wins ordering.                                    |
| Exact model id                   | `model: provider/model-id`                                     | Partial              | Only an explicit OpenCode override is lossless. Generic model requirements need host resolution. |
| Temperature / top-p / turn limit | `temperature`, `top_p`, `steps`                                | Native               | `maxSteps` is deprecated and must never be emitted.                                              |
| Child-agent delegation           | `task` permission and subagents                                | Native               | The room runtime still owns membership and routing.                                              |
| Local or remote MCP              | `mcp` config plus prefixed tool permissions                    | Host binding only    | A role may request a capability; it may not install or start an MCP server by itself.            |
| Custom tool implementation       | `.opencode/tools/*.ts` or `.js`                                | Rejected by v1alpha1 | These files execute code and may override built-ins.                                             |
| Plugin / lifecycle hook          | `.opencode/plugins/*` or npm plugin                            | Rejected by v1alpha1 | Plugins execute in-process and are not portable role data.                                       |
| Secrets                          | `{env:NAME}` in a host-owned binding                           | Reference only       | Secret values are never written to generated files or reports.                                   |
| UI, theme, color                 | Agent `color` or plugin UI                                     | Non-portable         | Cosmetic hints may be best-effort; they can never be required behavior.                          |

### Portable skill subset

Both OpenCode and Pi understand the Agent Skills-style fields `name`, `description`,
`license`, `compatibility`, and string metadata. The canonical exporter follows the
strictest shared rules:

- `name` is 1-64 lowercase alphanumeric/hyphen characters;
- it has no leading, trailing, or consecutive hyphen;
- it matches the directory containing `SKILL.md`; and
- `description` is 1-1024 characters.

Harness-specific fields such as `allowed-tools` are never treated as authorization.
OpenCode ignores unknown skill frontmatter, so required behavior must not depend on it.

## Capability mapping

The core manifest contains abstract capability requests. The adapter resolves those
requests only after host and room policy have approved them. Suggested built-in
bindings are:

| Abstract capability  | OpenCode permission  | Important behavior                                                  |
| -------------------- | -------------------- | ------------------------------------------------------------------- |
| `workspace.read`     | `read`               | Match allowed paths explicitly when the role is path-limited.       |
| `workspace.list`     | `list`, `glob`       | These are separate permissions.                                     |
| `workspace.search`   | `grep`               | Match the search pattern when policy requires it.                   |
| `workspace.write`    | `edit`               | `edit` also gates `write` and `apply_patch`.                        |
| `process.exec`       | `bash`               | Emit a catch-all deny/ask rule before specific command patterns.    |
| `agent.delegate`     | `task`               | Restrict by target agent pattern.                                   |
| `skill.load`         | `skill`              | Restrict to the generated skill names.                              |
| `user.question`      | `question`           | Non-granular.                                                       |
| `network.fetch`      | `webfetch`           | Can be restricted by URL pattern.                                   |
| `network.search`     | `websearch`          | Availability also depends on the configured provider/runtime.       |
| `language.lsp`       | `lsp`                | OpenCode currently documents this tool as experimental.             |
| `workspace.external` | `external_directory` | This is an additional guard, not a replacement for read/edit rules. |

An abstract custom capability resolves through a host-owned binding table to an
already-installed custom or MCP tool name. No binding means unsupported. Wildcard
bindings are forbidden unless the host policy explicitly approves the expanded set.

## Generated output

For a role `io.github.ishuowang/finance-controller@1.2.0`, an export is materialized in
a content-addressed directory such as:

```text
exports/opencode/<manifest-sha256>/
├── opencode.json
├── agents/
│   └── rh-ishuowang-finance-controller.md
├── skills/
│   ├── rh-finance-controller-budget-review/
│   │   ├── SKILL.md
│   │   └── references/
│   └── rh-finance-controller-financial-report/
│       └── SKILL.md
├── commands/
│   └── rh-finance-controller-close-month.md
└── rolehub-export.json
```

`opencode.json` points `skills.paths` at the generated `skills/` directory. It contains
only target configuration derived from the effective policy. MCP definitions, custom
tool paths, credentials, and plugins may be merged only from a separate trusted host
overlay; they are never copied from a role bundle.

The generated agent starts from deny-by-default permissions. Specific grants follow the
catch-all because OpenCode evaluates matching patterns in order and the last match wins:

```markdown
---
description: Reviews budgets, forecasts cash flow, and explains financial risk.
mode: all
temperature: 0.1
steps: 12
permission:
  '*': deny
  read:
    '*': deny
    'reports/**': allow
  glob: allow
  grep: allow
  edit: deny
  bash:
    '*': deny
    'git diff *': allow
  task: deny
  external_directory: deny
  skill:
    '*': deny
    'rh-finance-controller-*': allow
---

You are the finance controller for this room.

Review evidence before making a claim. Explain assumptions and material risks. Do not
approve payments, sign agreements, or represent that advice has received human review.
```

The export report must include the source role id, version, manifest digest, adapter and
harness versions, generated filenames, effective permission map, target bindings,
warnings, rejected fields, and whether the export was strict or best-effort.

## Starting a role

For a one-shot compatibility check, the runner may execute:

```bash
OPENCODE_CONFIG_DIR=/absolute/path/to/export \
  opencode run \
  --agent rh-ishuowang-finance-controller \
  --format json \
  --dir /absolute/path/to/workspace \
  "Summarize the current budget risks."
```

For a Room member, prefer one loopback-only OpenCode server per member. The broker
creates a session, sends messages with the generated agent id, consumes events, and
answers permission requests through the documented server API. Protect the server with
a generated password even on loopback. Never add `--auto`: it changes `ask` decisions
into automatic approvals unless they are explicitly denied.

## Invite, resume, and leave semantics

1. Resolve the role to an immutable manifest digest and verify it.
2. Compute effective permissions as the intersection of role request, adapter support,
   host policy, room policy, and the user's grant.
3. Generate a fresh per-member config directory and export report.
4. Start the member's process/server with that directory and exact role id.
5. Persist the role digest, export digest, OpenCode version, session id, and effective
   permissions in the room membership record.
6. Resume only with the same digests. An available newer role version is not an update.
7. On leave, stop accepting work, abort or finish the current turn according to room
   policy, terminate the member process, revoke its secret handles, and delete the
   ephemeral export. Retain transcript and immutable bundle cache according to audit
   policy.

A shared OpenCode server is an optimization, not a security boundary. It shares process
state, config, plugins, MCP connections, and credentials. Community roles use separate
processes by default.

## Isolation and security limits

`OPENCODE_CONFIG_DIR` prevents RoleHub from writing user-global or project configuration,
but it is composition isolation, not an operating-system sandbox. OpenCode still merges
other applicable config sources, and project/global plugins execute code. Managed
settings may further restrict an export and must never be bypassed.

For untrusted repositories or unattended work, run the member in a container, VM, or
equivalent sandbox with a minimal workspace mount, network policy, and short-lived
credentials. A permission map limits model tool calls; it does not make arbitrary plugin
code safe.

Custom tools are especially sensitive because OpenCode permits a custom tool with the
same name to replace a built-in tool. The exporter therefore never creates a `tools/` or
`plugins/` entry from community content.

## Strict failure boundaries

Strict export fails with a machine-readable incompatibility when any of the following is
true:

- a required abstract capability has no approved OpenCode binding;
- effective policy denies a capability marked required by the role;
- a role asks to ship a plugin, custom tool, MCP executable, package, script, binary,
  symlink, lifecycle hook, or literal secret;
- a required model constraint cannot be resolved to an available permitted model;
- the caller cannot service a required `ask` permission in headless mode;
- two generated agents, skills, commands, or tool bindings collide after normalization;
- a skill violates the portable naming/frontmatter rules;
- a required command uses OpenCode-only shell interpolation (`!` command syntax) or
  automatic file inclusion (`@path`) without an explicit trusted target override;
- the installed OpenCode version or config schema is outside the adapter's tested range;
- a target field would have to be silently dropped or weakened; or
- the generated config fails validation against OpenCode's current schema.

Best-effort mode may omit only optional behavior. Every omission is recorded in
`rolehub-export.json`; it may never convert `deny` to `ask`, `ask` to `allow`, broaden a
pattern, choose a more capable tool, or insert a secret.

## Official sources

- [OpenCode agents](https://opencode.ai/docs/agents/)
- [OpenCode Agent Skills](https://opencode.ai/docs/skills/)
- [OpenCode permissions](https://opencode.ai/docs/permissions/)
- [OpenCode commands](https://opencode.ai/docs/commands/)
- [OpenCode custom tools](https://opencode.ai/docs/custom-tools/)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/)
- [OpenCode config and `OPENCODE_CONFIG_DIR`](https://opencode.ai/docs/config/)
- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [OpenCode JSON Schema](https://opencode.ai/config.json)
- [Official OpenCode repository](https://github.com/anomalyco/opencode)
