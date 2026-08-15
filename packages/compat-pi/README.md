# `@ishuowang/rolehub-compat-pi`

Creates a Pi SDK session recipe with an explicit `DefaultResourceLoader`, tool allowlist,
in-memory session, and host-owned OS isolation requirements.

The generated JSON is an integration recipe, not an executable session factory. This package
does not import Pi at runtime; the trusted host must resolve the pinned Pi SDK, construct the
resource loader/session, and attest the required process and OS isolation before launch.

## Install

After the v0.2.0 npm release:

```bash
npm install @ishuowang/rolehub-core@0.2.0 \
  @ishuowang/rolehub-compat-sdk@0.2.0 \
  @ishuowang/rolehub-compat-pi@0.2.0
# Runtime host only:
npm install '@earendil-works/pi-coding-agent@>=0.84.2 <0.85.0'
```

## Minimal API

```js
import { loadRole } from '@ishuowang/rolehub-core'
import compatibility from '@ishuowang/rolehub-compat-pi'

const role = await loadRole('./roles/io.github.ishuowang/research-librarian')
const plan = compatibility.plan(role, { mode: 'best-effort', scope: 'session' })
console.log(plan.runnable, plan.generatedFiles) // includes rolehub-pi-runtime.json
```

## Trust and isolation boundary

This package emits a verified runtime **recipe**, not a Pi session factory, and does not
import or launch Pi. The trusted host resolves the pinned SDK, builds the explicit resource
loader and `AgentSession`, and applies the effective tool allowlist. Configuration isolation
and an in-memory session prevent ambient state reuse; they do not sandbox filesystem or
shell access. Those capabilities require a dedicated process/container and host OS sandbox.

## v0.2.0 documentation

- [Pi compatibility](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/pi.md)
- [Compatibility package contract](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility-contract.md)
