import { stableJson, type CapabilityId, type LoadedRole } from '@ishuowang/rolehub-core'
import {
  assemblePrompt,
  assertStrictCompatibility,
  capabilityIds,
  evaluatePolicy,
  policyMappings,
  portableOutputPath,
  roleSlug,
  type CompatibilityDescriptor,
  type CompatibilityPlan,
  type CompatibilityResult,
  type ExportOptions,
  type Mapping,
  type RoleCompatibility,
} from '@ishuowang/rolehub-compat-sdk'

const VERSION = '0.2.0'

export const descriptor: CompatibilityDescriptor = {
  apiVersion: 'rolehub.dev/compatibility/v1alpha1',
  id: 'dsharness',
  displayName: 'DeepSeek Harness',
  packageName: '@ishuowang/rolehub-compat-dsharness',
  version: VERSION,
  target: 'DeepSeek Harness Agent Scope',
  targetVersion: '>=0.1.0-rc.6 <0.2.0',
  implementation: 'Cordis Agent.setup composition using scoped prompt, skill, and tool registries',
  transport: 'native',
  documentation:
    'https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/dsharness.md',
}

const brokerOnlyCapabilities = new Set<CapabilityId>(['room.message'])

export class DsharnessCompatibility implements RoleCompatibility {
  readonly descriptor = descriptor

  plan(role: LoadedRole, options: ExportOptions): CompatibilityPlan {
    const policy = evaluatePolicy(role, options, this.descriptor.id)
    const mappings: Mapping[] = [
      {
        source: 'spec.prompt',
        target: 'agentCtx.systemPrompt.section()',
        fidelity: 'exact',
      },
      {
        source: 'spec.skills',
        target: 'agentCtx.skills.register()',
        fidelity: 'exact',
      },
      {
        source: 'spec.capabilities',
        target:
          'agentCtx.tools.restrict() plus monotonic tools.guard() and host capability providers',
        fidelity: 'exact',
      },
      {
        source: 'spec.isolation.scope',
        target: 'DSHarness Agent scope and owned AgentHandle lifecycle',
        fidelity: role.manifest.spec.isolation.scope === 'session' ? 'exact' : 'degraded',
        ...(role.manifest.spec.isolation.scope === 'process'
          ? { message: 'The host must place this Agent scope in a dedicated DSHarness process.' }
          : {}),
      },
      {
        source: 'room.lifecycle',
        target: 'ctx.subagents continuable child and AgentHandle.dispose()',
        fidelity: 'exact',
      },
    ]

    const required = new Set(capabilityIds(role, 'required'))
    const effectiveCapabilities: CapabilityId[] = []
    for (const capability of policy.granted) {
      if (brokerOnlyCapabilities.has(capability)) {
        effectiveCapabilities.push(capability)
        continue
      }
      const binding = inspectBinding(capability, options)
      if (!binding.valid) {
        mappings.push({
          source: `binding-format:${capability}`,
          fidelity: 'unsupported',
          message: 'Native tool bindings must be a unique array of valid DSHarness tool names.',
        })
        continue
      }
      if (binding.tools.length === 0) {
        mappings.push({
          source: required.has(capability)
            ? `binding:${capability}`
            : `optional-capability:${capability}`,
          fidelity: required.has(capability) ? 'unsupported' : 'degraded',
          message: 'The DSHarness host has not resolved this abstract capability to native tools.',
        })
        continue
      }
      effectiveCapabilities.push(capability)
    }
    mappings.push(...policyMappings(policy))

    const generatedFiles = [
      portableOutputPath('dsharness', 'role-composition.json'),
      portableOutputPath('dsharness', 'prompt.md'),
      ...role.skills.map((skill) =>
        portableOutputPath('dsharness', 'skills', skill.name, 'SKILL.md'),
      ),
      'rolehub-dsharness-runtime.json',
    ]
    const plan: CompatibilityPlan = {
      compatibilityId: this.descriptor.id,
      compatibilityVersion: this.descriptor.version,
      targetVersion: this.descriptor.targetVersion,
      mappings,
      requiredGrants: policy.missingRequired,
      effectiveCapabilities,
      ...(options.policy ? { policyDigest: options.policy.policyDigest } : {}),
      generatedFiles,
      runnable: !mappings.some(
        (mapping) =>
          mapping.fidelity === 'unsupported' && !mapping.source.startsWith('optional-capability:'),
      ),
      warnings: [
        'Bindings are trusted host configuration and are never loaded from the role bundle.',
        'Memory capabilities require a non-empty trusted host binding to a scoped provider.',
        'Cold resume must re-run createDsharnessSetup against the same pinned bundle digest.',
        "The execution guard is required because tools.restrict() does not filter tools registered later in the agent's own scope.",
      ],
    }
    assertStrictCompatibility(plan, options)
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): CompatibilityResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const nativeTools = resolveNativeTools(plan.effectiveCapabilities, options)
    const composition = {
      schemaVersion: 2,
      compositionRef: `sha256:${role.bundleDigest}`,
      member: roleSlug(role),
      role: {
        id: role.manifest.metadata.id,
        version: role.manifest.metadata.version,
      },
      setup: '@ishuowang/rolehub-compat-dsharness#createDsharnessSetup',
      prompt: './prompt.md',
      skills: role.skills.map((skill) => ({
        name: skill.name,
        path: `./skills/${skill.name}/SKILL.md`,
      })),
      nativeTools,
      effectiveCapabilities: plan.effectiveCapabilities,
      policyDigest: plan.policyDigest,
      isolation: role.manifest.spec.isolation,
      lifecycle: {
        invite: 'verify-pin-intersect-create-agent-scope',
        resume: 'verify-lock-rehydrate-setup-before-publish',
        leave: 'stop-delivery-drain-revoke-dispose-agent-handle',
      },
    }
    return {
      plan,
      files: [
        {
          path: portableOutputPath('dsharness', 'role-composition.json'),
          content: stableJson(composition),
        },
        {
          path: portableOutputPath('dsharness', 'prompt.md'),
          content: assemblePrompt(role, this.descriptor.id, false),
        },
        ...role.skills.map((skill) => ({
          path: portableOutputPath('dsharness', 'skills', skill.name, 'SKILL.md'),
          content: skill.content,
        })),
        {
          path: 'rolehub-dsharness-runtime.json',
          content: stableJson({
            schemaVersion: 1,
            package: descriptor.packageName,
            export: 'createDsharnessSetup',
            composition: './dsharness/role-composition.json',
            requiredServices: ['systemPrompt', 'skills', 'tools', 'agents', 'subagents'],
          }),
        },
      ],
    }
  }
}

/** Minimal structural surface implemented by a DSHarness Agent-scoped Cordis context. */
export interface DsharnessAgentContext {
  systemPrompt: {
    section(section: { name: string; order: number; text: string; complete?: boolean }): () => void
  }
  skills: {
    register(skill: {
      name: string
      description: string
      content: string
      source: 'bundled'
      invocation: { modelInvocable: boolean; userInvocable: boolean }
      provider: string
    }): () => void
  }
  tools: {
    restrict(filter: { allow: readonly string[] }): () => void
    guard(guard: (execution: { readonly name: string }) => string | undefined): () => void
  }
}

/**
 * Build the trusted `CreateAgentOptions.setup` callback used by DSHarness.
 * Registrations belong to the unpublished Agent scope and unwind with its AgentHandle.
 */
export function createDsharnessSetup(
  role: LoadedRole,
  options: ExportOptions,
): (agentCtx: DsharnessAgentContext) => void {
  const compatibility = new DsharnessCompatibility()
  const plan = compatibility.plan(role, options)
  if (!plan.runnable) throw new Error('Cannot mount a non-runnable DSHarness compatibility plan')
  const prompt = assemblePrompt(role, descriptor.id, false)
  const nativeTools = resolveNativeTools(plan.effectiveCapabilities, options)

  return (agentCtx) => {
    agentCtx.systemPrompt.section({
      name:
        role.manifest.spec.prompt.mode === 'replace'
          ? 'deployment:persona'
          : `rolehub:role:${role.bundleDigest.slice(0, 16)}`,
      order: role.manifest.spec.prompt.mode === 'replace' ? 0 : 10,
      text: prompt,
      ...(role.manifest.spec.prompt.mode === 'replace' ? { complete: true } : {}),
    })
    for (const skill of role.skills) {
      agentCtx.skills.register({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: `rolehub:${role.bundleDigest}`,
      })
    }
    const allowedTools = new Set(nativeTools)
    agentCtx.tools.restrict({ allow: nativeTools })
    agentCtx.tools.guard((execution) =>
      allowedTools.has(execution.name)
        ? undefined
        : `RoleHub denied tool not bound by the effective role policy: ${execution.name}`,
    )
  }
}

function resolveNativeTools(
  capabilities: readonly CapabilityId[],
  options: ExportOptions,
): string[] {
  const tools = new Set<string>()
  for (const capability of capabilities) {
    if (brokerOnlyCapabilities.has(capability)) continue
    for (const tool of inspectBinding(capability, options).tools) tools.add(tool)
  }
  return [...tools].sort()
}

function inspectBinding(
  capability: CapabilityId,
  options: ExportOptions,
): { valid: boolean; tools: string[] } {
  const value: unknown = options.bindings?.[capability]
  if (value === undefined) return { valid: true, tools: [] }
  if (
    !Array.isArray(value) ||
    !value.every((tool) => typeof tool === 'string' && /^[A-Za-z0-9_.:-]+$/.test(tool))
  ) {
    return { valid: false, tools: [] }
  }
  const tools = [...new Set(value as string[])].sort((left, right) =>
    left.localeCompare(right, 'en'),
  )
  return { valid: tools.length === value.length, tools }
}

export const compatibility = new DsharnessCompatibility()
export default compatibility
