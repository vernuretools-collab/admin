import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { portalsRoot, PORTALS } from './config.js'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0])
  const resolved = path.resolve(root, '.' + decoded)
  if (!resolved.startsWith(root)) return null
  return resolved
}

export function portalDistExists(id) {
  const spec = PORTALS[id]
  if (!spec) return false
  const index = path.join(portalsRoot(), spec.folder, 'index.html')
  return fs.existsSync(index)
}

function portInUseError(port, cause) {
  const err = new Error(
    `Port ${port} is already in use on 127.0.0.1. Close the other app using that port ` +
      `(installed CRM Admin, another Electron instance, or admin-portal Vite) so this app can serve the local portals/admin build.`,
  )
  err.code = 'EADDRINUSE'
  err.port = port
  err.cause = cause
  return err
}

export function createStaticServer(root, port) {
  const server = http.createServer((req, res) => {
    let file = safeJoin(root, req.url)
    if (!file) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, 'index.html')
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      })
      res.end(data)
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err?.code === 'EADDRINUSE') {
        reject(portInUseError(port, err))
        return
      }
      reject(err)
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

export async function startPortalServers() {
  const servers = []
  for (const spec of Object.values(PORTALS)) {
    const root = path.join(portalsRoot(), spec.folder)
    if (!fs.existsSync(path.join(root, 'index.html'))) continue
    try {
      servers.push(await createStaticServer(root, spec.port))
    } catch (err) {
      for (const started of servers) {
        try {
          started.close()
        } catch {
          /* ignore */
        }
      }
      throw err
    }
  }
  return servers
}

export function portalUrl(id) {
  const spec = PORTALS[id]
  return `http://127.0.0.1:${spec.port}/`
}
