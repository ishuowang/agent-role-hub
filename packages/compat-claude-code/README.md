# `@ishuowang/rolehub-compat-claude-code`

Compiles a verified role into ephemeral Claude Code `--agents` configuration and a
dedicated-process launch specification. It never installs user-global skills or MCP servers.

## Install

After the v0.2.0 npm release:

```bash
npm install @ishuowang/rolehub-core@0.2.0 \
  @ishuowang/rolehub-compat-sdk@0.2.0 \
  @ishuowang/rolehub-compat-claude-code@0.2.0
```

## Minimal API

```js
import { loadRole } from '@ishuowang/rolehub-core'
import compatibility from '@ishuowang/rolehub-compat-claude-code'

const role = await loadRole('./roles/io.github.ishuowang/research-librarian')
const plan = compatibility.plan(role, { mode: 'best-effort', scope: 'session' })
console.log(plan.runnable, plan.mappings)
```

A matching effective-policy receipt is required before the plan can become runnable.
Project scope is report-only; runnable output uses the session-scoped `--bare` launcher.

## Trust and isolation boundary

The package is a trusted compiler, not a permission broker. It compiles bundled skills into
the role prompt and emits ephemeral `--agents` data; it does not modify global agents,
skills, hooks, plugins, or MCP configuration. Tool lists are not a filesystem or network
sandbox. The host must use the digest-bound receipt, pass JSON as one argv value, and run
each role in a dedicated process with the reported enforcement. Export also fails closed
when one granted native tool, such as `Bash`, would expose an ungranted or denied capability
through the same tool surface.

## v0.2.0 documentation

- [Claude Code compatibility](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/claude-code.md)
- [Compatibility package contract](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility-contract.md)
