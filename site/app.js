const state = { roles: [], compatibilities: [], query: '' }

const repository = 'https://github.com/ishuowang/agent-role-hub'

const elements = {
  roles: document.querySelector('#roles'),
  roleStatus: document.querySelector('#role-status'),
  compatibility: document.querySelector('#compatibility-packages'),
  compatibilityStatus: document.querySelector('#compatibility-status'),
  search: document.querySelector('#search'),
  roleTemplate: document.querySelector('#role-template'),
  compatibilityTemplate: document.querySelector('#compatibility-template'),
}

const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
const list = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []

function normalizeRoles(raw) {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.roles) ? raw.roles : []
  return rows
    .map((row) => {
      const metadata = row.metadata ?? {}
      const id = text(row.id ?? metadata.name)
      const slug = id.split('/').at(-1) || id
      return {
        id,
        name: text(row.displayName ?? metadata.displayName, slug.replaceAll('-', ' ')),
        description: text(row.description ?? metadata.description),
        version: text(row.version ?? metadata.version, 'unversioned'),
        trust: text(row.trust ?? row.trustTier, 'community'),
        tags: list(row.tags ?? metadata.tags).slice(0, 4),
        portability: text(row.portability, 'universal'),
        href: text(row.url, `${repository}/tree/main/roles/${id}`),
      }
    })
    .filter((row) => row.id)
}

function normalizeCompatibilities(raw) {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.compatibilities)
      ? raw.compatibilities
      : []
  return rows
    .map((row) => {
      const id = text(row.id)
      const documentation = text(row.documentation)
      return {
        id,
        name: text(row.displayName, id),
        target: text(row.target),
        targetVersion: text(row.targetVersion),
        version: text(row.version, 'unversioned'),
        transport: text(row.transport, 'integration'),
        implementation: text(row.implementation),
        packageName: text(row.packageName),
        href: `${repository}/tree/main/packages/compat-${id}`,
        docsHref: documentation.startsWith('https://')
          ? documentation
          : documentation
            ? `${repository}/blob/main/${documentation}`
            : `${repository}/tree/main/docs`,
      }
    })
    .filter((row) => row.id)
}

function renderRoles() {
  const query = state.query.trim().toLowerCase()
  const filtered = state.roles.filter((role) => {
    return (
      !query ||
      [role.id, role.name, role.description, ...role.tags].join(' ').toLowerCase().includes(query)
    )
  })

  elements.roles.replaceChildren(...filtered.map(renderRole))
  elements.roleStatus.textContent = `${filtered.length} role${filtered.length === 1 ? '' : 's'} · universal by definition`
  if (!filtered.length) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = state.roles.length
      ? 'No universal roles match that search.'
      : 'The first verified roles are being prepared.'
    elements.roles.append(empty)
  }
}

function renderRole(role) {
  const node = elements.roleTemplate.content.firstElementChild.cloneNode(true)
  node.querySelector('.trust').textContent = role.trust
  node.querySelector('.portability').textContent = role.portability
  node.querySelector('.version').textContent = `v${role.version}`
  node.querySelector('h3').textContent = role.name
  node.querySelector('.description').textContent = role.description
  node.querySelector('.role-id').textContent = role.id
  const link = node.querySelector('.role-link')
  link.href = role.href
  link.setAttribute('aria-label', `View ${role.name}`)
  node.querySelector('.tags').replaceChildren(...role.tags.map((tag) => chip(tag)))
  return node
}

function renderCompatibilities() {
  elements.compatibility.replaceChildren(...state.compatibilities.map(renderCompatibility))
  elements.compatibilityStatus.textContent = `${state.compatibilities.length} independently versioned package${state.compatibilities.length === 1 ? '' : 's'}`
  if (!state.compatibilities.length) {
    const empty = document.createElement('p')
    empty.className = 'empty-state'
    empty.textContent = 'Compatibility registry unavailable.'
    elements.compatibility.append(empty)
  }
}

function renderCompatibility(item, index) {
  const node = elements.compatibilityTemplate.content.firstElementChild.cloneNode(true)
  node.style.setProperty('--order', index)
  node.querySelector('.compat-index').textContent = String(index + 1).padStart(2, '0')
  node.querySelector('.transport').textContent = item.transport
  node.querySelector('.compat-version').textContent = `v${item.version}`
  node.querySelector('h3').textContent = item.name
  node.querySelector('.compat-target').textContent = item.target
  node.querySelector('.target-version').textContent = item.targetVersion
  node.querySelector('.implementation').textContent = item.implementation
  node.querySelector('.package-name').textContent = item.packageName

  const source = node.querySelector('.package-link')
  source.href = item.href
  source.setAttribute('aria-label', `View ${item.name} compatibility package`)
  const docs = node.querySelector('.docs-link')
  docs.href = item.docsHref
  docs.setAttribute('aria-label', `Read ${item.name} compatibility documentation`)
  return node
}

function chip(label) {
  const span = document.createElement('span')
  span.textContent = label
  return span
}

elements.search.addEventListener('input', (event) => {
  state.query = event.target.value
  renderRoles()
})

const [roleResult, compatibilityResult] = await Promise.allSettled([
  fetch('./catalog.json', { cache: 'no-cache' }).then((response) => {
    if (!response.ok) throw new Error(`role catalog returned ${response.status}`)
    return response.json()
  }),
  fetch('./compatibility.json', { cache: 'no-cache' }).then((response) => {
    if (!response.ok) throw new Error(`compatibility catalog returned ${response.status}`)
    return response.json()
  }),
])

if (roleResult.status === 'fulfilled') {
  state.roles = normalizeRoles(roleResult.value)
  renderRoles()
} else {
  elements.roleStatus.textContent = 'Role catalog unavailable'
  elements.roles.innerHTML = `<p class="empty-state">Browse universal roles on <a href="${repository}/tree/main/roles">GitHub</a>.</p>`
  console.error(roleResult.reason)
}

if (compatibilityResult.status === 'fulfilled') {
  state.compatibilities = normalizeCompatibilities(compatibilityResult.value)
  renderCompatibilities()
} else {
  elements.compatibilityStatus.textContent = 'Compatibility registry unavailable'
  elements.compatibility.innerHTML = `<p class="empty-state">Browse compatibility packages on <a href="${repository}/tree/main/packages">GitHub</a>.</p>`
  console.error(compatibilityResult.reason)
}
