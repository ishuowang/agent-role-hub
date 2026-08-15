# OpenCode compatibility

Package: `@ishuowang/rolehub-compat-opencode`
Compatibility id: `opencode`
Tested target: OpenCode `>=1.18.18 <1.19.0`

This package creates a deny-by-default OpenCode agent, then describes a loopback-only
server controlled through the official SDK. Because OpenCode can merge configuration from
user and project locations, strict execution also requires a host-attested sterile
HOME/XDG environment and a sanitized workspace.

## Why this native surface

OpenCode agents provide native prompt, turn-limit, and permission configuration. The
server/SDK pair gives a room host explicit session creation and lifecycle control. The
generated launch recipe sets `OPENCODE_CONFIG_DIR` to the artifact-local directory,
redirects HOME/XDG paths to a sterile root, selects a workspace without `opencode.json`,
`opencode.jsonc`, or `.opencode/`, binds the server to `127.0.0.1` on an ephemeral port,
and references a host-owned password.

`OPENCODE_CONFIG_DIR` alone does not prevent all ambient configuration merging. Runnable
strict output therefore requires `enforcement.configuration: isolated`. That attestation
is not an operating-system sandbox, so a role receiving shell or filesystem access must
also run in a dedicated process/container with the enforcement stated by its receipt.

## Export

```bash
rolehub compat inspect opencode
rolehub compat export ./roles/example \
  --using opencode \
  --policy ./example.opencode.policy.yaml \
  --scope session --out ./exports/example-opencode
```

Output includes:

```text
opencode/opencode.json          # isolated configuration root
opencode/agents/<role>.md       # native deny-by-default agent
rolehub-opencode-launch.json    # loopback server + SDK recipe
.rolehub/compatibility-*.json
```

The role's skills are compiled into its agent prompt rather than exposed through broad
skill discovery. Permissions begin with `"*": "deny"` and are opened only for effective
capabilities.

## Capability and isolation rules

- Runnable output requires a matching receipt, a `dedicated` process boundary, and
  `configuration: isolated`.
- `isolated` means sterile HOME/XDG paths plus a sanitized workspace with no project
  OpenCode config. `OPENCODE_CONFIG_DIR` by itself is insufficient.
- Configuration isolation is not filesystem enforcement.
- `bash` is a shared command surface: it can write files and mutate repository state even
  when the native `edit` permission is denied. Prompt instructions are not enforcement.
- When `filesystem.write` is absent or denied, `bash` is runnable only with an attested OS
  sandbox whose effective workspace mode is `read-only`; denying `edit` alone is not exact.
- In an effective `workspace-write` sandbox, `bash` is report-only unless
  `source-control.write` is also granted. An explicit deny, or an `approval: ask` request
  that was not granted, therefore fails closed.
- When all shared write capabilities are granted, any approval gate on `shell.execute`,
  `filesystem.write`, or `source-control.write` raises the native `bash` permission to
  `ask`. The launch recipe records the host filesystem attestation and derived effective
  mode for audit.
- The server remains loopback-only and password-protected. Exposing it publicly is outside
  this compatibility package and must fail host review.
- Optional `ask` capabilities require a trusted interactive approval broker or remain
  disabled.
- Extensions and ambient configuration must not add tools after the effective allowlist
  is calculated.

Strict mode rejects missing required mappings or enforcement. Best-effort writes a clear
report and withholds runnable output when a boundary is absent.

## Lifecycle

The host launches an isolated OpenCode server, creates a session for the selected native
agent through the SDK, and routes room messages to that session. Leave stops delivery,
aborts/drains the session, revokes providers, stops the server, and removes ephemeral
credentials. Resume verifies the lock before recreating both server and session.

## Upstream references

- [OpenCode agents](https://opencode.ai/docs/agents/)
- [OpenCode configuration](https://opencode.ai/docs/config/)
- [OpenCode permissions](https://opencode.ai/docs/permissions/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode server](https://opencode.ai/docs/server/)
