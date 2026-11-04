/**
 * dsh-record-manager —— Host 半
 * 管理一个"记录"目录下的纯文本笔记（.txt/.md）：
 *   - HTTP 路由 /dsh-record-manager/api/*  供 Web 页面调用
 *   - Agent 工具 record_note               供"记一下：…"直接写文件
 *
 * 数据真身是磁盘文件，随时可用外部编辑器打开。一份实现、两处调用。
 *
 * @author local
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * 默认记录根目录：用户主目录下的 dsh-notes（跨平台，可用 cordis.patch.yml 的
 * config.root 或插件内"配置"页覆盖）。
 */
const DEFAULT_ROOT = path.join(os.homedir(), 'dsh-notes')
const DEFAULT_DAILY = '日常/记录.txt'
const MAX_BYTES = 4 * 1024 * 1024
const TRASH_NAME = '.trash'
const HERE = path.dirname(fileURLToPath(import.meta.url))

export const inject = ['webServer', 'tools']

/** 文本工具：UTF-8 读写、原子替换、路径围栏、日期分区追加。 */
export function apply(ctx, config) {
  const cfg = config || {}
  const CFG_ROOT = path.resolve(String(cfg.root || DEFAULT_ROOT))
  const DAILY = String(cfg.dailyFile || DEFAULT_DAILY)
  const SETTINGS_FILE = path.join(CFG_ROOT, '.dsh-record-manager.json')

  /** 读取磁盘上持久化的根目录覆盖（配置页写入）；无或无效则用配置默认值。 */
  function loadRootOverride() {
    try {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
      const obj = JSON.parse(raw)
      if (obj && typeof obj.root === 'string' && obj.root.trim() !== '') return path.resolve(obj.root.trim())
    } catch (err) {}
    return null
  }
  function saveRootOverride(root) {
    const obj = { root: root }
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8')
  }
  function currentRoot() { return ROOT }

  let ROOT = loadRootOverride() || CFG_ROOT

  // 保证记录根目录存在
  try { fs.mkdirSync(ROOT, { recursive: true }) } catch (err) {}

  /** 切换记录根目录：校验可创建/可访问后持久化并生效。返回 {root}。 */
  function setRoot(next) {
    if (typeof next !== 'string' || next.trim() === '') fail('目录不能为空')
    const abs = path.resolve(next.trim())
    if (/^[a-zA-Z]:$/.test(abs)) fail('不能使用盘符根目录')
    try {
      fs.mkdirSync(abs, { recursive: true })
      if (!fs.statSync(abs).isDirectory()) fail('目标不是目录')
    } catch (err) {
      if (err && err.code === 'RECORD') throw err
      fail('无法访问该目录：' + String((err && err.message) || err))
    }
    saveRootOverride(abs)
    ROOT = abs
    return { root: ROOT }
  }

  // ---- 路径与读写 ----
  function fail(message) { const e = new Error(message); e.code = 'RECORD'; throw e }

  /**
   * 跨平台打开一个 URL / 文件（不经过 shell，避免命令注入）。
   * Windows 用 `rundll32 url.dll,FileProtocolHandler`，比 `cmd /c start` 更稳且不需拼接引号。
   */
  function openExternal(target) {
    try {
      const t = String(target)
      if (process.platform === 'win32') {
        execFile('rundll32', ['url.dll,FileProtocolHandler', t], () => {})
      } else if (process.platform === 'darwin') {
        execFile('open', [t], () => {})
      } else {
        execFile('xdg-open', [t], () => {})
      }
    } catch (err) {}
  }

  /** 跨平台在文件管理器中显示一个目录。 */
  function openPath(dir) {
    try {
      const d = String(dir)
      if (process.platform === 'win32') {
        execFile('explorer.exe', [d], () => {})
      } else if (process.platform === 'darwin') {
        execFile('open', [d], () => {})
      } else {
        execFile('xdg-open', [d], () => {})
      }
    } catch (err) {}
  }

  /** 把用户给的相对文件名解析为 ROOT 内的绝对路径，拒绝越界/绝对/非法扩展名。 */
  function safePath(rel) {
    if (typeof rel !== 'string' || rel.trim() === '') fail('缺少文件名')
    if (/^[a-zA-Z]:/.test(rel) || rel.startsWith('\\') || rel.startsWith('/')) fail('不允许绝对路径')
    const abs = path.resolve(ROOT, rel)
    const relative = path.relative(ROOT, abs)
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) fail('路径越界')
    if (!/\.(txt|md)$/i.test(abs)) fail('仅支持 .txt / .md')
    return abs
  }

  /** 解析目录相对路径（不要求扩展名），限定在 ROOT 内；空串/'.' 表示根目录。 */
  function safeDirPath(rel) {
    const r = (typeof rel === 'string' ? rel : '').trim()
    if (r === '' || r === '.') return ROOT
    if (/^[a-zA-Z]:/.test(r) || r.startsWith('\\') || r.startsWith('/')) fail('不允许绝对路径')
    const abs = path.resolve(ROOT, r)
    const relative = path.relative(ROOT, abs)
    if (relative === '') return ROOT
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail('路径越界')
    return abs
  }

  function readNoteText(abs) {
    try {
      const buf = fs.readFileSync(abs)
      if (buf.length > MAX_BYTES) fail('文件超过大小上限')
      return buf.toString('utf8')
    } catch (err) {
      if (err && err.code === 'ENOENT') return ''
      throw err
    }
  }

  function statMs(abs) { try { return fs.statSync(abs).mtimeMs } catch (err) { return 0 } }

  /** 原子写入：先写临时文件再 rename，避免半截文件。 */
  function writeAtomic(abs, text) {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = abs + '.' + process.pid + '.' + Date.now() + '.tmp'
    fs.writeFileSync(tmp, text, { encoding: 'utf8' })
    fs.renameSync(tmp, abs)
  }

  function todayMMDD() {
    const d = new Date()
    return String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  }

  /** 追加到"每日流水"：识别最后一个 MMDD：分区，同日则编号+1，跨日则新起分区。 */
  function appendDailyText(abs, text) {
    const existing = readNoteText(abs)
    const eol = existing.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
    const mmdd = todayMMDD()
    const lines = existing === '' ? [] : existing.split(/\r?\n/)
    let lastHeader = -1
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (/^\d{4}[：:]\s*$/.test(lines[i])) { lastHeader = i; break }
    }
    let out = existing
    if (lastHeader !== -1 && lines[lastHeader].startsWith(mmdd)) {
      // 同日：找该分区内最大编号
      let maxN = 0
      for (let i = lastHeader + 1; i < lines.length; i += 1) {
        const m = /^(\d+)\./.exec(lines[i])
        if (m) maxN = Math.max(maxN, parseInt(m[1], 10))
      }
      if (out !== '' && !out.endsWith('\n')) out += eol
      out += (maxN + 1) + '.' + text + eol
      return out
    }
    // 跨日 / 新文件：空行分隔 + 新日期分区
    if (out !== '' && !out.endsWith('\n')) out += eol
    if (out !== '' && !/\n\s*$/.test(out)) out += eol
    if (out !== '' && !/\r?\n\r?\n$/.test(out)) out += eol
    out += mmdd + '：' + eol + '1.' + text + eol
    return out
  }

  /** 追加到普通笔记：带时间戳的条目前缀。 */
  function appendPlainText(abs, text) {
    const existing = readNoteText(abs)
    const eol = existing.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
    const d = new Date()
    const stamp = todayMMDD() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    let out = existing
    if (out !== '' && !out.endsWith('\n')) out += eol
    out += '- ' + stamp + ' ' + text + eol
    return out
  }

  function appendItem(rel, text) {
    if (typeof text !== 'string' || text.trim() === '') fail('追加内容为空')
    const targetRel = rel && String(rel).trim() !== '' ? String(rel) : DAILY
    const abs = safePath(targetRel)
    const next = targetRel === DAILY ? appendDailyText(abs, text.trim()) : appendPlainText(abs, text.trim())
    writeAtomic(abs, next)
    return { rel: targetRel, text: next, mtimeMs: statMs(abs) }
  }

  function listNotes(dirRel) {
    const dirAbs = safeDirPath(dirRel)
    let entries = []
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }) } catch (err) { return [] }
    const baseRel = path.relative(ROOT, dirAbs).split(path.sep).join('/')
    const out = []
    for (const ent of entries) {
      if (ent.name === TRASH_NAME) continue
      const childAbs = path.join(dirAbs, ent.name)
      const childRel = baseRel ? (baseRel + '/' + ent.name) : ent.name
      let st
      try { st = fs.statSync(childAbs) } catch (err) { continue }
      if (ent.isDirectory()) {
        out.push({ name: ent.name, rel: childRel, type: 'dir', size: 0, mtimeMs: st.mtimeMs })
      } else if (ent.isFile()) {
        if (!/\.(txt|md)$/i.test(ent.name)) continue
        out.push({ name: ent.name, rel: childRel, type: 'file', size: st.size, mtimeMs: st.mtimeMs })
      }
    }
    out.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      if (a.type === 'dir') return a.name.localeCompare(b.name)
      return b.mtimeMs - a.mtimeMs
    })
    return out
  }

  /** 递归构建目录树（文件夹在前，其次按修改时间倒序的文件）。 */
  function buildTree(dirAbs, depth) {
    depth = depth || 0
    if (depth > 8) return []
    let entries = []
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }) } catch (err) { return [] }
    const baseRel = path.relative(ROOT, dirAbs).split(path.sep).join('/')
    const dirs = [], files = []
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === TRASH_NAME) continue
      const childAbs = path.join(dirAbs, ent.name)
      const childRel = baseRel ? (baseRel + '/' + ent.name) : ent.name
      let st
      try { st = fs.statSync(childAbs) } catch (err) { continue }
      if (ent.isDirectory()) {
        dirs.push({ name: ent.name, rel: childRel, type: 'dir', size: 0, mtimeMs: st.mtimeMs, children: buildTree(childAbs, depth + 1) })
      } else if (ent.isFile() && /\.(txt|md)$/i.test(ent.name)) {
        files.push({ name: ent.name, rel: childRel, type: 'file', size: st.size, mtimeMs: st.mtimeMs })
      }
    }
    dirs.sort(function (a, b) { return a.name.localeCompare(b.name) })
    files.sort(function (a, b) { return b.mtimeMs - a.mtimeMs })
    return dirs.concat(files)
  }

  function relOf(abs) { return path.relative(ROOT, abs).split(path.sep).join('/') }

  /** 递归遍历记录根下的 .txt/.md 文件（跳过 node_modules/.git），对每个文件回调。 */
  function walkFiles(dirAbs, cb) {
    let entries = []
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }) } catch (err) { return }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === TRASH_NAME) continue
      const childAbs = path.join(dirAbs, ent.name)
      if (ent.isDirectory()) { walkFiles(childAbs, cb) }
      else if (ent.isFile() && /\.(txt|md)$/i.test(ent.name)) { cb(childAbs) }
    }
  }

  /** 全文搜索：返回命中「文件:行号:内容」列表（上限 1000 条）。 */
  function textSearch(q, opts) {
    opts = opts || {}
    const caseSensitive = !!opts.caseSensitive
    const useRegex = !!opts.regex
    const whole = !!opts.whole
    let re = null
    let needle = ''
    if (useRegex) {
      try { re = new RegExp(q, caseSensitive ? 'g' : 'gi') } catch (err) { fail('正则无效：' + String(err.message || err)) }
    } else {
      needle = caseSensitive ? q : q.toLowerCase()
      if (whole) {
        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        try { re = new RegExp('\\b' + esc + '\\b', caseSensitive ? 'g' : 'gi') } catch (err) { re = null }
      }
    }
    const results = []
    let total = 0
    walkFiles(ROOT, function (abs) {
      let txt
      try { txt = readNoteText(abs) } catch (err) { return }
      const lines = txt.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        let hit = false
        if (re) { re.lastIndex = 0; hit = re.test(lines[i]) }
        else { const hay = caseSensitive ? lines[i] : lines[i].toLowerCase(); hit = hay.indexOf(needle) !== -1 }
        if (hit) {
          total += 1
          if (results.length < 1000) results.push({ rel: relOf(abs), name: path.basename(abs), line: i + 1, text: lines[i].slice(0, 300) })
        }
      }
    })
    return { results: results, total: total }
  }

  // ---- 回收站（删除 = 移入 ROOT/.trash，可恢复）----
  function trashDirAbs() { const d = path.join(ROOT, TRASH_NAME); fs.mkdirSync(d, { recursive: true }); return d }

  function moveToTrash(abs, rel) {
    const dir = trashDirAbs()
    const name = Date.now() + '_' + encodeURIComponent(rel)
    fs.renameSync(abs, path.join(dir, name))
    return name
  }

  function listTrash() {
    const dir = path.join(ROOT, TRASH_NAME)
    let names = []
    try { names = fs.readdirSync(dir) } catch (err) { return [] }
    const out = []
    for (const name of names) {
      const i = name.indexOf('_')
      if (i <= 0) continue
      const ts = parseInt(name.slice(0, i), 10)
      if (!ts) continue
      let rel = ''
      try { rel = decodeURIComponent(name.slice(i + 1)) } catch (err) { rel = name.slice(i + 1) }
      let st
      try { st = fs.statSync(path.join(dir, name)) } catch (err) { continue }
      out.push({ name: name, rel: rel, trashedAt: ts, mtimeMs: st.mtimeMs, size: st.size })
    }
    out.sort(function (a, b) { return b.trashedAt - a.trashedAt })
    return out
  }

  function restoreFromTrash(name) {
    const raw = String(name || '')
    const base = path.basename(raw)
    if (!base || base !== raw) fail('非法回收站条目')
    const i = base.indexOf('_')
    if (i <= 0) fail('非法回收站条目')
    let rel = ''
    try { rel = decodeURIComponent(base.slice(i + 1)) } catch (err) { fail('非法回收站条目') }
    const abs = safePath(rel)
    if (fs.existsSync(abs)) fail('目标文件已存在，无法恢复')
    const src = path.join(ROOT, TRASH_NAME, base)
    if (!fs.existsSync(src)) fail('回收站条目不存在')
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.renameSync(src, abs)
    return rel
  }

  // ---- HTTP 层 ----
  function sendJson(res, code, obj) {
    try {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(obj))
    } catch (err) {}
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > MAX_BYTES) { reject(new Error('请求体过大')); req.destroy() }
      })
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })
  }

  /** 轻量同源/回环校验：拒绝跨站与不同源写请求。 */
  function rejected(req) {
    try {
      const headers = req.headers || {}
      const site = String(headers['sec-fetch-site'] || '').toLowerCase()
      if (site === 'cross-site') return true
      const origin = headers.origin
      if (typeof origin === 'string' && origin && origin !== 'null') {
        const host = String(headers.host || '')
        let oh = ''
        try { oh = new URL(origin).host } catch (err) { return true }
        if (oh && oh !== host) return true
      }
      return false
    } catch (err) { return true }
  }

  async function handle(req, res) {
    if (rejected(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' })
    let url
    try { url = new URL(req.url || '/', 'http://localhost') } catch (err) { return sendJson(res, 400, { ok: false, error: 'bad url' }) }
    const route = url.pathname.replace(/^\/dsh-record-manager\/api/, '')
    const method = String(req.method || 'GET').toUpperCase()
    try {
      if (method === 'GET' && route === '/tree') {
        return sendJson(res, 200, { ok: true, root: ROOT, dailyFile: DAILY, nodes: buildTree(ROOT, 0) })
      }
      if (method === 'GET' && route === '/list') {
        const dirRel = url.searchParams.get('dir') || ''
        return sendJson(res, 200, { ok: true, root: ROOT, dailyFile: DAILY, dir: dirRel, files: listNotes(dirRel) })
      }
      if (method === 'GET' && route === '/read') {
        const rel = url.searchParams.get('rel') || ''
        const abs = safePath(rel)
        return sendJson(res, 200, { ok: true, rel, text: readNoteText(abs), mtimeMs: statMs(abs) })
      }
      if (method === 'GET' && route === '/stat') {
        const rel = url.searchParams.get('rel') || ''
        const abs = safePath(rel)
        let size = 0
        try { size = fs.statSync(abs).size } catch (err) { return sendJson(res, 200, { ok: true, exists: false, mtimeMs: 0, size: 0 }) }
        return sendJson(res, 200, { ok: true, exists: true, rel, mtimeMs: statMs(abs), size })
      }
      if (method === 'GET' && route === '/search') {
        const q = url.searchParams.get('q') || ''
        if (!q.trim()) return sendJson(res, 200, { ok: true, total: 0, results: [] })
        const found = textSearch(q, {
          caseSensitive: url.searchParams.get('case') === '1',
          regex: url.searchParams.get('regex') === '1',
          whole: url.searchParams.get('whole') === '1',
        })
        return sendJson(res, 200, { ok: true, total: found.total, results: found.results })
      }
      if (method === 'POST' && route === '/write') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const abs = safePath(body.rel)
        const text = typeof body.text === 'string' ? body.text : ''
        if (text.length > MAX_BYTES) fail('内容超过大小上限')
        if (typeof body.expectedMtimeMs === 'number') {
          if (!fs.existsSync(abs)) return sendJson(res, 200, { ok: false, conflict: true, reason: 'missing' })
          const cur = statMs(abs)
          if (Math.abs(cur - body.expectedMtimeMs) > 1) return sendJson(res, 200, { ok: false, conflict: true, reason: 'changed', mtimeMs: cur })
        }
        writeAtomic(abs, text)
        return sendJson(res, 200, { ok: true, rel: body.rel, mtimeMs: statMs(abs) })
      }
      if (method === 'POST' && route === '/append') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const targetRel = body.rel && String(body.rel).trim() !== '' ? String(body.rel) : DAILY
        if (typeof body.expectedMtimeMs === 'number') {
          const abs0 = safePath(targetRel)
          if (fs.existsSync(abs0)) {
            const cur = statMs(abs0)
            if (Math.abs(cur - body.expectedMtimeMs) > 1) return sendJson(res, 200, { ok: false, conflict: true, reason: 'changed', mtimeMs: cur })
          }
        }
        return sendJson(res, 200, { ok: true, ...appendItem(body.rel, body.text) })
      }
      if (method === 'POST' && route === '/create') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const abs = safePath(body.rel)
        if (fs.existsSync(abs)) fail('文件已存在')
        writeAtomic(abs, '')
        return sendJson(res, 200, { ok: true, rel: body.rel })
      }
      if (method === 'POST' && route === '/mkdir') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const abs = safeDirPath(body.rel)
        if (abs === ROOT) fail('无效目录名')
        if (fs.existsSync(abs)) fail('目录已存在')
        fs.mkdirSync(abs, { recursive: false })
        return sendJson(res, 200, { ok: true, rel: body.rel })
      }
      if (method === 'POST' && route === '/delete') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const abs = safePath(body.rel)
        const trashed = moveToTrash(abs, String(body.rel))
        return sendJson(res, 200, { ok: true, rel: body.rel, trash: trashed })
      }
      if (method === 'GET' && route === '/trash/list') {
        return sendJson(res, 200, { ok: true, entries: listTrash() })
      }
      if (method === 'POST' && route === '/trash/restore') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const rel = restoreFromTrash(body.name)
        return sendJson(res, 200, { ok: true, rel: rel })
      }
      if (method === 'GET' && route === '/open-popout') {
        const raw = String(req.headers.host || '')
        const host = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(raw) ? raw : '127.0.0.1:' + (process.env.DSH_WEB_PORT || '33920')
        const target = 'http://' + host + '/dsh-record-manager/popout'
        openExternal(target)
        return sendJson(res, 200, { ok: true, url: target })
      }
      if (method === 'GET' && route === '/reveal') {
        openPath(ROOT)
        return sendJson(res, 200, { ok: true, root: ROOT })
      }
      if (method === 'GET' && route === '/config') {
        return sendJson(res, 200, { ok: true, root: ROOT, configRoot: CFG_ROOT, dailyFile: DAILY })
      }
      if (method === 'POST' && route === '/config') {
        const body = JSON.parse((await readBody(req)) || '{}')
        const r = setRoot(body.root)
        return sendJson(res, 200, { ok: true, root: r.root })
      }
      return sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: String((err && err.message) || err) })
    }
  }

  const apiRoutes = ['', '/tree', '/list', '/read', '/stat', '/search', '/write', '/append', '/create', '/mkdir', '/delete', '/trash/list', '/trash/restore', '/reveal', '/open-popout', '/config']
  ctx.effect(() => {
    const disposers = apiRoutes.map((p) => ctx.webServer.register({ kind: 'exact', path: '/dsh-record-manager/api' + p, handler: handle }))
    return () => { for (const d of disposers) { try { d() } catch (err) {} } }
  }, 'record-manager: api')

  // ---- 独立窗口（popout）：独立 HTML + 打包好的前端 ----
  const popoutHtml = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>外置笔记</title><style>html,body,#root{height:100%;margin:0}body{background:#fff;font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif}</style></head><body><div id="root"></div><script src="/dsh-record-manager/popout.js"></script></body></html>'
  function servePopoutPage(req, res) {
    try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(popoutHtml) } catch (err) {}
  }
  function servePopoutJs(req, res) {
    try {
      const buf = fs.readFileSync(path.join(HERE, 'popout.js'))
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(buf)
    } catch (err) { try { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('popout.js not built') } catch (_) {} }
  }
  ctx.effect(() => {
    const d1 = ctx.webServer.register({ kind: 'exact', path: '/dsh-record-manager/popout', handler: servePopoutPage })
    const d2 = ctx.webServer.register({ kind: 'exact', path: '/dsh-record-manager/popout.js', handler: servePopoutJs })
    return () => { try { d1() } catch (err) {} try { d2() } catch (err) {} }
  }, 'record-manager: popout')

  // ---- Agent 工具：一份实现、两处调用 ----
  const toolParameters = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['append', 'list', 'read', 'create'], description: '操作类型' },
      text: { type: 'string', description: 'append/list 之外不需要；append 时要追加的文本' },
      rel: { type: 'string', description: '目标文件名（相对记录目录）。append 缺省为每日流水' },
      target: { type: 'string', description: '与 rel 相同（兼容字段）' },
    },
    required: ['action'],
    additionalProperties: false,
  }

  // 注意：tools.register 的 description 必须是字符串。它会被原样写进
  // request/header 事件（tools[].description），若为函数则不满足 lossless JSON，
  // 在 session.append("request/header") 处抛
  // 'session event "request/header" carries non-JSON-serializable data'。
  // 故这里用静态字符串（不含会变化的 ROOT），目录信息由 action=list 返回。
  ctx.effect(() => ctx.tools.register({
    name: 'record_note',
    description: '管理 dsh-record-manager 插件里的纯文本笔记（记录目录下的 .txt/.md）。'
      + 'action=append 追加一条（缺省写到每日流水，自动编号/补日期）；'
      + 'action=list 列出记录文件（含当前目录）；action=read 读取文件文本；action=create 新建空文件。'
      + '用户说"记一下：…"时用 append。',
    parameters: toolParameters,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const rel = args.rel || args.target
      if (args.action === 'append') {
        return JSON.stringify({ ok: true, ...appendItem(rel, args.text) })
      }
      if (args.action === 'list') {
        return JSON.stringify({ ok: true, root: ROOT, files: listNotes() })
      }
      if (args.action === 'read') {
        const abs = safePath(rel)
        return JSON.stringify({ ok: true, rel, text: readNoteText(abs), mtimeMs: statMs(abs) })
      }
      if (args.action === 'create') {
        const abs = safePath(rel)
        if (fs.existsSync(abs)) throw new Error('文件已存在')
        writeAtomic(abs, '')
        return JSON.stringify({ ok: true, rel })
      }
      throw new Error('未知 action：' + String(args.action))
    },
  }), 'record-manager: tool')

  try { console.log('[dsh-record-manager] ready, root=' + ROOT) } catch (err) {}
}
