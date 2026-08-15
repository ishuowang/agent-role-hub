import { stableJson, type CapabilityId, type LoadedRole } from '@ishuowang/rolehub-core'
import {
  assemblePrompt,
  assertStrictCompatibility,
  capabilityIds,
  evaluatePolicy,
  policyMappings,
  portableOutputPath,
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
  id: 'codex',
  displayName: 'Codex',
  packageName: '@ishuowang/rolehub-compat-codex',
  version: VERSION,
  target: 'Codex CLI',
  targetVersion: '>=0.145.0 <0.146.0',
  implementation:
    'Dedicated codex exec process with role instructions injected by an explicit CLI config override',
  transport: 'cli',
  documentation:
    'https://github.com/ishuowang/agent-role-hub/blob/v0.2.0/docs/compatibility/codex.md',
}

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

export class CodexCompatibility implements RoleCompatibility {
  readonly descriptor = descriptor

  plan(role: LoadedRole, options: ExportOptions): CompatibilityPlan {
    const policy = evaluatePolicy(role, options, this.descriptor.id)
    const sandboxMode = resolveSandboxMode(role, options)
    const shellEnabled = policy.granted.includes('shell.execute')
    const mappings: Mapping[] = [
      {
        source: 'spec.prompt',
        target: 'codex exec --config developer_instructions=<verified-role-prompt>',
        fidelity: 'exact',
      },
      {
        source: 'spec.skills',
        target: 'compiled developer_instructions CLI override',
        fidelity: 'degraded',
      },
      {
        source: 'native-tool:shell',
        target: shellEnabled ? 'features.shell_tool=true' : '--disable shell_tool',
        fidelity: 'exact',
        message: shellEnabled
          ? 'The matching effective policy explicitly grants shell.execute.'
          : 'The stable Codex shell tool feature is disabled for this launch.',
      },
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
        ...(capability === 'shell.execute' && !enabled
          ? { target: '--disable shell_tool' }
          : enabled && mapping?.target
            ? { target: mapping.target }
            : {}),
        fidelity:
          capability === 'shell.execute' && !enabled
            ? 'exact'
            : enabled && mapping
              ? mapping.fidelity
              : 'degraded',
        message: enabled
          ? 'Enabled by the matching effective policy receipt.'
          : capability === 'shell.execute'
            ? 'Omitted and enforced by disabling the stable shell_tool feature.'
            : 'Omitted because the effective policy does not grant this optional capability.',
      })
      if (
        !enabled &&
        capability === 'source-control.write' &&
        shellEnabled &&
        sandboxMode === 'workspace-write'
      ) {
        mappings.push({
          source: `native-surface:${capability}`,
          fidelity: 'unsupported',
          message:
            'The granted shell in a writable workspace can perform source-control writes, so this optional capability cannot be withheld precisely without a host command broker.',
        })
      }
    }
    for (const capability of capabilityIds(role, 'denied')) {
      const commandDenial = deniedCommandMapping(capability, shellEnabled, sandboxMode)
      mappings.push({
        source: `deny:${capability}`,
        ...(commandDenial?.target
          ? { target: commandDenial.target }
          : { target: 'no provider in the sterile dedicated launch' }),
        fidelity: commandDenial?.fidelity ?? (options.policy ? 'exact' : 'advisory'),
        message: commandDenial
          ? commandDenial.message
          : options.policy
            ? 'The effective policy excludes this capability and the sterile launch binds no provider; prompt text is defense in depth only.'
            : 'A prompt alone is not a security boundary.',
      })
    }
    if (
      policy.granted.includes('source-control.write') &&
      (!shellEnabled || sandboxMode !== 'workspace-write')
    ) {
      mappings.push({
        source: 'native-surface:source-control.write',
        fidelity: 'unsupported',
        message:
          'Codex source-control writes require both an effective shell grant and a writable sandbox.',
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
    if (options.policy?.enforcement.process !== 'dedicated') {
      mappings.push({
        source: 'host.enforcement.process',
        fidelity: 'unsupported',
        message: 'Codex roles require a dedicated process for a per-role policy boundary.',
      })
    }
    if (options.policy?.enforcement.configuration !== 'isolated') {
      mappings.push({
        source: 'host.enforcement.configuration',
        fidelity: 'unsupported',
        message:
          'Codex project configuration, instructions, MCP servers, and skills are independent injection surfaces; strict execution requires a sanitized workspace.',
      })
    }
    mappings.push(...policyMappings(policy))

    const plan: CompatibilityPlan = {
      compatibilityId: this.descriptor.id,
      compatibilityVersion: this.descriptor.version,
      targetVersion: this.descriptor.targetVersion,
      mappings,
      requiredGrants: policy.missingRequired,
      effectiveCapabilities: policy.granted,
      ...(options.policy ? { policyDigest: options.policy.policyDigest } : {}),
      generatedFiles: [
        portableOutputPath('.rolehub', 'role-prompt.md'),
        portableOutputPath('.rolehub', 'codex-launch.json'),
      ],
      runnable: !mappings.some(
        (mapping) =>
          mapping.fidelity === 'unsupported' && !mapping.source.startsWith('optional-capability:'),
      ),
      warnings: [
        'Custom-agent TOML is intentionally not emitted: Codex custom agents configure spawned sessions, not the primary codex exec session.',
        'The host must TOML-encode role-prompt.md and pass the complete developer_instructions override as one argv value.',
        'The caller must apply the reported policy to a dedicated Codex session for hard isolation.',
        'The launch recipe requires sterile HOME/CODEX_HOME paths and a sanitized workspace in addition to ignored user configuration.',
      ],
    }
    assertStrictCompatibility(plan, options)
    return plan
  }

  render(role: LoadedRole, options: ExportOptions): CompatibilityResult {
    const plan = this.plan(role, options)
    if (!plan.runnable) return { plan, files: [] }
    const shellEnabled = plan.effectiveCapabilities.includes('shell.execute')
    const sandboxMode = resolveSandboxMode(role, options)
    const prompt = assemblePrompt(role, this.descriptor.id, true)
    return {
      plan,
      files: [
        {
          path: portableOutputPath('.rolehub', 'role-prompt.md'),
          content: prompt,
        },
        {
          path: portableOutputPath('.rolehub', 'codex-launch.json'),
          content: stableJson({
            schemaVersion: 2,
            executable: 'codex',
            argvTemplate: [
              ...(shellEnabled ? [] : ['--disable', 'shell_tool']),
              '--ask-for-approval',
              'never',
              '--config',
              'developer_instructions=<TOML-string-from:.rolehub/role-prompt.md>',
              '--config',
              'project_doc_max_bytes=0',
              'exec',
              '--ephemeral',
              '--ignore-user-config',
              '--ignore-rules',
              '--strict-config',
              '--sandbox',
              sandboxMode,
              '--disable',
              'apps',
              '--disable',
              'hooks',
              '--cd',
              '<sanitized-workspace>',
              '-',
            ],
            cwd: '<sanitized-workspace>',
            environment: {
              HOME: '<sterile-home>',
              XDG_CONFIG_HOME: '<sterile-home>/.config',
              XDG_DATA_HOME: '<sterile-home>/.local/share',
              XDG_STATE_HOME: '<sterile-home>/.local/state',
              XDG_CACHE_HOME: '<sterile-home>/.cache',
              CODEX_HOME: '<sterile-codex-home-containing-auth-only>',
            },
            developerInstructions: {
              sourceFile: './role-prompt.md',
              encoding: 'toml-string',
              passAsSingleArgument: true,
            },
            configurationIsolation: {
              hostAttestation: 'enforcement.configuration=isolated',
              sanitizedWorkspace: true,
              forbiddenProjectEntries: [
                '.codex/',
                '.agents/',
                'AGENTS.md',
                'AGENTS.override.md',
                '**/AGENTS.md',
                '**/AGENTS.override.md',
              ],
              projectDocMaxBytes: 0,
              ignoreUserConfig: true,
              disableApps: true,
              disableHooks: true,
              sterileHome: true,
              sterileCodexHome: true,
            },
            stdin: '<room-message-or-turn-input>',
          }),
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

function deniedCommandMapping(
  capability: CapabilityId,
  shellEnabled: boolean,
  sandboxMode: 'read-only' | 'workspace-write',
): { target: string; fidelity: Mapping['fidelity']; message: string } | undefined {
  if (capability === 'shell.execute') {
    return {
      target: '--disable shell_tool',
      fidelity: shellEnabled ? 'unsupported' : 'exact',
      message: shellEnabled
        ? 'The effective policy unexpectedly exposes shell.execute while the role denies it.'
        : 'The stable Codex shell_tool feature is disabled; prompt text is not used as enforcement.',
    }
  }
  if (capability === 'filesystem.write') {
    return {
      target: `sandbox_mode=${sandboxMode}`,
      fidelity: sandboxMode === 'read-only' ? 'exact' : 'unsupported',
      message:
        sandboxMode === 'read-only'
          ? 'The read-only Codex sandbox enforces the workspace write denial.'
          : "A writable sandbox cannot enforce the role's filesystem.write denial.",
    }
  }
  if (capability === 'source-control.write') {
    const enforced = !shellEnabled || sandboxMode === 'read-only'
    return {
      target: !shellEnabled ? '--disable shell_tool' : `sandbox_mode=${sandboxMode}`,
      fidelity: enforced ? 'exact' : 'unsupported',
      message: enforced
        ? 'Source-control commands are unavailable because shell_tool is disabled or the workspace is read-only.'
        : 'The granted shell in a writable workspace can perform source-control writes; prompt text cannot enforce this denial.',
    }
  }
  return undefined
}

export const compatibility = new CodexCompatibility()
export default compatibility
