import claudeCode from '@ishuowang/rolehub-compat-claude-code'
import codex from '@ishuowang/rolehub-compat-codex'
import dsharness from '@ishuowang/rolehub-compat-dsharness'
import opencode from '@ishuowang/rolehub-compat-opencode'
import pi from '@ishuowang/rolehub-compat-pi'
import { RoleHubError, stableJson } from '@ishuowang/rolehub-core'
import type { RoleCompatibility } from '@ishuowang/rolehub-compat-sdk'

export const builtinCompatibilities: readonly RoleCompatibility[] = [
  claudeCode,
  codex,
  dsharness,
  opencode,
  pi,
].sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id, 'en'))

export async function loadCompatibility(reference: string): Promise<RoleCompatibility> {
  const builtin = builtinCompatibilities.find(
    (candidate) =>
      candidate.descriptor.id === reference || candidate.descriptor.packageName === reference,
  )
  if (builtin) return builtin

  let imported: Record<string, unknown>
  try {
    imported = (await import(reference)) as Record<string, unknown>
  } catch (error) {
    throw new RoleHubError(
      'UNKNOWN_COMPATIBILITY',
      `Cannot load compatibility package ${reference}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const candidate = imported['compatibility'] ?? imported['default']
  if (!isCompatibility(candidate)) {
    throw new RoleHubError(
      'UNKNOWN_COMPATIBILITY',
      `${reference} does not export a RoleHub compatibility object`,
    )
  }
  return candidate
}

export function buildCompatibilityCatalog(): Record<string, unknown> {
  return {
    apiVersion: 'rolehub.dev/compatibility-catalog/v1alpha1',
    generatedBy: '@ishuowang/rolehub@0.2.0',
    compatibilities: builtinCompatibilities.map((item) => item.descriptor),
  }
}

export function describeCompatibility(item: RoleCompatibility): string {
  return stableJson(item.descriptor)
}

function isCompatibility(candidate: unknown): candidate is RoleCompatibility {
  if (!candidate || typeof candidate !== 'object') return false
  const value = candidate as Partial<RoleCompatibility>
  return (
    !!value.descriptor &&
    typeof value.descriptor.id === 'string' &&
    typeof value.descriptor.version === 'string' &&
    typeof value.plan === 'function' &&
    typeof value.render === 'function'
  )
}
