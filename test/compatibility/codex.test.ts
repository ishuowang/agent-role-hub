import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { CodexCompatibility } from '@ishuowang/rolehub-compat-codex'
import { loadRole, sha256, stableJson, type LoadedRole } from '@ishuowang/rolehub-core'
import type { LoadedEffectivePolicy } from '@ishuowang/rolehub-compat-sdk'
import { testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const readOnlyRoleRoot = path.join(
  repositoryRoot,
  'roles',
  'io.github.ishuowang',
  'finance-controller',
)
const writeRoleRoot = path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'software-engineer')

test('Codex launch injects developer instructions without an unused custom-agent file', async () => {
  const role = await loadRole(readOnlyRoleRoot)
  const result = new CodexCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'codex'),
  })
  assert.equal(result.plan.runnable, true)
  const launchFile = result.files.find((file) => file.path === '.rolehub/codex-launch.json')
  assert.ok(launchFile && typeof launchFile.content === 'string')
  const launch = JSON.parse(launchFile.content) as {
    argvTemplate: string[]
    cwd: string
    environment: Record<string, string>
    developerInstructions: {
      sourceFile: string
      encoding: string
      passAsSingleArgument: boolean
    }
    configurationIsolation: {
      sanitizedWorkspace: boolean
      forbiddenProjectEntries: string[]
      projectDocMaxBytes: number
      ignoreUserConfig: boolean
      disableApps: boolean
      disableHooks: boolean
      sterileHome: boolean
      sterileCodexHome: boolean
    }
    stdin: string
  }

  const execIndex = launch.argvTemplate.indexOf('exec')
  assert.ok(execIndex > 0)
  assert.ok(launch.argvTemplate.indexOf('--disable') < execIndex)
  assert.ok(launch.argvTemplate.includes('shell_tool'))
  assert.ok(launch.argvTemplate.indexOf('--ask-for-approval') < execIndex)
  assert.ok(launch.argvTemplate.indexOf('--config') < execIndex)
  assert.ok(
    launch.argvTemplate.includes(
      'developer_instructions=<TOML-string-from:.rolehub/role-prompt.md>',
    ),
  )
  assert.ok(launch.argvTemplate.includes('project_doc_max_bytes=0'))
  assert.equal(launch.cwd, '<sanitized-workspace>')
  assert.equal(launch.environment.HOME, '<sterile-home>')
  assert.equal(launch.environment.CODEX_HOME, '<sterile-codex-home-containing-auth-only>')
  assert.equal(launch.developerInstructions.sourceFile, './role-prompt.md')
  assert.equal(launch.developerInstructions.encoding, 'toml-string')
  assert.equal(launch.developerInstructions.passAsSingleArgument, true)
  assert.equal(launch.configurationIsolation.sanitizedWorkspace, true)
  assert.equal(launch.configurationIsolation.projectDocMaxBytes, 0)
  assert.equal(launch.configurationIsolation.ignoreUserConfig, true)
  assert.equal(launch.configurationIsolation.disableApps, true)
  assert.equal(launch.configurationIsolation.disableHooks, true)
  assert.equal(launch.configurationIsolation.sterileHome, true)
  assert.equal(launch.configurationIsolation.sterileCodexHome, true)
  assert.ok(launch.configurationIsolation.forbiddenProjectEntries.includes('.codex/'))
  assert.ok(launch.configurationIsolation.forbiddenProjectEntries.includes('.agents/'))
  assert.ok(launch.configurationIsolation.forbiddenProjectEntries.includes('**/AGENTS.md'))
  assert.equal(launch.stdin, '<room-message-or-turn-input>')
  assert.ok(!result.files.some((file) => file.path.startsWith('.codex/agents/')))
})

test('Codex refuses shared project configuration even in a dedicated process', async () => {
  const role = await loadRole(readOnlyRoleRoot)
  const plan = new CodexCompatibility().plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'codex', { configuration: 'shared' }),
  })

  assert.equal(plan.runnable, false)
  assert.ok(
    plan.mappings.some(
      (mapping) =>
        mapping.source === 'host.enforcement.configuration' && mapping.fidelity === 'unsupported',
    ),
  )
})

test('Codex disables shell_tool when shell is denied and keeps read-only write denials exact', async () => {
  const role = await loadRole(readOnlyRoleRoot)
  const result = new CodexCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'codex'),
  })

  assert.equal(result.plan.runnable, true)
  for (const capability of ['shell.execute', 'filesystem.write', 'source-control.write']) {
    const mapping = result.plan.mappings.find((item) => item.source === `deny:${capability}`)
    assert.equal(mapping?.fidelity, 'exact', capability)
  }
  const launchFile = result.files.find((file) => file.path === '.rolehub/codex-launch.json')
  assert.ok(launchFile && typeof launchFile.content === 'string')
  const launch = JSON.parse(launchFile.content) as { argvTemplate: string[] }
  assert.deepEqual(launch.argvTemplate.slice(0, 2), ['--disable', 'shell_tool'])
})

test('Codex fails closed when a granted shell in a writable workspace overlaps source-control write', async () => {
  const role = await loadRole(writeRoleRoot)
  const shellOnly = grantCapabilities(testPolicy(role, 'codex'), ['shell.execute'])
  const plan = new CodexCompatibility().plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy: shellOnly,
  })

  assert.equal(plan.runnable, false)
  assert.ok(
    plan.mappings.some(
      (mapping) =>
        mapping.source === 'native-surface:source-control.write' &&
        mapping.fidelity === 'unsupported',
    ),
  )
  const rendered = new CodexCompatibility().render(role, {
    mode: 'best-effort',
    scope: 'session',
    policy: shellOnly,
  })
  assert.deepEqual(rendered.files, [])

  const shellAndSourceControl = grantCapabilities(testPolicy(role, 'codex'), [
    'shell.execute',
    'source-control.write',
  ])
  const runnable = new CodexCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: shellAndSourceControl,
  })
  assert.equal(runnable.plan.runnable, true)
  const launchFile = runnable.files.find((file) => file.path === '.rolehub/codex-launch.json')
  assert.ok(launchFile && typeof launchFile.content === 'string')
  const launch = JSON.parse(launchFile.content) as { argvTemplate: string[] }
  assert.ok(!launch.argvTemplate.includes('shell_tool'))
})

test('Codex 0.145 parses the generated launch flags without starting a session', async (context) => {
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8' })
  if (version.error && (version.error as NodeJS.ErrnoException).code === 'ENOENT') {
    context.skip('Codex CLI is not installed')
    return
  }
  assert.equal(version.status, 0, version.stderr)
  if (!/codex-cli 0\.145\./.test(version.stdout)) {
    context.skip(`installed CLI is outside the pinned target: ${version.stdout.trim()}`)
    return
  }

  const role = await loadRole(readOnlyRoleRoot)
  const result = new CodexCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'codex'),
  })
  const launchFile = result.files.find((file) => file.path === '.rolehub/codex-launch.json')
  assert.ok(launchFile && typeof launchFile.content === 'string')
  const launch = JSON.parse(launchFile.content) as { argvTemplate: string[] }
  const workspace = await mkdtemp(path.join(tmpdir(), 'rolehub-codex-config-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  const argv = launch.argvTemplate.slice(0, -1).map((argument) => {
    if (argument === '<sanitized-workspace>') return workspace
    if (argument.startsWith('developer_instructions=<')) {
      return 'developer_instructions="RoleHub parser test"'
    }
    return argument
  })
  argv.push('--help')

  const parsed = spawnSync('codex', argv, { encoding: 'utf8' })
  assert.equal(parsed.status, 0, parsed.stderr)
  assert.match(parsed.stdout, /Run Codex non-interactively/)
})

function grantCapabilities(
  policy: LoadedEffectivePolicy,
  capabilities: LoadedEffectivePolicy['grants'],
): LoadedEffectivePolicy {
  const { policyDigest: _policyDigest, ...receipt } = policy
  const updated = {
    ...receipt,
    grants: [...new Set([...receipt.grants, ...capabilities])],
  }
  return { ...updated, policyDigest: sha256(stableJson(updated)) }
}
