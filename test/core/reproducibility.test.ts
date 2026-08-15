import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildCatalog } from '../../src/catalog.js'
import { sha256, stableJson } from '../../src/bundle-files.js'
import { loadRole } from '../../src/manifest.js'
import { packRole } from '../../src/pack.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const rolesRoot = path.join(repositoryRoot, 'roles')

test('catalog generation is deterministic', async () => {
  const first = stableJson(await buildCatalog(rolesRoot))
  const second = stableJson(await buildCatalog(rolesRoot))
  assert.equal(first, second)
})

test('role archives are byte-for-byte reproducible', async (context) => {
  const role = await loadRole(path.join(rolesRoot, 'io.github.ishuowang', 'research-librarian'))
  const firstDirectory = await mkdtemp(path.join(tmpdir(), 'rolehub-pack-a-'))
  const secondDirectory = await mkdtemp(path.join(tmpdir(), 'rolehub-pack-b-'))
  context.after(() =>
    Promise.all([
      rm(firstDirectory, { recursive: true, force: true }),
      rm(secondDirectory, { recursive: true, force: true }),
    ]),
  )
  const first = await packRole(role, firstDirectory)
  const second = await packRole(role, secondDirectory)
  assert.equal(sha256(await readFile(first)), sha256(await readFile(second)))
})
