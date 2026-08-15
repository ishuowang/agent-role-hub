const state = { roles: [], query: '', target: 'all' }

const elements = {
  roles: document.querySelector('#roles'),
  status: document.querySelector('#status'),
  search: document.querySelector('#search'),
  targets: document.querySelector('#targets'),
  template: document.querySelector('#role-template'),
}

const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
const list = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []

function normalize(raw) {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.roles) ? raw.roles : []
  return rows
    .map((row) => {
      const metadata = row.metadata ?? {}
      const spec = row.spec ?? {}
      const id = text(row.id ?? metadata.name)
      const slug = id.split('/').at(-1) || id
      const adapters = list(
        row.adapters ?? row.compatibility?.adapters ?? spec.compatibility?.adapters,
      ).map((adapter) => adapter.toLowerCase())
      return {
        id,
        name: text(row.displayName ?? metadata.displayName, slug.replaceAll('-', ' ')),
        description: text(row.description ?? metadata.description),
        version: text(row.version ?? metadata.version, 'unversioned'),
        trust: text(row.trust ?? row.trustTier, 'community'),
        tags: list(row.tags ?? metadata.tags).slice(0, 4),
        adapters,
        href: text(
          row.url ?? row.source?.url,
          `https://github.com/ishuowang/agent-role-hub/tree/main/roles/${id}`,
        ),
      }
    })
    .filter((row) => row.id)
}

function render() {
  const query = state.query.trim().toLowerCase()
  const filtered = state.roles.filter((role) => {
    const targetMatches =
      state.target === 'all' || role.adapters.some((adapter) => adapter.includes(state.target))
    const queryMatches =
      !query ||
      [role.id, role.name, role.description, ...role.tags, ...role.adapters]
        .join(' ')
        .toLowerCase()
        .includes(query)
    return targetMatches && queryMatches
  })

  elements.roles.replaceChildren(...filtered.map(renderRole))
  elements.status.textContent = `${filtered.length} role${filtered.length === 1 ? '' : 's'} · pinned, reviewable, portable`
  if (!filtered.length) {
    const empty = document.createElement('p')
    empty.className = 'description'
    empty.textContent = state.roles.length
      ? 'No roles match this filter.'
      : 'The first verified roles are being prepared.'
    elements.roles.append(empty)
  }
}

function renderRole(role) {
  const node = elements.template.content.firstElementChild.cloneNode(true)
  node.querySelector('.trust').textContent = role.trust
  node.querySelector('.version').textContent = `v${role.version}`
  node.querySelector('h3').textContent = role.name
  node.querySelector('.description').textContent = role.description
  node.querySelector('.role-id').textContent = role.id
  const link = node.querySelector('.role-link')
  link.href = role.href
  link.setAttribute('aria-label', `View ${role.name}`)
  node.querySelector('.tags').replaceChildren(...role.tags.map((tag) => chip(tag)))
  node.querySelector('.compat').replaceChildren(...role.adapters.map((adapter) => chip(adapter)))
  return node
}

function chip(label) {
  const span = document.createElement('span')
  span.textContent = label
  return span
}

elements.search.addEventListener('input', (event) => {
  state.query = event.target.value
  render()
})

elements.targets.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-target]')
  if (!button) return
  state.target = button.dataset.target
  for (const item of elements.targets.querySelectorAll('button'))
    item.classList.toggle('active', item === button)
  render()
})

try {
  const response = await fetch('./catalog.json', { cache: 'no-cache' })
  if (!response.ok) throw new Error(`catalog returned ${response.status}`)
  state.roles = normalize(await response.json())
  render()
} catch (error) {
  elements.status.textContent = 'Catalog unavailable'
  elements.roles.innerHTML = `<p class="description">The static catalog could not be loaded. Browse roles on <a href="https://github.com/ishuowang/agent-role-hub/tree/main/roles">GitHub</a>.</p>`
  console.error(error)
}
