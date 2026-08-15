# `@ishuowang/rolehub-compat-codex`

Compiles a verified role into an explicit `developer_instructions` override and a dedicated
`codex exec` launch specification. It does not write custom-agent TOML, `AGENTS.md`, or
user-global skills.

## Install

After the v0.2.0 npm release:

```bash
npm install @ishuowang/rolehub-core@0.2.0 \
  @ishuowang/rolehub-compat-sdk@0.2.0 \
  @ishuowang/rolehub-compat-codex@0.2.0
```

## Minimal API

```js
import { loadRole } from '@ishuowang/rolehub-core'
import compatibility from '@ishuowang/rolehub-compat-codex'

const role = await loadRole('./roles/io.github.ishuowang/software-engineer')
const plan = compatibility.plan(role, { mode: 'best-effort', scope: 'session' })
console.log(plan.runnable, plan.generatedFiles)
```

A matching effective-policy receipt is required before the plan can become runnable.

## Trust and isolation boundary

The package emits verified prompt material and a `codex exec` recipe; it does not launch
Codex or authorize tools. Compiled skills stay inside the role instructions. Runnable
strict use requires a dedicated process, sterile HOME/CODEX_HOME paths, and isolated
configuration in a sanitized workspace. The launcher disables `shell_tool` unless
`shell.execute` is effective and fails closed when a granted shell would widen an
ungranted write capability. A prompt is not a security principal.

## v0.2.0 documentation

- [Codex compatibility](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/codex.md)
- [Compatibility package contract](https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility-contract.md)
