import { sha256, stableJson } from '../../src/bundle-files.js'
import type { HarnessId, LoadedRole } from '../../src/adapters/base.js'
import type { EffectivePolicyReceipt, LoadedEffectivePolicy } from '../../src/types.js'

export function testPolicy(role: LoadedRole, target: HarnessId): LoadedEffectivePolicy {
  const receipt: EffectivePolicyReceipt = {
    apiVersion: 'rolehub.dev/policy/v1alpha1',
    kind: 'EffectiveRolePolicy',
    role: { id: role.manifest.metadata.id, bundleDigest: role.bundleDigest },
    target,
    grants: role.manifest.spec.capabilities.required.map((capability) => capability.id),
    enforcement: {
      filesystem: 'os-sandbox',
      network: 'egress-policy',
      approvals: 'interactive-broker',
      room: 'broker',
      process: target === 'dsh' ? 'shared' : 'dedicated',
    },
  }
  return { ...receipt, policyDigest: sha256(stableJson(receipt)) }
}
