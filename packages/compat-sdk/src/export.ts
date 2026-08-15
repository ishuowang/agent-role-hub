import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  RoleHubError,
  assertSafeRelativePath,
  resolveWithin,
  sha256,
  stableJson,
  type LoadedRole,
} from '@ishuowang/rolehub-core'
import { type ExportOptions, type CompatibilityReport, type RoleCompatibility } from './contract.js'

export async function writeCompatibilityExport(
  role: LoadedRole,
  compatibility: RoleCompatibility,
  output: string,
  options: ExportOptions,
): Promise<CompatibilityReport> {
  const result = compatibility.render(role, options)
  const descriptor = compatibility.descriptor
  if (
    result.plan.compatibilityId !== descriptor.id ||
    result.plan.compatibilityVersion !== descriptor.version
  ) {
    throw new RoleHubError(
      'POLICY_MISMATCH',
      'Compatibility plan identity does not match its exported descriptor',
    )
  }
  if (!result.plan.runnable && result.files.length) {
    throw new RoleHubError(
      'POLICY_MISMATCH',
      'A non-runnable compatibility plan must not emit launchable artifacts',
    )
  }
  assertArtifactContract(
    result.plan.generatedFiles,
    result.files.map((file) => file.path),
    result.plan.runnable,
  )
  for (const file of result.files) assertSafeGeneratedFileMode(file.mode, file.path)
  const report: CompatibilityReport = {
    reportVersion: 2,
    role: {
      id: role.manifest.metadata.id,
      version: role.manifest.metadata.version,
      manifestDigest: role.manifestDigest,
      bundleDigest: role.bundleDigest,
    },
    compatibility: {
      id: descriptor.id,
      packageName: descriptor.packageName,
      version: descriptor.version,
      targetVersion: descriptor.targetVersion,
    },
    options,
    plan: result.plan,
  }
  const outputRoot = path.resolve(output)
  await mkdir(outputRoot, { recursive: true })
  const existing = await readdir(outputRoot)
  if (existing.length) {
    throw new RoleHubError(
      'OUTPUT_NOT_EMPTY',
      `Refusing to mix an export with existing files: ${outputRoot}`,
    )
  }
  await assertNoSymlinkAncestors(outputRoot, outputRoot)

  const lock = {
    apiVersion: 'rolehub.dev/compatibility-lock/v1alpha1',
    role: report.role,
    compatibility: report.compatibility,
    policyDigest: result.plan.policyDigest ?? null,
    artifacts: result.files
      .map((file) => ({
        path: file.path,
        sha256: sha256(file.content),
        mode: file.mode ?? 0o644,
      }))
      .sort((left, right) => left.path.localeCompare(right.path, 'en')),
  }
  const files = [
    ...result.files,
    { path: '.rolehub/compatibility-report.json', content: stableJson(report) },
    { path: '.rolehub/compatibility-lock.json', content: stableJson(lock) },
  ]
  for (const file of files) {
    const destination = resolveWithin(outputRoot, file.path, 'compatibility output')
    await assertNoSymlinkAncestors(outputRoot, destination)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, file.content, { mode: file.mode ?? 0o644 })
  }
  return report
}

function assertSafeGeneratedFileMode(mode: unknown, filePath: string): void {
  if (mode === undefined || mode === 0o644 || mode === 0o755) return
  throw new RoleHubError(
    'SCHEMA_INVALID',
    `Generated file mode must be the integer permission 0644 or 0755: ${filePath}`,
  )
}

function assertArtifactContract(
  declaredPaths: unknown,
  actualPaths: unknown,
  runnable: boolean,
): void {
  const declared = validateArtifactPaths(declaredPaths, 'plan.generatedFiles')
  const actual = validateArtifactPaths(actualPaths, 'compatibility artifacts')
  if (runnable && !sameStrings(declared, actual)) {
    throw new RoleHubError(
      'SCHEMA_INVALID',
      'Runnable compatibility plan.generatedFiles must exactly match emitted artifact paths',
    )
  }
}

function validateArtifactPaths(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new RoleHubError('SCHEMA_INVALID', `${label} must be an array of portable paths`)
  }
  const paths = value.map((entry) => assertSafeRelativePath(entry, label))
  const seen = new Map<string, string>()
  const reservedReceipts = [
    '.rolehub/compatibility-report.json',
    '.rolehub/compatibility-lock.json',
  ]
  for (const artifactPath of paths) {
    const comparisonPath = artifactPath.toLowerCase()
    if (
      comparisonPath === '.' ||
      comparisonPath === '.rolehub' ||
      reservedReceipts.some(
        (receipt) => comparisonPath === receipt || comparisonPath.startsWith(`${receipt}/`),
      )
    ) {
      throw new RoleHubError(
        'UNSAFE_PATH',
        `${label} cannot write a reserved RoleHub receipt path: ${artifactPath}`,
      )
    }
    const duplicate = seen.get(comparisonPath)
    if (duplicate !== undefined) {
      throw new RoleHubError(
        'SCHEMA_INVALID',
        `${label} contains duplicate or case-colliding paths: ${duplicate} and ${artifactPath}`,
      )
    }
    seen.set(comparisonPath, artifactPath)
  }
  const sorted = [...seen.values()].sort((left, right) => left.localeCompare(right, 'en'))
  for (const [index, artifactPath] of sorted.entries()) {
    const descendant = sorted[index + 1]
    if (descendant?.toLowerCase().startsWith(`${artifactPath.toLowerCase()}/`)) {
      throw new RoleHubError(
        'SCHEMA_INVALID',
        `${label} contains a file/directory path collision: ${artifactPath} and ${descendant}`,
      )
    }
  }
  return sorted
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function assertNoSymlinkAncestors(root: string, destination: string): Promise<void> {
  const relative = path.relative(root, destination)
  let current = root
  for (const segment of ['', ...relative.split(path.sep)]) {
    if (segment) current = path.join(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new RoleHubError(
          'UNSAFE_PATH',
          `Compatibility output traverses a symlink: ${current}`,
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
}
