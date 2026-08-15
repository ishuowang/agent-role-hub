import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  DsharnessCompatibility,
  createDsharnessSetup,
  type DsharnessAgentContext,
} from '@ishuowang/rolehub-compat-dsharness'
import { loadRole, type LoadedRole } from '@ishuowang/rolehub-core'
import { testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const roleRoot = path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'finance-controller')

test('DSHarness compatibility ships as a library, not a malformed Profile Bundle', async () => {
  const packageJson = JSON.parse(
    await readFile(
      path.join(repositoryRoot, 'packages', 'compat-dsharness', 'package.json'),
      'utf8',
    ),
  ) as { dsh?: unknown; files?: string[] }
  assert.equal(packageJson.dsh, undefined)
  assert.equal(packageJson.files?.includes('cordis.patch.yml'), false)
})

test('DSHarness setup binds only effective tools and all scoped effects unwind together', async () => {
  const role = await loadRole(roleRoot)
  const bindings = {
    'filesystem.read': ['read', 'glob', 'grep'],
    'room.message': ['room_send'],
    'source-control.read': ['bash'],
    'filesystem.write': ['write'],
  }
  const setup = createDsharnessSetup(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'dsharness'),
    bindings,
  })
  const scoped = fakeAgentScope()

  assert.equal(setup(scoped.context), undefined)
  assert.equal(scoped.sections.length, 1)
  assert.equal(scoped.sections[0]?.complete, undefined)
  assert.match(scoped.sections[0]?.text ?? '', /Finance Controller/)
  assert.deepEqual(
    scoped.skills.map((skill) => skill.name),
    ['budget-analysis'],
  )
  assert.deepEqual(scoped.restrictions, [['glob', 'grep', 'read']])
  assert.equal(scoped.guards.length, 1)
  assert.equal(scoped.guards[0]?.({ name: 'read' }), undefined)
  assert.match(scoped.guards[0]?.({ name: 'write' }) ?? '', /denied tool not bound/)
  assert.match(scoped.guards[0]?.({ name: 'room_send' }) ?? '', /denied tool not bound/)
  assert.match(scoped.guards[0]?.({ name: 'bash' }) ?? '', /denied tool not bound/)

  scoped.dispose()
  assert.deepEqual(scoped.sections, [])
  assert.deepEqual(scoped.skills, [])
  assert.deepEqual(scoped.restrictions, [])
  assert.deepEqual(scoped.guards, [])
})

test('DSHarness replacement prompts use the complete-section contract', async () => {
  const loaded = await loadRole(roleRoot)
  const role: LoadedRole = {
    ...loaded,
    manifest: structuredClone(loaded.manifest),
  }
  role.manifest.spec.prompt.mode = 'replace'
  const scoped = fakeAgentScope()

  createDsharnessSetup(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'dsharness'),
    bindings: { 'filesystem.read': ['read'] },
  })(scoped.context)

  assert.deepEqual(
    {
      name: scoped.sections[0]?.name,
      order: scoped.sections[0]?.order,
      complete: scoped.sections[0]?.complete,
    },
    { name: 'deployment:persona', order: 0, complete: true },
  )
})

test('DSHarness rejects malformed direct host bindings before setup', async () => {
  const role = await loadRole(roleRoot)
  const plan = new DsharnessCompatibility().plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'dsharness'),
    bindings: { 'filesystem.read': ['read', 'read'] },
  })

  assert.equal(plan.runnable, false)
  assert.ok(plan.mappings.some((mapping) => mapping.source === 'binding-format:filesystem.read'))
  assert.deepEqual(plan.effectiveCapabilities, ['room.message'])
})

test('DSHarness withholds optional memory without trusted provider binding evidence', async () => {
  const role = await loadRole(roleRoot)
  const policy = testPolicy(role, 'dsharness')
  policy.grants = [...policy.grants, 'memory.read']

  const unbound = new DsharnessCompatibility().plan(role, {
    mode: 'strict',
    scope: 'session',
    policy,
    bindings: { 'filesystem.read': ['read'] },
  })
  assert.equal(unbound.runnable, true)
  assert.ok(!unbound.effectiveCapabilities.includes('memory.read'))
  assert.ok(
    unbound.mappings.some(
      (mapping) =>
        mapping.source === 'optional-capability:memory.read' && mapping.fidelity === 'degraded',
    ),
  )

  const bound = new DsharnessCompatibility().plan(role, {
    mode: 'strict',
    scope: 'session',
    policy,
    bindings: {
      'filesystem.read': ['read'],
      'memory.read': ['role_memory_read'],
    },
  })
  assert.ok(bound.effectiveCapabilities.includes('memory.read'))

  const scoped = fakeAgentScope()
  createDsharnessSetup(role, {
    mode: 'strict',
    scope: 'session',
    policy,
    bindings: {
      'filesystem.read': ['read'],
      'memory.read': ['role_memory_read'],
    },
  })(scoped.context)
  assert.deepEqual(scoped.restrictions, [['read', 'role_memory_read']])
})

test('DSHarness fails closed when required memory lacks provider binding evidence', async () => {
  const loaded = await loadRole(roleRoot)
  const role: LoadedRole = {
    ...loaded,
    manifest: structuredClone(loaded.manifest),
  }
  const memory = role.manifest.spec.capabilities.optional.find(
    (capability) => capability.id === 'memory.read',
  )
  assert.ok(memory)
  role.manifest.spec.capabilities.optional = role.manifest.spec.capabilities.optional.filter(
    (capability) => capability.id !== 'memory.read',
  )
  role.manifest.spec.capabilities.required.push(memory)

  const plan = new DsharnessCompatibility().plan(role, {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'dsharness'),
    bindings: { 'filesystem.read': ['read'] },
  })
  assert.equal(plan.runnable, false)
  assert.ok(!plan.effectiveCapabilities.includes('memory.read'))
  assert.ok(
    plan.mappings.some(
      (mapping) => mapping.source === 'binding:memory.read' && mapping.fidelity === 'unsupported',
    ),
  )
})

function fakeAgentScope(): {
  context: DsharnessAgentContext
  sections: Array<{ name: string; order: number; text: string; complete?: boolean }>
  skills: Array<{ name: string }>
  restrictions: string[][]
  guards: Array<(execution: { readonly name: string }) => string | undefined>
  dispose(): void
} {
  const effects: Array<() => void> = []
  const sections: Array<{ name: string; order: number; text: string; complete?: boolean }> = []
  const skills: Array<{ name: string }> = []
  const restrictions: string[][] = []
  const guards: Array<(execution: { readonly name: string }) => string | undefined> = []
  const own = (cleanup: () => void): (() => void) => {
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      cleanup()
    }
    effects.push(dispose)
    return dispose
  }
  const context: DsharnessAgentContext = {
    systemPrompt: {
      section: (section) => {
        sections.push(section)
        return own(() => sections.splice(sections.indexOf(section), 1))
      },
    },
    skills: {
      register: (skill) => {
        skills.push(skill)
        return own(() => skills.splice(skills.indexOf(skill), 1))
      },
    },
    tools: {
      restrict: ({ allow }) => {
        const restriction = [...allow]
        restrictions.push(restriction)
        return own(() => restrictions.splice(restrictions.indexOf(restriction), 1))
      },
      guard: (guard) => {
        guards.push(guard)
        return own(() => guards.splice(guards.indexOf(guard), 1))
      },
    },
  }
  return {
    context,
    sections,
    skills,
    restrictions,
    guards,
    dispose: () => {
      for (const effect of effects.reverse()) effect()
    },
  }
}
