import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const coreRoot = path.join(repositoryRoot, 'packages', 'core')

const namedPlatformLeaks = [
  /@ishuowang\/rolehub-compat-/i,
  /@anthropic-ai\//i,
  /@deepseek-ai\//i,
  /@opencode-ai\//i,
  /@earendil-works\/pi-coding-agent/i,
  /\bclaude(?: code)?\b/i,
  /\bcodex\b/i,
  /\bopencode\b/i,
  /\bdeepseek(?: harness)?\b/i,
  /\bdsharness\b/i,
  /\bpi coding agent\b/i,
  /\badapters?\b/i,
]

test('core stays free of named harnesses and compatibility dependencies', async () => {
  const packageJson = JSON.parse(await readFile(path.join(coreRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.peerDependencies,
    ...packageJson.optionalDependencies,
  })
  assert.deepEqual(
    dependencyNames.filter((name) => namedPlatformLeaks.some((pattern) => pattern.test(name))),
    [],
  )

  const files = await collectTextFiles(coreRoot)
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    const leak = namedPlatformLeaks.find((pattern) => pattern.test(content))
    assert.equal(
      leak,
      undefined,
      `platform-specific term ${String(leak)} leaked into ${path.relative(coreRoot, file)}`,
    )
  }
})

async function collectTextFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(absolute)))
      continue
    }
    if (entry.isFile() && ['.json', '.md', '.ts'].includes(path.extname(entry.name))) {
      files.push(absolute)
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'))
}
