import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { ClaudeCodeCompatibility } from '@ishuowang/rolehub-compat-claude-code'
import { loadRole, sha256, stableJson, type LoadedRole } from '@ishuowang/rolehub-core'
import type { LoadedEffectivePolicy } from '@ishuowang/rolehub-compat-sdk'
import { testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const roleRoot = path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'software-engineer')

test('Claude session export is scoped, deterministic, and denies native Skill discovery', async () => {
  const role = await loadRole(roleRoot)
  const compatibility = new ClaudeCodeCompatibility()
  const options = {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'claude-code'),
  } as const
  const first = compatibility.render(role, options)
  const second = compatibility.render(role, options)
  assert.deepEqual(first, second)

  const agentsFile = first.files.find((file) => file.path === 'agents.json')
  assert.ok(agentsFile && typeof agentsFile.content === 'string')
  const agents = JSON.parse(agentsFile.content) as Record<
    string,
    { tools: string[]; disallowedTools: string[]; prompt: string }
  >
  const [name, definition] = Object.entries(agents)[0] ?? []
  assert.match(name ?? '', /^rolehub-ishuowang-software-engineer-[a-f0-9]{8}$/)
  assert.ok(definition)
  assert.ok(definition.disallowedTools.includes('Skill'))
  assert.ok(
    !definition.tools.includes('Bash'),
    'optional shell capability must not be auto-enabled',
  )
  assert.match(definition.prompt, /Bundle SHA-256:/)
})

test('Claude strict export reports required skill/source-control degradation', async () => {
  const role = await loadRole(roleRoot)
  assert.throws(() =>
    new ClaudeCodeCompatibility().plan(role, {
      mode: 'strict',
      scope: 'session',
      policy: testPolicy(role, 'claude-code'),
    }),
  )
})

test('Claude project scope is report-only even with isolated configuration attested', async () => {
  const role = await loadRole(roleRoot)
  const compatibility = new ClaudeCodeCompatibility()
  const options = {
    mode: 'best-effort',
    scope: 'project',
    policy: testPolicy(role, 'claude-code'),
  } as const
  const plan = compatibility.plan(role, options)

  assert.equal(plan.runnable, false)
  assert.deepEqual(plan.generatedFiles, [])
  assert.ok(
    plan.mappings.some(
      (mapping) => mapping.source === 'export.scope' && mapping.fidelity === 'unsupported',
    ),
  )
  assert.deepEqual(compatibility.render(role, options).files, [])
  assert.throws(() =>
    compatibility.plan(role, {
      ...options,
      mode: 'strict',
    }),
  )
})

test('Claude fails closed when Bash overlaps an ungranted source-control capability', async () => {
  const role = await loadRole(roleRoot)
  const policy = grantCapabilities(testPolicy(role, 'claude-code'), ['shell.execute'])
  const result = new ClaudeCodeCompatibility().render(role, {
    mode: 'best-effort',
    scope: 'session',
    policy,
  })

  assert.equal(result.plan.runnable, false)
  assert.deepEqual(result.files, [])
  assert.ok(
    result.plan.mappings.some(
      (mapping) =>
        mapping.source === 'tool-overlap:source-control.write' &&
        mapping.fidelity === 'unsupported' &&
        mapping.message?.includes('Bash'),
    ),
  )
})

test('Claude does not call a denied capability exact when a granted tool overlaps it', async () => {
  const role = await loadRole(roleRoot)
  const deniedSourceControlRole: LoadedRole = {
    ...role,
    manifest: {
      ...role.manifest,
      spec: {
        ...role.manifest.spec,
        capabilities: {
          ...role.manifest.spec.capabilities,
          optional: role.manifest.spec.capabilities.optional.filter(
            (capability) => capability.id !== 'source-control.write',
          ),
          denied: [
            ...role.manifest.spec.capabilities.denied,
            {
              id: 'source-control.write',
              reason: 'Regression fixture: Bash must not bypass this denial.',
            },
          ],
        },
      },
    },
  }
  const policy = grantCapabilities(testPolicy(deniedSourceControlRole, 'claude-code'), [
    'shell.execute',
  ])
  const plan = new ClaudeCodeCompatibility().plan(deniedSourceControlRole, {
    mode: 'best-effort',
    scope: 'session',
    policy,
  })

  assert.equal(plan.runnable, false)
  assert.ok(
    plan.mappings.some(
      (mapping) =>
        mapping.source === 'tool-overlap:source-control.write' &&
        mapping.fidelity === 'unsupported',
    ),
  )
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
