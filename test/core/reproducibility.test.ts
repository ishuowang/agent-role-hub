import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as tar from 'tar'

import { buildCatalog, loadRole, packRole, sha256, stableJson } from '@ishuowang/rolehub-core'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const rolesRoot = path.join(repositoryRoot, 'roles')

test('catalog generation is deterministic', async () => {
  const first = stableJson(await buildCatalog(rolesRoot))
  const second = stableJson(await buildCatalog(rolesRoot))
  assert.equal(first, second)
  const catalog = JSON.parse(first) as { roles: Array<Record<string, unknown>> }
  assert.ok(catalog.roles.every((role) => role['portability'] === 'universal'))
  assert.ok(catalog.roles.every((role) => !('adapters' in role) && !('platforms' in role)))
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

test('packing uses the same verified byte snapshot as the bundle digest and lock', async (context) => {
  const roleRoot = await mkdtemp(path.join(tmpdir(), 'rolehub-snapshot-role-'))
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'rolehub-snapshot-pack-'))
  const extractDirectory = await mkdtemp(path.join(tmpdir(), 'rolehub-snapshot-extract-'))
  context.after(() =>
    Promise.all([
      rm(roleRoot, { recursive: true, force: true }),
      rm(outputDirectory, { recursive: true, force: true }),
      rm(extractDirectory, { recursive: true, force: true }),
    ]),
  )
  await cp(path.join(rolesRoot, 'io.github.ishuowang', 'research-librarian'), roleRoot, {
    recursive: true,
  })

  const role = await loadRole(roleRoot)
  const promptPath = path.join(roleRoot, role.manifest.spec.prompt.path)
  const changedPrompt = `${role.prompt}\nThis change happened after loadRole.\n`
  await writeFile(promptPath, changedPrompt)

  const archive = await packRole(role, outputDirectory)
  await tar.extract({ cwd: extractDirectory, file: archive })

  const bundledRoot = path.join(extractDirectory, role.manifest.metadata.name)
  const archivedPrompt = await readFile(
    path.join(bundledRoot, role.manifest.spec.prompt.path),
    'utf8',
  )
  const lock = JSON.parse(await readFile(path.join(bundledRoot, 'bundle.lock.json'), 'utf8')) as {
    bundleDigest: string
    role: { id: string; version: string; manifestDigest: string }
    files: Array<{ path: string; size: number; sha256: string }>
  }

  assert.equal(archivedPrompt, role.prompt)
  assert.notEqual(archivedPrompt, changedPrompt)
  assert.equal(lock.bundleDigest, role.bundleDigest)
  assert.equal(
    lock.files.find((file) => file.path === role.manifest.spec.prompt.path)?.sha256,
    sha256(archivedPrompt),
  )
  assert.equal(
    sha256(stableJson({ role: lock.role, files: lock.files })),
    lock.bundleDigest,
    'the lock digest must describe the exact archived snapshot',
  )
})
