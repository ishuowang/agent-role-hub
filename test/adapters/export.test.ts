import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AdapterCompatibilityError, HARNESS_IDS } from '../../src/adapters/base.js'
import { exportRole, getAdapter } from '../../src/export.js'
import { RoleHubError } from '../../src/errors.js'
import { loadRole } from '../../src/manifest.js'
import { testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const roleRoot = path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'software-engineer')

test('every supported harness produces an explicit best-effort report', async (context) => {
  const role = await loadRole(roleRoot)
  const temporary = await mkdtemp(path.join(tmpdir(), 'rolehub-export-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))

  for (const target of HARNESS_IDS) {
    const output = path.join(temporary, target)
    const report = await exportRole(role, target, output, {
      mode: 'best-effort',
      scope: 'session',
    })
    assert.equal(report.adapter.id, target)
    assert.equal(report.role.id, role.manifest.metadata.id)
    const reportPath = path.join(
      output,
      target === 'codex' ? '.rolehub/export-report.json' : 'rolehub-export.json',
    )
    const onDisk = JSON.parse(await readFile(reportPath, 'utf8')) as { reportVersion: number }
    assert.equal(onDisk.reportVersion, 1)
    assert.equal(report.plan.runnable, false)
  }
})

test('matching policy receipt unlocks only adapters that can preserve required behavior', async (context) => {
  const role = await loadRole(roleRoot)
  const temporary = await mkdtemp(path.join(tmpdir(), 'rolehub-policy-export-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))

  const claude = await exportRole(role, 'claude', path.join(temporary, 'claude'), {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'claude'),
  })
  assert.equal(claude.plan.runnable, true)
  assert.equal(claude.plan.requiredGrants.length, 0)
  assert.ok(await readFile(path.join(temporary, 'claude', 'agents.json'), 'utf8'))
  await assert.rejects(
    exportRole(role, 'claude', path.join(temporary, 'claude'), {
      mode: 'best-effort',
      scope: 'session',
      policy: testPolicy(role, 'claude'),
    }),
    (error) => error instanceof RoleHubError && error.code === 'OUTPUT_NOT_EMPTY',
  )

  const pi = await exportRole(role, 'pi', path.join(temporary, 'pi'), {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'pi'),
  })
  assert.equal(pi.plan.runnable, false, 'Pi has no native source-control.read binding')
  await assert.rejects(readFile(path.join(temporary, 'pi', 'rolehub-pi.json'), 'utf8'))
})

test('strict mode rejects unsupported required mappings', async () => {
  const role = await loadRole(roleRoot)
  assert.throws(
    () =>
      getAdapter('pi').plan(role, {
        mode: 'strict',
        scope: 'session',
        policy: testPolicy(role, 'pi'),
      }),
    AdapterCompatibilityError,
  )
})
