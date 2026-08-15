# Effective policy receipts

A community role declares intent; it never grants itself access. A runnable export
therefore requires a separate, trusted effective-policy receipt selected by the user or
room host.

```yaml
apiVersion: rolehub.dev/policy/v1alpha1
kind: EffectiveRolePolicy
role:
  id: io.github.ishuowang/finance-controller
  bundleDigest: <64-character digest printed by rolehub validate>
target: opencode
grants:
  - filesystem.read
  - room.message
enforcement:
  filesystem: os-sandbox
  network: egress-policy
  approvals: interactive-broker
  room: broker
  process: dedicated
```

Pass it explicitly:

```bash
rolehub export roles/io.github.ishuowang/finance-controller \
  --target opencode \
  --policy ./finance-controller.opencode.policy.yaml \
  --out ./exports/finance-controller
```

The receipt is bound to the exact role bundle digest and one target. RoleHub rejects a
receipt that grants an undeclared/denied capability, broadens filesystem or network
isolation, targets another harness, or refers to another role version.

The receipt is a local trust input, not a community artifact or cryptographic proof of a
running sandbox. Production room hosts should generate it from their policy engine,
protect it from role-controlled writes, and include its digest in the audit record.

Exports require an empty destination directory. This prevents an earlier runnable
configuration from surviving beside a newer report-only result.
