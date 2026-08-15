import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { ErrorObject, ValidateFunction } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
import formatsPlugin from 'ajv-formats'
import { parse as parseYaml } from 'yaml'

import type { CapabilityId, RoleManifest } from './types.js'
import { RoleHubError } from './errors.js'
import {
  assertSafeRelativePath,
  collectBundleFiles,
  resolveWithin,
  sha256,
  stableJson,
} from './bundle-files.js'
import type { LoadedRole, LoadedSkill } from './adapters/base.js'

let schemaValidator: ValidateFunction<RoleManifest> | undefined

export async function loadRole(roleRoot: string): Promise<LoadedRole> {
  const root = path.resolve(roleRoot)
  const files = await collectBundleFiles(root)
  const fileNames = new Set(files.map((file) => file.path))
  if (!fileNames.has('role.yaml')) {
    throw new RoleHubError('MANIFEST_NOT_FOUND', `Missing role.yaml in ${root}`)
  }

  const manifestPath = path.join(root, 'role.yaml')
  const raw = await readFile(manifestPath, 'utf8')
  let candidate: unknown
  try {
    candidate = parseYaml(raw)
  } catch (error) {
    throw new RoleHubError('INVALID_YAML', `Cannot parse ${manifestPath}: ${messageOf(error)}`)
  }

  const validate = await getSchemaValidator()
  if (!validate(candidate)) {
    throw new RoleHubError(
      'SCHEMA_INVALID',
      `Invalid role.yaml:\n${formatSchemaErrors(validate.errors ?? [])}`,
    )
  }
  const manifest = candidate as RoleManifest
  validateSemantics(manifest)

  const promptPath = assertSafeRelativePath(manifest.spec.prompt.path, 'spec.prompt.path')
  if (!fileNames.has(promptPath)) {
    throw new RoleHubError('MISSING_FILE', `Prompt file does not exist: ${promptPath}`)
  }
  const prompt = await readFile(resolveWithin(root, promptPath), 'utf8')
  if (!prompt.trim()) throw new RoleHubError('EMPTY_PROMPT', `Prompt is empty: ${promptPath}`)

  const skills: LoadedSkill[] = []
  for (const skill of manifest.spec.skills) {
    const skillDirectory = assertSafeRelativePath(skill.path, `skill ${skill.name} path`)
    const skillPath = path.posix.join(skillDirectory, 'SKILL.md')
    if (!fileNames.has(skillPath)) {
      throw new RoleHubError('MISSING_FILE', `Skill ${skill.name} is missing ${skillPath}`)
    }
    const content = await readFile(resolveWithin(root, skillPath), 'utf8')
    validateSkillFrontmatter(skill.name, content, skillPath)
    skills.push({
      name: skill.name,
      path: skillDirectory,
      content,
      required: skill.required,
    })
  }

  const evalPath = assertSafeRelativePath(manifest.spec.evals.path, 'spec.evals.path')
  if (!fileNames.has(evalPath)) {
    throw new RoleHubError('MISSING_FILE', `Eval suite does not exist: ${evalPath}`)
  }
  await validateEvalSuite(manifest, resolveWithin(root, evalPath), evalPath)

  const manifestDigest = sha256(stableJson(manifest))
  const bundleDigest = sha256(
    stableJson({
      role: {
        id: manifest.metadata.id,
        version: manifest.metadata.version,
        manifestDigest,
      },
      files: files.map(({ path: filePath, size, sha256: fileDigest }) => ({
        path: filePath,
        size,
        sha256: fileDigest,
      })),
    }),
  )
  return {
    root,
    manifestPath,
    manifest,
    manifestDigest,
    bundleDigest,
    prompt,
    skills,
  }
}

export async function discoverRoleRoots(input: string): Promise<string[]> {
  const absolute = path.resolve(input)
  const inputStat = await safeStat(absolute)
  if (!inputStat) throw new RoleHubError('PATH_NOT_FOUND', `Path does not exist: ${absolute}`)
  if (inputStat.isFile()) {
    if (path.basename(absolute) !== 'role.yaml') {
      throw new RoleHubError('MANIFEST_NOT_FOUND', `Expected a role.yaml file: ${absolute}`)
    }
    return [path.dirname(absolute)]
  }
  if (!inputStat.isDirectory()) {
    throw new RoleHubError('PATH_NOT_FOUND', `Path is not a directory: ${absolute}`)
  }
  if (await safeStat(path.join(absolute, 'role.yaml'))) return [absolute]

  const roots: string[] = []
  const { readdir } = await import('node:fs/promises')
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 4) return
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules')
        continue
      const child = path.join(directory, entry.name)
      if (await safeStat(path.join(child, 'role.yaml'))) roots.push(child)
      else await visit(child, depth + 1)
    }
  }
  await visit(absolute, 0)
  if (!roots.length)
    throw new RoleHubError('MANIFEST_NOT_FOUND', `No role.yaml found under ${absolute}`)
  return roots
}

async function getSchemaValidator(): Promise<ValidateFunction<RoleManifest>> {
  if (schemaValidator) return schemaValidator
  const schemaPath = new URL('../schema/role-v1alpha1.schema.json', import.meta.url)
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  ;(formatsPlugin as unknown as (instance: Ajv2020) => Ajv2020)(ajv)
  const compiled = ajv.compile<RoleManifest>(schema)
  schemaValidator = compiled
  return compiled
}

function validateSemantics(manifest: RoleManifest): void {
  const expectedId = `${manifest.metadata.publisher}/${manifest.metadata.name}`
  if (manifest.metadata.id !== expectedId) {
    throw new RoleHubError(
      'INVALID_ROLE_ID',
      `metadata.id must equal metadata.publisher/metadata.name (${expectedId})`,
    )
  }

  const seen = new Map<string, string>()
  for (const kind of ['required', 'optional', 'denied'] as const) {
    for (const capability of manifest.spec.capabilities[kind]) {
      const previous = seen.get(capability.id)
      if (previous) {
        throw new RoleHubError(
          'CAPABILITY_CONFLICT',
          `Capability ${capability.id} appears in both ${previous} and ${kind}`,
        )
      }
      seen.set(capability.id, kind)
      if (kind === 'required' && capability.approval === 'ask') {
        throw new RoleHubError(
          'CAPABILITY_CONFLICT',
          `Required capability ${capability.id} cannot depend on an optional approval prompt`,
        )
      }
    }
  }

  const skillNames = new Set<string>()
  const skillPaths = new Set<string>()
  for (const skill of manifest.spec.skills) {
    if (skillNames.has(skill.name))
      throw new RoleHubError('DUPLICATE_SKILL', `Duplicate skill: ${skill.name}`)
    if (skillPaths.has(skill.path))
      throw new RoleHubError('DUPLICATE_SKILL', `Duplicate skill path: ${skill.path}`)
    skillNames.add(skill.name)
    skillPaths.add(skill.path)
    if (path.posix.basename(skill.path) !== skill.name) {
      throw new RoleHubError(
        'INVALID_SKILL',
        `Skill directory must match its name (${skill.name}): ${skill.path}`,
      )
    }
  }

  const required = new Set(manifest.spec.capabilities.required.map((capability) => capability.id))
  const requested = new Set([
    ...required,
    ...manifest.spec.capabilities.optional.map((capability) => capability.id),
  ])
  if (manifest.spec.isolation.filesystem === 'read-only' && required.has('filesystem.write')) {
    throw new RoleHubError(
      'CAPABILITY_CONFLICT',
      'filesystem.write is required but isolation.filesystem is read-only',
    )
  }
  if (
    manifest.spec.isolation.filesystem === 'denied' &&
    (required.has('filesystem.read') || required.has('filesystem.write'))
  ) {
    throw new RoleHubError(
      'CAPABILITY_CONFLICT',
      'Filesystem access is required but isolation.filesystem is denied',
    )
  }
  if (
    manifest.spec.isolation.network === 'denied' &&
    (['network.fetch', 'web.search', 'browser.operate'] satisfies CapabilityId[]).some((id) =>
      required.has(id),
    )
  ) {
    throw new RoleHubError(
      'CAPABILITY_CONFLICT',
      'Network access is required but isolation.network is denied',
    )
  }
  if (manifest.spec.secrets.some((secret) => secret.required) && !requested.has('secrets.use')) {
    throw new RoleHubError(
      'CAPABILITY_CONFLICT',
      'A required secret reference also requires the secrets.use capability',
    )
  }
}

function validateSkillFrontmatter(
  expectedName: string,
  content: string,
  relativePath: string,
): void {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match?.[1]) {
    throw new RoleHubError('INVALID_SKILL', `${relativePath} requires YAML frontmatter`)
  }
  let frontmatter: unknown
  try {
    frontmatter = parseYaml(match[1])
  } catch (error) {
    throw new RoleHubError(
      'INVALID_SKILL',
      `${relativePath} has invalid frontmatter: ${messageOf(error)}`,
    )
  }
  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new RoleHubError('INVALID_SKILL', `${relativePath} frontmatter must be an object`)
  }
  const fields = frontmatter as Record<string, unknown>
  if (fields['name'] !== expectedName) {
    throw new RoleHubError('INVALID_SKILL', `${relativePath} name must equal ${expectedName}`)
  }
  if (typeof fields['description'] !== 'string' || !fields['description'].trim()) {
    throw new RoleHubError('INVALID_SKILL', `${relativePath} requires a description`)
  }
}

async function validateEvalSuite(
  manifest: RoleManifest,
  absolutePath: string,
  relativePath: string,
): Promise<void> {
  let parsed: unknown
  try {
    parsed = parseYaml(await readFile(absolutePath, 'utf8'))
  } catch (error) {
    throw new RoleHubError('INVALID_YAML', `Cannot parse ${relativePath}: ${messageOf(error)}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new RoleHubError('SCHEMA_INVALID', `${relativePath} must contain an eval suite object`)
  }
  const suite = parsed as Record<string, unknown>
  if (suite['apiVersion'] !== 'rolehub.dev/evals/v1alpha1' || suite['kind'] !== 'RoleEvalSuite') {
    throw new RoleHubError(
      'SCHEMA_INVALID',
      `${relativePath} has an unsupported eval apiVersion or kind`,
    )
  }
  const metadata = suite['metadata'] as Record<string, unknown> | undefined
  if (
    metadata?.['role'] !== manifest.metadata.id ||
    metadata['version'] !== manifest.metadata.version
  ) {
    throw new RoleHubError(
      'SCHEMA_INVALID',
      `${relativePath} metadata must match the role id and version`,
    )
  }
  const cases = suite['cases']
  if (!Array.isArray(cases) || cases.length < 2) {
    throw new RoleHubError('SCHEMA_INVALID', `${relativePath} requires at least two eval cases`)
  }
  const ids = new Set<string>()
  const categories = new Set<string>()
  for (const [index, candidate] of cases.entries()) {
    if (!candidate || typeof candidate !== 'object') {
      throw new RoleHubError(
        'SCHEMA_INVALID',
        `${relativePath} case ${index + 1} must be an object`,
      )
    }
    const evalCase = candidate as Record<string, unknown>
    const id = evalCase['id']
    const category = evalCase['category']
    const input = evalCase['input'] as Record<string, unknown> | undefined
    const expect = evalCase['expect']
    if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) {
      throw new RoleHubError(
        'SCHEMA_INVALID',
        `${relativePath} has an invalid or duplicate case id`,
      )
    }
    if (category !== 'positive' && category !== 'adversarial') {
      throw new RoleHubError('SCHEMA_INVALID', `${relativePath} case ${id} has an invalid category`)
    }
    if (typeof input?.['prompt'] !== 'string' || !input['prompt'].trim()) {
      throw new RoleHubError('SCHEMA_INVALID', `${relativePath} case ${id} requires input.prompt`)
    }
    if (!expect || typeof expect !== 'object') {
      throw new RoleHubError('SCHEMA_INVALID', `${relativePath} case ${id} requires expect`)
    }
    ids.add(id)
    categories.add(category)
  }
  if (!categories.has('positive') || !categories.has('adversarial')) {
    throw new RoleHubError('SCHEMA_INVALID', `${relativePath} needs positive and adversarial cases`)
  }
}

function formatSchemaErrors(errors: ErrorObject[]): string {
  return errors
    .map((error) => `- ${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('\n')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function safeStat(target: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
