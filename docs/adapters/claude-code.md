# Claude Code adapter

> **Safe CLI default:** a digest-bound effective-policy receipt is required before the
> exporter writes `agents.json` or a project agent. Missing required grants, room
> transport, process isolation, or host enforcement produces report-only output even in
> best-effort mode.

This adapter turns a verified RoleHub role into a Claude Code agent definition.
Claude Code is an implementation target, not the source of the RoleHub schema.

The default export is ephemeral: RoleHub passes definitions through Claude Code's
session-scoped `--agents` flag instead of installing agents or skills into a user's
global configuration. This keeps an invited role out of `~/.claude`, and leaving a room
does not require uninstalling user-level skills.

This document targets Claude Code 2.1.210 or later for the v1alpha1 adapter. The runtime
must still check `claude --version` and the generated export report before launch. Do not
assume that an experimental or newly documented field exists on an older executable.

## Official references

- [Custom subagents](https://code.claude.com/docs/en/sub-agents): agent scopes,
  frontmatter, `--agents`, scoped MCP servers, skills, permissions, and worktrees.
- [Skills](https://code.claude.com/docs/en/skills): `SKILL.md`, progressive disclosure,
  tool grants, invocation controls, and Claude-specific extensions.
- [MCP](https://code.claude.com/docs/en/mcp): server configuration, transports,
  environment expansion, approvals, and managed restrictions.
- [Permissions](https://code.claude.com/docs/en/permissions): tool rules and their
  precedence.
- [Sandboxing](https://code.claude.com/docs/en/sandboxing): filesystem and network
  boundaries and the important limitation that the sandbox covers Bash subprocesses,
  not every Claude Code tool.
- [Agent teams](https://code.claude.com/docs/en/agent-teams): native teammate behavior
  and current limitations.
- [CLI reference](https://code.claude.com/docs/en/cli-usage): `--agent`, `--agents`,
  `--settings`, `--mcp-config`, `--strict-mcp-config`, and `--bare`.
- [Anthropic's skills repository](https://github.com/anthropics/skills): official
  examples of the portable Agent Skills directory shape.

## Export statuses

Every exported field is classified in `export-report.json`:

- `exact`: the target preserves the RoleHub meaning. Host policy may still narrow it.
- `degraded`: the target can run the role, but a documented semantic difference remains.
- `advisory`: the value is retained for the model, lock file, or operator, but Claude
  Code does not enforce it.
- `unsupported`: Claude Code cannot represent the requested behavior.

Strict mode fails when a required field is `degraded` or `unsupported`. Best-effort mode
may continue only after recording the affected JSON Pointer, reason, fallback, and risk.
No mode may silently discard a required capability.

## Default: ephemeral `--agents` mode

`--agents` accepts a JSON object containing one or more custom agent definitions. These
definitions exist only for the current Claude Code session and have higher precedence
than project, user, and plugin agents, although administrator-managed agents still take
precedence.

RoleHub uses a collision-resistant Claude name such as
`rolehub-ishuowang-finance-controller-a1b2c3d4`. The canonical role id, version, and
manifest digest remain in `rolehub.lock.json`; they must not be reconstructed from the
Claude slug.

An ephemeral definition has this shape:

```json
{
  "rolehub-ishuowang-finance-controller-a1b2c3d4": {
    "description": "Review budgets, forecasts, and financial risk.",
    "prompt": "<rolehub_role id=\"io.github.ishuowang/finance-controller\" digest=\"sha256:...\">\n...role prompt...\n</rolehub_role>\n\n<rolehub_skill name=\"budget-review\" digest=\"sha256:...\">\n...portable skill instructions...\n</rolehub_skill>",
    "tools": ["Read", "Grep", "Glob", "mcp__ledger__query"],
    "disallowedTools": ["Skill", "Write", "Edit", "Bash"],
    "model": "sonnet",
    "permissionMode": "default",
    "maxTurns": 12,
    "mcpServers": [
      {
        "ledger": {
          "type": "http",
          "url": "https://ledger.example/mcp",
          "headers": {
            "Authorization": "Bearer ${LEDGER_TOKEN}"
          }
        }
      }
    ],
    "memory": "local",
    "effort": "high",
    "background": false,
    "isolation": "worktree"
  }
}
```

The `prompt` key is specific to the JSON accepted by `--agents`. In a filesystem agent,
the Markdown body supplies the same system prompt.

Claude Code currently accepts these agent-definition fields:

```text
description
prompt                 # --agents JSON only
tools
disallowedTools
model
permissionMode
maxTurns
skills
mcpServers
hooks
memory
background
effort
isolation
color
initialPrompt
```

Filesystem definitions additionally require `name` in their frontmatter. RoleHub v1
emits names using lowercase ASCII letters, numbers, and hyphens and never emits `:`,
which Claude reserves for plugin-scoped identifiers.

The launcher must pass JSON as one process argument. It must not interpolate role data
into a shell command. Conceptually:

```ts
spawn('claude', [
  '--agents',
  JSON.stringify(agents),
  '--agent',
  selectedAgentName,
  '--strict-mcp-config',
  '--mcp-config',
  runMcpPath,
  '--settings',
  runSettingsPath,
])
```

`--strict-mcp-config` prevents unrelated MCP configuration from loading. Claude's
official subagent documentation states that inline servers supplied explicitly through
`--agents` are not filtered by this flag. Administrator-managed MCP restrictions still
apply and may block a requested server.

`--bare` is useful for a hermetic scripted/API-key run, but it deliberately skips OAuth
and keychain reads. The adapter must not add it to an interactive subscription-authenticated
session without the operator choosing that authentication tradeoff.

## Capability matrix

| RoleHub concept                             | Claude Code target                   | Ephemeral subagent                            | Project export                                                          | Native agent team                                           |
| ------------------------------------------- | ------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| Canonical id, version, digest               | Lock and export report               | Exact outside Claude metadata                 | Exact outside Claude metadata                                           | Exact outside Claude metadata                               |
| Display/delegation description              | `description`                        | Exact                                         | Exact                                                                   | Exact                                                       |
| Role system instructions                    | `prompt` or Markdown body            | Exact, subject to host policy/context         | Exact, subject to host policy/context                                   | Degraded: body is appended to teammate system prompt        |
| Portable instruction-only skills            | Compiled prompt sections             | Degraded: eager rather than progressive       | Degraded: eager rather than progressive                                 | Degraded: eager and appended                                |
| Claude-installed skills                     | `skills` names                       | Supported but not the default                 | Supported but pollutes project skill discovery                          | Unsupported: ignored for teammates                          |
| Built-in tool availability                  | `tools`, `disallowedTools`           | Exact for known tool ids                      | Exact for known tool ids                                                | Exact for the honored teammate allowlist                    |
| MCP tool availability                       | `mcp__server__tool` entries          | Exact for a resolved server                   | Exact for a resolved server                                             | Degraded: server must be session-global                     |
| Per-role MCP server                         | Inline `mcpServers`                  | Exact                                         | Exact only without strict filtering, or through a strict session config | Unsupported: teammate ignores the field                     |
| Model family or exact Claude model          | `model`                              | Exact after model resolution                  | Exact after model resolution                                            | Exact, subject to organization allowlist                    |
| Effort                                      | `effort`                             | Exact for supported levels                    | Exact for supported levels                                              | Unsupported unless the team runtime adds it separately      |
| Maximum turns                               | `maxTurns`                           | Exact                                         | Exact                                                                   | Unsupported as a teammate role field                        |
| Background preference                       | `background`                         | Exact where the installed version supports it | Exact where supported                                                   | Advisory only                                               |
| Git checkout isolation                      | `isolation: worktree`                | Exact only for that narrow meaning            | Exact only for that narrow meaning                                      | Unsupported by native teammates                             |
| Persistent memory                           | `memory: user\|project\|local`       | Degraded for room-scoped memory               | Degraded for room-scoped memory                                         | Unsupported as a teammate role field                        |
| Approval mode                               | `permissionMode`                     | Degraded: parent mode can override it         | Degraded: session policy still wins                                     | Unsupported at spawn; inherited from team lead              |
| Fine-grained filesystem/network policy      | Session `--settings`                 | Exact only with one role per process          | Exact only with one role per process                                    | Unsupported per teammate                                    |
| Secret references                           | Runtime environment/header expansion | Exact when injected by the trusted runtime    | Exact when injected by the trusted runtime                              | Degraded to session scope                                   |
| Join, leave, room messaging                 | RoleHub runtime                      | Not a definition field                        | Not a definition field                                                  | Native team supports messaging, but not full role isolation |
| Timeout, concurrency, artifact verification | RoleHub runtime                      | External enforcement                          | External enforcement                                                    | External enforcement                                        |

An unknown required Claude tool, a required non-Claude model, or a required isolation
property that cannot be represented is a strict export error. An optional value may be
dropped only with an explicit warning.

## Skills without application pollution

Claude subagents can preload skills by name with a `skills` array, but that is not a
visibility boundary:

- project, user, and plugin skill descriptions remain discoverable by the session;
- a subagent can invoke unlisted skills through the `Skill` tool; and
- a skill with `disable-model-invocation: true` cannot be preloaded into a subagent.

The RoleHub default therefore does not copy role skills into `.claude/skills` or
`~/.claude/skills`. Because v1alpha1 skills are instruction-only, the exporter validates
them and compiles their Markdown instructions into clearly delimited sections of the
agent prompt. It then omits `Skill` from `tools` or places it in `disallowedTools`.

This mapping is reported as `degraded`, not `exact`, because eager prompt composition
loses native progressive disclosure. It preserves the role's standing instructions but
may consume more initial context.

RoleHub must not execute or silently translate Claude-specific skill behavior such as:

- ``!`command` `` dynamic context injection;
- skill `allowed-tools` grants;
- skill hooks;
- `context: fork` and `agent` execution directives; or
- scripts or package lifecycle actions.

In particular, Claude's `allowed-tools` skill field is a temporary permission grant,
not an allowlist. Treating it as a capability restriction would invert its security
meaning. A required Claude-specific behavior causes a strict error. Best-effort mode can
retain unsupported text as inert instructions only when the report makes that change
clear.

If a portable skill has reference material or assets, the runtime stages them under the
read-only role payload and adds explicit paths to the compiled prompt. A v1alpha1 bundle
cannot introduce scripts, binaries, symlinks, package installations, or lifecycle hooks.

## Tools and MCP

`tools` restricts which tools are visible to the agent. Omitting it means inheritance,
so RoleHub always emits an explicit allowlist. `disallowedTools` is then applied as an
additional fail-closed filter. Known MCP tools use Claude's canonical
`mcp__<server>__<tool>` names; `mcp__<server>` and `mcp__<server>__*` represent a whole
server where that breadth was explicitly requested.

Tool availability is not approval. Adding `Bash`, `Edit`, or an MCP tool to `tools` does
not authorize each call. Conversely, a RoleHub role may request a capability but can
never use its bundle to pre-approve that capability.

Claude Code supports inline `stdio`, `http`, `sse`, and `ws` MCP definitions. SSE is
deprecated in favor of HTTP when a provider offers both. The role archive never supplies
an executable MCP command. A trusted host-side provider registry resolves a logical
RoleHub capability to an installed, reviewed, and version-pinned MCP configuration.

Rules for generated MCP configuration:

1. Never serialize a credential value. Use a logical secret reference and inject it at
   runtime, commonly through `${ENV_VAR}` in an MCP `env` or `headers` value.
2. Never turn a community role reference into `npx -y ...@latest` or another implicit
   package installation.
3. Include only tools named in the effective capability intersection.
4. Treat a blocked, missing, or unhealthy required server as a launch failure.
5. Do not assume Claude's Bash sandbox contains an MCP server process. The documented
   sandbox boundary applies to Bash and its child processes; trusted MCP providers need
   their own containment and authorization.

For an ephemeral subagent, prefer an inline server object so it connects when that
agent starts and disconnects when it finishes. A string entry such as `github` shares a
server already configured in the parent session and is therefore not role-isolated.

## Permissions and isolation

The effective permission set is always:

```text
role request
  intersection adapter support
  intersection host policy
  intersection room policy
  intersection explicit user grant
```

Claude's `permissionMode` is a coarse interaction mode, not a portable permission
policy. Parent `bypassPermissions` or `acceptEdits` modes take precedence over a
subagent's frontmatter. A parent in auto mode also causes the subagent to use the parent
classifier policy. The exporter therefore never translates a role request into
`bypassPermissions` or `acceptEdits`.

Use the agent `tools` allowlist for the maximum capability boundary. Use trusted
session settings or trusted enforcement hooks for command, path, domain, and
action-specific decisions. Community role bundles cannot ship those hooks.

Claude's sandbox settings are session-wide, and subagents in one process share the same
sandbox. The sandbox also covers only Bash commands and their child processes; Read,
Edit, Write, WebFetch, and MCP calls continue through their respective permission
systems.

Consequences for RoleHub rooms:

- one Claude process per role can receive a role-specific `--settings` file;
- multiple roles with identical effective policies may share a process;
- roles with different filesystem, network, secret, or approval boundaries must not
  share a process in strict mode; and
- best-effort mode may use only a safe common intersection, with degraded capabilities
  reported. It must never use a union that lets one role inherit another role's access.

`isolation: worktree` gives a subagent an isolated Git checkout. It is not a container,
does not create a separate operating-system identity, and does not create a per-agent
sandbox. A RoleHub request for process, container, VM, credential, or network isolation
must be implemented by the external runtime or rejected.

Claude's `memory` value names user, project, or local persistent storage by agent name.
That does not equal a Room-scoped memory lifetime. `memory: none` maps exactly by
omission; a required Room-only memory scope needs RoleHub-managed storage or fails.

## Project export

Project export is an explicit alternative for teams that want a reviewable agent file in
version control. It must never write a user-global agent or skill.

```text
.claude/
└── agents/
    └── rolehub-ishuowang-finance-controller-a1b2c3d4.md
.rolehub/
└── exports/
    └── claude-code/
        ├── mcp.json
        ├── settings.json
        ├── rolehub.lock.json
        └── export-report.json
```

The generated agent file uses Claude's exact frontmatter keys:

```md
---
name: rolehub-ishuowang-finance-controller-a1b2c3d4
description: Review budgets, forecasts, and financial risk.
tools:
  - Read
  - Grep
  - Glob
  - mcp__ledger__query
disallowedTools:
  - Skill
  - Write
  - Edit
  - Bash
model: sonnet
permissionMode: default
maxTurns: 12
mcpServers:
  - ledger
effort: high
background: false
isolation: worktree
---

<rolehub_role id="io.github.ishuowang/finance-controller" digest="sha256:...">
...role prompt...
</rolehub_role>

<rolehub_skill name="budget-review" digest="sha256:...">
...portable skill instructions...
</rolehub_skill>
```

Project export uses server names that resolve from the generated `mcp.json`. Launch with
both `--strict-mcp-config` and that file. This avoids a subtle difference: strict MCP
configuration can filter inline MCP declared in a filesystem agent, whereas an inline
server passed explicitly through `--agents` is exempt from that particular filter.

Do not generate `.claude/skills` in the default project export. A user may explicitly
choose a `native-skills` compatibility option, but the report must state that the skill
metadata becomes available to the project session and that this is not role-exclusive.

## Native Agent Teams compatibility

Claude Code's native Agent Teams are useful for a shared task list and direct teammate
messaging, but they are currently an experimental, lower-fidelity RoleHub target.
RoleHub must not pre-author `~/.claude/teams/<team>/config.json` or
`~/.claude/tasks/<team>/`; Claude Code owns and rewrites that runtime state.

A teammate created from a custom agent definition currently receives:

- the definition's `tools` allowlist;
- its `model`; and
- the Markdown body appended to the teammate's system prompt.

It does not apply the definition's `skills` or `mcpServers`. Teammates load project/user
skills and MCP servers like regular sessions. They start with the team lead's permission
mode, and a per-teammate mode cannot be declared at spawn time. Native teammates also do
not get per-role worktrees from the role definition.

The `claude-team` exporter therefore:

1. compiles instruction-only skills into each definition body;
2. places the union of required, trusted MCP server definitions in the session-level
   `mcp.json` only in explicit best-effort mode;
3. restricts each teammate's visible MCP tool ids through its `tools` allowlist;
4. marks prompt composition, MCP isolation, permissions, memory, maximum turns, and
   worktree behavior as degraded or unsupported; and
5. fails strict export whenever the role requires any of those per-role guarantees.

The session-level MCP union is a real isolation loss: a server process and its tool
descriptions belong to the session even when a teammate's tool allowlist hides some
calls. Use the external RoleHub room sidecar with one Claude process per role when the
roles have different trust boundaries.

## Generated ephemeral files

The runtime uses a private per-run directory selected by its cache policy:

```text
<rolehub-cache>/runs/<run-id>/
├── agents.json
├── mcp.json
├── settings.json
├── rolehub.lock.json
├── export-report.json
└── payload/
    └── <canonical-role-id>/
        ├── prompt.md
        └── skills/
            └── <skill-name>/
                ├── SKILL.md
                ├── references/
                └── assets/
```

The launcher reads the verified prompt and skill files, composes `agents.json`, and then
makes the payload read-only. The Claude agent does not discover the staged `SKILL.md`
files as application skills; they are kept for provenance and referenced resources.

`rolehub.lock.json` records at least:

- canonical role and skill ids and versions;
- source repository and immutable commit, release, or OCI digest;
- manifest and file digests;
- resolved Claude agent name, model, tools, and MCP provider ids;
- adapter and Claude Code versions; and
- the effective permission-policy digest.

`export-report.json` records every exact, degraded, advisory, unsupported, or rejected
mapping. Neither file may contain secret values.

## Fail-closed checklist

The Claude adapter rejects launch when any of the following applies to a required field:

- the role artifact or lock digest does not verify;
- the installed Claude Code version is below the adapter baseline;
- a tool id has no reviewed Claude mapping;
- a trusted MCP provider cannot be resolved, is blocked by managed policy, or fails its
  required health check;
- a role requests executable skill content or implicit package installation;
- a literal credential appears in the role or generated files;
- a model requirement cannot resolve to an allowed Claude model;
- strict native-team export would weaken a per-role boundary; or
- the requested filesystem, network, memory, approval, or isolation guarantee cannot be
  enforced by the selected process topology.

An operator can choose best-effort export for optional capabilities, but the resulting
warnings remain machine-readable and visible before invitation. A model prompt is never
accepted as enforcement for a permission or isolation boundary.
