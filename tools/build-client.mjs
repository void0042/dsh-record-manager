import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 相对本仓库根目录解析，保证跨机器/跨平台可用
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src', 'client.js')
const OUT = path.join(ROOT, 'client.js')

const result = await build({
  entryPoints: [SRC],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  // 由 DSH ModuleLoader 在运行时注入 require 的共享模块
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
  write: false,
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  charset: 'utf8',
})

const code = result.outputFiles[0].text
const banner = "window.__ModuleLoader__.load({\n  id: 'dsh-record-manager',\n  factory(require) {\n    var module = { exports: {} };\n    var exports = module.exports;\n    (function (module, exports, require) {\n"
const footer = "\n    })(module, exports, require);\n    return module.exports;\n  },\n});\n"
const out = banner + code + footer
fs.writeFileSync(OUT, out)
console.log('built ' + OUT + ' bytes=' + Buffer.byteLength(out, 'utf8'))
