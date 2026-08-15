# `@ishuowang/rolehub-compat-dsharness`

Mounts a verified role through DSHarness `CreateAgentOptions.setup`: the prompt, runtime
skills, and tool restriction live in that Agent's Cordis scope and unwind with its handle.

This package is a trusted compatibility library, not a DSHarness Profile Bundle or a
standalone Cordis plugin. A host integration imports `createDsharnessSetup()` and passes the
returned callback to `ctx.agents.create()` or `ctx.agents.resume()`; it must not install this
package with `dsh plugin add`. The Agent scope owns every prompt, skill, restriction, and
execution-guard effect, so setup failure or `AgentHandle.dispose()` unwinds them together.

Both `tools.restrict()` and a monotonic `tools.guard()` are installed. The guard is required
because DSHarness intentionally lets tools registered later in the Agent's own scope bypass
inherited-tool restrictions; an unbound scoped tool is therefore denied at execution time.

## Install

After the v0.2.0 npm release, install the library beside a compatible DSHarness host:

```bash
npm install @ishuowang/rolehub-core@0.2.0 \
  @ishuowang/rolehub-compat-sdk@0.2.0 \
  @ishuowang/rolehub-compat-dsharness@0.2.0
```

The host supplies the tested optional DSHarness/Cordis peers. Do not use `dsh plugin add`:
this package is a library, not a DSH plugin bundle.

## Minimal host API

```js
import { createDsharnessSetup } from '@ishuowang/rolehub-compat-dsharness'

const setup = createDsharnessSetup(verifiedRole, effectiveOptions)
// Pass `setup` as CreateAgentOptions.setup to ctx.agents.create() or resume().
```

`effectiveOptions` contains the matching digest-bound policy and host-owned native-tool
bindings; neither can be supplied by the role bundle.

## Trust and isolation boundary

The imported library is trusted executable host code. Agent scope isolates and unwinds its
prompt, skills, restriction, and guard, while the host owns capability providers, room
delivery, policy verification, and any required process/filesystem/network isolation. A
role requesting process isolation still needs a dedicated DSHarness process.

## v0.2.0 documentation

- [DSHarness compatibility](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/dsharness.md)
- [Compatibility package contract](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility-contract.md)
