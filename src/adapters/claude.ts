import { stringify as stringifyYaml } from 'yaml'

import type { CapabilityId } from '../types.js'
import { stableJson } from '../bundle-files.js'
import {
  AdapterCompatibilityError,
  assemblePrompt,
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

export class ClaudeAdapter implements RoleAdapter {
  readonly id = 'claude' as const
  readonly version = VERSION

  plan(role: LoadedRole, options: ExportOptions): ExportPlan {
    const policy = evaluatePolicy(role, options, this.id)
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

    if (role.manifest.spec.isolation.scope === 'process') {
      mappings.push({
        source: 'spec.isolation.scope',
        fidelity: 'unsupported',
        message: 'Process isolation must be supplied by the outer RoleHub runtime.',
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
      options.scope === 'project'
        ? [
            portableOutputPath('.claude', 'agents', `${agentName(role)}.md`),
            portableOutputPath('.rolehub', 'exports', 'claude-code', 'rolehub.lock.json'),
            'rolehub-export.json',
          ]
        : ['agents.json', 'rolehub-claude.json', 'rolehub.lock.json', 'rolehub-export.json']

    const plan: ExportPlan = {
      target: this.id,
      adapterVersion: this.version,
      targetVersion: '>=2.1.210 <2.2.0',
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
      throw new AdapterCompatibilityError(plan)
    }
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): ExportResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const name = agentName(role)
    const definition = buildDefinition(role, options)
    const lock = buildLock(role, options, name, definition.tools)

    if (options.scope === 'project') {
      const { prompt, ...frontmatter } = definition
      return {
        plan,
        files: [
          {
            path: portableOutputPath('.claude', 'agents', `${name}.md`),
            content: `---\n${stringifyYaml({ name, ...frontmatter }).trim()}\n---\n\n${prompt}`,
          },
          {
            path: portableOutputPath('.rolehub', 'exports', 'claude-code', 'rolehub.lock.json'),
            content: stableJson(lock),
          },
        ],
      }
    }

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
                '--agents',
                '<contents-of-agents.json-as-one-argv-value>',
                '--agent',
                name,
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
    prompt: assemblePrompt(role, 'claude', true),
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
    adapter: { id: 'claude', version: VERSION, targetVersion: '>=2.1.210 <2.2.0' },
    policyDigest: options.policy?.policyDigest,
    resolved: {
      agentName: name,
      tools,
      effectiveCapabilities: grantedCapabilityIds(role, options),
    },
  }
}
