// Serves the built artifact the way Azure Static Web Apps does: with the
// globalHeaders and navigationFallback from staticwebapp.config.json applied.
//
// `vite preview` cannot do this — that configuration is an Azure feature, so the
// production e2e run previously exercised the artifact with no Content-Security-
// Policy at all. A policy that breaks the page then passes CI and only fails on
// the public site. This server closes that gap.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const DEFAULT_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const toRegExp = glob =>
  new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')

export function readReleaseConfig(root) {
  const config = JSON.parse(readFileSync(resolve(root, 'staticwebapp.config.json'), 'utf8'))
  return {
    headers: { ...config.globalHeaders },
    fallback: config.navigationFallback?.rewrite,
    excluded: (config.navigationFallback?.exclude ?? []).map(toRegExp),
    mime: { ...DEFAULT_MIME, ...config.mimeTypes },
  }
}

const readIfPresent = async file => {
  try {
    return await readFile(file)
  } catch {
    return null
  }
}

export function createReleaseServer(root) {
  const { headers, fallback, excluded, mime } = readReleaseConfig(root)
  return createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const relative = normalize(path).replace(/^(\.\.[/\\])+/, '')

    // A real file always wins, exactly as on Azure.
    let file = join(root, relative)
    let body = await readIfPresent(file)
    if (body === null && !relative.endsWith('/')) body = await readIfPresent(join(file, 'index.html'))

    // Otherwise the navigation fallback applies, unless the path is excluded.
    if (body === null && fallback && !excluded.some(pattern => pattern.test(path))) {
      file = join(root, fallback)
      body = await readIfPresent(file)
    }

    if (body === null) {
      response.writeHead(404, headers)
      return response.end('Not found')
    }

    response.writeHead(200, {
      ...headers,
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
    })
    response.end(body)
  })
}

const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const portIndex = process.argv.indexOf('--port')
  const port = Number(portIndex === -1 ? 4189 : process.argv[portIndex + 1])
  const root = resolve(process.cwd(), 'dist')
  await stat(join(root, 'index.html'))
  createReleaseServer(root).listen(port, '127.0.0.1', () => {
    console.log(`release server on http://127.0.0.1:${port} with Azure globalHeaders applied`)
  })
}
