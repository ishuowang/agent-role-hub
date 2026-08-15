import type { CapabilityId } from '../types.js'
import {
  assemblePrompt,
  assertStrictCompatibility,
  capabilityIds,
  evaluatePolicy,
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

const capabilityMappings: Partial<
  Record<CapabilityId, { target: string; fidelity: Mapping['fidelity'] }>
> = {
  'filesystem.read': { target: 'sandbox_mode=read-only', fidelity: 'exact' },
  'filesystem.write': { target: 'sandbox_mode=workspace-write', fidelity: 'degraded' },
  'source-control.read': { target: 'sandboxed repository tools', fidelity: 'degraded' },
  'source-control.write': { target: 'sandbox_mode=workspace-write', fidelity: 'degraded' },
  'shell.execute': { target: 'sandboxed shell', fidelity: 'degraded' },
  'network.fetch': { target: 'network_access plus host policy', fidelity: 'degraded' },
  'web.search': { target: 'web_search', fidelity: 'degraded' },
  'issues.read': { target: 'host-provided MCP/tool', fidelity: 'degraded' },
  'issues.write': { target: 'host-provided MCP/tool', fidelity: 'degraded' },
  'room.message': { target: 'assistant response channel', fidelity: 'exact' },
}

export class CodexAdapter implements RoleAdapter {
  readonly id = 'codex' as const
  readonly version = VERSION

  plan(role: LoadedRole, options: ExportOptions): ExportPlan {
    const policy = evaluatePolicy(role, options, this.id)
    const mappings: Mapping[] = [
      { source: 'spec.prompt', target: 'developer_instructions', fidelity: 'exact' },
      { source: 'spec.skills', target: 'compiled developer_instructions', fidelity: 'degraded' },
    ]
    const requiredGrants: string[] = []
    for (const capability of capabilityIds(role, 'required')) {
      const mapping = capabilityMappings[capability]
      mappings.push(
        mapping
          ? { source: `capability:${capability}`, ...mapping }
          : {
              source: `capability:${capability}`,
              fidelity: 'unsupported',
              message: 'Codex custom-agent files cannot safely bind this required capability.',
            },
      )
      if (mapping) requiredGrants.push(capability)
    }
    for (const capability of capabilityIds(role, 'optional')) {
      const mapping = capabilityMappings[capability]
      const enabled = policy.granted.includes(capability)
      mappings.push({
        source: `optional-capability:${capability}`,
        ...(enabled && mapping?.target ? { target: mapping.target } : {}),
        fidelity: enabled && mapping ? mapping.fidelity : 'degraded',
        message: enabled
          ? 'Enabled by the matching effective policy receipt.'
          : 'Omitted because the effective policy does not grant this optional capability.',
      })
    }
    for (const capability of capabilityIds(role, 'denied')) {
      mappings.push({
        source: `deny:${capability}`,
        target: 'dedicated host policy and prompt boundary',
        fidelity: options.policy ? 'exact' : 'advisory',
        message: options.policy
          ? 'The effective policy excludes this capability; the prompt is defense in depth only.'
          : 'A custom-agent prompt alone is not a security boundary.',
      })
    }
    if (
      role.manifest.spec.capabilities.optional.some((capability) => capability.approval === 'ask')
    ) {
      mappings.push({
        source: 'spec.capabilities.optional[].approval',
        target: 'capability remains disabled in the base export',
        fidelity: 'exact',
        message: 'Optional approved capabilities require a separate host-owned overlay.',
      })
    }
    mappings.push(...policyMappings(policy))

    const plan: ExportPlan = {
      target: this.id,
      adapterVersion: this.version,
      targetVersion: '>=0.145.0 <0.146.0',
      mappings,
      requiredGrants: policy.missingRequired,
      effectiveCapabilities: policy.granted,
      ...(options.policy ? { policyDigest: options.policy.policyDigest } : {}),
      generatedFiles: [
        portableOutputPath('.codex', 'agents', `${roleSlug(role)}.toml`),
        portableOutputPath('.rolehub', 'export-report.json'),
      ],
      runnable: !mappings.some(
        (mapping) =>
          mapping.fidelity === 'unsupported' && !mapping.source.startsWith('optional-capability:'),
      ),
      warnings: [
        'Skills are compiled into developer instructions to avoid repository-wide skill discovery.',
        'The caller must apply the reported policy to a dedicated Codex session for hard isolation.',
      ],
    }
    assertStrictCompatibility(plan, options)
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): ExportResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const slug = roleSlug(role).replaceAll('-', '_')
    const sandboxMode = resolveSandboxMode(role, options)
    const lines = [
      `name = ${JSON.stringify(slug)}`,
      `description = ${JSON.stringify(role.manifest.metadata.description)}`,
      `sandbox_mode = ${JSON.stringify(sandboxMode)}`,
    ]
    const reasoning = role.manifest.spec.model?.reasoning
    if (reasoning) lines.push(`model_reasoning_effort = ${JSON.stringify(reasoning)}`)
    lines.push(`developer_instructions = ${JSON.stringify(assemblePrompt(role, this.id, true))}`)
    return {
      plan,
      files: [
        {
          path: portableOutputPath('.codex', 'agents', `${roleSlug(role)}.toml`),
          content: `${lines.join('\n')}\n`,
        },
      ],
    }
  }
}

function resolveSandboxMode(
  role: LoadedRole,
  options: ExportOptions,
): 'read-only' | 'workspace-write' {
  return role.manifest.spec.isolation.filesystem === 'workspace-write' &&
    options.policy?.grants.includes('filesystem.write')
    ? 'workspace-write'
    : 'read-only'
}
