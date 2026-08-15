# Codex adapter

> **Safe CLI default:** a digest-bound effective-policy receipt is required before the
> exporter writes a custom-agent file. Without it, RoleHub emits only a compatibility
> report. Optional capabilities remain disabled unless the receipt grants them.

Status: initial target for Codex CLI `0.145.0` and the current standalone custom-agent
format.

Official references:

- [Subagents and custom agents](https://developers.openai.com/codex/subagents)
- [Build skills](https://developers.openai.com/codex/skills)
- [Configuration reference](https://developers.openai.com/codex/config-reference)
- [AGENTS.md](https://developers.openai.com/codex/guides/agents-md)

## Default export

RoleHub emits a project-scoped standalone custom agent:

```text
<output>/
├── .codex/
│   └── agents/
│       └── <role-slug>.toml
└── .rolehub/
    └── export-report.json
```

Current Codex custom-agent files require `name`, `description`, and
`developer_instructions`. They may also carry ordinary session settings such as `model`,
`model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, and `skills.config`.

```toml
name = "security_reviewer"
description = "Review a change for concrete correctness and security risks."
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
...compiled RoleHub prompt...
"""
```

Codex identifies the agent by its `name` field; the filename is only a convention.
RoleHub converts portable kebab-case names to deterministic snake_case while preserving
the canonical role id and digest in the export report.

## Skills and no-pollution mode

Codex discovers repository skills under `.agents/skills` from the working directory up to
the repository root, and user skills under `$HOME/.agents/skills`. Installing a role's
skills into either location makes them discoverable outside that role.

The default RoleHub exporter therefore compiles instruction-only skill bodies into
`developer_instructions` and records the loss of progressive disclosure as `degraded`.
It does not write user-global skills. A caller may explicitly request native project
skills, in which case the exporter writes `.agents/skills/<name>/SKILL.md` and reports the
broader project visibility.

Scripts or skill-owned executable dependencies are unsupported in v1alpha1.

## Capability mapping

| RoleHub intent                | Codex mapping                        | Fidelity                                        |
| ----------------------------- | ------------------------------------ | ----------------------------------------------- |
| role prompt                   | `developer_instructions`             | exact                                           |
| description                   | `description`                        | exact                                           |
| model capability class        | resolved `model`, pinned in report   | degraded                                        |
| reasoning effort              | `model_reasoning_effort`             | exact when supported                            |
| read-only workspace           | `sandbox_mode = "read-only"`         | exact for sandboxed writes                      |
| workspace writes              | `sandbox_mode = "workspace-write"`   | degraded when source paths are narrower         |
| MCP server                    | per-agent `mcp_servers` config       | exact for configuration, subject to host policy |
| instruction-only skills       | compile into instructions            | degraded                                        |
| native skills                 | `.agents/skills`                     | degraded due project-wide discovery             |
| named built-in tool allowlist | no general custom-agent allowlist    | unsupported                                     |
| per-role approval policy      | child inherits live parent overrides | advisory/unsupported                            |
| room invite/leave             | RoleHub runtime concern              | unsupported by static export                    |

Codex reapplies a parent turn's live sandbox and approval overrides when spawning a child.
Consequently, a native subagent file alone is not a hard per-role permission boundary. A
strict Room runtime must use a dedicated Codex session/process with an operator-owned
policy envelope, or reject the role when its required denial cannot be enforced.

`AGENTS.md` is intentionally not the role target. It is durable repository guidance and
would affect unrelated agents working under its directory.

## Strict failures

Strict export fails when the source role requires:

- a built-in tool allow/deny combination Codex cannot enforce;
- a path or domain policy narrower than the generated sandbox can enforce;
- per-role interactive approval behavior that a parent can override;
- session-scoped memory or leave-time erasure;
- automatic tool, MCP, plugin, or package installation; or
- an executable skill.

Best-effort export may still render instructions, but the report must not label an
advisory prompt as an enforced permission.
