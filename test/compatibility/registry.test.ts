import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { buildCompatibilityCatalog } from '@ishuowang/rolehub'
import { buildCatalog, stableJson } from '@ishuowang/rolehub-core'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const rolesRoot = path.join(repositoryRoot, 'roles')

test('compatibility registry is independent from the universal role catalog', async () => {
  const before = stableJson(await buildCatalog(rolesRoot))
  const registry = buildCompatibilityCatalog() as {
    apiVersion: string
    compatibilities: Array<Record<string, unknown>>
  }

  assert.equal(registry.apiVersion, 'rolehub.dev/compatibility-catalog/v1alpha1')
  assert.deepEqual(
    registry.compatibilities.map((item) => item['id']),
    ['claude-code', 'codex', 'dsharness', 'opencode', 'pi'],
  )

  registry.compatibilities.length = 0
  const after = stableJson(await buildCatalog(rolesRoot))
  assert.equal(
    after,
    before,
    'changing compatibility availability must not change role catalog bytes',
  )

  const catalog = JSON.parse(after) as { apiVersion: string; roles: Array<Record<string, unknown>> }
  assert.equal(catalog.apiVersion, 'rolehub.dev/catalog/v1alpha2')
  for (const role of catalog.roles) {
    assert.equal(role['portability'], 'universal')
    for (const forbidden of [
      'adapter',
      'adapters',
      'compatibility',
      'compatibilities',
      'platforms',
      'target',
    ]) {
      assert.equal(forbidden in role, false, `${forbidden} must not appear in a role catalog row`)
    }
  }
})
