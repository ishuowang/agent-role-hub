import { stringify as stringifyYaml } from 'yaml'

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
  id: 'opencode',
  displayName: 'OpenCode',
  packageName: '@ishuowang/rolehub-compat-opencode',
  version: VERSION,
  target: 'OpenCode',
  targetVersion: '>=1.18.18 <1.19.0',
  implementation: 'Sterile HOME/XDG, sanitized workspace, and official SDK/server session control',
  transport: 'server',
  documentation:
    'https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/opencode.md',
}
const toolBindings: Partial<Record<CapabilityId, string[]>> = {
  'filesystem.read': ['read', 'glob', 'grep', 'list'],
  'filesystem.write': ['edit'],
  'shell.execute': ['bash'],
  'network.fetch': ['webfetch'],
  'web.search': ['websearch'],
  'room.delegate': ['task'],
  'room.message': [],
}

export class OpenCodeCompatibility implements RoleCompatibility {
  readonly descriptor = descriptor

  plan(role: LoadedRole, options: ExportOptions): CompatibilityPlan {
    const policy = evaluatePolicy(role, options, this.descriptor.id)
    const shellSafety = analyzeShellSafety(role, options, policy.granted)
    const effectiveCapabilities = policy.granted.filter(
      (capability) =>
        (capability !== 'shell.execute' || shellSafety.safe) &&
        (capability !== 'source-control.write' || shellSafety.sourceControlWriteEffective),
    )
    const effective = new Set(effectiveCapabilities)
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
    for (const capability of capabilityIds(role, 'required')) {
      const granted = policy.granted.includes(capability)
      const tools =
        !granted || effective.has(capability) ? capabilityTools(capability, shellSafety) : undefined
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
    }
    for (const capability of capabilityIds(role, 'optional')) {
      const granted = policy.granted.includes(capability)
      const enabled = effective.has(capability)
      const tools = enabled ? capabilityTools(capability, shellSafety) : toolBindings[capability]
      mappings.push({
        source: `optional-capability:${capability}`,
        ...(enabled && tools?.length ? { target: tools.join(', ') } : {}),
        fidelity: enabled && tools ? 'exact' : 'degraded',
        message:
          granted && !enabled && capability === 'shell.execute'
            ? 'Withheld because the shared bash command surface cannot preserve the effective write boundaries.'
            : granted && !enabled && capability === 'source-control.write'
              ? 'Withheld because no safe writable bash surface realizes this capability.'
              : enabled
                ? 'Enabled by the matching effective policy receipt.'
                : 'Omitted because the effective policy does not grant this optional capability.',
      })
    }
    mappings.push(...shellSafety.mappings)
    for (const capability of capabilityIds(role, 'denied')) {
      mappings.push(deniedCapabilityMapping(capability, shellSafety))
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
    if (options.policy?.enforcement.process !== 'dedicated') {
      mappings.push({
        source: 'host.enforcement.process',
        fidelity: 'unsupported',
        message: 'OpenCode compatibility requires a clean dedicated process or container.',
      })
    }
    if (options.policy?.enforcement.configuration !== 'isolated') {
      mappings.push({
        source: 'host.enforcement.configuration',
        fidelity: 'unsupported',
        message:
          'OpenCode merges user and project configuration; strict execution requires a sterile HOME/XDG environment and a sanitized workspace with no project configuration.',
      })
    }
    mappings.push(...policyMappings(policy))
    const generatedFiles = [
      portableOutputPath('opencode', 'opencode.json'),
      portableOutputPath('opencode', 'agents', `${exportSlug(role)}.md`),
      'rolehub-opencode-launch.json',
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
        'OPENCODE_CONFIG_DIR is only one config source; the launch recipe also requires sterile HOME/XDG paths and a sanitized workspace.',
        'Configuration isolation is distinct from the operating-system sandbox required for filesystem or shell boundaries.',
        'OpenCode bash shares filesystem and source-control write surfaces; unsafe overlaps make the plan report-only.',
      ],
    }
    assertStrictCompatibility(plan, options)
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): CompatibilityResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const permission = buildPermissions(role, plan.effectiveCapabilities)
    const frontmatter: Record<string, unknown> = {
      description: role.manifest.metadata.description,
      mode: 'all',
      steps: role.manifest.spec.limits.maxTurns,
      permission,
    }
    const files = [
      {
        path: portableOutputPath('opencode', 'agents', `${exportSlug(role)}.md`),
        content: `---\n${stringifyYaml(frontmatter).trim()}\n---\n\n${assemblePrompt(role, this.descriptor.id, true)}`,
      },
      {
        path: portableOutputPath('opencode', 'opencode.json'),
        content: `${JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)}\n`,
      },
      {
        path: 'rolehub-opencode-launch.json',
        content: stableJson({
          schemaVersion: 1,
          executable: 'opencode',
          argvTemplate: ['serve', '--hostname', '127.0.0.1', '--port', '<ephemeral-port>'],
          env: {
            OPENCODE_CONFIG_DIR: '<artifact-root>/opencode',
            OPENCODE_SERVER_PASSWORD: '<secret-ref:ROLEHUB_OPENCODE_PASSWORD>',
            HOME: '<sterile-home>',
            XDG_CONFIG_HOME: '<sterile-home>/.config',
            XDG_DATA_HOME: '<sterile-home>/.local/share',
            XDG_STATE_HOME: '<sterile-home>/.local/state',
            XDG_CACHE_HOME: '<sterile-home>/.cache',
          },
          cwd: '<sanitized-workspace>',
          configurationIsolation: {
            hostAttestation: 'enforcement.configuration=isolated',
            sanitizedWorkspace: true,
            forbiddenProjectEntries: ['opencode.json', 'opencode.jsonc', '.opencode/'],
            inheritUserEnvironment: false,
          },
          filesystemIsolation: {
            hostAttestation: `enforcement.filesystem=${options.policy?.enforcement.filesystem ?? 'none'}`,
            effectiveMode:
              options.policy?.enforcement.filesystem === 'os-sandbox'
                ? plan.effectiveCapabilities.includes('filesystem.write') &&
                  role.manifest.spec.isolation.filesystem === 'workspace-write'
                  ? 'workspace-write'
                  : 'read-only'
                : (options.policy?.enforcement.filesystem ?? 'none'),
          },
          sdk: '@opencode-ai/sdk',
          agent: exportSlug(role),
        }),
      },
    ]
    return { plan, files }
  }
}

function exportSlug(role: LoadedRole): string {
  const publisher = role.manifest.metadata.publisher.split('.').at(-1) ?? 'community'
  return `rh-${publisher}-${roleSlug(role)}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}

function buildPermissions(
  role: LoadedRole,
  effectiveCapabilities: readonly CapabilityId[],
): Record<string, unknown> {
  const permission: Record<string, unknown> = { '*': 'deny' }
  const requested = new Set(effectiveCapabilities)
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
  if (
    requested.has('shell.execute') &&
    ['shell.execute', 'filesystem.write', 'source-control.write'].some((capability) => {
      if (!requested.has(capability as CapabilityId)) return false
      return findCapabilityRequest(role, capability as CapabilityId)?.approval === 'ask'
    })
  ) {
    permission['bash'] = 'ask'
  }
  for (const capability of capabilityIds(role, 'denied')) {
    for (const tool of denyTools(capability)) permission[tool] = 'deny'
  }
  permission['skill'] = 'deny'
  permission['external_directory'] = 'deny'
  return permission
}

interface ShellSafety {
  safe: boolean
  shellGranted: boolean
  osSandbox: boolean
  workspaceWritable: boolean
  sourceControlWriteGranted: boolean
  sourceControlWriteEffective: boolean
  mappings: Mapping[]
}

function analyzeShellSafety(
  role: LoadedRole,
  options: ExportOptions,
  grantedCapabilities: readonly CapabilityId[],
): ShellSafety {
  const granted = new Set(grantedCapabilities)
  const shellGranted = granted.has('shell.execute')
  const osSandbox = options.policy?.enforcement.filesystem === 'os-sandbox'
  const workspaceWritable =
    granted.has('filesystem.write') && role.manifest.spec.isolation.filesystem === 'workspace-write'
  const sourceControlWriteGranted = granted.has('source-control.write')
  const mappings: Mapping[] = []
  let safe = true

  if (shellGranted) {
    if (osSandbox && !workspaceWritable) {
      mappings.push({
        source: 'overlap:shell.execute->filesystem.write',
        target: 'host-attested OS sandbox in read-only mode',
        fidelity: 'exact',
        message:
          'The native bash surface cannot write because the effective workspace boundary is read-only.',
      })
      if (!sourceControlWriteGranted) {
        mappings.push({
          source: 'overlap:shell.execute->source-control.write',
          target: 'host-attested OS sandbox in read-only mode',
          fidelity: 'exact',
          message: 'The same read-only boundary prevents bash from mutating repository state.',
        })
      }
    } else if (!osSandbox) {
      safe = false
      mappings.push({
        source: 'overlap:shell.execute->filesystem.write',
        fidelity: 'unsupported',
        message: workspaceWritable
          ? 'OpenCode bash requires an attested OS sandbox to confine writes to the effective writable workspace.'
          : 'OpenCode bash can write independently of the edit permission; only an attested OS sandbox in read-only mode can enforce an ungranted or denied filesystem.write boundary.',
      })
    }

    if (workspaceWritable && !sourceControlWriteGranted) {
      safe = false
      const request = findCapabilityRequest(role, 'source-control.write')
      const boundary = capabilityIds(role, 'denied').includes('source-control.write')
        ? 'explicitly denied'
        : request?.approval === 'ask'
          ? 'approval-gated but not granted'
          : 'not granted'
      mappings.push({
        source: 'overlap:shell.execute->source-control.write',
        target: 'bash in a writable workspace',
        fidelity: 'unsupported',
        message: `source-control.write is ${boundary}; OpenCode tool permissions cannot stop bash from mutating repository state in a writable workspace.`,
      })
    } else if (workspaceWritable && sourceControlWriteGranted && osSandbox) {
      mappings.push({
        source: 'overlap:shell.execute->source-control.write',
        target: 'bash under effective filesystem.write and source-control.write grants',
        fidelity: 'exact',
        message:
          'The shared write surface is authorized; any approval-gated grant is enforced on bash.',
      })
    }

    if (!workspaceWritable && sourceControlWriteGranted) {
      safe = false
      mappings.push({
        source: 'overlap:source-control.write->filesystem.write',
        target: 'host-attested read-only workspace',
        fidelity: 'unsupported',
        message:
          'source-control.write cannot be realized through bash while filesystem.write is not effective and the OS sandbox is read-only.',
      })
    }
  }

  return {
    safe,
    shellGranted,
    osSandbox,
    workspaceWritable,
    sourceControlWriteGranted,
    sourceControlWriteEffective:
      shellGranted && safe && workspaceWritable && sourceControlWriteGranted,
    mappings,
  }
}

function capabilityTools(capability: CapabilityId, shellSafety: ShellSafety): string[] | undefined {
  if (capability === 'source-control.write' && shellSafety.sourceControlWriteEffective) {
    return ['bash']
  }
  return toolBindings[capability]
}

function deniedCapabilityMapping(capability: CapabilityId, shellSafety: ShellSafety): Mapping {
  if (shellSafety.shellGranted && capability === 'filesystem.write') {
    return shellSafety.osSandbox && !shellSafety.workspaceWritable
      ? {
          source: `deny:${capability}`,
          target: 'edit denied plus host-attested OS sandbox read-only boundary',
          fidelity: 'exact',
        }
      : {
          source: `deny:${capability}`,
          target: 'bash shared command surface',
          fidelity: 'unsupported',
          message: 'Denying the edit tool does not prevent bash from writing files.',
        }
  }
  if (shellSafety.shellGranted && capability === 'source-control.write') {
    return shellSafety.osSandbox && !shellSafety.workspaceWritable
      ? {
          source: `deny:${capability}`,
          target: 'host-attested OS sandbox read-only boundary',
          fidelity: 'exact',
        }
      : {
          source: `deny:${capability}`,
          target: 'bash shared command surface',
          fidelity: 'unsupported',
          message: 'A writable bash process can mutate repository state.',
        }
  }
  return {
    source: `deny:${capability}`,
    target: denyTools(capability).join(', ') || 'deny-by-default tool policy',
    fidelity: 'exact',
  }
}

function findCapabilityRequest(role: LoadedRole, capability: CapabilityId) {
  return [
    ...role.manifest.spec.capabilities.required,
    ...role.manifest.spec.capabilities.optional,
    ...role.manifest.spec.capabilities.denied,
  ].find((candidate) => candidate.id === capability)
}

function denyTools(capability: CapabilityId): string[] {
  return toolBindings[capability] ?? []
}

export const compatibility = new OpenCodeCompatibility()
export default compatibility
