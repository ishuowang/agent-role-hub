import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { Ajv2020 } from 'ajv/dist/2020.js'

import { CAPABILITY_IDS } from '../../src/types.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')

test('public schemas compile and capability vocabulary stays aligned with TypeScript', async () => {
  const roleSchema = JSON.parse(
    await readFile(path.join(repositoryRoot, 'schema', 'role-v1alpha1.schema.json'), 'utf8'),
  ) as any
  const policySchema = JSON.parse(
    await readFile(
      path.join(repositoryRoot, 'schema', 'effective-policy-v1alpha1.schema.json'),
      'utf8',
    ),
  ) as any
  const ajv = new Ajv2020({ strict: true })
  assert.doesNotThrow(() => ajv.compile(roleSchema))
  assert.doesNotThrow(() => ajv.compile(policySchema))
  const roleCapabilities = roleSchema.$defs.capabilityRequest.properties.id.enum as string[]
  const policyCapabilities = policySchema.properties.grants.items.enum as string[]
  assert.deepEqual(roleCapabilities, [...CAPABILITY_IDS])
  assert.deepEqual(policyCapabilities, [...CAPABILITY_IDS])
})
