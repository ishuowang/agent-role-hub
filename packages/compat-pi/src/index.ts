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
  id: 'pi',
  displayName: 'Pi',
  packageName: '@ishuowang/rolehub-compat-pi',
  version: VERSION,
  target: '@earendil-works/pi-coding-agent',
  targetVersion: '>=0.84.2 <0.85.0',
  implementation: 'SDK ResourceLoader and AgentSession integration recipe with a tool allowlist',
  transport: 'sdk',
  documentation: 'https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/pi.md',
}
const nativeTools: Partial<Record<CapabilityId, string[]>> = {
  'filesystem.read': ['read', 'grep', 'find', 'ls'],
  'filesystem.write': ['edit', 'write'],
  'room.message': [],
}

export class PiCompatibility implements RoleCompatibility {
  readonly descriptor = descriptor

  plan(role: LoadedRole, options: ExportOptions): CompatibilityPlan {
    const policy = evaluatePolicy(role, options, this.descriptor.id)
    const effectiveCapabilities = resolveEffectiveCapabilities(role, policy.granted, options)
    const nativeSkills = useNativeSkills(role, options, effectiveCapabilities)
    const mappings: Mapping[] = [
      {
        source: 'spec.prompt',
        target: 'ResourceLoader appendSystemPromptFile',
        fidelity: 'exact',
      },
      {
        source: 'spec.skills',
        target: nativeSkills ? '--skill <verified-path>' : 'compiled prompt sections',
        fidelity:
          role.manifest.spec.skills.some((skill) => skill.required) && !nativeSkills
            ? 'unsupported'
            : nativeSkills || !role.skills.length
              ? 'exact'
              : 'degraded',
        message: nativeSkills
          ? 'Native skill loading is confined by the attested OS sandbox.'
          : 'Pi read would broaden filesystem access, so native skill loading is disabled.',
      },
      {
        source: 'spec.isolation',
        target: 'dedicated Pi process plus effective policy receipt',
        fidelity: options.policy ? 'exact' : 'unsupported',
      },
      { source: 'spec.limits', target: 'RoleHub runner limits', fidelity: 'exact' },
    ]
    for (const capability of capabilityIds(role, 'required')) {
      const tools = nativeTools[capability]
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
              message:
                capability === 'shell.execute'
                  ? 'The raw Pi bash tool is withheld because no argument-level execution broker is available.'
                  : 'Pi needs an explicit trusted host binding for this capability.',
            },
      )
    }
    for (const request of role.manifest.spec.capabilities.optional) {
      const capability = request.id
      const tools = nativeTools[capability]
      const granted = policy.granted.includes(capability)
      const approvalBlocked =
        granted && request.approval === 'ask' && !hasVerifiedApprovalBroker(options)
      const enabled = effectiveCapabilities.includes(capability)
      mappings.push({
        source: `optional-capability:${capability}`,
        ...(enabled && tools?.length ? { target: tools.join(', ') } : {}),
        fidelity: enabled && tools ? 'exact' : 'degraded',
        message: approvalBlocked
          ? 'Withheld because approval: ask requires a verified host interactive approval broker.'
          : !granted
            ? 'Omitted because the effective policy does not grant this optional capability.'
            : enabled && tools
              ? 'Enabled by the matching receipt and any required verified approval broker.'
              : capability === 'shell.execute' && granted
                ? 'Withheld because Pi bash cannot enforce RoleHub capability boundaries at command-argument granularity.'
                : 'Pi has no native tool mapping for this optional capability.',
      })
    }
    if (policy.granted.includes('shell.execute')) {
      mappings.push({
        source: 'host.enforcement.shell-arguments',
        target: 'Pi bash tool withheld',
        fidelity: 'unsupported',
        message:
          'Pi has no verified argument-level execution broker; bash would overlap ungranted or denied filesystem, source-control, and network capabilities.',
      })
    }
    if (
      role.manifest.spec.capabilities.optional.some((capability) => capability.approval === 'ask')
    ) {
      mappings.push({
        source: 'spec.capabilities.optional[].approval',
        target: hasVerifiedApprovalBroker(options)
          ? 'host-attested interactive approval broker'
          : 'approval-gated optional tools withheld',
        fidelity: hasVerifiedApprovalBroker(options) ? 'exact' : 'degraded',
        message: hasVerifiedApprovalBroker(options)
          ? 'The trusted policy receipt attests an interactive approval broker outside Pi core.'
          : 'Pi core has no interactive approval mechanism; a policy grant alone cannot enable approval-gated tools.',
      })
    }
    for (const capability of capabilityIds(role, 'denied')) {
      mappings.push({
        source: `deny:${capability}`,
        target: 'strict tool allowlist, disabled extensions, and host enforcement',
        fidelity: 'exact',
      })
    }
    if (role.manifest.spec.prompt.mode === 'replace') {
      mappings.push({
        source: 'spec.prompt.mode',
        fidelity: 'unsupported',
        message:
          'The safe Pi compatibility layer appends role instructions and does not replace Pi tool guidance.',
      })
    }
    if (role.manifest.spec.model) {
      mappings.push({ source: 'spec.model', target: 'host model resolver', fidelity: 'degraded' })
    }
    if (options.policy?.enforcement.process !== 'dedicated') {
      mappings.push({
        source: 'host.enforcement.process',
        fidelity: 'unsupported',
        message: 'Pi roles require one dedicated process or container per room member.',
      })
    }
    if (
      policy.granted.some((capability) =>
        ['filesystem.read', 'filesystem.write', 'shell.execute'].includes(capability),
      ) &&
      options.policy?.enforcement.filesystem !== 'os-sandbox'
    ) {
      mappings.push({
        source: 'host.enforcement.filesystem',
        fidelity: 'unsupported',
        message: 'Pi has no native sandbox; filesystem tools require an OS sandbox receipt.',
      })
    }
    mappings.push(...policyMappings(policy))
    const generatedFiles = [
      portableOutputPath('pi', 'prompt.md'),
      'rolehub-pi-runtime.json',
      ...(nativeSkills
        ? role.skills.map((skill) => portableOutputPath('pi', 'skills', skill.name, 'SKILL.md'))
        : []),
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
        'PI_CODING_AGENT_DIR and explicit resources prevent configuration pollution; they are not an OS sandbox.',
        'Ambient context files are always disabled; workspace access is available only through effective tools.',
        'Optional approval-gated tools require an interactive approval broker attested by the trusted policy receipt.',
        'The raw Pi bash tool is never emitted because the current policy protocol cannot attest argument-level command enforcement.',
      ],
    }
    assertStrictCompatibility(plan, options)
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): CompatibilityResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const nativeSkills = useNativeSkills(role, options, plan.effectiveCapabilities)
    const tools = resolveTools(plan.effectiveCapabilities)
    const prompt = assemblePrompt(role, this.descriptor.id, !nativeSkills)
    const metadata = {
      schemaVersion: 1,
      member: roleSlug(role),
      role: {
        id: role.manifest.metadata.id,
        version: role.manifest.metadata.version,
        manifestDigest: role.manifestDigest,
        bundleDigest: role.bundleDigest,
      },
      implementation: '@earendil-works/pi-coding-agent SDK',
      prompt: './pi/prompt.md',
      skills: nativeSkills ? role.skills.map((skill) => `./pi/skills/${skill.name}`) : [],
      compiledSkills: nativeSkills ? [] : role.skills.map((skill) => skill.name),
      tools,
      limits: role.manifest.spec.limits,
      contextPolicy: role.manifest.spec.isolation.context,
      policyDigest: options.policy?.policyDigest,
      resourceLoader: {
        noExtensions: true,
        noSkills: true,
        additionalSkillPaths: nativeSkills
          ? role.skills.map((skill) => `<artifact-root>/pi/skills/${skill.name}`)
          : [],
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        appendSystemPromptFile: '<artifact-root>/pi/prompt.md',
      },
      session: { persistence: 'memory', tools },
      roomMethods: {
        send: 'session.prompt',
        steer: 'session.steer',
        followUp: 'session.followUp',
        abort: 'session.abort',
      },
    }
    return {
      plan,
      files: [
        { path: portableOutputPath('pi', 'prompt.md'), content: prompt },
        { path: 'rolehub-pi-runtime.json', content: stableJson(metadata) },
        ...(nativeSkills
          ? role.skills.map((skill) => ({
              path: portableOutputPath('pi', 'skills', skill.name, 'SKILL.md'),
              content: skill.content,
            }))
          : []),
      ],
    }
  }
}

function resolveTools(capabilities: readonly CapabilityId[]): string[] {
  const tools = new Set<string>()
  for (const capability of capabilities) {
    for (const tool of nativeTools[capability] ?? []) tools.add(tool)
  }
  return [...tools].sort()
}

function useNativeSkills(
  role: LoadedRole,
  options: ExportOptions,
  effectiveCapabilities: readonly CapabilityId[],
): boolean {
  return (
    role.skills.length > 0 &&
    effectiveCapabilities.includes('filesystem.read') &&
    options.policy?.enforcement.filesystem === 'os-sandbox'
  )
}

function resolveEffectiveCapabilities(
  role: LoadedRole,
  granted: readonly CapabilityId[],
  options: ExportOptions,
): CapabilityId[] {
  const approvalGated = new Set(
    role.manifest.spec.capabilities.optional
      .filter((capability) => capability.approval === 'ask')
      .map((capability) => capability.id),
  )
  const approvalBroker = hasVerifiedApprovalBroker(options)
  return granted.filter(
    (capability) =>
      capability !== 'shell.execute' && (approvalBroker || !approvalGated.has(capability)),
  )
}

function hasVerifiedApprovalBroker(options: ExportOptions): boolean {
  return options.policy?.enforcement.approvals === 'interactive-broker'
}

export const compatibility = new PiCompatibility()
export default compatibility
