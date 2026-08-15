import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { parse as parseYaml } from 'yaml'

import { OpenCodeCompatibility } from '@ishuowang/rolehub-compat-opencode'
import { PiCompatibility } from '@ishuowang/rolehub-compat-pi'
import { loadRole, type LoadedRole } from '@ishuowang/rolehub-core'
import { testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const roleRoot = path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'finance-controller')

test('OpenCode compiles skills safely and preserves network/tool deny-by-default', async () => {
  const role = await loadRole(roleRoot)
  const result = new OpenCodeCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'opencode'),
  })
  assert.equal(result.plan.runnable, true)
  assert.ok(!result.files.some((file) => file.path.startsWith('skills/')))
  const agent = result.files.find((file) => file.path.startsWith('opencode/agents/'))
  assert.ok(agent && typeof agent.content === 'string')
  const frontmatter = agent.content.match(/^---\n([\s\S]*?)\n---/)?.[1]
  assert.ok(frontmatter)
  const parsed = parseYaml(frontmatter) as { permission: Record<string, unknown> }
  assert.equal(parsed.permission['*'], 'deny')
  assert.equal(parsed.permission['skill'], 'deny')
  assert.equal(parsed.permission['webfetch'], undefined)
  assert.match(agent.content, /Skill: budget-analysis/)

  const launchFile = result.files.find((file) => file.path === 'rolehub-opencode-launch.json')
  assert.ok(launchFile && typeof launchFile.content === 'string')
  const launch = JSON.parse(launchFile.content) as {
    cwd: string
    env: Record<string, string>
    configurationIsolation: {
      sanitizedWorkspace: boolean
      forbiddenProjectEntries: string[]
      inheritUserEnvironment: boolean
    }
  }
  assert.equal(launch.cwd, '<sanitized-workspace>')
  assert.equal(launch.env['HOME'], '<sterile-home>')
  assert.equal(launch.env['XDG_CONFIG_HOME'], '<sterile-home>/.config')
  assert.equal(launch.configurationIsolation.sanitizedWorkspace, true)
  assert.equal(launch.configurationIsolation.inheritUserEnvironment, false)
  assert.deepEqual(launch.configurationIsolation.forbiddenProjectEntries, [
    'opencode.json',
    'opencode.jsonc',
    '.opencode/',
  ])
})

test('OpenCode refuses shared configuration even in a dedicated process', async () => {
  const role = await loadRole(roleRoot)
  const plan = new OpenCodeCompatibility().plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'opencode', { configuration: 'shared' }),
  })

  assert.equal(plan.runnable, false)
  assert.ok(
    plan.mappings.some(
      (mapping) =>
        mapping.source === 'host.enforcement.configuration' && mapping.fidelity === 'unsupported',
    ),
  )
})

test('OpenCode fails closed when bash can bypass an ungranted source-control write gate', async () => {
  const loaded = await loadRole(roleRoot)
  const role = writableOpenCodeShellRole(loaded)
  const policy = testPolicy(role, 'opencode')
  policy.grants = [...policy.grants, 'filesystem.write', 'shell.execute']

  const compatibility = new OpenCodeCompatibility()
  const plan = compatibility.plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy,
  })

  assert.equal(plan.runnable, false)
  assert.ok(!plan.effectiveCapabilities.includes('shell.execute'))
  assert.ok(
    plan.mappings.some(
      (mapping) =>
        mapping.source === 'overlap:shell.execute->source-control.write' &&
        mapping.fidelity === 'unsupported' &&
        mapping.message?.includes('approval-gated but not granted'),
    ),
  )
  assert.deepEqual(
    compatibility.render(role, {
      mode: 'best-effort',
      scope: 'session',
      policy,
    }).files,
    [],
  )

  const deniedRole = writableOpenCodeShellRole(loaded)
  deniedRole.manifest.spec.capabilities.optional =
    deniedRole.manifest.spec.capabilities.optional.filter(
      (capability) => capability.id !== 'source-control.write',
    )
  deniedRole.manifest.spec.capabilities.denied.push({
    id: 'source-control.write',
    reason: 'Repository mutation is explicitly denied.',
  })
  const deniedPolicy = testPolicy(deniedRole, 'opencode')
  deniedPolicy.grants = [...deniedPolicy.grants, 'filesystem.write', 'shell.execute']
  const denied = compatibility.plan(deniedRole, {
    mode: 'best-effort',
    scope: 'session',
    policy: deniedPolicy,
  })
  assert.equal(denied.runnable, false)
  assert.ok(
    denied.mappings.some(
      (mapping) =>
        mapping.source === 'overlap:shell.execute->source-control.write' &&
        mapping.message?.includes('explicitly denied'),
    ),
  )
})

test('OpenCode asks on the shared bash surface when all writable capabilities are granted', async () => {
  const loaded = await loadRole(roleRoot)
  const role = writableOpenCodeShellRole(loaded)
  const policy = testPolicy(role, 'opencode')
  policy.grants = [...policy.grants, 'filesystem.write', 'shell.execute', 'source-control.write']

  const result = new OpenCodeCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy,
  })
  assert.equal(result.plan.runnable, true)
  assert.ok(result.plan.effectiveCapabilities.includes('shell.execute'))
  assert.ok(result.plan.effectiveCapabilities.includes('source-control.write'))
  const agent = result.files.find((file) => file.path.startsWith('opencode/agents/'))
  assert.ok(agent && typeof agent.content === 'string')
  const frontmatter = agent.content.match(/^---\n([\s\S]*?)\n---/)?.[1]
  assert.ok(frontmatter)
  const parsed = parseYaml(frontmatter) as { permission: Record<string, unknown> }
  assert.equal(parsed.permission['bash'], 'ask')
  assert.equal(parsed.permission['edit'], 'allow')

  const launchFile = result.files.find((file) => file.path === 'rolehub-opencode-launch.json')
  assert.ok(launchFile && typeof launchFile.content === 'string')
  const launch = JSON.parse(launchFile.content) as {
    filesystemIsolation: { effectiveMode: string; hostAttestation: string }
  }
  assert.equal(launch.filesystemIsolation.effectiveMode, 'workspace-write')
  assert.equal(launch.filesystemIsolation.hostAttestation, 'enforcement.filesystem=os-sandbox')
})

test('OpenCode relies on an attested read-only OS sandbox to deny writes through bash', async () => {
  const loaded = await loadRole(roleRoot)
  const role: LoadedRole = {
    ...loaded,
    manifest: structuredClone(loaded.manifest),
  }
  role.manifest.spec.capabilities.denied = role.manifest.spec.capabilities.denied.filter(
    (capability) => capability.id !== 'shell.execute',
  )
  role.manifest.spec.capabilities.optional.push({
    id: 'shell.execute',
    reason: 'Run an approved read-only calculation.',
    approval: 'ask',
  })
  const sandboxedPolicy = testPolicy(role, 'opencode')
  sandboxedPolicy.grants = [...sandboxedPolicy.grants, 'shell.execute']

  const result = new OpenCodeCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: sandboxedPolicy,
  })
  assert.equal(result.plan.runnable, true)
  assert.ok(
    result.plan.mappings.some(
      (mapping) =>
        mapping.source === 'overlap:shell.execute->filesystem.write' &&
        mapping.fidelity === 'exact' &&
        mapping.target?.includes('read-only'),
    ),
  )
  for (const capability of ['filesystem.write', 'source-control.write']) {
    assert.ok(
      result.plan.mappings.some(
        (mapping) =>
          mapping.source === `deny:${capability}` &&
          mapping.fidelity === 'exact' &&
          mapping.target?.includes('read-only'),
      ),
    )
  }
  const launchFile = result.files.find((file) => file.path === 'rolehub-opencode-launch.json')
  assert.ok(launchFile && typeof launchFile.content === 'string')
  const launch = JSON.parse(launchFile.content) as {
    filesystemIsolation: { effectiveMode: string }
  }
  assert.equal(launch.filesystemIsolation.effectiveMode, 'read-only')

  const unsandboxedPolicy = testPolicy(role, 'opencode', { filesystem: 'tool-policy' })
  unsandboxedPolicy.grants = [...unsandboxedPolicy.grants, 'shell.execute']
  const unsafe = new OpenCodeCompatibility().plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy: unsandboxedPolicy,
  })
  assert.equal(unsafe.runnable, false)
  assert.ok(!unsafe.effectiveCapabilities.includes('shell.execute'))
  assert.ok(
    unsafe.mappings.some(
      (mapping) =>
        mapping.source === 'overlap:shell.execute->filesystem.write' &&
        mapping.fidelity === 'unsupported',
    ),
  )
})

test('Pi SDK recipe loads verified skills without implicit tools', async () => {
  const role = await loadRole(roleRoot)
  const result = new PiCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'pi'),
  })
  assert.equal(result.plan.runnable, true)
  const metadataFile = result.files.find((file) => file.path === 'rolehub-pi-runtime.json')
  assert.ok(metadataFile && typeof metadataFile.content === 'string')
  const metadata = JSON.parse(metadataFile.content) as {
    resourceLoader: {
      noExtensions: boolean
      noContextFiles: boolean
      additionalSkillPaths: string[]
    }
    session: { tools: string[] }
    skills: string[]
  }
  assert.equal(metadata.resourceLoader.noExtensions, true)
  assert.equal(
    metadata.resourceLoader.noContextFiles,
    true,
    'workspace roles must not inherit ambient Pi context files',
  )
  assert.ok(metadata.resourceLoader.additionalSkillPaths.length > 0)
  assert.ok(metadata.skills.length > 0)
  assert.ok(metadata.session.tools.includes('read'))
  assert.ok(!metadata.session.tools.includes('bash'))
  assert.ok(!metadata.session.tools.includes('write'))
})

test('Pi withholds approval-gated tools until a verified host broker is attested', async () => {
  const loaded = await loadRole(roleRoot)
  const role: LoadedRole = {
    ...loaded,
    manifest: structuredClone(loaded.manifest),
  }
  role.manifest.spec.capabilities.optional = role.manifest.spec.capabilities.optional.map(
    (capability) =>
      capability.id === 'source-control.read'
        ? {
            id: 'filesystem.write',
            reason: 'Write one approved analysis artifact.',
            approval: 'ask',
          }
        : capability,
  )
  role.manifest.spec.capabilities.denied = role.manifest.spec.capabilities.denied.filter(
    (capability) => capability.id !== 'filesystem.write',
  )
  role.manifest.spec.isolation.filesystem = 'workspace-write'

  const withoutBroker = testPolicy(role, 'pi', { approvals: 'none' })
  withoutBroker.grants = [...withoutBroker.grants, 'filesystem.write']
  const blocked = new PiCompatibility().plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy: withoutBroker,
  })

  assert.equal(blocked.runnable, false)
  assert.ok(!blocked.effectiveCapabilities.includes('filesystem.write'))
  assert.ok(
    blocked.mappings.some(
      (mapping) =>
        mapping.source === 'optional-capability:filesystem.write' &&
        mapping.fidelity === 'degraded' &&
        mapping.message?.includes('verified host interactive approval broker'),
    ),
  )

  const withBroker = testPolicy(role, 'pi')
  withBroker.grants = [...withBroker.grants, 'filesystem.write']
  const allowed = new PiCompatibility().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: withBroker,
  })
  assert.ok(allowed.plan.effectiveCapabilities.includes('filesystem.write'))
  const runtimeFile = allowed.files.find((file) => file.path === 'rolehub-pi-runtime.json')
  assert.ok(runtimeFile && typeof runtimeFile.content === 'string')
  const runtime = JSON.parse(runtimeFile.content) as { session: { tools: string[] } }
  assert.ok(runtime.session.tools.includes('edit'))
  assert.ok(runtime.session.tools.includes('write'))
})

test('Pi reports shell grants as unsupported without an argument-level broker', async () => {
  const loaded = await loadRole(roleRoot)
  const role: LoadedRole = {
    ...loaded,
    manifest: structuredClone(loaded.manifest),
  }
  role.manifest.spec.capabilities.optional = role.manifest.spec.capabilities.optional.map(
    (capability) =>
      capability.id === 'source-control.read'
        ? {
            id: 'shell.execute',
            reason: 'Run one separately approved analysis command.',
            approval: 'ask',
          }
        : capability,
  )
  role.manifest.spec.capabilities.denied = role.manifest.spec.capabilities.denied.filter(
    (capability) => capability.id !== 'shell.execute',
  )
  const policy = testPolicy(role, 'pi')
  policy.grants = [...policy.grants, 'shell.execute']

  const compatibility = new PiCompatibility()
  const plan = compatibility.plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy,
  })
  assert.equal(plan.runnable, false)
  assert.ok(!plan.effectiveCapabilities.includes('shell.execute'))
  assert.ok(
    plan.mappings.some(
      (mapping) =>
        mapping.source === 'host.enforcement.shell-arguments' &&
        mapping.fidelity === 'unsupported' &&
        mapping.message?.includes('source-control'),
    ),
  )

  const rendered = compatibility.render(role, {
    mode: 'best-effort',
    scope: 'session',
    policy,
  })
  assert.deepEqual(rendered.files, [])
})

function writableOpenCodeShellRole(loaded: LoadedRole): LoadedRole {
  const role: LoadedRole = {
    ...loaded,
    manifest: structuredClone(loaded.manifest),
  }
  role.manifest.spec.isolation.filesystem = 'workspace-write'
  role.manifest.spec.capabilities.denied = role.manifest.spec.capabilities.denied.filter(
    (capability) =>
      !['filesystem.write', 'shell.execute', 'source-control.write'].includes(capability.id),
  )
  role.manifest.spec.capabilities.optional = role.manifest.spec.capabilities.optional.filter(
    (capability) => capability.id !== 'source-control.read',
  )
  role.manifest.spec.capabilities.optional.push(
    {
      id: 'filesystem.write',
      reason: 'Write approved workspace artifacts.',
    },
    {
      id: 'shell.execute',
      reason: 'Run an approved workspace command.',
      approval: 'ask',
    },
    {
      id: 'source-control.write',
      reason: 'Mutate repository state only after separate approval.',
      approval: 'ask',
    },
  )
  return role
}
