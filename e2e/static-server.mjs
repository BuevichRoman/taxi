/**
 * Отдаёт собранное приложение из `build` с возвратом index.html на
 * неизвестные пути — маршруты вида /driver-order/1 живут в браузере.
 *
 * Своё, а не `serve`, чтобы прогон не тянул лишнюю зависимость.
 */
import { createServer, request } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const root = new URL('../build/', import.meta.url).pathname
const port = Number(process.env.PORT || 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const fileFor = (urlPath) => {
  const relative = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const candidate = join(root, relative)

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return join(root, 'index.html')
}

/**
 * Запросы к API уходят на мок, а браузер видит их со своего origin.
 *
 * Так же устроено боевое размещение — приложение и API на одном хосте, — и
 * это важно не только для CORS: часы сервера читаются из заголовка `Date`
 * ответа (`src/tools/serverClock.ts`), а с чужого origin браузер его не
 * отдаёт без `Access-Control-Expose-Headers`
 */
const MOCK = process.env.MOCK_URL || 'http://localhost:4010'

const proxy = (req, res) => {
  const target = new URL(req.url, MOCK)
  const upstream = request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (answer) => {
      res.writeHead(answer.statusCode || 502, answer.headers)
      answer.pipe(res)
    },
  )

  upstream.on('error', () => {
    res.writeHead(502)
    res.end('мок недоступен')
  })

  req.pipe(upstream)
}

createServer((req, res) => {
  const url = req.url || '/'

  if (url.startsWith('/api/') || url.startsWith('/_test/')) {
    proxy(req, res)
    return
  }

  const file = fileFor(url)
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(port, () => {
  console.log(`Собранное приложение на http://localhost:${port}`)
})
