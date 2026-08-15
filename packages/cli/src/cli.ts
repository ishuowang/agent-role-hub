#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Command, Option } from 'commander'
import {
  RoleHubError,
  buildBundleLock,
  buildCatalog,
  discoverRoleRoots,
  loadRole,
  packRole,
  stableJson,
  writeCatalog,
} from '@ishuowang/rolehub-core'
import {
  loadEffectivePolicy,
  writeCompatibilityExport,
  type ExportMode,
  type ExportScope,
} from '@ishuowang/rolehub-compat-sdk'
import {
  buildCompatibilityCatalog,
  builtinCompatibilities,
  describeCompatibility,
  loadCompatibility,
} from './registry.js'

const program = new Command()
  .name('rolehub')
  .description('Validate universal roles and explicitly bridge them into an AI harness.')
  .version('0.2.0')
  .showSuggestionAfterError()
  .showHelpAfterError()

program
  .command('validate')
  .description('Validate one universal role or every role below a directory.')
  .argument('[input]', 'role directory, role.yaml, or roles root', 'roles')
  .option('--json', 'emit machine-readable JSON')
  .action(async (input: string, options: { json?: boolean }) => {
    const roots = await discoverRoleRoots(input)
    const roles = []
    for (const root of roots) {
      const role = await loadRole(root)
      roles.push({
        id: role.manifest.metadata.id,
        version: role.manifest.metadata.version,
        portability: 'universal',
        manifestDigest: role.manifestDigest,
        bundleDigest: role.bundleDigest,
        root: path.relative(process.cwd(), role.root) || '.',
      })
    }
    if (options.json) process.stdout.write(stableJson({ valid: true, roles }))
    else {
      for (const role of roles)
        console.log(`✓ ${role.id}@${role.version}  universal  sha256:${role.bundleDigest}`)
      console.log(`Validated ${roles.length} role${roles.length === 1 ? '' : 's'}.`)
    }
  })

program
  .command('inspect')
  .description('Show normalized role metadata and its reproducible bundle lock.')
  .argument('<role>', 'role directory or role.yaml')
  .action(async (input: string) => {
    const roots = await discoverRoleRoots(input)
    if (roots.length !== 1)
      throw new RoleHubError('EXPECTED_ONE_ROLE', 'Inspect accepts exactly one role')
    const role = await loadRole(roots[0]!)
    const lock = await buildBundleLock(role)
    process.stdout.write(
      stableJson({
        portability: 'universal',
        manifest: role.manifest,
        lock,
        promptBytes: Buffer.byteLength(role.prompt),
        skills: role.skills.map(({ name, description, path, required }) => ({
          name,
          description,
          path,
          required,
        })),
      }),
    )
  })

program
  .command('pack')
  .description('Build a deterministic universal role archive with bundle.lock.json.')
  .argument('<role>', 'role directory or role.yaml')
  .option('-o, --out <directory>', 'output directory', 'dist/roles')
  .action(async (input: string, options: { out: string }) => {
    const roots = await discoverRoleRoots(input)
    if (roots.length !== 1)
      throw new RoleHubError('EXPECTED_ONE_ROLE', 'Pack accepts exactly one role')
    const role = await loadRole(roots[0]!)
    const archive = await packRole(role, options.out)
    console.log(path.relative(process.cwd(), archive) || archive)
  })

const catalog = program.command('catalog').description('Build the platform-neutral role catalog.')
catalog
  .command('build')
  .description('Generate a deterministic catalog from validated role bundles.')
  .option('--roles <directory>', 'roles root', 'roles')
  .requiredOption('--out <file>', 'catalog JSON output')
  .option('--site <file>', 'optional second output used by the static catalog site')
  .action(async (options: { roles: string; out: string; site?: string }) => {
    const value = await buildCatalog(options.roles)
    await writeCatalog(value, options.out)
    if (options.site) await writeCatalog(value, options.site)
    console.log(`Generated ${value.roles.length} universal roles → ${options.out}`)
  })

const compat = program
  .command('compat')
  .alias('compatibility')
  .description('Inspect or invoke independently versioned harness compatibility packages.')

compat
  .command('list')
  .description('List built-in compatibility packages; roles do not contain this list.')
  .option('--json', 'emit machine-readable JSON')
  .action((options: { json?: boolean }) => {
    if (options.json) {
      process.stdout.write(stableJson(buildCompatibilityCatalog()))
      return
    }
    for (const item of builtinCompatibilities) {
      const value = item.descriptor
      console.log(`${value.id.padEnd(13)} ${value.packageName}@${value.version} → ${value.target}`)
    }
  })

compat
  .command('inspect')
  .description('Inspect one built-in or explicitly installed compatibility package.')
  .argument('<reference>', 'compatibility id or installed package specifier')
  .action(async (reference: string) => {
    process.stdout.write(describeCompatibility(await loadCompatibility(reference)))
  })

compat
  .command('catalog')
  .description('Write the compatibility registry separately from the role catalog.')
  .requiredOption('--out <file>', 'registry JSON output')
  .option('--site <file>', 'optional second output used by the static catalog site')
  .action(async (options: { out: string; site?: string }) => {
    const content = stableJson(buildCompatibilityCatalog())
    for (const output of [options.out, options.site].filter((item): item is string => !!item)) {
      const absolute = path.resolve(output)
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, content, { mode: 0o644 })
    }
    console.log(
      `Generated ${builtinCompatibilities.length} compatibility packages → ${options.out}`,
    )
  })

compat
  .command('export')
  .description('Bridge one verified role with an explicitly selected compatibility package.')
  .argument('<role>', 'role directory or role.yaml')
  .requiredOption('--using <reference>', 'compatibility id or installed package specifier')
  .option('-o, --out <directory>', 'output directory; defaults to exports/<compat>/<digest>')
  .option('--policy <file>', 'trusted effective-policy receipt bound to role and compatibility')
  .option('--bindings <file>', 'trusted JSON map from abstract capabilities to native tool names')
  .addOption(new Option('--mode <mode>').choices(['strict', 'best-effort']).default('strict'))
  .addOption(new Option('--scope <scope>').choices(['session', 'project']).default('session'))
  .action(
    async (
      input: string,
      options: {
        using: string
        out?: string
        mode: ExportMode
        scope: ExportScope
        policy?: string
        bindings?: string
      },
    ) => {
      const roots = await discoverRoleRoots(input)
      if (roots.length !== 1)
        throw new RoleHubError('EXPECTED_ONE_ROLE', 'Compat export accepts exactly one role')
      const role = await loadRole(roots[0]!)
      const compatibility = await loadCompatibility(options.using)
      const output =
        options.out ?? path.join('exports', compatibility.descriptor.id, role.bundleDigest)
      const policy = options.policy
        ? await loadEffectivePolicy(options.policy, role, compatibility.descriptor.id)
        : undefined
      const bindings = options.bindings ? await loadBindings(options.bindings) : undefined
      const report = await writeCompatibilityExport(role, compatibility, output, {
        mode: options.mode,
        scope: options.scope,
        ...(policy ? { policy } : {}),
        ...(bindings ? { bindings } : {}),
      })
      console.log(
        `${report.plan.runnable ? '✓' : '⚠'} ${report.role.id}@${report.role.version} → ${report.compatibility.id} (${output})`,
      )
      for (const warning of report.plan.warnings) console.warn(`  warning: ${warning}`)
      if (!report.plan.runnable) {
        console.warn('  report-only: no runnable harness configuration was generated')
        if (report.plan.requiredGrants.length) {
          console.warn(`  missing grants: ${report.plan.requiredGrants.join(', ')}`)
        }
      }
    },
  )

async function loadBindings(input: string): Promise<Record<string, readonly string[]>> {
  const absolute = path.resolve(input)
  let value: unknown
  try {
    value = JSON.parse(await readFile(absolute, 'utf8'))
  } catch (error) {
    throw new RoleHubError(
      'INVALID_YAML',
      `Cannot parse bindings JSON ${absolute}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RoleHubError('SCHEMA_INVALID', 'Bindings must be an object')
  }
  const bindings: Record<string, readonly string[]> = {}
  for (const [capability, names] of Object.entries(value)) {
    if (
      !Array.isArray(names) ||
      !names.every((name) => typeof name === 'string' && /^[A-Za-z0-9_.:-]+$/.test(name))
    ) {
      throw new RoleHubError('SCHEMA_INVALID', `Invalid native tool bindings for ${capability}`)
    }
    bindings[capability] = [...new Set(names)].sort()
  }
  return bindings
}

try {
  await program.parseAsync(process.argv)
} catch (error) {
  if (error instanceof RoleHubError) {
    console.error(`rolehub: ${error.code}: ${error.message}`)
  } else if (error instanceof Error) {
    console.error(`rolehub: ${error.message}`)
  } else {
    console.error(`rolehub: ${String(error)}`)
  }
  process.exitCode = 1
}
