import { sha256, stableJson, type LoadedRole } from '@ishuowang/rolehub-core'
import type { EffectivePolicyReceipt, LoadedEffectivePolicy } from '@ishuowang/rolehub-compat-sdk'

export function testPolicy(
  role: LoadedRole,
  compatibility: string,
  enforcementOverrides: Partial<EffectivePolicyReceipt['enforcement']> = {},
): LoadedEffectivePolicy {
  const receipt: EffectivePolicyReceipt = {
    apiVersion: 'rolehub.dev/policy/v1alpha1',
    kind: 'EffectiveRolePolicy',
    role: { id: role.manifest.metadata.id, bundleDigest: role.bundleDigest },
    compatibility,
    grants: role.manifest.spec.capabilities.required.map((capability) => capability.id),
    enforcement: {
      filesystem: 'os-sandbox',
      network: 'egress-policy',
      approvals: 'interactive-broker',
      room: 'broker',
      process: compatibility === 'dsharness' ? 'shared' : 'dedicated',
      configuration: 'isolated',
      ...enforcementOverrides,
    },
  }
  return { ...receipt, policyDigest: sha256(stableJson(receipt)) }
}

export const dsharnessBindings = {
  'filesystem.read': ['read', 'glob', 'grep'],
  'filesystem.write': ['write', 'edit'],
  'source-control.read': ['read', 'bash'],
  'source-control.write': ['bash'],
  'shell.execute': ['bash'],
  'network.fetch': ['web_fetch'],
  'web.search': ['web_search'],
} as const
