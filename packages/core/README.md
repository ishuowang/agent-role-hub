# `@ishuowang/rolehub-core`

The platform-neutral RoleHub protocol implementation. It validates, inspects, packs, and
indexes `AgentRole` bundles without importing or naming an AI harness.

Platform behavior belongs in separately versioned `rolehub-compat-*` packages.

## Install

After the v0.2.0 npm release:

```bash
npm install @ishuowang/rolehub-core@0.2.0
```

## Minimal API

```js
import { loadRole, packRole } from '@ishuowang/rolehub-core'

const role = await loadRole('./roles/io.github.ishuowang/research-librarian')
console.log(role.manifest.metadata.id, role.bundleDigest)
await packRole(role, './dist/roles')
```

## Trust boundary

Core validates and packages bundle data; it does not execute role content, grant a
capability, load a compatibility package, or launch a harness. A successful validation is
therefore an integrity result, not an authorization decision. The trusted host must apply
an effective policy and a separately reviewed compatibility layer before execution.

## v0.2.0 documentation

- [Architecture](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/architecture.md)
- [Role and compatibility registries](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/registry.md)
