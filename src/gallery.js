import { applySession, createUserClient } from './attendance.js'
import { SCREENSHOT_BUCKET } from './config.js'
import { isAdminRole, roleFromSession } from './session.js'

function looksAdminProfile(data = {}) {
  const role = String(data.role || '').toLowerCase()
  if (isAdminRole(role)) return true
  return /(admin|owner|superadmin|executive|founder)/i.test(
    `${data.roleName || ''} ${data.departmentName || ''} ${data.department || ''}`,
  )
}

function personName(data = {}, fallback = '') {
  return data.displayName || data.name || data.fullName || data.full_name || data.email || fallback
}

export async function ensureAdminSession(session) {
  if (isAdminRole(roleFromSession(session))) return true
  const wrapped = createUserClient(session)
  if (!wrapped) return false
  const { client } = wrapped
  await applySession(client, session)
  const uid = session.user?.id
  const email = session.user?.email
  const { data: byAuth } = uid
    ? await client.from('profiles').select('data').eq('auth_id', uid)
    : { data: [] }
  const { data: byEmail } = email
    ? await client.from('profiles').select('data').eq('data->>email', email)
    : { data: [] }
  const rows = [...(byAuth || []), ...(byEmail || [])]
  return rows.some((row) => looksAdminProfile(row.data || {}))
}

async function adminClient(session) {
  if (!(await ensureAdminSession(session))) {
    throw new Error('Sign in as an admin, then click Load screenshots.')
  }
  const wrapped = createUserClient(session)
  if (!wrapped) throw new Error('Not signed in')
  const { client } = wrapped
  await applySession(client, session)
  return client
}

async function loadDirectory(client) {
  const [{ data: employees }, { data: profiles }] = await Promise.all([
    client.from('employees').select('id, user_id, auth_id, data').limit(500),
    client.from('profiles').select('id, user_id, auth_id, data').limit(500),
  ])
  const names = {}
  const people = []

  function addPerson(row, kind) {
    if (!row) return
    const data = row.data || {}
    const name = personName(data, '')
    const email = data.email || ''
    const label = name || email || row.id
  const ids = [...new Set(
    [row.id, row.user_id, row.auth_id, data.uid, data.employeeId, data.userId, data.email].filter(Boolean).map(String),
  )]
  for (const id of ids) names[id.toLowerCase()] = label
  people.push({ id: String(row.id), label, email, ids, kind })
  }

  for (const row of employees || []) addPerson(row, 'employee')
  for (const row of profiles || []) addPerson(row, 'profile')

  const employeesOnly = people.filter((person) => person.kind === 'employee')
  employeesOnly.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  return { people, employeesOnly, names }
}

function matchKeysForEmployee(selected, people) {
  const keys = new Set((selected.ids || []).map((id) => String(id).toLowerCase()))
  keys.add(String(selected.id).toLowerCase())
  const email = String(selected.email || '').toLowerCase()
  const label = String(selected.label || '').toLowerCase()
  for (const person of people) {
    const personEmail = String(person.email || '').toLowerCase()
    const overlaps = (person.ids || []).some((id) => keys.has(String(id).toLowerCase()))
    const sameEmail = email && personEmail && email === personEmail
    const sameName = label && String(person.label || '').toLowerCase() === label
    if (!overlaps && !sameEmail && !sameName) continue
    keys.add(String(person.id).toLowerCase())
    for (const id of person.ids || []) keys.add(String(id).toLowerCase())
  }
  return keys
}

export async function listEmployeesForFilter(session) {
  const client = await adminClient(session)
  const { employeesOnly } = await loadDirectory(client)
  return employeesOnly.map((person) => ({
    id: person.id,
    label: person.email && person.label !== person.email ? `${person.label} (${person.email})` : person.label,
    email: person.email,
    ids: person.ids,
  }))
}

export async function listWorkScreenshots(session, filters = {}) {
  const client = await adminClient(session)
  const { people, employeesOnly, names } = await loadDirectory(client)

  let query = client
    .from('work_screenshots')
    .select('id, user_id, org_id, auth_id, captured_at, storage_path, width, height')
    .order('captured_at', { ascending: false })
    .limit(200)

  if (filters.date) {
    const day = String(filters.date).slice(0, 10)
    query = query
      .gte('captured_at', `${day}T00:00:00+05:30`)
      .lte('captured_at', `${day}T23:59:59.999+05:30`)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data || []).map((row) => {
    const key = String(row.user_id || '').toLowerCase()
    const authKey = String(row.auth_id || '').toLowerCase()
    return {
      ...row,
      displayName: names[key] || names[authKey] || 'Unknown employee',
    }
  })

  const selected = employeesOnly.find((person) => person.id === String(filters.employeeId || ''))
  if (!selected) return rows

  const keys = matchKeysForEmployee(selected, people)
  const selectedLabel = String(selected.label || '').toLowerCase()
  return rows.filter((row) => {
    const userId = String(row.user_id || '').toLowerCase()
    const authId = String(row.auth_id || '').toLowerCase()
    const name = String(row.displayName || '').toLowerCase()
    return keys.has(userId) || keys.has(authId) || (selectedLabel && name === selectedLabel)
  })
}

export async function signedScreenshotUrl(session, storagePath) {
  const client = await adminClient(session)
  const { data, error } = await client.storage.from(SCREENSHOT_BUCKET).createSignedUrl(storagePath, 60 * 10)
  if (error) throw error
  return data.signedUrl
}
