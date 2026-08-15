import type { BundleFile } from './bundle-files.js'
import { collectBundleFiles, sha256, stableJson } from './bundle-files.js'
import { RoleHubError } from './errors.js'
import type { LoadedRole } from './types.js'

const loadedSnapshots = new WeakMap<LoadedRole, readonly BundleFile[]>()

export function bundleDigestFromSnapshot(
  identity: { id: string; version: string; manifestDigest: string },
  files: readonly BundleFile[],
): string {
  return sha256(
    stableJson({
      role: identity,
      files: files.map(({ path, size, sha256: fileDigest }) => ({
        path,
        size,
        sha256: fileDigest,
      })),
    }),
  )
}

export function registerBundleSnapshot(role: LoadedRole, files: readonly BundleFile[]): void {
  assertSnapshotMatchesRole(role, files)
  loadedSnapshots.set(role, files)
}

export async function verifiedBundleSnapshot(role: LoadedRole): Promise<readonly BundleFile[]> {
  const files = loadedSnapshots.get(role) ?? (await collectBundleFiles(role.root))
  assertSnapshotMatchesRole(role, files)
  return files
}

export function assertSnapshotMatchesRole(role: LoadedRole, files: readonly BundleFile[]): void {
  for (const file of files) {
    if (file.size !== file.content.byteLength || file.sha256 !== sha256(file.content)) {
      throw new RoleHubError(
        'BUNDLE_CHANGED',
        `Bundle snapshot bytes no longer match their digest: ${file.path}`,
      )
    }
  }
  const bundleDigest = bundleDigestFromSnapshot(
    {
      id: role.manifest.metadata.id,
      version: role.manifest.metadata.version,
      manifestDigest: role.manifestDigest,
    },
    files,
  )
  if (bundleDigest !== role.bundleDigest) {
    throw new RoleHubError(
      'BUNDLE_CHANGED',
      'Bundle snapshot does not match the loaded role digest; load the role again',
    )
  }
}
