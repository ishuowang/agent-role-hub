#!/usr/bin/env node

import path from 'node:path'

import { Command, Option } from 'commander'

import { HARNESS_IDS, type ExportMode, type ExportScope, type HarnessId } from './adapters/base.js'
import { buildCatalog, writeCatalog } from './catalog.js'
import { RoleHubError } from './errors.js'
import { exportRole } from './export.js'
import { buildBundleLock } from './lock.js'
import { discoverRoleRoots, loadRole } from './manifest.js'
import { packRole } from './pack.js'
import { loadEffectivePolicy } from './policy.js'
import { stableJson } from './bundle-files.js'

const program = new Command()
  .name('rolehub')
  .description('Validate, package, inspect, and export portable RoleHub roles.')
  .version('0.1.0')
  .showSuggestionAfterError()
  .showHelpAfterError()

program
  .command('validate')
  .description('Validate one role or every role below a directory.')
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
        manifestDigest: role.manifestDigest,
        bundleDigest: role.bundleDigest,
        root: path.relative(process.cwd(), role.root) || '.',
      })
    }
    if (options.json) process.stdout.write(stableJson({ valid: true, roles }))
    else {
      for (const role of roles)
        console.log(`✓ ${role.id}@${role.version}  sha256:${role.bundleDigest}`)
      console.log(`Validated ${roles.length} role${roles.length === 1 ? '' : 's'}.`)
    }
  })

program
  .command('inspect')
  .description('Show normalized metadata and the reproducible bundle lock.')
  .argument('<role>', 'role directory or role.yaml')
  .action(async (input: string) => {
    const roots = await discoverRoleRoots(input)
    if (roots.length !== 1)
      throw new RoleHubError('EXPECTED_ONE_ROLE', 'Inspect accepts exactly one role')
    const role = await loadRole(roots[0]!)
    const lock = await buildBundleLock(role)
    process.stdout.write(
      stableJson({
        manifest: role.manifest,
        lock,
        promptBytes: Buffer.byteLength(role.prompt),
        skills: role.skills.map(({ name, path, required }) => ({ name, path, required })),
      }),
    )
  })

program
  .command('pack')
  .description('Build a deterministic role archive with bundle.lock.json.')
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

const catalog = program.command('catalog').description('Build and verify the static role catalog.')
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
    console.log(`Generated ${value.roles.length} roles → ${options.out}`)
  })

program
  .command('export')
  .description('Compile a verified role for one AI harness without installing it globally.')
  .argument('<role>', 'role directory or role.yaml')
  .requiredOption('-t, --target <harness>', `target harness (${HARNESS_IDS.join(', ')})`)
  .option('-o, --out <directory>', 'output directory; defaults to exports/<target>/<digest>')
  .option(
    '--policy <file>',
    'trusted effective-policy receipt bound to this role digest and target',
  )
  .addOption(new Option('--mode <mode>').choices(['strict', 'best-effort']).default('strict'))
  .addOption(new Option('--scope <scope>').choices(['session', 'project']).default('session'))
  .action(
    async (
      input: string,
      options: {
        target: string
        out?: string
        mode: ExportMode
        scope: ExportScope
        policy?: string
      },
    ) => {
      if (!HARNESS_IDS.includes(options.target as HarnessId)) {
        throw new RoleHubError('UNKNOWN_ADAPTER', `Unknown target: ${options.target}`)
      }
      const roots = await discoverRoleRoots(input)
      if (roots.length !== 1)
        throw new RoleHubError('EXPECTED_ONE_ROLE', 'Export accepts exactly one role')
      const role = await loadRole(roots[0]!)
      const target = options.target as HarnessId
      const output = options.out ?? path.join('exports', target, role.bundleDigest)
      const policy = options.policy
        ? await loadEffectivePolicy(options.policy, role, target)
        : undefined
      const report = await exportRole(role, target, output, {
        mode: options.mode,
        scope: options.scope,
        ...(policy ? { policy } : {}),
      })
      console.log(
        `${report.plan.runnable ? '✓' : '⚠'} ${report.role.id}@${report.role.version} → ${target} (${output})`,
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
