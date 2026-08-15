# Codex compatibility

Package: `@ishuowang/rolehub-compat-codex`
Compatibility id: `codex`
Tested target: Codex CLI `>=0.145.0 <0.146.0`

This package renders a verified universal role as a dedicated `codex exec` launch recipe.
The verified role prompt is supplied through the official `developer_instructions` config
key as one explicit CLI override. It does not write `AGENTS.md`, install global skills, or
depend on ambient user configuration.

## Why this native surface

Codex custom-agent files configure spawned sessions; they do not select the primary
`codex exec` session. Emitting one beside the launcher would therefore configure a
different agent. RoleHub uses one consistent primary-session surface instead: an explicit
`developer_instructions` CLI config override plus `codex exec`. Instruction-only skills
compile into those instructions and do not become repository-wide discoverable skills.

The generated launcher uses an ephemeral, strict configuration; ignores user config and
exec-policy rules; disables apps and hooks; and records explicit sandbox and approval
arguments. The host must use sterile HOME/CODEX_HOME paths, sanitize project configuration,
TOML-encode the verified prompt as one argv value, and send the room turn through stdin.
It is still a recipe: the host owns process creation, workspace selection, OS/network
controls, secrets, and room delivery.

## Export

```bash
rolehub compat inspect codex
rolehub compat export ./roles/example \
  --using codex \
  --policy ./example.codex.policy.yaml \
  --scope session --out ./exports/example-codex
```

Output includes:

```text
.rolehub/role-prompt.md      # digest-bound assembled instructions
.rolehub/codex-launch.json   # dedicated codex exec recipe
.rolehub/compatibility-*.json
```

The launch recipe selects `read-only` unless both the role and policy allow workspace
write. It puts the global approval flag before `exec`, then uses
`--ephemeral --ignore-user-config --ignore-rules --strict-config`, disables apps and
hooks, sets `project_doc_max_bytes=0`, and chooses a sanitized workspace. The role prompt
becomes `developer_instructions`; stdin remains available for the actual room message.

When `shell.execute` is not an effective grant, the launcher adds
`--disable shell_tool`. When shell is granted, RoleHub checks the coupled command surface:
for example, shell in a writable workspace can perform source-control writes. If that
capability is denied or its approval-gated optional grant is absent, the export is
report-only because neither prompt text nor the broad sandbox mode distinguishes commands.

## Capability and isolation rules

- Runnable output requires a `dedicated` process receipt; developer instructions do not
  create a separate security principal.
- Filesystem and source-control writes are bounded by the selected sandbox and may be
  reported as degraded when the native scope is broader than the abstract request.
- A denied shell is enforced by disabling the stable `shell_tool` feature. A granted shell
  cannot silently widen an ungranted source-control write capability.
- Skills compile into developer instructions; no project/global skill directory is
  populated.
- Optional capabilities remain unavailable unless the receipt grants them and the host
  supplies a native mapping.
- Room messaging, external publication, money, legal commitments, and secrets require
  trusted host providers; prompt instructions never authorize them.

Strict mode fails on missing required enforcement. Best-effort output remains report-only
when a dedicated process or required grant is missing.

## Lifecycle

The room host creates one `codex exec` process per role member, injects the verified role
prompt as one TOML-encoded config argument, sends the room turn through stdin, and pins the
role and compatibility versions. Leave revokes providers and terminates that process.
Resume starts a new process from the pinned lock; it does not reuse ambient global
configuration.

## Upstream references

- [Codex custom agents](https://developers.openai.com/codex/subagents)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [Codex skills](https://developers.openai.com/codex/skills)
- [Repository instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
