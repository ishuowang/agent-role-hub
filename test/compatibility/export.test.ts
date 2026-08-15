import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { builtinCompatibilities } from '@ishuowang/rolehub'
import { RoleHubError, loadRole } from '@ishuowang/rolehub-core'
import {
  CompatibilityError,
  writeCompatibilityExport,
  type CompatibilityDescriptor,
  type CompatibilityPlan,
  type GeneratedFile,
  type RoleCompatibility,
} from '@ishuowang/rolehub-compat-sdk'
import { dsharnessBindings, testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const roleRoot = path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'software-engineer')

test('every compatibility package produces an explicit report-only preview', async (context) => {
  const role = await loadRole(roleRoot)
  const temporary = await mkdtemp(path.join(tmpdir(), 'rolehub-compat-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))

  for (const compatibility of builtinCompatibilities) {
    const output = path.join(temporary, compatibility.descriptor.id)
    const report = await writeCompatibilityExport(role, compatibility, output, {
      mode: 'best-effort',
      scope: 'session',
    })
    assert.equal(report.compatibility.id, compatibility.descriptor.id)
    assert.equal(report.role.id, role.manifest.metadata.id)
    const reportPath = path.join(output, '.rolehub', 'compatibility-report.json')
    const onDisk = JSON.parse(await readFile(reportPath, 'utf8')) as { reportVersion: number }
    assert.equal(onDisk.reportVersion, 2)
    assert.equal(report.plan.runnable, false)
    assert.ok(await readFile(path.join(output, '.rolehub', 'compatibility-lock.json'), 'utf8'))
  }
})

test('a matching receipt unlocks only a compatibility layer that preserves requirements', async (context) => {
  const role = await loadRole(roleRoot)
  const temporary = await mkdtemp(path.join(tmpdir(), 'rolehub-policy-compat-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))

  const claude = builtinCompatibilities.find((item) => item.descriptor.id === 'claude-code')!
  const claudeOutput = path.join(temporary, 'claude-code')
  const report = await writeCompatibilityExport(role, claude, claudeOutput, {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'claude-code'),
  })
  assert.equal(report.plan.runnable, true)
  assert.equal(report.plan.requiredGrants.length, 0)
  assert.ok(await readFile(path.join(claudeOutput, 'agents.json'), 'utf8'))
  await assert.rejects(
    writeCompatibilityExport(role, claude, claudeOutput, {
      mode: 'best-effort',
      scope: 'session',
      policy: testPolicy(role, 'claude-code'),
    }),
    (error) => error instanceof RoleHubError && error.code === 'OUTPUT_NOT_EMPTY',
  )

  const dsharness = builtinCompatibilities.find((item) => item.descriptor.id === 'dsharness')!
  const dsh = await writeCompatibilityExport(role, dsharness, path.join(temporary, 'dsharness'), {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'dsharness'),
    bindings: dsharnessBindings,
  })
  assert.equal(dsh.plan.runnable, true)

  const pi = builtinCompatibilities.find((item) => item.descriptor.id === 'pi')!
  const piReport = await writeCompatibilityExport(role, pi, path.join(temporary, 'pi'), {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'pi'),
  })
  assert.equal(piReport.plan.runnable, false, 'Pi has no native source-control.read binding')
  await assert.rejects(readFile(path.join(temporary, 'pi', 'rolehub-pi-runtime.json'), 'utf8'))
})

test('strict mode rejects unsupported required mappings', async () => {
  const role = await loadRole(roleRoot)
  const pi = builtinCompatibilities.find((item) => item.descriptor.id === 'pi')!
  assert.throws(
    () =>
      pi.plan(role, {
        mode: 'strict',
        scope: 'session',
        policy: testPolicy(role, 'pi'),
      }),
    CompatibilityError,
  )
})

test('export rejects ambiguous, reserved, and falsely declared third-party artifacts', async (context) => {
  const role = await loadRole(roleRoot)
  const temporary = await mkdtemp(path.join(tmpdir(), 'rolehub-hostile-compat-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))

  const cases: Array<{
    name: string
    generatedFiles: string[]
    files: GeneratedFile[]
    code: string
  }> = [
    {
      name: 'duplicate',
      generatedFiles: ['launch.json', 'launch.json'],
      files: [
        { path: 'launch.json', content: '{}' },
        { path: 'launch.json', content: '{"second":true}' },
      ],
      code: 'SCHEMA_INVALID',
    },
    {
      name: 'reserved',
      generatedFiles: ['.rolehub/compatibility-report.json'],
      files: [{ path: '.rolehub/compatibility-report.json', content: '{"forged":true}' }],
      code: 'UNSAFE_PATH',
    },
    {
      name: 'reserved-descendant',
      generatedFiles: ['.ROLEHUB/compatibility-lock.json/child'],
      files: [{ path: '.ROLEHUB/compatibility-lock.json/child', content: '{}' }],
      code: 'UNSAFE_PATH',
    },
    {
      name: 'mismatch',
      generatedFiles: ['declared.json'],
      files: [{ path: 'actual.json', content: '{}' }],
      code: 'SCHEMA_INVALID',
    },
    {
      name: 'file-directory-collision',
      generatedFiles: ['config', 'config/launch.json'],
      files: [
        { path: 'config', content: '{}' },
        { path: 'config/launch.json', content: '{}' },
      ],
      code: 'SCHEMA_INVALID',
    },
  ]

  for (const fixture of cases) {
    const output = path.join(temporary, fixture.name)
    await assert.rejects(
      writeCompatibilityExport(
        role,
        fixtureCompatibility(fixture.generatedFiles, fixture.files),
        output,
        { mode: 'strict', scope: 'session' },
      ),
      (error) => error instanceof RoleHubError && error.code === fixture.code,
      fixture.name,
    )
    await assert.rejects(stat(output), { code: 'ENOENT' })
  }
})

test('export allows only safe regular-file permission modes', async (context) => {
  const role = await loadRole(roleRoot)
  const temporary = await mkdtemp(path.join(tmpdir(), 'rolehub-file-modes-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))

  const validOutput = path.join(temporary, 'valid')
  await writeCompatibilityExport(
    role,
    fixtureCompatibility(
      ['config.json', 'launch.sh'],
      [
        { path: 'config.json', content: '{}', mode: 0o644 },
        { path: 'launch.sh', content: '#!/bin/sh\n', mode: 0o755 },
      ],
    ),
    validOutput,
    { mode: 'strict', scope: 'session' },
  )
  const lock = JSON.parse(
    await readFile(path.join(validOutput, '.rolehub', 'compatibility-lock.json'), 'utf8'),
  ) as { artifacts: Array<{ path: string; mode: number }> }
  assert.deepEqual(
    lock.artifacts.map(({ path: artifactPath, mode }) => [artifactPath, mode]),
    [
      ['config.json', 0o644],
      ['launch.sh', 0o755],
    ],
  )
  assert.equal((await stat(path.join(validOutput, 'config.json'))).mode & 0o7000, 0)
  assert.equal((await stat(path.join(validOutput, 'launch.sh'))).mode & 0o7000, 0)

  const invalidModes = [
    ['setuid', 0o4755],
    ['setgid', 0o2755],
    ['sticky', 0o1755],
    ['type-bits', 0o100644],
    ['negative', -1],
    ['non-integer', 0o644 + 0.5],
    ['other-permissions', 0o666],
  ] as const

  for (const [name, mode] of invalidModes) {
    const output = path.join(temporary, name)
    await assert.rejects(
      writeCompatibilityExport(
        role,
        fixtureCompatibility(['artifact'], [{ path: 'artifact', content: '', mode }]),
        output,
        { mode: 'strict', scope: 'session' },
      ),
      (error) => error instanceof RoleHubError && error.code === 'SCHEMA_INVALID',
      name,
    )
    await assert.rejects(stat(output), { code: 'ENOENT' })
  }
})

const fixtureDescriptor = {
  apiVersion: 'rolehub.dev/compatibility/v1alpha1',
  id: 'fixture',
  displayName: 'Fixture',
  packageName: '@fixture/rolehub-compatibility',
  version: '1.0.0',
  target: 'Fixture runtime',
  targetVersion: '>=1 <2',
  implementation: 'test fixture',
  transport: 'sdk',
  documentation: 'https://example.invalid',
} satisfies CompatibilityDescriptor

function fixtureCompatibility(generatedFiles: string[], files: GeneratedFile[]): RoleCompatibility {
  const plan: CompatibilityPlan = {
    compatibilityId: fixtureDescriptor.id,
    compatibilityVersion: fixtureDescriptor.version,
    targetVersion: fixtureDescriptor.targetVersion,
    mappings: [],
    requiredGrants: [],
    effectiveCapabilities: [],
    generatedFiles,
    runnable: true,
    warnings: [],
  }
  return {
    descriptor: fixtureDescriptor,
    plan: () => plan,
    render: () => ({ plan, files }),
  }
}
