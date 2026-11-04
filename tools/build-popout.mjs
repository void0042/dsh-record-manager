import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 相对本仓库根目录解析，保证跨机器/跨平台可用
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'popout.js')
const result = await build({
  entryPoints: [path.join(ROOT, 'src', 'popout.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  write: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
})
const code = result.outputFiles[0].text
fs.writeFileSync(OUT, code)
console.log('built ' + OUT + ' bytes=' + Buffer.byteLength(code, 'utf8'))
