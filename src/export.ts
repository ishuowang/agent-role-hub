import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ClaudeAdapter } from './adapters/claude.js'
import { CodexAdapter } from './adapters/codex.js'
import { DshAdapter } from './adapters/dsh.js'
import { OpenCodeAdapter } from './adapters/opencode.js'
import { PiAdapter } from './adapters/pi.js'
import {
  type ExportOptions,
  type ExportReport,
  type HarnessId,
  type LoadedRole,
  type RoleAdapter,
} from './adapters/base.js'
import { resolveWithin, stableJson } from './bundle-files.js'
import { RoleHubError } from './errors.js'

const adapters: Record<HarnessId, RoleAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  opencode: new OpenCodeAdapter(),
  pi: new PiAdapter(),
  dsh: new DshAdapter(),
}

export function getAdapter(id: HarnessId): RoleAdapter {
  return adapters[id]
}

export async function exportRole(
  role: LoadedRole,
  target: HarnessId,
  output: string,
  options: ExportOptions,
): Promise<ExportReport> {
  const adapter = getAdapter(target)
  const result = adapter.render(role, options)
  const report: ExportReport = {
    reportVersion: 1,
    role: {
      id: role.manifest.metadata.id,
      version: role.manifest.metadata.version,
      manifestDigest: role.manifestDigest,
      bundleDigest: role.bundleDigest,
    },
    adapter: { id: adapter.id, version: adapter.version },
    options,
    plan: result.plan,
  }
  const outputRoot = path.resolve(output)
  await mkdir(outputRoot, { recursive: true })
  const existing = await readdir(outputRoot)
  if (existing.length) {
    throw new RoleHubError(
      'OUTPUT_NOT_EMPTY',
      `Refusing to mix an export with existing files: ${outputRoot}`,
    )
  }
  await assertNoSymlinkAncestors(outputRoot, outputRoot)

  const reportPath = target === 'codex' ? '.rolehub/export-report.json' : 'rolehub-export.json'
  const files = [...result.files, { path: reportPath, content: stableJson(report) }]
  for (const file of files) {
    const destination = resolveWithin(outputRoot, file.path, 'adapter output')
    await assertNoSymlinkAncestors(outputRoot, destination)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, file.content, { mode: file.mode ?? 0o644 })
  }
  return report
}

async function assertNoSymlinkAncestors(root: string, destination: string): Promise<void> {
  const relative = path.relative(root, destination)
  let current = root
  for (const segment of ['', ...relative.split(path.sep)]) {
    if (segment) current = path.join(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new RoleHubError('UNSAFE_PATH', `Adapter output traverses a symlink: ${current}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
}
