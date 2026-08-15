import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { parse as parseYaml } from 'yaml'

import { OpenCodeAdapter } from '../../src/adapters/opencode.js'
import { PiAdapter } from '../../src/adapters/pi.js'
import { loadRole } from '../../src/manifest.js'
import { testPolicy } from '../helpers/policy.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const roleRoot = path.join(repositoryRoot, 'roles', 'io.github.ishuowang', 'finance-controller')

test('OpenCode compiles skills safely and preserves network/tool deny-by-default', async () => {
  const role = await loadRole(roleRoot)
  const result = new OpenCodeAdapter().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'opencode'),
  })
  assert.equal(result.plan.runnable, true)
  assert.ok(!result.files.some((file) => file.path.startsWith('skills/')))
  const agent = result.files.find((file) => file.path.startsWith('agents/'))
  assert.ok(agent && typeof agent.content === 'string')
  const frontmatter = agent.content.match(/^---\n([\s\S]*?)\n---/)?.[1]
  assert.ok(frontmatter)
  const parsed = parseYaml(frontmatter) as { permission: Record<string, unknown> }
  assert.equal(parsed.permission['*'], 'deny')
  assert.equal(parsed.permission['skill'], 'deny')
  assert.equal(parsed.permission['webfetch'], undefined)
  assert.match(agent.content, /Skill: budget-analysis/)
})

test('Pi launch template loads prompt and native skills without implicit tools', async () => {
  const role = await loadRole(roleRoot)
  const result = new PiAdapter().render(role, {
    mode: 'strict',
    scope: 'session',
    policy: testPolicy(role, 'pi'),
  })
  assert.equal(result.plan.runnable, true)
  const metadataFile = result.files.find((file) => file.path === 'rolehub-pi.json')
  assert.ok(metadataFile && typeof metadataFile.content === 'string')
  const metadata = JSON.parse(metadataFile.content) as {
    argvTemplate: string[]
    tools: string[]
    skills: string[]
  }
  assert.ok(metadata.argvTemplate.includes('--append-system-prompt'))
  assert.ok(metadata.argvTemplate.includes('--skill'))
  assert.ok(metadata.skills.length > 0)
  assert.ok(metadata.tools.includes('read'))
  assert.ok(!metadata.tools.includes('bash'))
  assert.ok(!metadata.tools.includes('write'))
})
