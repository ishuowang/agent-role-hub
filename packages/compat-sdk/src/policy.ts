import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

import {
  CAPABILITY_IDS,
  RoleHubError,
  sha256,
  stableJson,
  type LoadedRole,
} from '@ishuowang/rolehub-core'
import {
  capabilityIds,
  type EffectivePolicyReceipt,
  type LoadedEffectivePolicy,
} from './contract.js'

const filesystemModes = new Set(['none', 'tool-policy', 'os-sandbox'])
const networkModes = new Set(['none', 'tool-policy', 'egress-policy'])
const approvalModes = new Set(['none', 'interactive-broker'])
const roomModes = new Set(['none', 'broker'])
const processModes = new Set(['shared', 'dedicated'])
const configurationModes = new Set(['shared', 'isolated'])

export async function loadEffectivePolicy(
  input: string,
  role: LoadedRole,
  compatibilityId: string,
): Promise<LoadedEffectivePolicy> {
  const absolute = path.resolve(input)
  let parsed: unknown
  try {
    const raw = await readFile(absolute, 'utf8')
    parsed = absolute.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
  } catch (error) {
    throw new RoleHubError(
      'INVALID_YAML',
      `Cannot read effective policy ${absolute}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const receipt = validatePolicyShape(parsed)
  if (
    receipt.role.id !== role.manifest.metadata.id ||
    receipt.role.bundleDigest !== role.bundleDigest
  ) {
    throw new RoleHubError(
      'POLICY_MISMATCH',
      'Effective policy role id and bundle digest must match the loaded role exactly',
    )
  }
  if (receipt.compatibility !== compatibilityId) {
    throw new RoleHubError(
      'POLICY_MISMATCH',
      `Policy compatibility ${receipt.compatibility} does not match ${compatibilityId}`,
    )
  }
  const requested = new Set([
    ...capabilityIds(role, 'required'),
    ...capabilityIds(role, 'optional'),
  ])
  const denied = new Set(capabilityIds(role, 'denied'))
  for (const grant of receipt.grants) {
    if (!requested.has(grant) || denied.has(grant)) {
      throw new RoleHubError(
        'POLICY_MISMATCH',
        `Policy grants unrequested or denied capability: ${grant}`,
      )
    }
  }
  if (
    role.manifest.spec.isolation.filesystem !== 'workspace-write' &&
    receipt.grants.includes('filesystem.write')
  ) {
    throw new RoleHubError(
      'POLICY_MISMATCH',
      'Policy grants filesystem.write outside workspace-write isolation',
    )
  }
  if (
    role.manifest.spec.isolation.network === 'denied' &&
    receipt.grants.some((grant) =>
      (['network.fetch', 'web.search', 'browser.operate'] as const).includes(grant as never),
    )
  ) {
    throw new RoleHubError(
      'POLICY_MISMATCH',
      'Policy grants network access while role isolation denies it',
    )
  }
  return { ...receipt, policyDigest: sha256(stableJson(receipt)) }
}

function validatePolicyShape(candidate: unknown): EffectivePolicyReceipt {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new RoleHubError('POLICY_INVALID', 'Effective policy must be an object')
  }
  const value = candidate as Record<string, unknown>
  const allowedTop = new Set([
    'apiVersion',
    'kind',
    'role',
    'compatibility',
    'grants',
    'enforcement',
  ])
  rejectUnknown(value, allowedTop, 'policy')
  if (
    value['apiVersion'] !== 'rolehub.dev/policy/v1alpha1' ||
    value['kind'] !== 'EffectiveRolePolicy'
  ) {
    throw new RoleHubError('POLICY_INVALID', 'Unsupported policy apiVersion or kind')
  }
  const role = record(value['role'], 'policy.role')
  rejectUnknown(role, new Set(['id', 'bundleDigest']), 'policy.role')
  if (typeof role['id'] !== 'string' || !role['id']) invalid('policy.role.id')
  if (typeof role['bundleDigest'] !== 'string' || !/^[a-f0-9]{64}$/.test(role['bundleDigest'])) {
    invalid('policy.role.bundleDigest')
  }
  if (
    typeof value['compatibility'] !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value['compatibility'])
  ) {
    invalid('policy.compatibility')
  }
  if (
    !Array.isArray(value['grants']) ||
    !value['grants'].every((item) => CAPABILITY_IDS.includes(item))
  ) {
    invalid('policy.grants')
  }
  if (new Set(value['grants']).size !== value['grants'].length)
    invalid('policy.grants (duplicates)')
  const enforcement = record(value['enforcement'], 'policy.enforcement')
  rejectUnknown(
    enforcement,
    new Set(['filesystem', 'network', 'approvals', 'room', 'process', 'configuration']),
    'policy.enforcement',
  )
  if (!filesystemModes.has(String(enforcement['filesystem'])))
    invalid('policy.enforcement.filesystem')
  if (!networkModes.has(String(enforcement['network']))) invalid('policy.enforcement.network')
  if (!approvalModes.has(String(enforcement['approvals']))) invalid('policy.enforcement.approvals')
  if (!roomModes.has(String(enforcement['room']))) invalid('policy.enforcement.room')
  if (!processModes.has(String(enforcement['process']))) invalid('policy.enforcement.process')
  if (!configurationModes.has(String(enforcement['configuration']))) {
    invalid('policy.enforcement.configuration')
  }
  return candidate as EffectivePolicyReceipt
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label)
  return value as Record<string, unknown>
}

function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length)
    throw new RoleHubError('POLICY_INVALID', `${label} has unknown fields: ${unknown.join(', ')}`)
}

function invalid(label: string): never {
  throw new RoleHubError('POLICY_INVALID', `Invalid ${label}`)
}
