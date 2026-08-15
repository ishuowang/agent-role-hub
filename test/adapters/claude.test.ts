import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { ClaudeAdapter } from '../../src/adapters/claude.js'
import { loadRole } from '../../src/manifest.js'
import { testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const roleRoot = path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'software-engineer')

test('Claude session export is scoped, deterministic, and denies native Skill discovery', async () => {
  const role = await loadRole(roleRoot)
  const adapter = new ClaudeAdapter()
  const options = {
    mode: 'best-effort',
    scope: 'session',
    policy: testPolicy(role, 'claude'),
  } as const
  const first = adapter.render(role, options)
  const second = adapter.render(role, options)
  assert.deepEqual(first, second)

  const agentsFile = first.files.find((file) => file.path === 'agents.json')
  assert.ok(agentsFile && typeof agentsFile.content === 'string')
  const agents = JSON.parse(agentsFile.content) as Record<
    string,
    { tools: string[]; disallowedTools: string[]; prompt: string }
  >
  const [name, definition] = Object.entries(agents)[0] ?? []
  assert.match(name ?? '', /^rolehub-ishuowang-software-engineer-[a-f0-9]{8}$/)
  assert.ok(definition)
  assert.ok(definition.disallowedTools.includes('Skill'))
  assert.ok(
    !definition.tools.includes('Bash'),
    'optional shell capability must not be auto-enabled',
  )
  assert.match(definition.prompt, /Bundle SHA-256:/)
})

test('Claude strict export reports required skill/source-control degradation', async () => {
  const role = await loadRole(roleRoot)
  assert.throws(() =>
    new ClaudeAdapter().plan(role, {
      mode: 'strict',
      scope: 'session',
      policy: testPolicy(role, 'claude'),
    }),
  )
})
