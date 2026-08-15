#!/usr/bin/env node

import { chmod, lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = path.join(repositoryRoot, 'packages')
const packageRoot = path.resolve(process.argv[2] ?? process.cwd())
const relative = path.relative(packagesRoot, packageRoot)

if (
  !relative ||
  relative.startsWith('..') ||
  path.isAbsolute(relative) ||
  relative.includes(path.sep)
) {
  throw new Error(`Refusing to normalize a path outside one workspace package: ${packageRoot}`)
}

const packageJsonPath = path.join(packageRoot, 'package.json')
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const executablePaths = new Set(
  Object.values(
    typeof packageJson.bin === 'string' ? { default: packageJson.bin } : (packageJson.bin ?? {}),
  ).map((entry) => path.resolve(packageRoot, String(entry))),
)

for (const entry of ['package.json', 'README.md', 'LICENSE', 'dist', 'schema']) {
  const absolute = path.join(packageRoot, entry)
  try {
    await normalize(absolute)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function normalize(absolute) {
  const stat = await lstat(absolute)
  if (stat.isSymbolicLink()) {
    throw new Error(`Package inputs must not contain symlinks: ${absolute}`)
  }
  if (stat.isDirectory()) {
    await chmod(absolute, 0o755)
    for (const entry of await readdir(absolute)) await normalize(path.join(absolute, entry))
    return
  }
  if (!stat.isFile()) throw new Error(`Unsupported package input: ${absolute}`)
  await chmod(absolute, executablePaths.has(absolute) ? 0o755 : 0o644)
}
