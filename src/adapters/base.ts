import path from 'node:path'

import type { CapabilityId, LoadedEffectivePolicy, RoleManifest } from '../types.js'

export const HARNESS_IDS = ['claude', 'codex', 'opencode', 'pi', 'dsh'] as const
export type HarnessId = (typeof HARNESS_IDS)[number]
export type Fidelity = 'exact' | 'advisory' | 'degraded' | 'unsupported'
export type ExportMode = 'strict' | 'best-effort'
export type ExportScope = 'session' | 'project'

export interface LoadedSkill {
  name: string
  path: string
  content: string
  required: boolean
}

export interface LoadedRole {
  root: string
  manifestPath: string
  manifest: RoleManifest
  manifestDigest: string
  bundleDigest: string
  prompt: string
  skills: LoadedSkill[]
}

export interface Mapping {
  source: string
  target?: string
  fidelity: Fidelity
  message?: string
}

export interface ExportPlan {
  target: HarnessId
  adapterVersion: string
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
}

export interface GeneratedFile {
  path: string
  content: string | Buffer
  mode?: number
}

export interface ExportResult {
  plan: ExportPlan
  files: GeneratedFile[]
}

export interface RoleAdapter {
  readonly id: HarnessId
  readonly version: string
  plan(role: LoadedRole, options: ExportOptions): ExportPlan
  render(role: LoadedRole, options: ExportOptions): ExportResult
}

export interface ExportReport {
  reportVersion: 1
  role: {
    id: string
    version: string
    manifestDigest: string
    bundleDigest: string
  }
  adapter: {
    id: HarnessId
    version: string
  }
  options: ExportOptions
  plan: ExportPlan
}

export class AdapterCompatibilityError extends Error {
  readonly plan: ExportPlan

  constructor(plan: ExportPlan) {
    const unsupported = plan.mappings
      .filter((mapping) => mapping.fidelity === 'unsupported')
      .filter((mapping) => !mapping.source.startsWith('optional-capability:'))
      .map((mapping) => mapping.source)
      .join(', ')
    super(`Strict export to ${plan.target} is incompatible${unsupported ? `: ${unsupported}` : ''}`)
    this.name = 'AdapterCompatibilityError'
    this.plan = plan
  }
}

export function assertStrictCompatibility(plan: ExportPlan, options: ExportOptions): void {
  if (options.mode !== 'strict') return
  if (!plan.runnable) {
    throw new AdapterCompatibilityError(plan)
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
  target: HarnessId,
): PolicyEvaluation {
  const policy = options.policy
  const granted = grantedCapabilityIds(role, options)
  const missingRequired = missingRequiredGrants(role, options)
  const gaps: string[] = []
  if (!policy)
    return { granted, missingRequired, gaps: ['No effective policy receipt was supplied.'] }
  if (
    policy.target !== target ||
    policy.role.id !== role.manifest.metadata.id ||
    policy.role.bundleDigest !== role.bundleDigest
  ) {
    return {
      granted: [],
      missingRequired: capabilityIds(role, 'required'),
      gaps: ['Policy receipt does not match this role, digest, and target.'],
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
    (role.manifest.spec.isolation.scope === 'process' || target !== 'dsh') &&
    policy.enforcement.process !== 'dedicated'
  ) {
    gaps.push('This target requires a dedicated role process for per-role policy isolation.')
  }
  if (
    target === 'pi' &&
    granted.some((capability) => filesystemCapabilities.has(capability)) &&
    policy.enforcement.filesystem !== 'os-sandbox'
  ) {
    gaps.push('Pi filesystem and shell tools require an OS sandbox, not a name allowlist.')
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

export function assemblePrompt(role: LoadedRole, target: HarnessId, compileSkills = true): string {
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
      `Target adapter: ${target}`,
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
