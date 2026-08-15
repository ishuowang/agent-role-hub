import { stringify as stringifyYaml } from 'yaml'

import type { CapabilityId } from '../types.js'
import {
  assemblePrompt,
  assertStrictCompatibility,
  capabilityIds,
  evaluatePolicy,
  grantedCapabilityIds,
  policyMappings,
  portableOutputPath,
  roleSlug,
  type ExportOptions,
  type ExportPlan,
  type ExportResult,
  type LoadedRole,
  type Mapping,
  type RoleAdapter,
} from './base.js'

const VERSION = '0.1.0'
const toolBindings: Partial<Record<CapabilityId, string[]>> = {
  'filesystem.read': ['read', 'glob', 'grep', 'list'],
  'filesystem.write': ['edit'],
  'shell.execute': ['bash'],
  'network.fetch': ['webfetch'],
  'web.search': ['websearch'],
  'room.delegate': ['task'],
  'room.message': [],
}

export class OpenCodeAdapter implements RoleAdapter {
  readonly id = 'opencode' as const
  readonly version = VERSION

  plan(role: LoadedRole, options: ExportOptions): ExportPlan {
    const policy = evaluatePolicy(role, options, this.id)
    const mappings: Mapping[] = [
      { source: 'spec.prompt', target: 'agents/<slug>.md', fidelity: 'exact' },
      {
        source: 'spec.skills',
        target: 'compiled agent prompt sections',
        fidelity: role.skills.length ? 'degraded' : 'exact',
        message: role.skills.length
          ? 'Compilation avoids workspace-relative skill discovery and loses progressive disclosure.'
          : 'No skills are declared.',
      },
      {
        source: 'spec.isolation',
        target: 'permission map plus effective policy receipt',
        fidelity: options.policy ? 'exact' : 'unsupported',
      },
      { source: 'spec.limits.maxTurns', target: 'steps', fidelity: 'exact' },
    ]
    const requiredGrants: string[] = []
    for (const capability of capabilityIds(role, 'required')) {
      const tools = toolBindings[capability]
      mappings.push(
        tools
          ? {
              source: `capability:${capability}`,
              target: tools.join(', '),
              fidelity: 'exact',
            }
          : {
              source: `capability:${capability}`,
              fidelity: 'unsupported',
              message: 'No native OpenCode binding is declared for this required capability.',
            },
      )
      if (tools) requiredGrants.push(capability)
    }
    for (const capability of capabilityIds(role, 'optional')) {
      const tools = toolBindings[capability]
      const enabled = policy.granted.includes(capability)
      mappings.push({
        source: `optional-capability:${capability}`,
        ...(enabled && tools?.length ? { target: tools.join(', ') } : {}),
        fidelity: enabled && tools ? 'exact' : 'degraded',
        message: enabled
          ? 'Enabled by the matching effective policy receipt.'
          : 'Omitted because the effective policy does not grant this optional capability.',
      })
    }
    for (const capability of capabilityIds(role, 'denied')) {
      mappings.push({
        source: `deny:${capability}`,
        target: denyTools(capability).join(', ') || 'deny-by-default tool policy',
        fidelity: 'exact',
      })
    }
    if (role.manifest.spec.limits.timeoutSeconds || role.manifest.spec.limits.maxOutputBytes) {
      mappings.push({
        source: 'spec.limits runtime fields',
        target: 'outer runtime enforcement',
        fidelity: 'degraded',
      })
    }
    if (role.manifest.spec.model) {
      mappings.push({ source: 'spec.model', target: 'host model resolver', fidelity: 'degraded' })
    }
    mappings.push(...policyMappings(policy))
    const generatedFiles = [
      'opencode.json',
      portableOutputPath('agents', `${exportSlug(role)}.md`),
      'rolehub-export.json',
    ]
    const plan: ExportPlan = {
      target: this.id,
      adapterVersion: this.version,
      targetVersion: '>=1.18.18 <1.19.0',
      mappings,
      requiredGrants: policy.missingRequired,
      effectiveCapabilities: policy.granted,
      ...(options.policy ? { policyDigest: options.policy.policyDigest } : {}),
      generatedFiles,
      runnable: !mappings.some(
        (mapping) =>
          mapping.fidelity === 'unsupported' && !mapping.source.startsWith('optional-capability:'),
      ),
      warnings: [
        'OPENCODE_CONFIG_DIR isolates generated configuration but is not an operating-system sandbox.',
      ],
    }
    assertStrictCompatibility(plan, options)
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): ExportResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const permission = buildPermissions(role, options)
    const frontmatter: Record<string, unknown> = {
      description: role.manifest.metadata.description,
      mode: 'all',
      steps: role.manifest.spec.limits.maxTurns,
      permission,
    }
    const files = [
      {
        path: portableOutputPath('agents', `${exportSlug(role)}.md`),
        content: `---\n${stringifyYaml(frontmatter).trim()}\n---\n\n${assemblePrompt(role, this.id, true)}`,
      },
      {
        path: 'opencode.json',
        content: `${JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)}\n`,
      },
    ]
    return { plan, files }
  }
}

function exportSlug(role: LoadedRole): string {
  const publisher = role.manifest.metadata.publisher.split('.').at(-1) ?? 'community'
  return `rh-${publisher}-${roleSlug(role)}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}

function buildPermissions(role: LoadedRole, options: ExportOptions): Record<string, unknown> {
  const permission: Record<string, unknown> = { '*': 'deny' }
  const requested = new Set(grantedCapabilityIds(role, options))
  for (const capability of requested) {
    const request = [
      ...role.manifest.spec.capabilities.required,
      ...role.manifest.spec.capabilities.optional,
    ].find((candidate) => candidate.id === capability)
    const action =
      request?.approval === 'ask' ||
      (role.manifest.spec.isolation.network === 'approval-required' &&
        (capability === 'network.fetch' || capability === 'web.search'))
        ? 'ask'
        : 'allow'
    for (const tool of toolBindings[capability] ?? []) permission[tool] = action
  }
  for (const capability of capabilityIds(role, 'denied')) {
    for (const tool of denyTools(capability)) permission[tool] = 'deny'
  }
  permission['skill'] = 'deny'
  permission['external_directory'] = 'deny'
  return permission
}

function denyTools(capability: CapabilityId): string[] {
  return toolBindings[capability] ?? []
}
