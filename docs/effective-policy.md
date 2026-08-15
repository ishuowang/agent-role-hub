# Effective policy receipts

A universal role declares intent; it never grants itself access. Runnable compatibility
output therefore requires a separate trusted receipt selected by the user, room leader,
or host policy engine.

```yaml
apiVersion: rolehub.dev/policy/v1alpha1
kind: EffectiveRolePolicy
role:
  id: io.github.ishuowang/finance-controller
  bundleDigest: <64-character digest printed by rolehub validate>
compatibility: opencode
grants:
  - filesystem.read
  - room.message
enforcement:
  filesystem: os-sandbox
  network: egress-policy
  approvals: interactive-broker
  room: broker
  process: dedicated
  configuration: isolated
```

Pass it only when explicitly selecting a compatibility package:

```bash
rolehub compat export roles/io.github.ishuowang/finance-controller \
  --using opencode \
  --policy ./finance-controller.opencode.policy.yaml \
  --out ./exports/finance-controller
```

The receipt binds one exact role bundle digest to one compatibility id. RoleHub rejects a
receipt that grants an undeclared or denied capability, broadens the role's filesystem or
network intent, selects another compatibility layer, or names another role digest.

The effective set is recalculated as:

```text
role requests ∩ compatibility support ∩ host policy ∩ room policy ∩ explicit grants
```

The receipt is local trusted input, not role content and not cryptographic proof that a
sandbox is running. Production hosts should generate it from their policy engine, protect
it from role-controlled writes, verify the claimed native enforcement, and include its
digest in the audit record.

`enforcement.configuration` is platform-neutral:

- `shared` means ambient user or project harness configuration may still be discovered or
  merged; and
- `isolated` means the host attests that only the selected compatibility output is visible
  to the harness—for example through sterile HOME/XDG directories and a sanitized
  workspace.

Configuration isolation does not imply filesystem, network, process, or approval
isolation. OpenCode can merge user and project configuration from several locations, so
its strict compatibility plan requires `configuration: isolated` in addition to a
dedicated process and any required OS sandbox.

Exports require an empty destination directory. This prevents an earlier runnable
configuration from surviving beside a newer report-only result. Without a matching
receipt, `--mode best-effort` writes a compatibility report but no runnable launcher.
