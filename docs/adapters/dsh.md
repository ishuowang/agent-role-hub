# DSH adapter

> **Safe CLI default:** DSH composition output is generated only from a matching
> effective-policy receipt. The composition records effective capabilities and the
> policy digest; cold resume must re-verify both before mounting scoped content.

Status: runtime design validated against DSH `0.1.0-rc.6` and
`dsh-agent-team-room` `0.3.x`.

DSH is a strong RoleHub runtime target, but it is one adapter rather than the protocol
owner.

## Native isolation

Each live DSH Agent owns an independent scope. That scope can register:

- system-prompt sections and variables;
- tool definitions, restrictions, guards, and presenters; and
- skill definitions or skill providers.

Resolution and execution both use the calling Agent scope, so a scoped tool is absent
from sibling prompt schemas and rejects sibling execution. Disposing the Agent scope
withdraws all three kinds of contribution.

The scope belongs to the live Agent, not the persisted Session. A cold-resumed Session
creates a new Agent scope, so the RoleHub runtime must verify the same lock and reinstall
the role before the next model request.

## Runtime mapping

| RoleHub intent                    | DSH mapping                                      | Fidelity                        |
| --------------------------------- | ------------------------------------------------ | ------------------------------- |
| role prompt                       | Agent-scoped prompt section                      | exact                           |
| instruction-only skills           | Agent-scoped skill registry                      | exact                           |
| approved tool pack                | Agent-scoped tool registration/restriction       | exact                           |
| denied tools                      | scoped `tools.restrict()` plus provider omission | exact                           |
| dedicated session                 | continuable child Session                        | exact                           |
| model/provider                    | child Agent options                              | exact when provider exists      |
| invite/leave                      | Room membership + scoped disposer                | exact after current turn drains |
| cold resume                       | continuable setup hook + role lock               | exact                           |
| narrow filesystem/network sandbox | host sandbox/policy provider                     | depends on deployment           |

## Integration seam

`ctx.subagents.registerContinuableSetup(...)` runs synchronously during both fresh child
creation and cold resume, before publication and before the first request. A Role Runtime
uses it to mount an already-fetched, already-verified composition into only the matching
child.

The current `startContinuable` request carries persona and a tool filter but not arbitrary
prompt/skill/tool packs. The DSH adapter therefore needs a durable `compositionRef` (role
id plus immutable digest) in the continuable child descriptor. Until that upstream seam
exists, an adapter can bridge fresh creation with a one-time pending token and use the
Room's persisted agent-id lock on resume.

```text
invite
  -> fetch and verify role
  -> reserve pending composition token
  -> create continuable child
  -> setup hook mounts role before publication
  -> persist child id + role digest + effective grant
```

Process failure between child creation and Room persistence must be reconciled. The
runtime keeps a `provisioning` member state and either completes the lock or quarantines
the orphaned child on startup.

## Leave semantics

1. Mark membership inactive and reject new work.
2. Interrupt or wait for the current turn to become idle.
3. Revoke capability grants and invoke every scoped disposer.
4. Remove the active Room binding while retaining the audit event and Session history.

No runtime can retract a prompt or schema already submitted in a live model request.
Role changes become authoritative at the next request boundary.

## Code-provider boundary

A community role may reference an approved DSH capability-pack id. It may not submit a
Cordis plugin, JavaScript function, npm lifecycle hook, or MCP server for automatic host
installation. Code providers follow DSH's ordinary trusted plugin installation and
approval path; RoleHub only selects among providers the host has already authorized.
