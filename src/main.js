import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { APP_ID, APP_LABEL, PARTITION, loadSupabaseEnv, rendererPath } from './config.js'
import { listEmployeesForFilter, listWorkScreenshots, signedScreenshotUrl } from './gallery.js'
import { signInWithPassword } from './attendance.js'
import { readSessionFromWindow } from './session.js'
import { portalDistExists, portalUrl, startPortalServers } from './staticServers.js'
import { appIcon, trayIcon } from './appIcon.js'
import { setupAutoUpdater } from './updater.js'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, session, Notification } = require('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(__dirname, 'preload.cjs')

const windows = {
  portal: null,
  gallery: null,
}

let tray = null
let servers = []
let portalServersReady = false
let isQuitting = false
const recentNativeTags = new Map()
const NATIVE_TAG_TTL_MS = 30_000

function hideInsteadOfClose(win) {
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })
}

function normalizePortalPath(routePath = '') {
  const raw = String(routePath || '').trim()
  if (!raw) return ''
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw)
      return `${u.pathname}${u.search}${u.hash}`
    }
  } catch {
    /* keep raw path */
  }
  return raw.startsWith('/') ? raw : `/${raw}`
}

function portalHref(routePath = '') {
  const base = portalUrl(APP_ID)
  const trimmed = String(routePath || '').replace(/^\//, '')
  return trimmed ? `${base}${trimmed}` : base
}

function createTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip('CRM Admin')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Admin', click: () => openPortal() },
      { label: 'Work screenshots', click: () => showGallery() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
}

function browserOpts(extra = {}) {
  return {
    width: 1280,
    height: 860,
    show: true,
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: {
      preload: extra.preload || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: extra.sandbox !== false,
      partition: PARTITION,
    },
    ...extra,
  }
}

function showGallery() {
  if (windows.gallery && !windows.gallery.isDestroyed()) {
    windows.gallery.show()
    windows.gallery.focus()
    return windows.gallery
  }
  const win = new BrowserWindow({
    ...browserOpts({ preload: preloadPath, width: 1100, height: 780, sandbox: false }),
    title: 'Work screenshots',
  })
  windows.gallery = win
  win.loadFile(rendererPath('screenshots.html'))
  win.on('closed', () => {
    windows.gallery = null
  })
  return win
}

async function openPortal({ show = true, path: routePath = '' } = {}) {
  if (!portalServersReady) {
    await dialog.showErrorBox(
      'Admin portal unavailable',
      'The local admin server is not running. Port 3001 may be in use by another CRM Admin or Vite process. Close that app and restart with npm run dev.',
    )
    return
  }
  if (!portalDistExists(APP_ID)) {
    await dialog.showErrorBox(
      'Portal missing',
      'Admin portal build missing. From crm-admin-desktop run npm run portals.',
    )
    return
  }
  if (windows.portal && !windows.portal.isDestroyed()) {
    if (show) {
      if (routePath) windows.portal.loadURL(portalHref(routePath))
      windows.portal.show()
      windows.portal.focus()
    }
    return windows.portal
  }
  const win = new BrowserWindow({
    ...browserOpts({ preload: preloadPath, sandbox: false }),
    title: `${APP_LABEL} portal`,
    show,
  })
  windows.portal = win
  hideInsteadOfClose(win)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadURL(portalHref(routePath))
  win.on('closed', () => {
    windows.portal = null
  })
  return win
}

function showNativeNotification(payload = {}) {
  const title = String(payload.title || APP_LABEL).trim() || APP_LABEL
  const body = String(payload.body || '')
  const tag = String(payload.tag || `${title}:${body}`)
  const now = Date.now()
  const last = recentNativeTags.get(tag)
  if (last && now - last < NATIVE_TAG_TTL_MS) return false
  recentNativeTags.set(tag, now)
  for (const [key, at] of recentNativeTags) {
    if (now - at > NATIVE_TAG_TTL_MS) recentNativeTags.delete(key)
  }
  if (!Notification.isSupported()) return false
  const n = new Notification({
    title,
    body,
    icon: appIcon(),
    silent: false,
  })
  n.on('click', () => {
    void openPortal({ show: true, path: normalizePortalPath(payload.link) })
  })
  n.show()
  return true
}

function cachedSessionPath() {
  return path.join(app.getPath('userData'), 'admin-session.json')
}

function saveCachedSession(session) {
  if (!session?.access_token) return
  try {
    fs.writeFileSync(cachedSessionPath(), JSON.stringify(session))
  } catch {
    /* ignore */
  }
}

function loadCachedSession() {
  try {
    const raw = fs.readFileSync(cachedSessionPath(), 'utf8')
    const session = JSON.parse(raw)
    return session?.access_token ? session : null
  } catch {
    return null
  }
}

async function sessionForGallery() {
  const portalSession = await readSessionFromWindow(windows.portal)
  if (portalSession) {
    saveCachedSession(portalSession)
    return portalSession
  }
  const cached = loadCachedSession()
  if (!cached) {
    throw new Error('Sign in below with an admin account, then click Load screenshots.')
  }
  return cached
}

function registerIpc() {
  ipcMain.handle('desktop:openGallery', async () => {
    showGallery()
    return true
  })
  ipcMain.handle('desktop:adminLogin', async (_event, credentials) => {
    const session = await signInWithPassword(credentials?.email, credentials?.password)
    saveCachedSession(session)
    return { email: session.user?.email || credentials?.email }
  })
  ipcMain.handle('desktop:listScreenshots', async (_event, filters) => {
    const session = await sessionForGallery()
    return listWorkScreenshots(session, filters || {})
  })
  ipcMain.handle('desktop:listEmployees', async () => {
    const session = await sessionForGallery()
    return listEmployeesForFilter(session)
  })
  ipcMain.handle('desktop:signedUrl', async (_event, storagePath) => {
    const session = await sessionForGallery()
    return signedScreenshotUrl(session, storagePath)
  })
  ipcMain.handle('desktop:showNotification', async (_event, payload) => showNativeNotification(payload || {}))
  ipcMain.handle('desktop:saveFile', async (event, payload) => {
    const filename = path.basename(String(payload?.filename || 'report.xlsx'))
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win || undefined, {
      title: 'Save monthly report',
      defaultPath: filename,
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    })
    if (result.canceled || !result.filePath) return { saved: false }
    const data = payload?.data
    const buffer = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data || []))
    fs.writeFileSync(result.filePath, buffer)
    return { saved: true, filePath: result.filePath }
  })
}

app.setName('CRM Admin')
app.setAppUserModelId('com.businessos.crm-admin')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    openPortal()
  })
}

app.whenReady().then(async () => {
  if (!gotLock) return
  loadSupabaseEnv()
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })
  registerIpc()
  try {
    servers = await startPortalServers()
    portalServersReady = true
  } catch (err) {
    portalServersReady = false
    console.error('[servers]', err)
    const portHint =
      err?.code === 'EADDRINUSE'
        ? err.message
        : `Could not start the admin portal server on 127.0.0.1:3001.\n\n${err?.message || err}`
    await dialog.showErrorBox('Admin portal port busy', portHint)
  }
  createTray()
  setupAutoUpdater()
  if (portalServersReady) {
    await openPortal()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openPortal()
  })
})

app.on('window-all-closed', () => {
  // Stay in the tray.
})

app.on('before-quit', () => {
  isQuitting = true
  for (const server of servers) {
    try {
      server.close()
    } catch {
      /* ignore */
    }
  }
})
