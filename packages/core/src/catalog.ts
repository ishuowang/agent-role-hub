import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { stableJson } from './bundle-files.js'
import { discoverRoleRoots, loadRole } from './manifest.js'
import type { LoadedRole } from './types.js'

export interface CatalogRole {
  id: string
  name: string
  displayName: string
  description: string
  publisher: string
  version: string
  license: string
  tags: string[]
  trust: 'reference' | 'community'
  portability: 'universal'
  path: string
  url: string
  manifestDigest: string
  bundleDigest: string
  capabilities: {
    required: string[]
    optional: string[]
    denied: string[]
  }
}

export interface RoleCatalog {
  apiVersion: 'rolehub.dev/catalog/v1alpha2'
  generatedBy: string
  roles: CatalogRole[]
}

export async function buildCatalog(rolesRoot: string): Promise<RoleCatalog> {
  const absoluteRoot = path.resolve(rolesRoot)
  const roots = await discoverRoleRoots(absoluteRoot)
  const loaded = await Promise.all(roots.map(loadRole))
  loaded.sort((left, right) =>
    left.manifest.metadata.id.localeCompare(right.manifest.metadata.id, 'en'),
  )
  return {
    apiVersion: 'rolehub.dev/catalog/v1alpha2',
    generatedBy: '@ishuowang/rolehub-core@0.2.0',
    roles: loaded.map((role) => toCatalogRole(role, absoluteRoot)),
  }
}

export async function writeCatalog(catalog: RoleCatalog, output: string): Promise<void> {
  const absolute = path.resolve(output)
  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, stableJson(catalog), { mode: 0o644 })
}

function toCatalogRole(role: LoadedRole, rolesRoot: string): CatalogRole {
  const metadata = role.manifest.metadata
  const relativePath = path.relative(rolesRoot, role.root).split(path.sep).join('/')
  return {
    id: metadata.id,
    name: metadata.name,
    displayName: metadata.displayName,
    description: metadata.description,
    publisher: metadata.publisher,
    version: metadata.version,
    license: metadata.license,
    tags: metadata.tags,
    trust: metadata.publisher === 'io.github.ishuowang' ? 'reference' : 'community',
    portability: 'universal',
    path: relativePath,
    url: `https://github.com/ishuowang/agent-role-hub/tree/main/roles/${relativePath}`,
    manifestDigest: role.manifestDigest,
    bundleDigest: role.bundleDigest,
    capabilities: {
      required: role.manifest.spec.capabilities.required.map((item) => item.id),
      optional: role.manifest.spec.capabilities.optional.map((item) => item.id),
      denied: role.manifest.spec.capabilities.denied.map((item) => item.id),
    },
  }
}
