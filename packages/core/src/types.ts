export const CAPABILITY_IDS = [
  'filesystem.read',
  'filesystem.write',
  'shell.execute',
  'network.fetch',
  'web.search',
  'browser.operate',
  'source-control.read',
  'source-control.write',
  'issues.read',
  'issues.write',
  'room.message',
  'room.delegate',
  'memory.read',
  'memory.write',
  'secrets.use',
  'external.publish',
  'money.spend',
  'legal.commit',
] as const

export type CapabilityId = (typeof CAPABILITY_IDS)[number]

export interface CapabilityRequest {
  id: CapabilityId
  reason: string
  approval?: 'ask'
}

export interface RoleManifest {
  apiVersion: 'rolehub.dev/v1alpha1'
  kind: 'AgentRole'
  metadata: {
    id: string
    name: string
    version: string
    displayName: string
    description: string
    publisher: string
    license: string
    tags: string[]
  }
  spec: {
    prompt: {
      path: string
      mode: 'append' | 'replace'
    }
    skills: Array<{
      name: string
      path: string
      required: boolean
    }>
    capabilities: {
      required: CapabilityRequest[]
      optional: CapabilityRequest[]
      denied: CapabilityRequest[]
    }
    isolation: {
      scope: 'session' | 'process'
      context: 'none' | 'room' | 'workspace'
      filesystem: 'denied' | 'read-only' | 'workspace-write'
      network: 'denied' | 'approval-required' | 'allowlisted' | 'unrestricted'
      allowedHosts?: string[]
    }
    limits: {
      maxTurns: number
      timeoutSeconds?: number
      maxOutputBytes?: number
    }
    model?: {
      class?: 'fast' | 'balanced' | 'reasoning' | 'frontier'
      reasoning?: 'low' | 'medium' | 'high' | 'xhigh'
    }
    secrets: Array<{
      name: string
      purpose: string
      required: boolean
    }>
    evals: {
      path: string
    }
  }
}

export interface LoadedSkill {
  name: string
  description: string
  path: string
  content: string
  required: boolean
}

export interface LoadedRole {
  root: string
  manifestPath: string
  manifest: RoleManifest
  manifestDigest: string
  bundleDigest: string
  prompt: string
  skills: LoadedSkill[]
}
