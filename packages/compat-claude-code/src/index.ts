import { stableJson, type CapabilityId, type LoadedRole } from '@ishuowang/rolehub-core'
import {
  CompatibilityError,
  assemblePrompt,
  capabilityIds,
  evaluatePolicy,
  grantedCapabilityIds,
  policyMappings,
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
  id: 'claude-code',
  displayName: 'Claude Code',
  packageName: '@ishuowang/rolehub-compat-claude-code',
  version: VERSION,
  target: 'Claude Code CLI',
  targetVersion: '>=2.1.210 <2.2.0',
  implementation: 'Session-scoped --agents JSON with a dedicated launcher process',
  transport: 'cli',
  documentation:
    'https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/claude-code.md',
}
const toolBindings: Partial<Record<CapabilityId, string[]>> = {
  'filesystem.read': ['Read', 'Grep', 'Glob'],
  'filesystem.write': ['Write', 'Edit'],
  'shell.execute': ['Bash'],
  'network.fetch': ['WebFetch'],
  'web.search': ['WebSearch'],
  'source-control.read': ['Read', 'Grep', 'Glob'],
  'source-control.write': ['Bash'],
  'room.message': [],
}

const sideEffectCapabilities = new Set<CapabilityId>([
  'external.publish',
  'issues.write',
  'legal.commit',
  'money.spend',
  'secrets.use',
])

const bashSemanticOverlap = new Set<CapabilityId>([
  'filesystem.write',
  'source-control.read',
  'source-control.write',
])

export class ClaudeCodeCompatibility implements RoleCompatibility {
  readonly descriptor = descriptor

  plan(role: LoadedRole, options: ExportOptions): CompatibilityPlan {
    const policy = evaluatePolicy(role, options, this.descriptor.id)
    const mappings: Mapping[] = [
      {
        source: 'spec.prompt',
        target: options.scope === 'session' ? '--agents[].prompt' : '.claude/agents/*.md body',
        fidelity: 'exact',
      },
      {
        source: 'spec.skills',
        target: 'compiled prompt sections',
        fidelity: role.skills.length ? 'degraded' : 'exact',
        ...(role.skills.length
          ? {
              message:
                'Instruction bodies are preserved, but native progressive disclosure is intentionally disabled.',
            }
          : {}),
      },
      { source: 'spec.limits.maxTurns', target: 'maxTurns', fidelity: 'exact' },
    ]

    if (options.scope === 'project') {
      mappings.push({
        source: 'export.scope',
        fidelity: 'unsupported',
        message:
          'Project-scope files do not provide an enforceable launch boundary: project/local settings, hooks, plugins, MCP servers, skills, and instructions may still be discovered. Use the session-scoped --bare launcher.',
      })
    }
    const requiredGrants: string[] = []
    for (const capability of capabilityIds(role, 'required')) {
      const tools = toolBindings[capability]
      mappings.push(
        tools
          ? {
              source: `capability:${capability}`,
              target: tools.length ? tools.join(', ') : 'assistant response channel',
              fidelity: capability.startsWith('source-control.') ? 'degraded' : 'exact',
              ...(capability.startsWith('source-control.')
                ? {
                    message:
                      'Claude tool ids do not express repository operation or argument constraints.',
                  }
                : {}),
            }
          : {
              source: `capability:${capability}`,
              fidelity: 'unsupported',
              message:
                'No reviewed built-in Claude tool binding exists for this required capability.',
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
      const tools = toolBindings[capability]
      mappings.push({
        source: `deny:${capability}`,
        target: tools?.length ? `disallowedTools: ${tools.join(', ')}` : 'no provider is bound',
        fidelity:
          tools?.length || sideEffectCapabilities.has(capability) || options.policy
            ? 'exact'
            : 'advisory',
      })
    }
    mappings.push(...toolOverlapMappings(role, policy.granted))

    if (options.policy?.enforcement.process !== 'dedicated') {
      mappings.push({
        source: 'host.enforcement.process',
        fidelity: 'unsupported',
        message: 'Claude Code roles require a dedicated launcher process for policy isolation.',
      })
    }
    if (role.manifest.spec.isolation.network === 'approval-required') {
      mappings.push({
        source: 'spec.isolation.network',
        target: 'session policy owned by launcher',
        fidelity: 'degraded',
        message: 'Claude agent definitions do not own a per-role network approval policy.',
      })
    }
    if (role.manifest.spec.model?.class) {
      mappings.push({
        source: 'spec.model.class',
        target: 'host-resolved Claude model',
        fidelity: 'degraded',
      })
    }
    mappings.push(...policyMappings(policy))

    const generatedFiles =
      options.scope === 'project' ? [] : ['agents.json', 'rolehub-claude.json', 'rolehub.lock.json']

    const plan: CompatibilityPlan = {
      compatibilityId: this.descriptor.id,
      compatibilityVersion: this.descriptor.version,
      targetVersion: this.descriptor.targetVersion,
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
        'The launcher must pass agents.json as one argv value; never interpolate it into a shell command.',
        'Tool allowlists do not replace a dedicated process and host-owned filesystem/network policy.',
        'Project scope is report-only; runnable exports use --bare so project settings, hooks, plugins, MCP servers, skills, and instructions are not auto-discovered.',
      ],
    }

    const requiredSkillDegraded = role.manifest.spec.skills.some((skill) => skill.required)
    const requiredFieldDegraded = mappings.some(
      (mapping) => mapping.source.startsWith('capability:') && mapping.fidelity === 'degraded',
    )
    if (
      options.mode === 'strict' &&
      (!plan.runnable || requiredSkillDegraded || requiredFieldDegraded)
    ) {
      throw new CompatibilityError(plan)
    }
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): CompatibilityResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const name = agentName(role)
    const definition = buildDefinition(role, options)
    const lock = buildLock(role, options, name, definition.tools)

    return {
      plan,
      files: [
        { path: 'agents.json', content: stableJson({ [name]: definition }) },
        {
          path: 'rolehub-claude.json',
          content: stableJson({
            schemaVersion: 1,
            selectedAgent: name,
            agentsFile: './agents.json',
            launch: {
              executable: 'claude',
              argvTemplate: [
                '--bare',
                '--disable-slash-commands',
                '--strict-mcp-config',
                '--no-chrome',
                '--agents',
                '<contents-of-agents.json-as-one-argv-value>',
                '--agent',
                name,
                '--tools',
                definition.tools.join(','),
              ],
            },
          }),
        },
        { path: 'rolehub.lock.json', content: stableJson(lock) },
      ],
    }
  }
}

interface ClaudeDefinition {
  description: string
  prompt: string
  tools: string[]
  disallowedTools: string[]
  permissionMode: 'default'
  maxTurns: number
  background: false
  effort?: 'low' | 'medium' | 'high'
}

function buildDefinition(role: LoadedRole, options: ExportOptions): ClaudeDefinition {
  const requested = new Set(grantedCapabilityIds(role, options))
  const denied = new Set(capabilityIds(role, 'denied'))
  const disallowedTools = new Set<string>(['Skill'])
  for (const capability of denied) {
    for (const tool of toolBindings[capability] ?? []) disallowedTools.add(tool)
  }
  const tools = new Set<string>()
  for (const capability of requested) {
    for (const tool of toolBindings[capability] ?? []) {
      if (!disallowedTools.has(tool)) tools.add(tool)
    }
  }
  const definition: ClaudeDefinition = {
    description: role.manifest.metadata.description,
    prompt: assemblePrompt(role, descriptor.id, true),
    tools: [...tools].sort(),
    disallowedTools: [...disallowedTools].sort(),
    permissionMode: 'default',
    maxTurns: role.manifest.spec.limits.maxTurns,
    background: false,
  }
  const reasoning = role.manifest.spec.model?.reasoning
  if (reasoning) definition.effort = reasoning === 'xhigh' ? 'high' : reasoning
  return definition
}

function toolOverlapMappings(role: LoadedRole, granted: readonly CapabilityId[]): Mapping[] {
  const grantedSet = new Set(granted)
  const exposedTools = new Set<string>()
  for (const capability of granted) {
    for (const tool of toolBindings[capability] ?? []) exposedTools.add(tool)
  }

  const unavailable = [
    ...capabilityIds(role, 'optional').filter((capability) => !grantedSet.has(capability)),
    ...capabilityIds(role, 'denied'),
  ]
  return unavailable.flatMap((capability): Mapping[] => {
    const sharedTools = (toolBindings[capability] ?? []).filter((tool) => exposedTools.has(tool))
    const bashBypass = exposedTools.has('Bash') && bashSemanticOverlap.has(capability)
    if (!sharedTools.length && !bashBypass) return []
    const overlap = [...new Set([...sharedTools, ...(bashBypass ? ['Bash'] : [])])].sort()
    return [
      {
        source: `tool-overlap:${capability}`,
        fidelity: 'unsupported',
        message: `Granted Claude tool surface ${overlap.join(', ')} also exposes the ungranted or denied ${capability} capability; no per-command host broker is attested.`,
      },
    ]
  })
}

function agentName(role: LoadedRole): string {
  const publisher = role.manifest.metadata.publisher.split('.').at(-1) ?? 'community'
  return `rolehub-${publisher}-${roleSlug(role)}-${role.bundleDigest.slice(0, 8)}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
}

function buildLock(
  role: LoadedRole,
  options: ExportOptions,
  name: string,
  tools: string[],
): Record<string, unknown> {
  return {
    lockVersion: 1,
    role: {
      id: role.manifest.metadata.id,
      version: role.manifest.metadata.version,
      manifestDigest: role.manifestDigest,
      bundleDigest: role.bundleDigest,
    },
    compatibility: {
      id: descriptor.id,
      version: descriptor.version,
      targetVersion: descriptor.targetVersion,
    },
    policyDigest: options.policy?.policyDigest,
    resolved: {
      agentName: name,
      tools,
      effectiveCapabilities: grantedCapabilityIds(role, options),
    },
  }
}

export const compatibility = new ClaudeCodeCompatibility()
export default compatibility
