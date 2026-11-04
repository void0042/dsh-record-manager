import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { RecordsPage, zh, en } from './client.js'

const dict = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase().startsWith('zh') ? zh : en
const t = function (k) { return dict[k] != null ? dict[k] : k }
try { document.title = dict.title || '外置笔记' } catch (err) {}
const root = createRoot(document.getElementById('root'))
root.render(React.createElement(RecordsPage, { t: t }))
