# `@ishuowang/rolehub-compat-sdk`

The host-owned boundary between a verified universal role and one AI harness. Compatibility
packages consume effective policy receipts; they never turn a role's request into permission.

## Install

After the v0.2.0 npm release:

```bash
npm install @ishuowang/rolehub-core@0.2.0 @ishuowang/rolehub-compat-sdk@0.2.0
```

## Minimal API

```js
import { loadRole } from '@ishuowang/rolehub-core'
import { loadEffectivePolicy } from '@ishuowang/rolehub-compat-sdk'

const role = await loadRole('./roles/io.github.ishuowang/research-librarian')
const policy = await loadEffectivePolicy('./policy.yaml', role, 'codex')
console.log(policy.policyDigest)
```

Use `writeCompatibilityExport(role, compatibility, emptyOutputDir, options)` to write a
compatibility package's deterministic artifacts plus its report and lock.

## Trust boundary

The SDK verifies that a policy receipt matches the role id, bundle digest, and selected
compatibility id. It does not mint grants, install providers, launch a process, or turn
prompt text into enforcement. Compatibility modules are trusted executable code; load only
an explicitly selected and reviewed package. Filesystem, network, approval, room, process,
and configuration isolation remain host responsibilities recorded by the receipt.

## v0.2.0 documentation

- [Compatibility package contract](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility-contract.md)
- [Effective policy](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/effective-policy.md)
