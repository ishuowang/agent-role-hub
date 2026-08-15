# `@ishuowang/rolehub-compat-opencode`

Builds a deny-by-default OpenCode agent in an isolated configuration directory and a
loopback server launch specification for the official SDK.

## Install

After the v0.2.0 npm release:

```bash
npm install @ishuowang/rolehub-core@0.2.0 \
  @ishuowang/rolehub-compat-sdk@0.2.0 \
  @ishuowang/rolehub-compat-opencode@0.2.0
# Runtime host only:
npm install '@opencode-ai/sdk@>=1.18.18 <1.19.0'
```

## Minimal API

```js
import { loadRole } from '@ishuowang/rolehub-core'
import compatibility from '@ishuowang/rolehub-compat-opencode'

const role = await loadRole('./roles/io.github.ishuowang/software-engineer')
const plan = compatibility.plan(role, { mode: 'best-effort', scope: 'session' })
console.log(plan.runnable, plan.warnings)
```

A matching policy with `enforcement.configuration: isolated` is required for runnable
output.

## Trust and isolation boundary

The package emits deny-by-default agent/config files and a loopback SDK/server recipe; it
does not start the server or grant tools. OpenCode can merge multiple configuration
sources, so `OPENCODE_CONFIG_DIR` alone is insufficient: the host must also provide sterile
HOME/XDG paths and a sanitized workspace without project OpenCode configuration.
Configuration isolation is not an OS sandbox; filesystem or shell capabilities need the
separately attested process and OS boundaries.

## v0.2.0 documentation

- [OpenCode compatibility](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/opencode.md)
- [Compatibility package contract](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility-contract.md)
