import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { stringify as stringifyYaml } from 'yaml'

import { RoleHubError } from '../../src/errors.js'
import { loadRole } from '../../src/manifest.js'
import { loadEffectivePolicy } from '../../src/policy.js'
import { testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

test('effective policy is digest-bound and rejects denied grants', async (context) => {
  const role = await loadRole(
    path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'finance-controller'),
  )
  const temporary = await mkdtemp(path.join(tmpdir(), 'rolehub-policy-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))
  const validPath = path.join(temporary, 'policy.yaml')
  const { policyDigest: _digest, ...receipt } = testPolicy(role, 'opencode')
  await writeFile(validPath, stringifyYaml(receipt))
  const loaded = await loadEffectivePolicy(validPath, role, 'opencode')
  assert.match(loaded.policyDigest, /^[a-f0-9]{64}$/)

  const invalidPath = path.join(temporary, 'invalid-policy.yaml')
  await writeFile(
    invalidPath,
    stringifyYaml({ ...receipt, grants: [...receipt.grants, 'money.spend'] }),
  )
  await assert.rejects(
    loadEffectivePolicy(invalidPath, role, 'opencode'),
    (error) => error instanceof RoleHubError && error.code === 'POLICY_MISMATCH',
  )
})
