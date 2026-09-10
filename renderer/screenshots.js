const grid = document.getElementById('grid')
const errorEl = document.getElementById('error')
const statusEl = document.getElementById('status')
const dateEl = document.getElementById('date')
const employeeEl = document.getElementById('employeeId')
const lightbox = document.getElementById('lightbox')
const lightboxImg = document.getElementById('lightboxImg')
const lightboxCaption = document.getElementById('lightboxCaption')

function openFullView(src, caption) {
  if (!src) return
  lightboxImg.src = src
  lightboxCaption.textContent = caption || ''
  lightbox.hidden = false
}

function closeFullView() {
  lightbox.hidden = true
  lightboxImg.src = ''
}

lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox || event.target === document.getElementById('lightboxClose')) {
    closeFullView()
  }
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeFullView()
})

function cleanError(err) {
  const raw = err?.message || String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (Error:\s*)?/i, '')
}

function showError(message) {
  if (!message) {
    errorEl.hidden = true
    errorEl.textContent = ''
    return
  }
  errorEl.hidden = false
  errorEl.textContent = message
}

function showStatus(message) {
  if (!message) {
    statusEl.hidden = true
    statusEl.textContent = ''
    return
  }
  statusEl.hidden = false
  statusEl.textContent = message
}

async function load() {
  showError('')
  grid.innerHTML = ''
  try {
    const rows = await window.desktop.listScreenshots({
      date: dateEl.value || undefined,
      employeeId: employeeEl.value || undefined,
    })
    if (!rows.length) {
      showError('No screenshots yet. Confirm CRM Employee tray says Monitoring, wait one minute, then click Load screenshots. Leave Date empty to see all recent captures.')
      return
    }
    for (const row of rows) {
      const article = document.createElement('article')
      const img = document.createElement('img')
      img.alt = 'Work screenshot'
      const meta = document.createElement('div')
      const name = document.createElement('strong')
      name.textContent = row.displayName || 'Unknown employee'
      const when = document.createElement('span')
      when.textContent = new Date(row.captured_at).toLocaleString()
      meta.append(name, when)
      article.append(img, meta)
      const caption = `${row.displayName || 'Unknown employee'} · ${new Date(row.captured_at).toLocaleString()}`
      article.addEventListener('click', () => openFullView(img.src, caption))
      grid.append(article)
      window.desktop
        .signedUrl(row.storage_path)
        .then((url) => {
          img.src = url
        })
        .catch(() => {
          img.alt = 'Could not load image'
        })
    }
  } catch (err) {
    showError(cleanError(err))
  }
}

async function fillEmployees() {
  try {
    const people = await window.desktop.listEmployees()
    const current = employeeEl.value
    employeeEl.innerHTML = '<option value="">All employees</option>'
    for (const person of people || []) {
      const option = document.createElement('option')
      option.value = person.id
      option.textContent = person.label
      employeeEl.append(option)
    }
    if ([...employeeEl.options].some((option) => option.value === current)) {
      employeeEl.value = current
    }
  } catch {
    /* sign-in happens first */
  }
}

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  showError('')
  showStatus('Signing in…')
  try {
    const result = await window.desktop.adminLogin({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    })
    showStatus(`Signed in as ${result.email}`)
    await fillEmployees()
    await load()
  } catch (err) {
    showStatus('')
    showError(cleanError(err))
  }
})

document.getElementById('load').addEventListener('click', load)
employeeEl.addEventListener('change', load)
dateEl.value = ''
fillEmployees()
