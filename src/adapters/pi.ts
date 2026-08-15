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
const nativeTools: Partial<Record<CapabilityId, string[]>> = {
  'filesystem.read': ['read', 'grep', 'find', 'ls'],
  'filesystem.write': ['edit', 'write'],
  'shell.execute': ['bash'],
  'room.message': [],
}

export class PiAdapter implements RoleAdapter {
  readonly id = 'pi' as const
  readonly version = VERSION

  plan(role: LoadedRole, options: ExportOptions): ExportPlan {
    const policy = evaluatePolicy(role, options, this.id)
    const nativeSkills = useNativeSkills(role, options)
    const mappings: Mapping[] = [
      { source: 'spec.prompt', target: '--append-system-prompt', fidelity: 'exact' },
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
    const requiredGrants: string[] = []
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
              message: 'Pi needs an explicit trusted host binding for this capability.',
            },
      )
      if (tools) requiredGrants.push(capability)
    }
    for (const capability of capabilityIds(role, 'optional')) {
      const tools = nativeTools[capability]
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
    if (
      role.manifest.spec.capabilities.optional.some((capability) => capability.approval === 'ask')
    ) {
      mappings.push({
        source: 'spec.capabilities.optional[].approval',
        target: 'disabled pending trusted guard',
        fidelity: 'exact',
        message:
          'Pi core has no interactive approval mechanism, so approved-optional tools remain disabled.',
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
          'The safe Pi adapter appends role instructions and does not replace Pi tool guidance.',
      })
    }
    if (role.manifest.spec.model) {
      mappings.push({ source: 'spec.model', target: 'host model resolver', fidelity: 'degraded' })
    }
    mappings.push(...policyMappings(policy))
    const generatedFiles = [
      'prompt.md',
      'rolehub-pi.json',
      ...(nativeSkills
        ? role.skills.map((skill) => portableOutputPath('skills', skill.name, 'SKILL.md'))
        : []),
      'rolehub-export.json',
    ]
    const plan: ExportPlan = {
      target: this.id,
      adapterVersion: this.version,
      targetVersion: '>=0.84.2 <0.85.0',
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
        'PI_CODING_AGENT_DIR and explicit resources prevent configuration pollution; they are not an OS sandbox.',
      ],
    }
    assertStrictCompatibility(plan, options)
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): ExportResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const nativeSkills = useNativeSkills(role, options)
    const tools = resolveTools(role, options)
    const prompt = assemblePrompt(role, this.id, !nativeSkills)
    const skillArguments = nativeSkills
      ? role.skills.flatMap((skill) => ['--skill', `<verified-export-root>/skills/${skill.name}`])
      : []
    const contextArguments =
      role.manifest.spec.isolation.context === 'workspace' ? [] : ['--no-context-files']
    const metadata = {
      schemaVersion: 1,
      member: roleSlug(role),
      role: {
        id: role.manifest.metadata.id,
        version: role.manifest.metadata.version,
        manifestDigest: role.manifestDigest,
        bundleDigest: role.bundleDigest,
      },
      prompt: './prompt.md',
      skills: nativeSkills ? role.skills.map((skill) => `./skills/${skill.name}`) : [],
      compiledSkills: nativeSkills ? [] : role.skills.map((skill) => skill.name),
      tools,
      limits: role.manifest.spec.limits,
      contextPolicy: role.manifest.spec.isolation.context,
      policyDigest: options.policy?.policyDigest,
      environment: { PI_CODING_AGENT_DIR: '<runtime-owned-directory>' },
      argvTemplate: [
        '--mode',
        'rpc',
        '--no-session',
        '--no-approve',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        ...contextArguments,
        ...skillArguments,
        '--tools',
        tools.join(','),
        '--append-system-prompt',
        '<contents-of-prompt.md-as-one-argv-value>',
      ],
    }
    return {
      plan,
      files: [
        { path: 'prompt.md', content: prompt },
        { path: 'rolehub-pi.json', content: `${JSON.stringify(metadata, null, 2)}\n` },
        ...(nativeSkills
          ? role.skills.map((skill) => ({
              path: portableOutputPath('skills', skill.name, 'SKILL.md'),
              content: skill.content,
            }))
          : []),
      ],
    }
  }
}

function resolveTools(role: LoadedRole, options: ExportOptions): string[] {
  const capabilities = grantedCapabilityIds(role, options)
  const tools = new Set<string>()
  for (const capability of capabilities) {
    for (const tool of nativeTools[capability] ?? []) tools.add(tool)
  }
  return [...tools].sort()
}

function useNativeSkills(role: LoadedRole, options: ExportOptions): boolean {
  return (
    role.skills.length > 0 &&
    grantedCapabilityIds(role, options).includes('filesystem.read') &&
    options.policy?.enforcement.filesystem === 'os-sandbox'
  )
}
