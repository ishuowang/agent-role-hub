import type { LoadedRole } from './adapters/base.js'
import { collectBundleFiles, stableJson } from './bundle-files.js'

export interface BundleLock {
  lockVersion: 1
  bundleDigest: string
  role: {
    id: string
    version: string
    manifestDigest: string
  }
  files: Array<{
    path: string
    size: number
    sha256: string
  }>
}

export async function buildBundleLock(role: LoadedRole): Promise<BundleLock> {
  const files = await collectBundleFiles(role.root)
  return {
    lockVersion: 1,
    bundleDigest: role.bundleDigest,
    role: {
      id: role.manifest.metadata.id,
      version: role.manifest.metadata.version,
      manifestDigest: role.manifestDigest,
    },
    files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  }
}

export function serializeBundleLock(lock: BundleLock): string {
  return stableJson(lock)
}
