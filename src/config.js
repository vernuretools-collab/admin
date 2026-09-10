import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'

const require = createRequire(import.meta.url)
const electron = require('electron')
const { app } = electron

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return
  dotenv.config({ path: filePath, override: true })
}

export function loadSupabaseEnv() {
  const roaming = process.env.APPDATA || ''
  const exeDir = path.dirname(process.execPath)
  const candidates = [
    path.join(APP_ROOT, '.env'),
    path.join(process.resourcesPath || '', '.env'),
    path.join(exeDir, '.env'),
    path.join(exeDir, 'resources', '.env'),
    path.join(roaming, 'CRM Admin', '.env'),
    path.join(roaming, 'crm-admin-desktop', '.env'),
  ]
  try {
    if (app?.isPackaged) {
      candidates.push(path.join(path.dirname(app.getPath('exe')), '.env'))
      candidates.push(path.join(app.getPath('userData'), '.env'))
    }
  } catch {
    /* app paths may be unavailable at import time */
  }
  for (const file of candidates) loadEnvFile(file)
}

loadSupabaseEnv()

export function isPackaged() {
  return Boolean(app?.isPackaged)
}

export function portalsRoot() {
  if (isPackaged()) return path.join(process.resourcesPath, 'portals')
  return path.join(APP_ROOT, 'portals')
}

export function rendererPath(...parts) {
  return path.join(APP_ROOT, 'renderer', ...parts)
}

export const APP_ID = 'admin'
export const APP_LABEL = 'Admin'
export const PARTITION = 'persist:crm-admin'

export const PORTALS = {
  admin: { id: 'admin', label: 'Admin', port: 3001, folder: 'admin' },
}

export function supabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
}

export function supabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
}

export const SCREENSHOT_BUCKET = 'work-screenshots'
