import path from 'node:path'

import type { CapabilityId, LoadedRole } from '@ishuowang/rolehub-core'

export type Fidelity = 'exact' | 'advisory' | 'degraded' | 'unsupported'
export type ExportMode = 'strict' | 'best-effort'
export type ExportScope = 'session' | 'project'

export interface CompatibilityDescriptor {
  apiVersion: 'rolehub.dev/compatibility/v1alpha1'
  id: string
  displayName: string
  packageName: string
  version: string
  target: string
  targetVersion: string
  implementation: string
  transport: 'native' | 'cli' | 'sdk' | 'server'
  documentation: string
}

export interface EffectivePolicyReceipt {
  apiVersion: 'rolehub.dev/policy/v1alpha1'
  kind: 'EffectiveRolePolicy'
  role: {
    id: string
    bundleDigest: string
  }
  compatibility: string
  grants: CapabilityId[]
  enforcement: {
    filesystem: 'none' | 'tool-policy' | 'os-sandbox'
    network: 'none' | 'tool-policy' | 'egress-policy'
    approvals: 'none' | 'interactive-broker'
    room: 'none' | 'broker'
    process: 'shared' | 'dedicated'
    configuration: 'shared' | 'isolated'
  }
}

export interface LoadedEffectivePolicy extends EffectivePolicyReceipt {
  policyDigest: string
}

export interface Mapping {
  source: string
  target?: string
  fidelity: Fidelity
  message?: string
}

export interface CompatibilityPlan {
  compatibilityId: string
  compatibilityVersion: string
  targetVersion?: string
  mappings: Mapping[]
  requiredGrants: string[]
  effectiveCapabilities: CapabilityId[]
  policyDigest?: string
  generatedFiles: string[]
  runnable: boolean
  warnings: string[]
}

export interface ExportOptions {
  mode: ExportMode
  scope: ExportScope
  policy?: LoadedEffectivePolicy
  /** Host-owned abstract-capability to native-tool bindings; values never come from a role. */
  bindings?: Readonly<Record<string, readonly string[]>>
}

export interface GeneratedFile {
  path: string
  content: string | Buffer
  mode?: number
}

export interface CompatibilityResult {
  plan: CompatibilityPlan
  files: GeneratedFile[]
}

export interface RoleCompatibility {
  readonly descriptor: CompatibilityDescriptor
  plan(role: LoadedRole, options: ExportOptions): CompatibilityPlan
  render(role: LoadedRole, options: ExportOptions): CompatibilityResult
}

export interface CompatibilityReport {
  reportVersion: 2
  role: {
    id: string
    version: string
    manifestDigest: string
    bundleDigest: string
  }
  compatibility: {
    id: string
    packageName: string
    version: string
    targetVersion: string
  }
  options: ExportOptions
  plan: CompatibilityPlan
}

export class CompatibilityError extends Error {
  readonly plan: CompatibilityPlan

  constructor(plan: CompatibilityPlan) {
    const unsupported = plan.mappings
      .filter((mapping) => mapping.fidelity === 'unsupported')
      .filter((mapping) => !mapping.source.startsWith('optional-capability:'))
      .map((mapping) => mapping.source)
      .join(', ')
    super(
      `Strict export through ${plan.compatibilityId} is incompatible${unsupported ? `: ${unsupported}` : ''}`,
    )
    this.name = 'CompatibilityError'
    this.plan = plan
  }
}

export function assertStrictCompatibility(plan: CompatibilityPlan, options: ExportOptions): void {
  if (options.mode !== 'strict') return
  if (!plan.runnable) {
    throw new CompatibilityError(plan)
  }
}

export function roleSlug(role: LoadedRole): string {
  return role.manifest.metadata.name
}

export function capabilityIds(
  role: LoadedRole,
  kind: 'required' | 'optional' | 'denied',
): CapabilityId[] {
  return role.manifest.spec.capabilities[kind].map((capability) => capability.id)
}

export function grantedCapabilityIds(role: LoadedRole, options: ExportOptions): CapabilityId[] {
  if (!options.policy || options.policy.role.bundleDigest !== role.bundleDigest) return []
  const requested = new Set([
    ...capabilityIds(role, 'required'),
    ...capabilityIds(role, 'optional'),
  ])
  return options.policy.grants.filter((capability) => requested.has(capability))
}

export function missingRequiredGrants(role: LoadedRole, options: ExportOptions): CapabilityId[] {
  const granted = new Set(grantedCapabilityIds(role, options))
  return capabilityIds(role, 'required').filter((capability) => !granted.has(capability))
}

export interface PolicyEvaluation {
  granted: CapabilityId[]
  missingRequired: CapabilityId[]
  gaps: string[]
}

export function evaluatePolicy(
  role: LoadedRole,
  options: ExportOptions,
  compatibilityId: string,
): PolicyEvaluation {
  const policy = options.policy
  const granted = grantedCapabilityIds(role, options)
  const missingRequired = missingRequiredGrants(role, options)
  const gaps: string[] = []
  if (!policy)
    return { granted, missingRequired, gaps: ['No effective policy receipt was supplied.'] }
  if (
    policy.compatibility !== compatibilityId ||
    policy.role.id !== role.manifest.metadata.id ||
    policy.role.bundleDigest !== role.bundleDigest
  ) {
    return {
      granted: [],
      missingRequired: capabilityIds(role, 'required'),
      gaps: ['Policy receipt does not match this role, digest, and compatibility layer.'],
    }
  }
  const filesystemCapabilities = new Set<CapabilityId>([
    'filesystem.read',
    'filesystem.write',
    'shell.execute',
    'source-control.read',
    'source-control.write',
  ])
  const networkCapabilities = new Set<CapabilityId>([
    'network.fetch',
    'web.search',
    'browser.operate',
  ])
  if (
    granted.some((capability) => filesystemCapabilities.has(capability)) &&
    policy.enforcement.filesystem === 'none'
  ) {
    gaps.push('Granted filesystem/process capabilities have no filesystem enforcement.')
  }
  if (
    granted.some((capability) => networkCapabilities.has(capability)) &&
    policy.enforcement.network === 'none'
  ) {
    gaps.push('Granted network capabilities have no network enforcement.')
  }
  if (
    granted.some((capability) => capability === 'room.message' || capability === 'room.delegate') &&
    policy.enforcement.room !== 'broker'
  ) {
    gaps.push('Room capabilities require a host-owned room broker.')
  }
  const approvedOptional = new Set(
    role.manifest.spec.capabilities.optional
      .filter((capability) => capability.approval === 'ask')
      .map((capability) => capability.id),
  )
  if (
    granted.some((capability) => approvedOptional.has(capability)) &&
    policy.enforcement.approvals !== 'interactive-broker'
  ) {
    gaps.push('Approved optional capabilities require an interactive approval broker.')
  }
  if (
    role.manifest.spec.isolation.network === 'approval-required' &&
    granted.some((capability) => networkCapabilities.has(capability)) &&
    policy.enforcement.approvals !== 'interactive-broker'
  ) {
    gaps.push('The role requires approval for network access, but no approval broker is attested.')
  }
  if (
    granted.includes('shell.execute') &&
    role.manifest.spec.isolation.filesystem !== 'workspace-write' &&
    policy.enforcement.filesystem !== 'os-sandbox'
  ) {
    gaps.push('Shell access under a non-write filesystem policy requires an OS sandbox.')
  }
  if (
    granted.includes('shell.execute') &&
    role.manifest.spec.isolation.network === 'denied' &&
    policy.enforcement.network !== 'egress-policy'
  ) {
    gaps.push('Shell access under denied network policy requires enforced egress isolation.')
  }
  if (
    role.manifest.spec.isolation.scope === 'process' &&
    policy.enforcement.process !== 'dedicated'
  ) {
    gaps.push('This target requires a dedicated role process for per-role policy isolation.')
  }
  if (
    role.manifest.spec.isolation.network === 'allowlisted' &&
    policy.enforcement.network !== 'egress-policy'
  ) {
    gaps.push('A network host allowlist requires an enforced egress policy.')
  }
  return { granted, missingRequired, gaps }
}

export function policyMappings(evaluation: PolicyEvaluation): Mapping[] {
  return [
    ...evaluation.missingRequired.map((capability) => ({
      source: `grant:${capability}`,
      fidelity: 'unsupported' as const,
      message: 'The effective policy receipt does not grant this required capability.',
    })),
    ...evaluation.gaps.map((gap, index) => ({
      source: `enforcement:${index + 1}`,
      fidelity: 'unsupported' as const,
      message: gap,
    })),
  ]
}

export function assemblePrompt(
  role: LoadedRole,
  compatibilityId: string,
  compileSkills = true,
): string {
  const metadata = role.manifest.metadata
  const sections = [`# ${metadata.displayName}`, metadata.description, role.prompt.trim()]

  if (compileSkills && role.skills.length) {
    sections.push(
      [
        '## Portable instruction skills',
        'These instructions are compiled from the pinned RoleHub bundle. They do not grant tools or permissions.',
        ...role.skills.map(
          (skill) => `### Skill: ${skill.name}\n\n${stripFrontmatter(skill.content)}`,
        ),
      ].join('\n\n'),
    )
  }

  const capabilities = role.manifest.spec.capabilities
  sections.push(
    [
      '## Capability boundaries',
      `Requested: ${[...capabilities.required, ...capabilities.optional].map((item) => item.id).join(', ') || 'none'}`,
      `Denied: ${capabilities.denied.map((item) => item.id).join(', ') || 'none'}`,
      'Treat missing access as a hard boundary. Never ask for, infer, or simulate broader authorization.',
    ].join('\n'),
  )

  sections.push(
    [
      '---',
      `RoleHub source: ${metadata.id}@${metadata.version}`,
      `Manifest SHA-256: ${role.manifestDigest}`,
      `Bundle SHA-256: ${role.bundleDigest}`,
      `Compatibility layer: ${compatibilityId}`,
    ].join('\n'),
  )
  return `${sections.join('\n\n')}\n`
}

export function portableOutputPath(...parts: string[]): string {
  return path.posix.join(...parts)
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}
