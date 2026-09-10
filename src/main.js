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

const require = createRequire(import.meta.url)
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, session } = require('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(__dirname, 'preload.cjs')

const windows = {
  portal: null,
  gallery: null,
}

let tray = null
let servers = []

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

async function openPortal() {
  if (!portalDistExists(APP_ID)) {
    await dialog.showErrorBox(
      'Portal missing',
      'Admin portal build missing. From crm-admin-desktop run npm run portals.',
    )
    return
  }
  if (windows.portal && !windows.portal.isDestroyed()) {
    windows.portal.show()
    windows.portal.focus()
    return windows.portal
  }
  const win = new BrowserWindow({
    ...browserOpts({ sandbox: true }),
    title: `${APP_LABEL} portal`,
  })
  windows.portal = win
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadURL(portalUrl(APP_ID))
  win.on('closed', () => {
    windows.portal = null
  })
  return win
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
  } catch (err) {
    console.warn('[servers]', err)
  }
  createTray()
  await openPortal()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openPortal()
  })
})

app.on('window-all-closed', () => {
  // Stay in the tray.
})

app.on('before-quit', () => {
  for (const server of servers) {
    try {
      server.close()
    } catch {
      /* ignore */
    }
  }
})
