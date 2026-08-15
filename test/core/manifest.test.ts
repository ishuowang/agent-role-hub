import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { RoleHubError, discoverRoleRoots, loadRole } from '@ishuowang/rolehub-core'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const rolesRoot = path.join(repositoryRoot, 'roles')

test('all reference roles validate and have unique ids', async () => {
  const roots = await discoverRoleRoots(rolesRoot)
  const roles = await Promise.all(roots.map(loadRole))
  assert.equal(roles.length, 7)
  assert.equal(new Set(roles.map((role) => role.manifest.metadata.id)).size, roles.length)
  assert.ok(roles.every((role) => /^[a-f0-9]{64}$/.test(role.manifestDigest)))
  assert.ok(roles.every((role) => /^[a-f0-9]{64}$/.test(role.bundleDigest)))
})

test('bundle validation rejects symlinks', async (context) => {
  const temporary = await copyFixture(context)
  await symlink('prompt.md', path.join(temporary, 'prompt-link.md'))
  await assert.rejects(loadRole(temporary), isRoleHubError('UNSAFE_BUNDLE'))
})

test('bundle validation rejects token-shaped secrets', async (context) => {
  const temporary = await copyFixture(context)
  const fake = `ghp_${'a'.repeat(40)}`
  await writeFile(path.join(temporary, 'notes.md'), `temporary = ${fake}\n`)
  await assert.rejects(loadRole(temporary), isRoleHubError('SECRET_DETECTED'))
})

test('universal role schema rejects embedded platform compatibility fields', async (context) => {
  const temporary = await copyFixture(context)
  const manifestPath = path.join(temporary, 'role.yaml')
  const manifest = await readFile(manifestPath, 'utf8')
  await writeFile(manifestPath, `${manifest}\n  compatibility:\n    target: codex\n`)
  await assert.rejects(loadRole(temporary), isRoleHubError('SCHEMA_INVALID'))
})

async function copyFixture(context: test.TestContext): Promise<string> {
  const temporary = await mkdtemp(path.join(tmpdir(), 'rolehub-test-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))
  await cp(path.join(rolesRoot, 'io.github.ishuowang', 'finance-controller'), temporary, {
    recursive: true,
  })
  return temporary
}

function isRoleHubError(code: RoleHubError['code']): (error: unknown) => boolean {
  return (error) => error instanceof RoleHubError && error.code === code
}
