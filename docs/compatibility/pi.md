# Pi compatibility

Package: `@ishuowang/rolehub-compat-pi`
Compatibility id: `pi`
Tested target: `@earendil-works/pi-coding-agent >=0.84.2 <0.85.0`

This package describes a Pi SDK session built with an explicit `ResourceLoader`, an
`AgentSession`, an in-memory session, and an effective tool allowlist. The room host runs
one dedicated Pi process or container per invited role.

## Why this native surface

The SDK lets the host construct resources and sessions directly instead of inheriting a
user's CLI environment. The generated runtime recipe disables ambient extensions, skills,
prompt templates, themes, and context files for every role, including roles whose abstract
context intent is `workspace`. It then adds only the digest-verified prompt and selected
skill paths. Workspace content is reachable only through effective, sandboxed tools; Pi's
ambient context-file discovery is never used as a shortcut.

Pi does not provide the hard sandbox or interactive approval boundary required by every
RoleHub policy. `PI_CODING_AGENT_DIR` and an explicit `ResourceLoader` prevent config
pollution, but filesystem and shell tools still require a host OS sandbox.

## Export

```bash
rolehub compat inspect pi
rolehub compat export ./roles/example \
  --using pi \
  --policy ./example.pi.policy.yaml \
  --scope session --out ./exports/example-pi
```

Output includes:

```text
pi/prompt.md                   # assembled, digest-bound role prompt
pi/skills/<name>/SKILL.md      # only when safe native loading is allowed
rolehub-pi-runtime.json        # ResourceLoader + AgentSession recipe
.rolehub/compatibility-*.json
```

When native skill loading would broaden filesystem access, optional skills compile into
the prompt. A required skill that cannot be attached safely makes strict export fail.

## Capability and isolation rules

- `read`, `grep`, `find`, and `ls` implement read intent; `edit`/`write` implement write.
  Only effective mappings—after approval checks—enter the session tool list.
- The raw Pi `bash` tool is never emitted. A `shell.execute` grant is report-only and
  unsupported because the current protocol cannot attest an argument-level execution
  broker: one command could otherwise overlap denied or ungranted filesystem-write,
  source-control-write, or network capabilities.
- Filesystem tools require an `os-sandbox` receipt and a dedicated process. Any future
  shell provider additionally needs a protocol-level, tested command/argument broker.
- A policy grant alone never enables an optional `approval: ask` tool. It remains absent
  from both `effectiveCapabilities` and the Pi tool list unless the trusted receipt also
  attests `enforcement.approvals: interactive-broker`.
- The broker is host enforcement outside Pi core. Without that verified receipt claim,
  the mapping is reported as degraded/unsupported and the compatibility plan fails closed
  when the policy nevertheless attempts to grant it. This generic interactive broker does
  not satisfy the stronger argument-level requirement for `shell.execute`.
- Extensions are disabled by default because they can register additional tools or alter
  behavior outside the effective capability set.
- Room methods map to SDK calls such as `session.prompt`, `steer`, `followUp`, and `abort`;
  the room broker remains host-owned.
- In-memory session state is the default so one role member cannot inherit another's
  persisted history.
- `ResourceLoader.noContextFiles` is always `true`; `contextPolicy` records role intent but
  never re-enables ambient instruction discovery.

## Lifecycle

On invite, the host builds a new `ResourceLoader`, creates an `AgentSession`, and publishes
the member only after digest and policy verification. Leave blocks delivery, aborts or
drains the session, disposes resources, revokes grants, and terminates the process or
container. Resume constructs a fresh session from the same lock.

## Upstream references

- [Pi coding-agent SDK guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi coding-agent package](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
