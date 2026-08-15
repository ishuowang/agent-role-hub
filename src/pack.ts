import { chmod, copyFile, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as tar from 'tar'

import type { LoadedRole } from './adapters/base.js'
import { collectBundleFiles, resolveWithin } from './bundle-files.js'
import { buildBundleLock, serializeBundleLock } from './lock.js'

export async function packRole(role: LoadedRole, outputDirectory: string): Promise<string> {
  const outputRoot = path.resolve(outputDirectory)
  await mkdir(outputRoot, { recursive: true })
  const archiveName = `${role.manifest.metadata.name}-${role.manifest.metadata.version}.role.tgz`
  const archivePath = resolveWithin(outputRoot, archiveName, 'archive output')
  await rejectSymlink(outputRoot)
  await rejectSymlink(archivePath)
  const stagingRoot = await mkdtemp(path.join(tmpdir(), 'rolehub-pack-'))
  const bundleRoot = path.join(stagingRoot, role.manifest.metadata.name)

  try {
    await mkdir(bundleRoot, { recursive: true })
    const files = await collectBundleFiles(role.root)
    for (const file of files) {
      const destination = resolveWithin(bundleRoot, file.path, 'bundle file')
      await mkdir(path.dirname(destination), { recursive: true })
      await copyFile(file.absolutePath, destination)
      await chmod(destination, 0o644)
    }
    const lock = await buildBundleLock(role)
    await writeFile(path.join(bundleRoot, 'bundle.lock.json'), serializeBundleLock(lock), {
      mode: 0o644,
    })

    const entries = [...files.map((file) => file.path), 'bundle.lock.json'].sort((left, right) =>
      left.localeCompare(right, 'en'),
    )
    await tar.create(
      {
        cwd: bundleRoot,
        file: archivePath,
        gzip: true,
        noMtime: true,
        portable: true,
        prefix: role.manifest.metadata.name,
      },
      entries,
    )
    return archivePath
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

async function rejectSymlink(target: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new Error(`Refusing to write through a symbolic link: ${target}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}
