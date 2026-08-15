import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { RoleHubError } from './errors.js'

export const BUNDLE_LIMITS = {
  maxFiles: 256,
  maxFileBytes: 1024 * 1024,
  maxBundleBytes: 8 * 1024 * 1024,
} as const

const allowedExtensions = new Set([
  '.json',
  '.md',
  '.png',
  '.svg',
  '.txt',
  '.webp',
  '.yaml',
  '.yml',
  '.jpg',
  '.jpeg',
])

const ignoredGeneratedFiles = new Set(['bundle.lock.json'])
const forbiddenDirectoryNames = new Set([
  '.git',
  '.github',
  '.vscode',
  '__pycache__',
  'bin',
  'dist',
  'node_modules',
  'scripts',
  'vendor',
])
const forbiddenFileNames = new Set([
  '.env',
  '.npmrc',
  '.pypirc',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])

const secretPatterns: Array<[string, RegExp]> = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[opsu]_[A-Za-z0-9_]{30,}\b/],
  ['OpenAI token', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Alibaba Cloud access key id', /\bLTAI[A-Za-z0-9]{12,}\b/],
  ['generic bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/i],
]

export interface BundleFile {
  absolutePath: string
  content: Buffer
  path: string
  size: number
  sha256: string
}

export async function collectBundleFiles(root: string): Promise<BundleFile[]> {
  const absoluteRoot = path.resolve(root)
  const rootStat = await safeLstat(absoluteRoot)
  if (!rootStat?.isDirectory()) {
    throw new RoleHubError('BUNDLE_NOT_FOUND', `Role bundle is not a directory: ${absoluteRoot}`)
  }

  const files: BundleFile[] = []
  let totalBytes = 0

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        throw new RoleHubError('UNSAFE_BUNDLE', `Hidden bundle entry is not allowed: ${entry.name}`)
      }
      if (forbiddenDirectoryNames.has(entry.name) && entry.isDirectory()) {
        throw new RoleHubError(
          'UNSAFE_BUNDLE',
          `Executable/package directory is not allowed: ${entry.name}`,
        )
      }
      if (forbiddenFileNames.has(entry.name)) {
        throw new RoleHubError(
          'UNSAFE_BUNDLE',
          `Credential or package file is not allowed: ${entry.name}`,
        )
      }

      const absolutePath = path.join(directory, entry.name)
      const relativePath = toPortablePath(path.relative(absoluteRoot, absolutePath))
      const stat = await lstat(absolutePath)
      if (stat.isSymbolicLink()) {
        throw new RoleHubError('UNSAFE_BUNDLE', `Symbolic links are not allowed: ${relativePath}`)
      }
      if (stat.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!stat.isFile()) {
        throw new RoleHubError('UNSAFE_BUNDLE', `Only regular files are allowed: ${relativePath}`)
      }
      if (ignoredGeneratedFiles.has(entry.name)) continue
      if ((stat.mode & 0o111) !== 0) {
        throw new RoleHubError('UNSAFE_BUNDLE', `Executable files are not allowed: ${relativePath}`)
      }
      if (!allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
        throw new RoleHubError('UNSAFE_BUNDLE', `Unsupported file type: ${relativePath}`)
      }
      if (stat.size > BUNDLE_LIMITS.maxFileBytes) {
        throw new RoleHubError('BUNDLE_TOO_LARGE', `File exceeds 1 MiB: ${relativePath}`)
      }

      const content = await readFile(absolutePath)
      if (content.byteLength > BUNDLE_LIMITS.maxFileBytes) {
        throw new RoleHubError('BUNDLE_TOO_LARGE', `File exceeds 1 MiB: ${relativePath}`)
      }

      totalBytes += content.byteLength
      if (totalBytes > BUNDLE_LIMITS.maxBundleBytes) {
        throw new RoleHubError('BUNDLE_TOO_LARGE', 'Role bundle exceeds 8 MiB')
      }
      if (files.length >= BUNDLE_LIMITS.maxFiles) {
        throw new RoleHubError('BUNDLE_TOO_LARGE', 'Role bundle exceeds 256 files')
      }

      if (isTextFile(relativePath)) scanText(relativePath, content)
      files.push({
        absolutePath,
        content,
        path: relativePath,
        size: content.byteLength,
        sha256: sha256(content),
      })
    }
  }

  await visit(absoluteRoot)
  return files
}

export function assertSafeRelativePath(value: string, label = 'path'): string {
  if (!value || path.isAbsolute(value) || value.includes('\\')) {
    throw new RoleHubError('UNSAFE_PATH', `${label} must be a non-empty portable relative path`)
  }
  const normalized = path.posix.normalize(value)
  if (normalized === '..' || normalized.startsWith('../') || normalized !== value) {
    throw new RoleHubError('UNSAFE_PATH', `${label} escapes or is not normalized: ${value}`)
  }
  return normalized
}

export function resolveWithin(root: string, relativePath: string, label = 'path'): string {
  const safe = assertSafeRelativePath(relativePath, label)
  const absoluteRoot = path.resolve(root)
  const target = path.resolve(absoluteRoot, safe)
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new RoleHubError('UNSAFE_PATH', `${label} escapes the selected root: ${relativePath}`)
  }
  return target
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortObject(value), null, 2)}\n`
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, entry]) => [key, sortObject(entry)]),
  )
}

function scanText(relativePath: string, content: Buffer): void {
  if (content.includes(0)) {
    throw new RoleHubError('UNSAFE_BUNDLE', `NUL byte in text file: ${relativePath}`)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    throw new RoleHubError('UNSAFE_BUNDLE', `Text file is not valid UTF-8: ${relativePath}`)
  }
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) {
      throw new RoleHubError('SECRET_DETECTED', `Possible ${label} in ${relativePath}`)
    }
  }
}

function isTextFile(relativePath: string): boolean {
  return new Set(['.json', '.md', '.svg', '.txt', '.yaml', '.yml']).has(
    path.extname(relativePath).toLowerCase(),
  )
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join('/')
}

async function safeLstat(target: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
