import {
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

export class DshAdapter implements RoleAdapter {
  readonly id = 'dsh' as const
  readonly version = VERSION

  plan(role: LoadedRole, options: ExportOptions): ExportPlan {
    const policy = evaluatePolicy(role, options, this.id)
    const mappings: Mapping[] = [
      { source: 'spec.prompt', target: 'Agent-scoped prompt section', fidelity: 'exact' },
      { source: 'spec.skills', target: 'Agent-scoped skill registry', fidelity: 'exact' },
      {
        source: 'spec.capabilities',
        target: 'Scoped tool restrictions/providers',
        fidelity: 'exact',
      },
      {
        source: 'spec.runtime.isolation',
        target: 'Continuable child session plus compositionRef',
        fidelity: 'degraded',
        message: 'Durable compositionRef requires the documented DSH integration seam.',
      },
    ]
    mappings.push(...policyMappings(policy))
    const generatedFiles = [
      portableOutputPath('composition', 'role-composition.json'),
      portableOutputPath('composition', 'prompt.md'),
      ...role.skills.map((skill) =>
        portableOutputPath('composition', 'skills', skill.name, 'SKILL.md'),
      ),
      'rolehub-export.json',
    ]
    const plan: ExportPlan = {
      target: this.id,
      adapterVersion: this.version,
      targetVersion: '>=0.1.0-rc.6 <0.2.0',
      mappings,
      requiredGrants: policy.missingRequired,
      effectiveCapabilities: policy.granted,
      ...(options.policy ? { policyDigest: options.policy.policyDigest } : {}),
      generatedFiles,
      runnable: policy.missingRequired.length === 0 && policy.gaps.length === 0,
      warnings: [
        'The DSH host must pin compositionRef and rehydrate the scoped composition on cold resume.',
      ],
    }
    assertStrictCompatibility(plan, options)
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): ExportResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const composition = {
      schemaVersion: 1,
      compositionRef: `sha256:${role.bundleDigest}`,
      member: roleSlug(role),
      role: {
        id: role.manifest.metadata.id,
        version: role.manifest.metadata.version,
      },
      prompt: './prompt.md',
      skills: role.skills.map((skill) => ({ name: skill.name, path: `./skills/${skill.name}` })),
      requestedCapabilities: role.manifest.spec.capabilities,
      effectiveCapabilities: plan.effectiveCapabilities,
      policyDigest: plan.policyDigest,
      isolation: role.manifest.spec.isolation,
      approvals: role.manifest.spec.capabilities.optional
        .filter((capability) => capability.approval === 'ask')
        .map((capability) => capability.id),
      lifecycle: {
        invite: 'verify-pin-intersect-mount',
        resume: 'verify-lock-rehydrate-before-request',
        leave: 'stop-delivery-drain-revoke-dispose',
      },
    }
    return {
      plan,
      files: [
        {
          path: portableOutputPath('composition', 'role-composition.json'),
          content: `${JSON.stringify(composition, null, 2)}\n`,
        },
        {
          path: portableOutputPath('composition', 'prompt.md'),
          content: role.prompt,
        },
        ...role.skills.map((skill) => ({
          path: portableOutputPath('composition', 'skills', skill.name, 'SKILL.md'),
          content: skill.content,
        })),
      ],
    }
  }
}
