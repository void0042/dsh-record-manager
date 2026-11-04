/**
 * dsh-record-manager —— Client 半（浏览器，CodeMirror 6 内核）
 * 左导航「记录」独立整页：目录树 + 速记 + CodeMirror 编辑器 + 查找/替换 + 跳行 + 设置 + 自动保存。
 * 打包：tools/build-client.mjs（esbuild，react/@deepseek-ai 外部，@codemirror 内联）→ client.js。
 */
import * as React from 'react'
import { EditorState, Compartment, StateField, StateEffect } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, gutter, GutterMarker, Decoration, ViewPlugin } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from '@codemirror/search'

const NS = 'record.manager'
const PANEL_ID = 'records'
const API = '/dsh-record-manager/api'
const EXPAND_KEY = 'dsh-record-manager:expanded'
const LASTFILE_KEY = 'dsh-record-manager:lastFile'
const TABS_KEY = 'dsh-record-manager:tabs'
const RECENT_KEY = 'dsh-record-manager:recent'
const SETTINGS_KEY = 'dsh-record-manager:settings'
const DRAFT_PREFIX = 'dsh-record-manager:draft:'
const LARGE_FILE_CHARS = 1500000

const zh = {
  panel: '外置笔记', title: '外置笔记', newFile: '新建', refresh: '刷新', search: '搜索', popout: '独立窗口',
  openFolder: '打开文件夹', capturePh: '记一笔，回车追加…', append: '追加',
  save: '保存', unsaved: '未保存', saved: '已保存', saving: '保存中…',
  empty: '还没有记录文件', noFiles: '无文件', selectHint: '从左侧选择文件，或直接在下方速记',
  confirmDelete: '确定删除该文件？', appended: '已追加',
  newFolder: '新建文件夹', all: '全部', emptyDir: '此文件夹为空',
  find: '查找', goto: '跳转行', settings: '设置', wrap: '自动换行', autosave: '自动保存', showCapture: '显示追加框',
  font: '字号', tabSize: 'Tab 宽度', gotoPh: '输入行号', largeFile: '大文件，已切换为只读',
  del: '删除', trash: '回收站', restore: '恢复', cancel: '取消', create: '创建', close: '关闭',
}
const MENU_NS = 'record.note.menu'
const menuZh = { section: '外置笔记', empty: '没有匹配的笔记' }
const menuEn = { section: 'Notes', empty: 'No matching notes' }

const en = {
  panel: 'External Notes', title: 'External Notes', newFile: 'New', refresh: 'Refresh', search: 'Search', popout: 'Pop out',
  openFolder: 'Open folder', capturePh: 'Jot a note, Enter to append…', append: 'Append',
  save: 'Save', unsaved: 'Unsaved', saved: 'Saved', saving: 'Saving…',
  empty: 'No record files yet', noFiles: 'No files', selectHint: 'Pick a file on the left, or capture below',
  confirmDelete: 'Delete this file?', appended: 'Appended',
  newFolder: 'New folder', all: 'All', emptyDir: 'This folder is empty',
  find: 'Find', goto: 'Go to line', settings: 'Settings', wrap: 'Wrap', autosave: 'Autosave', showCapture: 'Show capture box',
  font: 'Font', tabSize: 'Tab size', gotoPh: 'Line number', largeFile: 'Large file: read-only',
  del: 'Delete', trash: 'Trash', restore: 'Restore', cancel: 'Cancel', create: 'Create', close: 'Close',
}

const tok = (name, fallback) => 'var(--dsw-alias-' + name + ', ' + fallback + ')'

async function api(path, opts) {
  try {
    const res = await fetch(API + path, opts)
    const json = await res.json().catch(function () { return { ok: false, error: 'bad-json' } })
    return json
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  }
}

function draftKey(rel) { return DRAFT_PREFIX + rel }
function clearDraft(rel) { try { window.localStorage.removeItem(draftKey(rel)) } catch (_) {} }

function RecordsIcon() {
  return React.createElement('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': true, style: { display: 'block' } },
    React.createElement('path', { d: 'M7 3 H15 L19 7 V19 A2 2 0 0 1 17 21 H7 A2 2 0 0 1 5 19 V5 A2 2 0 0 1 7 3 Z', fill: '#2f80ed' }),
    React.createElement('path', { d: 'M15 3 L19 7 H15 Z', fill: '#7db4f5' }),
    React.createElement('rect', { x: 8.5, y: 9, width: 7, height: 2, rx: 1, fill: '#ffffff' }),
    React.createElement('rect', { x: 11, y: 9, width: 2, height: 8, rx: 1, fill: '#ffffff' })
  )
}

const MONO = 'ui-monospace, Consolas, "Cascadia Code", monospace'

function fontTheme(fontSize) {
  return {
    '&': { height: '100%', fontSize: fontSize + 'px', border: 'none', outline: 'none', borderRadius: 0 },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { overflow: 'auto', fontFamily: MONO, lineHeight: '1.65' },
    '.cm-content': { padding: '12px 0 45vh', minWidth: '0', caretColor: tok('label-primary', '#eaeaea'), outline: 'none' },
    '&.cm-focused .cm-content': { outline: 'none' },
    '&.cm-focused .cm-scroller': { outline: 'none' },
    '.cm-line': { padding: '0 16px' },
    '.cm-date': { color: '#3b6ef0', fontWeight: '600' },
    '.cm-seq': { color: '#a06a00', fontWeight: '600' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: tok('label-tertiary', '#8a8a8a') },
    '.cm-activeLine': { backgroundColor: 'rgba(59,110,240,0.07)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(59,110,240,0.10)', color: tok('label-primary', '#eaeaea') },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(59,110,240,0.28) !important' },
    '.cm-searchMatch': { backgroundColor: 'rgba(224,175,104,0.35)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(59,110,240,0.45)' },
    '.cm-panels': { backgroundColor: tok('bg-elevated', '#f5f6f8'), color: tok('label-primary', '#eaeaea') },
    '.cm-panels.cm-panels-top': { borderBottom: '0.5px solid ' + tok('border-l3', '#333') },
    '.cm-textfield': { background: tok('bg-base', '#fff'), color: 'inherit', border: '1px solid ' + tok('border-l3', '#ccc'), borderRadius: 6, padding: '2px 6px' },
    '.cm-button': { background: tok('interactive-bg-hover', '#eee'), color: 'inherit', border: '1px solid ' + tok('border-l3', '#ccc'), borderRadius: 6, backgroundImage: 'none' },
  }
}

// —— 书签（行标记）——
const toggleBookmarkEffect = StateEffect.define()
const bookmarkField = StateField.define({
  create: function () { return new Set() },
  update: function (set, tr) {
    const next = new Set()
    set.forEach(function (pos) { next.add(tr.changes.mapPos(pos, 1)) })
    for (const e of tr.effects) {
      if (e.is(toggleBookmarkEffect)) {
        const line = tr.state.doc.lineAt(e.value)
        let found = null
        next.forEach(function (p) { if (p >= line.from && p <= line.to) found = p })
        if (found === null) next.add(line.from)
        else next.delete(found)
      }
    }
    return next
  },
})
class BookmarkMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div')
    el.textContent = '●'
    el.style.cssText = 'color:#e0af68;font-size:12px;line-height:1;width:10px;text-align:center'
    return el
  }
}
const bookmarkMarker = new BookmarkMarker()
const bookmarkGutter = gutter({
  class: 'cm-bookmarkGutter',
  lineMarker: function (view, line) {
    const set = view.state.field(bookmarkField)
    let has = false
    set.forEach(function (p) { if (p >= line.from && p <= line.to) has = true })
    return has ? bookmarkMarker : null
  },
})
function toggleBookmark(view) {
  view.dispatch({ effects: toggleBookmarkEffect.of(view.state.selection.main.head) })
}
function gotoNextBookmark(view, dir) {
  const set = view.state.field(bookmarkField)
  if (!set.size) return
  const cur = view.state.selection.main.head
  const arr = Array.from(set).sort(function (a, b) { return a - b })
  let target = null
  if (dir > 0) { for (const p of arr) { if (p > cur) { target = p; break } } if (target === null) target = arr[0] }
  else { for (let i = arr.length - 1; i >= 0; i -= 1) { if (arr[i] < cur) { target = arr[i]; break } } if (target === null) target = arr[arr.length - 1] }
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true })
  view.focus()
}

// —— 日期 / 序号 着色（CodeMirror 装饰，替代原 textarea 的 colorize）——
function buildColorDecorations(view) {
  const items = []
  const docLen = view.state.doc.length
  for (const r of view.visibleRanges) {
    let pos = r.from
    while (pos <= r.to) {
      const line = view.state.doc.lineAt(pos)
      const text = line.text
      const dm = text.match(/^(\s*)(\d{3,4})(\s*[：:])/)
      const bm = dm ? null : text.match(/^(\s*[-*+]\s+)(\d{3,4})(\s+\d{1,2}:\d{2})?/)
      if (dm) { const s = line.from + dm[1].length; items.push(Decoration.mark({ class: 'cm-date' }).range(s, s + dm[2].length)) }
      else if (bm) { const s = line.from + bm[1].length; items.push(Decoration.mark({ class: 'cm-date' }).range(s, s + bm[2].length)) }
      if (!dm) { const sm = text.match(/^(\s*)(\d+)([.、])/); if (sm) { const s = line.from + sm[1].length; items.push(Decoration.mark({ class: 'cm-seq' }).range(s, s + sm[2].length)) } }
      if (line.to >= docLen) break
      pos = line.to + 1
    }
  }
  return Decoration.set(items, true)
}
const colorPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildColorDecorations(view) }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = buildColorDecorations(u.view) }
}, { decorations: function (v) { return v.decorations } })

function CodeEditor(props) {
  const hostRef = React.useRef(null)
  const cb = React.useRef({ onDocChanged: props.onDocChanged, onSelection: props.onSelection })
  cb.current = { onDocChanged: props.onDocChanged, onSelection: props.onSelection }
  const suppress = React.useRef(false)
  const comps = React.useRef({ fontSize: new Compartment(), tab: new Compartment(), wrap: new Compartment(), editable: new Compartment() })
  const settings = props.settings || {}
  const readOnly = !!props.readOnly

  const emit = function (state) {
    try {
      const sel = state.selection.main
      const line = state.doc.lineAt(sel.head)
      cb.current.onSelection && cb.current.onSelection({ line: line.number, col: sel.head - line.from + 1, sel: sel.to - sel.from, chars: state.doc.length, lines: state.doc.lines })
    } catch (_) {}
  }

  const baseExts = function () {
    return [
      bookmarkGutter, bookmarkField,
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
      history(), drawSelection(),
      highlightSelectionMatches(),
      colorPlugin,
      search({ top: false }),
      keymap.of([
        { key: 'Ctrl-F2', run: function (v) { toggleBookmark(v); return true } },
        { key: 'F2', run: function (v) { gotoNextBookmark(v, 1); return true } },
        { key: 'Shift-F2', run: function (v) { gotoNextBookmark(v, -1); return true } },
        ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab,
      ]),
      EditorView.updateListener.of(function (u) {
        if (suppress.current) return
        if (u.docChanged) cb.current.onDocChanged && cb.current.onDocChanged(u.state.doc.toString())
        if (u.docChanged || u.selectionSet) emit(u.state)
      }),
      comps.current.fontSize.of(EditorView.theme(fontTheme(settings.fontSize || 15), { dark: false })),
      comps.current.tab.of(EditorState.tabSize.of(settings.tabSize || 4)),
      comps.current.wrap.of(settings.lineWrapping ? EditorView.lineWrapping : []),
      comps.current.editable.of(EditorView.editable.of(!readOnly)),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
    ]
  }

  React.useEffect(function () {
    const view = new EditorView({ parent: hostRef.current, state: EditorState.create({ doc: props.initialDoc || '', extensions: baseExts() }) })
    props.viewRef.current = view
    try { view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true }) } catch (_) {}
    emit(view.state)
    return function () { view.destroy(); props.viewRef.current = null }
  }, [])

  const first = React.useRef(true)
  React.useEffect(function () {
    if (first.current) { first.current = false; return }
    const v = props.viewRef.current; if (!v) return
    suppress.current = true
    v.setState(EditorState.create({ doc: props.initialDoc || '', extensions: baseExts() }))
    try { v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true }) } catch (_) {}
    suppress.current = false
    emit(v.state)
  }, [props.docVersion])

  React.useEffect(function () {
    const v = props.viewRef.current; if (!v) return
    v.dispatch({ effects: [
      comps.current.fontSize.reconfigure(EditorView.theme(fontTheme(settings.fontSize || 15), { dark: false })),
      comps.current.tab.reconfigure(EditorState.tabSize.of(settings.tabSize || 4)),
      comps.current.wrap.reconfigure(settings.lineWrapping ? EditorView.lineWrapping : []),
      comps.current.editable.reconfigure(EditorView.editable.of(!readOnly)),
    ] })
  }, [settings.fontSize, settings.tabSize, settings.lineWrapping, readOnly])

  return React.createElement('div', { ref: hostRef, style: { flex: 1, minWidth: 0, width: '100%', minHeight: 0, boxSizing: 'border-box', overflow: 'hidden', display: 'flex', border: '1px solid #b9c0c9', borderRadius: 8, background: tok('bg-base', '#ffffff') } })
}

export function RecordsPage(props) {
  return React.createElement(PageBoundary, null, React.createElement(RecordsPageInner, props))
}

class PageBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null, info: '' }
  }
  static getDerivedStateFromError(err) {
    return { err: err }
  }
  componentDidCatch(err, info) {
    this.setState({ info: (info && info.componentStack) || '' })
    try { console.error('[dsh-record-manager] page crashed:', err, info) } catch (_) {}
  }
  render() {
    if (this.state.err) {
      const e = this.state.err
      const text = (e && (e.stack || e.message)) || String(e)
      return React.createElement('div', {
        style: { padding: '18px 20px', fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 12, color: '#b42318', background: '#fff5f5', height: '100%', overflow: 'auto', boxSizing: 'border-box' },
      },
        React.createElement('div', { style: { fontWeight: 700, marginBottom: 8, fontSize: 14 } }, '外置笔记页面渲染出错（已捕获）'),
        React.createElement('div', { style: { color: '#5a6068', marginBottom: 10 } }, '请把下面这段报错发给开发定位：'),
        React.createElement('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, color: '#1c1f23' } }, text + (this.state.info ? '\n\n' + this.state.info : '')))
    }
    return this.props.children
  }
}

function RecordsPageInner(props) {
  const t = (props && props.t) || function (k) { return k }
  const [tree, setTree] = React.useState([])
  const [expanded, setExpanded] = React.useState({})
  const [newParent, setNewParent] = React.useState('')
  const [selected, setSelected] = React.useState('')
  const [docText, setDocText] = React.useState('')
  const [docVersion, setDocVersion] = React.useState(0)
  const [dirty, setDirty] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [capture, setCapture] = React.useState('')
  const [msg, setMsg] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [caret, setCaret] = React.useState({ line: 1, col: 1, sel: 0, chars: 0, lines: 1 })
  const [newOpen, setNewOpen] = React.useState(false)
  const [newName, setNewName] = React.useState('新记录.txt')
  const [newIsDir, setNewIsDir] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState('')
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [rootPath, setRootPath] = React.useState('')
  const [rootInput, setRootInput] = React.useState('')
  const [rootBusy, setRootBusy] = React.useState(false)
  const [gotoOpen, setGotoOpen] = React.useState(false)
  const [gotoVal, setGotoVal] = React.useState('')
  const [readOnly, setReadOnly] = React.useState(false)
  const [ftMode, setFtMode] = React.useState(false)
  const [ftResults, setFtResults] = React.useState([])
  const [ftTotal, setFtTotal] = React.useState(0)
  const [ftBusy, setFtBusy] = React.useState(false)
  const [external, setExternal] = React.useState(false)
  const [tabs, setTabs] = React.useState([])
  const [recent, setRecent] = React.useState(function () {
    try { return JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]') || [] } catch (_) { return [] }
  })
  const [settings, setSettings] = React.useState(function () {
    const def = { fontSize: 15, tabSize: 4, lineWrapping: true, autosave: true, showCapture: true }
    try { return Object.assign(def, JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}')) } catch (_) { return def }
  })

  const [conflict, setConflict] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [trashOpen, setTrashOpen] = React.useState(false)
  const [trashItems, setTrashItems] = React.useState([])

  const viewRef = React.useRef(null)
  const selectedRef = React.useRef(selected); selectedRef.current = selected
  const dirtyRef = React.useRef(dirty); dirtyRef.current = dirty
  const newIsDirRef = React.useRef(newIsDir); newIsDirRef.current = newIsDir
  const newParentRef = React.useRef(newParent); newParentRef.current = newParent
  const expandedHydratedRef = React.useRef(false)
  const tabsHydratedRef = React.useRef(false)
  const restoredRef = React.useRef(false)
  const autosaveTimer = React.useRef(null)
  const settingsRef = React.useRef(settings); settingsRef.current = settings
  const loadedMtimeRef = React.useRef(0)
  const statMtimeRef = React.useRef(0)
  const buffersRef = React.useRef({})
  const conflictRef = React.useRef(null); conflictRef.current = conflict
  const draftTimer = React.useRef(null)

  const loadList = React.useCallback(async function () {
    const r = await api('/tree')
    if (r.ok) {
      if (r.root) { setRootPath(r.root); ctxRootRel = null }
      const nodes = r.nodes || []
      setTree(nodes); setLoaded(true)
      let saved = null
      try { saved = JSON.parse(window.localStorage.getItem(EXPAND_KEY) || 'null') } catch (_) { saved = null }
      const base = (saved && typeof saved === 'object') ? saved : {}
      const next = {}
      const walk = function (list) {
        list.forEach(function (nd) {
          if (nd.type === 'dir') { next[nd.rel] = (nd.rel in base) ? !!base[nd.rel] : true; walk(nd.children || []) }
        })
      }
      walk(nodes)
      expandedHydratedRef.current = true
      setExpanded(next)
    } else { setMsg(r.error || 'tree failed') }
  }, [])
  const toggleDir = React.useCallback(function (rel) { setExpanded(function (m) { const n = Object.assign({}, m); n[rel] = !n[rel]; return n }) }, [])
  // 供 window 事件监听使用：必须在依赖它的 effect 之前声明（否则 const 存在 TDZ，
  // 触发 "Cannot access '<x>' before initialization"）。
  const openConfigRef = React.useRef(null)

  React.useEffect(function () { loadList() }, [loadList])
  React.useEffect(function () {
    function onOpenConfig() { if (openConfigRef.current) openConfigRef.current() }
    try { window.addEventListener('dsh-record-manager:open-config', onOpenConfig) } catch (_) {}
    return function () { try { window.removeEventListener('dsh-record-manager:open-config', onOpenConfig) } catch (_) {} }
  }, [])
  React.useEffect(function () {
    if (!expandedHydratedRef.current) return
    try { window.localStorage.setItem(EXPAND_KEY, JSON.stringify(expanded)) } catch (_) {}
  }, [expanded])
  React.useEffect(function () {
    if (!selected) return
    try { window.localStorage.setItem(LASTFILE_KEY, selected) } catch (_) {}
  }, [selected])
  React.useEffect(function () {
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch (_) {}
  }, [settings])
  React.useEffect(function () {
    if (!tabsHydratedRef.current) return
    try { window.localStorage.setItem(TABS_KEY, JSON.stringify(tabs)) } catch (_) {}
  }, [tabs])

  const doSave = React.useCallback(async function (force) {
    const v = viewRef.current
    if (!selectedRef.current || !v) return
    if (conflictRef.current && !force) { setMsg('存在保存冲突，请先处理'); return }
    setSaving(true)
    const txt = v.state.doc.toString()
    const payload = { rel: selectedRef.current, text: txt }
    if (!force && statMtimeRef.current) payload.expectedMtimeMs = statMtimeRef.current
    const r = await api('/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setSaving(false)
    if (r.ok) {
      setDirty(false); setMsg(t('saved')); setConflict(null)
      if (r.mtimeMs) { loadedMtimeRef.current = r.mtimeMs; statMtimeRef.current = r.mtimeMs }
      const cur = selectedRef.current
      if (cur) { buffersRef.current[cur] = { text: null, mtimeMs: r.mtimeMs || loadedMtimeRef.current, dirty: false }; clearDraft(cur) }
    } else if (r.conflict) {
      setConflict({ mtimeMs: r.mtimeMs || 0, reason: r.reason || '' })
      setMsg('文件已在外部被修改，未保存')
    } else setMsg(r.error || 'save failed')
  }, [t])
  const saveRef = React.useRef(doSave); saveRef.current = doSave

  const resetDoc = function (rel, text, mtimeMs, isDirty) {
    setSelected(rel); setDocText(text || ''); setDocVersion(function (v) { return v + 1 }); setDirty(!!isDirty)
    loadedMtimeRef.current = mtimeMs || 0
    statMtimeRef.current = mtimeMs || 0
    setExternal(false); setDraft(null); setConflict(null)
    const large = (text || '').length > LARGE_FILE_CHARS
    setReadOnly(large)
    if (large) setMsg(t('largeFile'))
  }

  const openFile = React.useCallback(async function (rel, force) {
    if (!rel) return
    const cur = selectedRef.current
    const v = viewRef.current
    if (cur && cur !== rel && v) { buffersRef.current[cur] = { text: dirtyRef.current ? v.state.doc.toString() : null, mtimeMs: loadedMtimeRef.current, dirty: dirtyRef.current } }
    if (cur && cur !== rel && dirtyRef.current) { await saveRef.current() }
    setTabs(function (list) { return list.indexOf(rel) === -1 ? list.concat([rel]) : list })
    const buf = buffersRef.current[rel]
    if (buf && !force && buf.text != null) { resetDoc(rel, buf.text, buf.mtimeMs, buf.dirty); setMsg(''); return }
    const r = await api('/read?rel=' + encodeURIComponent(rel))
    if (r.ok) {
      buffersRef.current[rel] = { text: null, mtimeMs: r.mtimeMs, dirty: false }
      resetDoc(rel, r.text || '', r.mtimeMs, false)
      if (force) { clearDraft(rel); setDraft(null) }
      else {
        let raw = null
        try { raw = window.localStorage.getItem(draftKey(rel)) } catch (_) { raw = null }
        if (raw) {
          let d = null
          try { d = JSON.parse(raw) } catch (_) { d = null }
          if (d && typeof d.text === 'string' && d.text !== (r.text || '')) setDraft({ rel: rel, text: d.text, savedAt: d.savedAt || 0 })
          else clearDraft(rel)
        }
      }
      setMsg('')
      setRecent(function (list) { const n = [rel].concat(list.filter(function (x) { return x !== rel })).slice(0, 12); try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(n)) } catch (_) {} return n })
    } else setMsg(r.error || 'read failed')
  }, [])

  const openFileAt = React.useCallback(async function (rel, line) {
    await openFile(rel)
    setTimeout(function () {
      const v = viewRef.current
      if (v && line) {
        const ln = Math.max(1, Math.min(v.state.doc.lines, line))
        v.dispatch({ selection: { anchor: v.state.doc.line(ln).from }, scrollIntoView: true })
        v.focus()
      }
    }, 120)
  }, [openFile])

  const closeTab = function (rel) {
    const cur = selectedRef.current
    const idx = tabs.indexOf(rel)
    const next = tabs.filter(function (x) { return x !== rel })
    delete buffersRef.current[rel]
    setTabs(next)
    if (cur === rel) {
      const pick = next[Math.max(0, idx - 1)] || ''
      if (pick) openFile(pick)
      else { setSelected(''); setDocText(''); setDocVersion(function (v) { return v + 1 }); setDirty(false); setReadOnly(false) }
    }
  }

  // 全文搜索
  React.useEffect(function () {
    if (!ftMode) return
    const q = search.trim()
    if (!q) { setFtResults([]); setFtTotal(0); return }
    setFtBusy(true)
    const tmr = setTimeout(async function () {
      const r = await api('/search?q=' + encodeURIComponent(q))
      setFtBusy(false)
      if (r.ok) { setFtResults(r.results || []); setFtTotal(r.total || 0) } else { setFtResults([]); setFtTotal(0); setMsg(r.error || 'search failed') }
    }, 300)
    return function () { clearTimeout(tmr) }
  }, [ftMode, search])

  // 外部修改检测（页面隐藏时暂停轮询，降低后台开销）
  React.useEffect(function () {
    const tick = async function () {
      if (document.hidden) return
      const rel = selectedRef.current
      if (!rel || dirtyRef.current) return
      const r = await api('/stat?rel=' + encodeURIComponent(rel))
      if (!r || !r.ok) return
      if (!r.exists) { setExternal(true); return }
      if (loadedMtimeRef.current && r.mtimeMs !== loadedMtimeRef.current) { statMtimeRef.current = r.mtimeMs; setExternal(true) }
    }
    const id = setInterval(tick, 4000)
    const onVis = function () { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVis)
    return function () { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  // 恢复上次打开的文件与标签页（仅一次）
  React.useEffect(function () {
    if (!loaded || restoredRef.current) return
    restoredRef.current = true
    tabsHydratedRef.current = true
    let rel = ''
    let savedTabs = []
    try { rel = window.localStorage.getItem(LASTFILE_KEY) || '' } catch (_) {}
    try { savedTabs = JSON.parse(window.localStorage.getItem(TABS_KEY) || '[]') || [] } catch (_) { savedTabs = [] }
    const flat = []
    const walk = function (list) { list.forEach(function (nd) { if (nd.type === 'dir') walk(nd.children || []); else flat.push(nd.rel) }) }
    walk(tree)
    savedTabs = savedTabs.filter(function (x) { return flat.indexOf(x) !== -1 })
    if (savedTabs.length) {
      setTabs(savedTabs)
      openFile(savedTabs.indexOf(rel) !== -1 ? rel : savedTabs[0])
    } else if (rel && flat.indexOf(rel) !== -1) openFile(rel)
  }, [loaded, tree, openFile])

  const handleDocChanged = React.useCallback(function (txt) {
    setDirty(true); setDocText(txt)
    const cur = selectedRef.current
    if (cur) buffersRef.current[cur] = { text: null, mtimeMs: loadedMtimeRef.current, dirty: true }
    if (settingsRef.current.autosave) {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(function () { saveRef.current() }, 1200)
    }
    if (cur) {
      if (draftTimer.current) clearTimeout(draftTimer.current)
      draftTimer.current = setTimeout(function () {
        try { window.localStorage.setItem(draftKey(cur), JSON.stringify({ text: txt, baseMtimeMs: loadedMtimeRef.current, savedAt: Date.now() })) } catch (_) {}
      }, 500)
    }
  }, [])

  // 全局快捷键：保存 / 查找 / 替换 / 跳行
  React.useEffect(function () {
    function onKey(e) {
      const meta = e.ctrlKey || e.metaKey
      if (!meta) return
      const k = (e.key || '').toLowerCase()
      if (k === 's') { e.preventDefault(); saveRef.current(); return }
      const v = viewRef.current
      if (k === 'f' || k === 'h') { e.preventDefault(); if (v) { v.focus(); openSearchPanel(v) } return }
      if (k === 'g') { e.preventDefault(); setGotoVal(''); setGotoOpen(true); return }
    }
    document.addEventListener('keydown', onKey)
    return function () { document.removeEventListener('keydown', onKey) }
  }, [])

  // 关闭页面前提醒未保存修改（草稿另存 localStorage，重开可恢复）
  React.useEffect(function () {
    function onBeforeUnload(e) { if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', onBeforeUnload)
    return function () { window.removeEventListener('beforeunload', onBeforeUnload) }
  }, [])

  const doGoto = function () {
    const v = viewRef.current; if (!v) { setGotoOpen(false); return }
    let n = parseInt(gotoVal, 10)
    if (isNaN(n)) { setGotoOpen(false); return }
    n = Math.max(1, Math.min(v.state.doc.lines, n))
    const line = v.state.doc.line(n)
    v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    v.focus(); setGotoOpen(false)
  }

  const doAppend = React.useCallback(async function () {
    const val = capture
    if (!val || !val.trim()) return
    const payload = { rel: selectedRef.current || undefined, text: val.trim() }
    if (selectedRef.current && statMtimeRef.current) payload.expectedMtimeMs = statMtimeRef.current
    const r = await api('/append', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (r.ok) {
      setCapture('')
      await loadList()
      if (selectedRef.current) {
        const rr = await api('/read?rel=' + encodeURIComponent(selectedRef.current))
        if (rr.ok) { buffersRef.current[selectedRef.current] = { text: null, mtimeMs: rr.mtimeMs, dirty: false }; resetDoc(selectedRef.current, rr.text || '', rr.mtimeMs, false) }
      }
      setMsg(t('appended'))
    } else if (r.conflict) {
      setConflict({ mtimeMs: r.mtimeMs || 0, reason: r.reason || '' })
      setMsg('文件已在外部被修改，未追加')
    } else setMsg(r.error || 'append failed')
  }, [capture, loadList, t])

  const doCreate = React.useCallback(async function (name) {
    const nm = String(name || '').trim()
    if (!nm) return
    const base = newParentRef.current
    const rel = base ? (base + '/' + nm) : nm
    if (newIsDirRef.current) {
      const r = await api('/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rel: rel }) })
      if (r.ok) { setNewOpen(false); setNewName(''); await loadList() } else setMsg(r.error || 'mkdir failed')
    } else {
      const r = await api('/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rel: rel }) })
      if (r.ok) { setNewOpen(false); setNewName(''); await loadList(); openFile(rel) } else setMsg(r.error || 'create failed')
    }
  }, [loadList, openFile])

  const doReveal = React.useCallback(async function () {
    const r = await api('/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!r.ok) setMsg(r.error || 'reveal failed')
  }, [])

  const openConfig = React.useCallback(async function () {
    setSettingsOpen(true)
    const r = await api('/config')
    if (r && r.ok) { setRootPath(r.root || ''); setRootInput(r.root || '') }
  }, [])
  // 供 window 事件监听使用：openConfig 声明在更后面，用 ref 桥接（避免 effect 依赖未初始化变量）
  React.useEffect(function () { openConfigRef.current = openConfig }, [openConfig])

  const doApplyRoot = React.useCallback(async function () {
    const next = String(rootInput || '').trim()
    if (!next) { setMsg('目录不能为空'); return }
    setRootBusy(true)
    const r = await api('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: next }) })
    setRootBusy(false)
    if (r && r.ok) {
      setRootPath(r.root); setRootInput(r.root)
      ctxRootRel = null
      setSettingsOpen(false)
      setSelected(''); setDocText(''); setTabs([])
      buffersRef.current = {}
      setMsg('记录目录已切换：' + r.root)
      await loadList()
    } else setMsg((r && r.error) || '切换失败')
  }, [rootInput, loadList])

  const doDelete = React.useCallback(async function (rel) {
    const r = await api('/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rel: rel }) })
    if (r.ok) {
      if (selectedRef.current === rel) { setSelected(''); setDocText(''); setDirty(false); setReadOnly(false) }
      setTabs(function (list) { return list.filter(function (x) { return x !== rel }) })
      delete buffersRef.current[rel]
      setDeleteTarget('')
      await loadList()
      setMsg('已移入回收站')
    } else setMsg(r.error || 'delete failed')
  }, [loadList])

  const openTrash = React.useCallback(async function () {
    const r = await api('/trash/list')
    if (r.ok) { setTrashItems(r.entries || []); setTrashOpen(true) } else setMsg(r.error || '读取回收站失败')
  }, [])

  const restoreTrashItem = async function (name) {
    const r = await api('/trash/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
    if (r.ok) {
      setMsg('已恢复')
      const rr = await api('/trash/list')
      if (rr.ok) setTrashItems(rr.entries || [])
      await loadList()
      if (r.rel) openFile(r.rel)
    } else setMsg(r.error || '恢复失败')
  }

  const restoreDraft = function () {
    if (!draft) return
    setDocText(draft.text); setDocVersion(function (v) { return v + 1 }); setDirty(true); setDraft(null)
  }
  const discardDraft = function () { if (draft) clearDraft(draft.rel); setDraft(null) }

  const btn = { background: tok('interactive-bg-hover', '#2a2a2a'), color: 'inherit', border: '0.5px solid ' + tok('border-l3', '#3a3a3a'), borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }
  const input = { boxSizing: 'border-box', width: '100%', background: tok('bg-base', '#1a1a1a'), color: 'inherit', border: '0.5px solid ' + tok('border-l3', '#3a3a3a'), borderRadius: 8, padding: '6px 9px', fontSize: 13, outline: 'none' }
  const accent = '#3b6ef0'
  const accentSoft = 'rgba(59,110,240,0.14)'
  const panelBg = tok('bg-elevated', '#f5f6f8')
  const btnPrimary = Object.assign({}, btn, { background: accent, color: '#ffffff', border: 'none', fontWeight: 500 })
  // 弹窗统一浅色卡片，避免深色 fallback 下深底 + 深字看不清
  const modalCard = { background: '#ffffff', color: '#1c1f23', border: '1px solid #d9dce1', borderRadius: 10, padding: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', gap: 10 }
  const modalTitle = { fontWeight: 600, fontSize: 15, color: '#1c1f23' }
  const modalInput = Object.assign({}, input, { background: '#ffffff', color: '#1c1f23', border: '1px solid #ccd2da' })
  const modalGhost = Object.assign({}, btn, { background: '#eef1f4', color: '#1c1f23', border: '1px solid #d0d6dd' })

  const matchTree = function (nodes, q) {
    const ql = String(q).toLowerCase()
    const walk = function (list) {
      const out = []
      for (const nd of list) {
        if (nd.type === 'dir') {
          const kids = walk(nd.children || [])
          if (nd.name.toLowerCase().indexOf(ql) !== -1 || kids.length) out.push(Object.assign({}, nd, { children: kids }))
        } else if (nd.name.toLowerCase().indexOf(ql) !== -1) out.push(nd)
      }
      return out
    }
    return walk(nodes)
  }
  const visibleTree = search ? matchTree(tree, search) : tree
  const renderTree = function (nodes, depth) {
    const rows = []
    nodes.forEach(function (nd) {
      const pad = 8 + depth * 14
      if (nd.type === 'dir') {
        const open = !!search || !!expanded[nd.rel]
        rows.push(React.createElement('div', { key: 'd' + nd.rel, onClick: function () { toggleDir(nd.rel) }, title: nd.name,
            style: { padding: '7px 10px 7px ' + pad + 'px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '0.5px solid ' + tok('border-l1', '#242424'), fontWeight: 600 } },
          React.createElement('span', { style: { width: 12, flexShrink: 0, textAlign: 'center', color: tok('label-tertiary', '#8a8a8a') } }, open ? '▾' : '▸'),
          React.createElement('span', { style: { flexShrink: 0 } }, '📁'),
          React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, nd.name),
          React.createElement('button', { onClick: function (e) { e.stopPropagation(); setNewParent(nd.rel); setNewIsDir(false); setNewName('新记录.txt'); setNewOpen(true) }, title: t('newFile'),
            style: { background: 'transparent', border: 'none', color: accent, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' } }, '＋')
        ))
        if (open && nd.children && nd.children.length) rows.push.apply(rows, renderTree(nd.children, depth + 1))
      } else {
        const sel = selected === nd.rel
        rows.push(React.createElement('div', { key: 'f' + nd.rel, onClick: function () { openFile(nd.rel) }, title: nd.name,
            style: { padding: '7px 10px 7px ' + pad + 'px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              background: sel ? accentSoft : 'transparent', borderLeft: '3px solid ' + (sel ? accent : 'transparent'),
              borderBottom: '0.5px solid ' + tok('border-l1', '#242424'), fontWeight: sel ? 600 : 400 } },
          React.createElement('span', { style: { width: 12, flexShrink: 0 } }, ''),
          React.createElement('span', { style: { flexShrink: 0, opacity: 0.9 } }, '📄'),
          React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, nd.name),
          React.createElement('button', { onClick: function (e) { e.stopPropagation(); setDeleteTarget(nd.rel) }, title: t('confirmDelete'),
            style: { background: 'transparent', border: 'none', color: tok('state-error-primary', '#e06c75'), cursor: 'pointer', fontSize: 14, lineHeight: 1 } }, '×')
        ))
      }
    })
    return rows
  }

  const eol = docText.indexOf('\r\n') !== -1 ? 'CRLF' : 'LF'

  return React.createElement('div', { style: { position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: tok('bg-base', '#141414'), color: tok('label-primary', '#eaeaea'), fontSize: 14 } },
    // 顶部工具条
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: panelBg, borderBottom: '0.5px solid ' + tok('border-l3', '#333') } },
      React.createElement('div', { style: { width: 4, height: 20, borderRadius: 2, background: accent } }),
      React.createElement('div', { style: { fontSize: 17, fontWeight: 600 } }, t('title')),
      React.createElement('div', { style: { flex: 1 } }),
      msg ? React.createElement('span', { style: { color: tok('label-tertiary', '#8a8a8a'), fontSize: 12, marginRight: 6 } }, msg) : null,
      React.createElement('button', { onClick: function () { setNewParent(''); setNewIsDir(false); setNewName('新记录.txt'); setNewOpen(true) }, style: btn }, t('newFile')),
      React.createElement('button', { onClick: function () { setNewParent(''); setNewIsDir(true); setNewName('新文件夹'); setNewOpen(true) }, style: btn }, t('newFolder')),
      React.createElement('button', { onClick: function () { loadList() }, style: btn }, t('refresh')),
      React.createElement('button', { onClick: openTrash, style: btn }, t('trash')),
      React.createElement('button', { onClick: doReveal, style: btn }, t('openFolder')),
      React.createElement('button', { onClick: function () { const w = window.open('/dsh-record-manager/popout', 'dsh-record-popout', 'width=1000,height=740'); if (!w) { api('/open-popout').then(function (r) { setMsg(r && r.ok ? '已在独立窗口打开' : ('打开失败：' + ((r && r.error) || ''))) }) } }, style: btn, title: t('popout') }, t('popout')),
      React.createElement('button', { onClick: openConfig, style: btn, title: '记录目录设置' }, '📁 目录'),
      React.createElement('button', { onClick: openConfig, style: btn, title: t('settings') }, '⚙')
    ),
    external ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: tok('state-warn-tertiary', '#d9a300'), color: '#1b1b1b', fontSize: 13 } },
      React.createElement('span', { style: { flex: 1 } }, '⚠ 文件已在外部被修改，是否重新加载？'),
      React.createElement('button', { onClick: function () { if (selectedRef.current) openFile(selectedRef.current, true) }, style: btn }, '重新加载'),
      React.createElement('button', { onClick: function () { setExternal(false); loadedMtimeRef.current = statMtimeRef.current || loadedMtimeRef.current }, style: btn }, '忽略')
    ) : null,
    draft ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: tok('state-warn-tertiary', '#d9a300'), color: '#1b1b1b', fontSize: 13 } },
      React.createElement('span', { style: { flex: 1 } }, '检测到未保存的草稿，是否恢复？'),
      React.createElement('button', { onClick: restoreDraft, style: btn }, '恢复草稿'),
      React.createElement('button', { onClick: discardDraft, style: btn }, '丢弃')
    ) : null,
    conflict ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#ffe6e6', color: '#7a1f1f', fontSize: 13 } },
      React.createElement('span', { style: { flex: 1 } }, '保存冲突：文件已在外部被修改。'),
      React.createElement('button', { onClick: function () { const rel = selectedRef.current; setConflict(null); if (rel) openFile(rel, true) }, style: btn }, '重新加载'),
      React.createElement('button', { onClick: function () { doSave(true) }, style: btn }, '覆盖保存'),
      React.createElement('button', { onClick: function () { setConflict(null) }, style: btn }, '稍后处理')
    ) : null,
    settingsOpen ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '8px 16px', background: panelBg, borderBottom: '0.5px solid ' + tok('border-l3', '#333'), fontSize: 13 } },
      React.createElement('span', null, t('font')),
      React.createElement('button', { style: btn, onClick: function () { setSettings(function (s) { return Object.assign({}, s, { fontSize: Math.max(10, (s.fontSize || 15) - 1) }) }) } }, '−'),
      React.createElement('span', { style: { minWidth: 24, textAlign: 'center' } }, (settings.fontSize || 15) + 'px'),
      React.createElement('button', { style: btn, onClick: function () { setSettings(function (s) { return Object.assign({}, s, { fontSize: Math.min(30, (s.fontSize || 15) + 1) }) }) } }, '＋'),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
        React.createElement('input', { type: 'checkbox', checked: !!settings.lineWrapping, onChange: function (e) { setSettings(function (s) { return Object.assign({}, s, { lineWrapping: e.target.checked }) }) } }), t('wrap')),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
        React.createElement('input', { type: 'checkbox', checked: !!settings.autosave, onChange: function (e) { setSettings(function (s) { return Object.assign({}, s, { autosave: e.target.checked }) }) } }), t('autosave')),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
        React.createElement('input', { type: 'checkbox', checked: settings.showCapture !== false, onChange: function (e) { setSettings(function (s) { return Object.assign({}, s, { showCapture: e.target.checked }) }) } }), t('showCapture')),
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, t('tabSize'),
        React.createElement('select', { value: settings.tabSize || 4, onChange: function (e) { setSettings(function (s) { return Object.assign({}, s, { tabSize: parseInt(e.target.value, 10) }) }) }, style: Object.assign({}, input, { width: 64 }) },
          [2, 4, 8].map(function (n) { return React.createElement('option', { key: n, value: n }, n) })))
    ) : null,
    // 主体
    React.createElement('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
      React.createElement('div', { style: { width: 272, flexShrink: 0, background: panelBg, borderRight: '0.5px solid ' + tok('border-l3', '#333'), display: 'flex', flexDirection: 'column', minHeight: 0 } },
        React.createElement('div', { style: { padding: '10px 10px 6px', display: 'flex', gap: 6, alignItems: 'center' } },
          React.createElement('input', { value: search, onChange: function (e) { setSearch(e.target.value) }, placeholder: ftMode ? '全文搜索内容…' : t('search'), style: Object.assign({}, input, { flex: 1, background: tok('bg-base', '#ffffff') }) }),
          React.createElement('button', { onClick: function () { setFtMode(function (v) { return !v }) }, title: '全文搜索', style: Object.assign({}, btn, { padding: '5px 8px', fontSize: 12, background: ftMode ? accent : btn.background, color: ftMode ? '#ffffff' : 'inherit', border: ftMode ? 'none' : btn.border }) }, '全文')
        ),
        React.createElement('div', { style: { flex: 1, overflow: 'auto', paddingBottom: 8 } },
          ftMode
            ? React.createElement('div', null,
                React.createElement('div', { style: { padding: '4px 10px', fontSize: 12, color: tok('label-tertiary', '#8a8a8a') } }, ftBusy ? '搜索中…' : (search.trim() ? (ftTotal + ' 处匹配' + (ftTotal > ftResults.length ? '（显示前 ' + ftResults.length + '）' : '')) : '输入关键字做全文搜索')),
                ftResults.length === 0
                  ? (search.trim() && !ftBusy ? React.createElement('div', { style: { padding: 12, color: tok('label-tertiary', '#8a8a8a') } }, t('noFiles')) : null)
                  : ftResults.map(function (hit, i) {
                      return React.createElement('div', { key: 'ft' + i, onClick: function () { openFileAt(hit.rel, hit.line) }, title: hit.rel + ':' + hit.line,
                          style: { padding: '6px 10px', cursor: 'pointer', borderBottom: '0.5px solid ' + tok('border-l1', '#242424') } },
                        React.createElement('div', { style: { fontSize: 12, color: accent, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, hit.name + ' : ' + hit.line),
                        React.createElement('div', { style: { fontSize: 12, color: tok('label-secondary', '#c8c8c8'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (hit.text || '').trim())
                      )
                    })
              )
            : React.createElement('div', null,
                (visibleTree.length === 0
                  ? React.createElement('div', { style: { padding: 12, color: tok('label-tertiary', '#8a8a8a') } }, loaded ? (search ? t('noFiles') : t('empty')) : '…')
                  : renderTree(visibleTree, 0)),
                (!search && recent.length) ? React.createElement('div', { style: { marginTop: 6, borderTop: '0.5px solid ' + tok('border-l1', '#242424') } },
                  React.createElement('div', { style: { padding: '6px 10px 2px', fontSize: 12, color: tok('label-tertiary', '#8a8a8a') } }, '最近打开'),
                  recent.map(function (r) { return React.createElement('div', { key: 'r' + r, onClick: function () { openFile(r) }, title: r, style: { padding: '5px 10px 5px 20px', cursor: 'pointer', fontSize: 12, color: tok('label-secondary', '#c8c8c8'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r) })
                ) : null
              )
        )
      ),
      React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
        tabs.length ? React.createElement('div', { style: { display: 'flex', alignItems: 'stretch', background: panelBg, borderBottom: '0.5px solid ' + tok('border-l3', '#333'), overflowX: 'auto', flexShrink: 0 } },
          tabs.map(function (rel) {
            const act = rel === selected
            const nm = rel.split('/').pop()
            const b = buffersRef.current[rel]
            const d = !!(b && b.dirty) || (act && dirty)
            return React.createElement('div', { key: 'tab' + rel, onClick: function () { openFile(rel) }, title: rel,
                style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', borderRight: '0.5px solid ' + tok('border-l1', '#242424'), background: act ? tok('bg-base', '#ffffff') : 'transparent', borderBottom: act ? '2px solid ' + accent : '2px solid transparent', fontWeight: act ? 600 : 400 } },
              d ? React.createElement('span', { style: { color: tok('state-warn-tertiary', '#d9a300'), fontSize: 10 } }, '●') : null,
              React.createElement('span', null, nm),
              React.createElement('span', { onClick: function (e) { e.stopPropagation(); closeTab(rel) }, style: { color: tok('label-tertiary', '#8a8a8a'), padding: '0 2px', fontSize: 13 } }, '×')
            )
          })
        ) : null,
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: panelBg, borderBottom: '0.5px solid ' + tok('border-l3', '#333') } },
          React.createElement('span', { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected || t('selectHint')),
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { onClick: function () { const v = viewRef.current; if (v) { v.focus(); openSearchPanel(v) } }, disabled: !selected, style: Object.assign({}, btn, { opacity: selected ? 1 : 0.5 }) }, t('find')),
          React.createElement('button', { onClick: function () { setGotoVal(''); setGotoOpen(true) }, disabled: !selected, style: Object.assign({}, btn, { opacity: selected ? 1 : 0.5 }) }, t('goto')),
          dirty ? React.createElement('span', { style: { color: tok('state-warn-tertiary', '#d9a300'), fontSize: 12 } }, t('unsaved')) : null,
          React.createElement('button', { onClick: function () { doSave(false) }, title: 'Ctrl+S', disabled: !selected || saving, style: Object.assign({}, btnPrimary, { opacity: (!selected || saving) ? 0.5 : 1 }) }, saving ? t('saving') : t('save'))
        ),
        // 速记条（可在设置里开关）
        settings.showCapture !== false ? React.createElement('div', { style: { padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-end', borderBottom: '0.5px solid ' + tok('border-l3', '#333') } },
          React.createElement('textarea', { value: capture, onChange: function (e) { setCapture(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAppend() } },
            placeholder: t('capturePh'), rows: 2,
            style: Object.assign({}, input, { flex: 1, minHeight: 44, maxHeight: 160, resize: 'vertical', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, padding: '10px 12px', background: tok('bg-elevated', '#ffffff'), border: '1px solid ' + tok('border-l3', '#d0d0d0') }) }),
          React.createElement('button', { onClick: doAppend, style: Object.assign({}, btnPrimary, { padding: '10px 16px', fontSize: 14 }) }, t('append'))
        ) : null,
        // CodeMirror 编辑区
        React.createElement('div', { style: { flex: 1, display: 'flex', minHeight: 0, minWidth: 0, position: 'relative', overflow: 'hidden' } },
          React.createElement(CodeEditor, { viewRef: viewRef, initialDoc: docText, docVersion: docVersion, settings: settings, readOnly: readOnly, onDocChanged: handleDocChanged, onSelection: setCaret })
        ),
        // 状态栏
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, padding: '4px 12px', background: panelBg, borderTop: '0.5px solid ' + tok('border-l3', '#333'), fontSize: 12, color: tok('label-tertiary', '#8a8a8a'), flexShrink: 0 } },
          React.createElement('span', null, '行 ' + caret.line + ', 列 ' + caret.col + (caret.sel ? '  (选中 ' + caret.sel + ')' : '')),
          React.createElement('span', null, (caret.chars || 0) + ' 字符'),
          React.createElement('span', null, (caret.lines || 1) + ' 行'),
          React.createElement('span', { style: { flex: 1 } }),
          readOnly ? React.createElement('span', { style: { color: tok('state-warn-tertiary', '#d9a300') } }, '只读') : null,
          React.createElement('span', null, 'UTF-8'),
          React.createElement('span', null, eol)
        )
      )
    ),
    // 新建弹窗
    newOpen ? React.createElement('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 } },
      React.createElement('div', { style: Object.assign({}, modalCard, { width: 320 }) },
        React.createElement('div', { style: modalTitle }, newIsDir ? t('newFolder') : t('newFile')),
        React.createElement('input', { autoFocus: true, value: newName, onChange: function (e) { setNewName(e.target.value) },
          onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doCreate(newName) } else if (e.key === 'Escape') { setNewOpen(false) } }, style: modalInput }),
        React.createElement('div', { style: { fontSize: 12, color: tok('label-tertiary', '#8a8a8a') } }, newIsDir ? ('在「' + (newParent || t('all')) + '」下新建文件夹') : ('在「' + (newParent || t('all')) + '」下新建文件，需以 .txt / .md 结尾')),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          React.createElement('button', { onClick: function () { setNewOpen(false) }, style: modalGhost }, t('cancel')),
          React.createElement('button', { onClick: function () { doCreate(newName) }, style: btnPrimary }, t('create'))
        )
      )
    ) : null,
    // 删除弹窗
    deleteTarget ? React.createElement('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 } },
      React.createElement('div', { style: Object.assign({}, modalCard, { width: 320 }) },
        React.createElement('div', { style: modalTitle }, t('del')),
        React.createElement('div', { style: { color: '#5a6068' } }, '确定删除「' + deleteTarget + '」？将移入回收站，可在「回收站」恢复。'),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          React.createElement('button', { onClick: function () { setDeleteTarget('') }, style: modalGhost }, t('cancel')),
          React.createElement('button', { onClick: function () { doDelete(deleteTarget) }, style: Object.assign({}, btnPrimary, { background: tok('state-error-primary', '#e06c75') }) }, t('del'))
        )
      )
    ) : null,
    // 跳转行弹窗
    gotoOpen ? React.createElement('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 } },
      React.createElement('div', { style: Object.assign({}, modalCard, { width: 300 }) },
        React.createElement('div', { style: modalTitle }, t('goto')),
        React.createElement('input', { autoFocus: true, value: gotoVal, placeholder: t('gotoPh'), onChange: function (e) { setGotoVal(e.target.value) },
          onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doGoto() } else if (e.key === 'Escape') { setGotoOpen(false) } }, style: modalInput }),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          React.createElement('button', { onClick: function () { setGotoOpen(false) }, style: modalGhost }, t('cancel')),
          React.createElement('button', { onClick: doGoto, style: btnPrimary }, '跳转')
        )
      )
    ) : null,
    // 回收站弹窗
    trashOpen ? React.createElement('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 } },
      React.createElement('div', { style: Object.assign({}, modalCard, { width: 440, maxHeight: '72%' }) },
        React.createElement('div', { style: modalTitle }, t('trash')),
        React.createElement('div', { style: { flex: 1, overflow: 'auto', border: '1px solid #e3e6ea', borderRadius: 8, minHeight: 80 } },
          trashItems.length === 0
            ? React.createElement('div', { style: { padding: 14, color: '#5a6068' } }, '回收站是空的')
            : trashItems.map(function (it) {
                return React.createElement('div', { key: it.name, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #eef1f4' } },
                  React.createElement('div', { style: { flex: 1, overflow: 'hidden' } },
                    React.createElement('div', { style: { fontSize: 13, color: '#1c1f23', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.rel),
                    React.createElement('div', { style: { fontSize: 11, color: '#7a8088' } }, new Date(it.mtimeMs).toLocaleString())
                  ),
                  React.createElement('button', { onClick: function () { restoreTrashItem(it.name) }, style: modalGhost }, t('restore'))
                )
              })
        ),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          React.createElement('button', { onClick: function () { setTrashOpen(false) }, style: modalGhost }, t('close'))
        )
      )
    ) : null,
    // 设置弹窗：记录目录 + 字体 + 行号/自动保存
    settingsOpen ? React.createElement('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 55 } },
      React.createElement('div', { style: Object.assign({}, modalCard, { width: 520 }) },
        React.createElement('div', { style: modalTitle }, t('settings')),
        React.createElement('div', { style: { fontSize: 12, color: '#5a6068' } }, '记录目录（可存放 .txt / .md 的文件夹）'),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('input', { value: rootInput, onChange: function (e) { setRootInput(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); doApplyRoot() } }, placeholder: '例如 ~/dsh-notes', style: Object.assign({}, modalInput, { flex: 1 }) }),
          React.createElement('button', { onClick: doReveal, style: modalGhost, title: t('openFolder') }, '打开')
        ),
        React.createElement('div', { style: { fontSize: 11, color: '#7a8088' } }, '当前：' + (rootPath || '(未获取)')),
        React.createElement('div', { style: { height: 1, background: '#eef1f4', margin: '4px 0' } }),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13, color: '#1c1f23' } },
          React.createElement('span', null, t('font')),
          React.createElement('button', { style: modalGhost, onClick: function () { setSettings(function (s) { return Object.assign({}, s, { fontSize: Math.max(10, (s.fontSize || 15) - 1) }) }) } }, '−'),
          React.createElement('span', { style: { minWidth: 40, textAlign: 'center' } }, (settings.fontSize || 15) + 'px'),
          React.createElement('button', { style: modalGhost, onClick: function () { setSettings(function (s) { return Object.assign({}, s, { fontSize: Math.min(30, (s.fontSize || 15) + 1) }) }) } }, '＋'),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: !!settings.lineWrapping, onChange: function (e) { setSettings(function (s) { return Object.assign({}, s, { lineWrapping: e.target.checked }) }) } }), t('wrap')),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: !!settings.autosave, onChange: function (e) { setSettings(function (s) { return Object.assign({}, s, { autosave: e.target.checked }) }) } }), t('autosave'))
        ),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          React.createElement('button', { onClick: function () { setSettingsOpen(false) }, style: modalGhost }, t('cancel')),
          React.createElement('button', { onClick: doApplyRoot, disabled: rootBusy, style: btnPrimary }, rootBusy ? '切换中…' : '应用目录')
        )
      )
    ) : null
  )
}

export { zh, en }

/* ---- 输入框 @note：选一条笔记插入（与 @ 文件引用同一触发器管线） ---- */
let ctxRootRel = null
// @ 引用只传路径：把相对路径解析成绝对路径（读 /list 的 root，失败则回退相对路径）。
function rootRel(_t) {
  if (ctxRootRel) return Promise.resolve(ctxRootRel)
  return api('/list').then(function (j) {
    ctxRootRel = j && j.ok && j.root ? String(j.root) : ''
    return ctxRootRel
  }).catch(function () { return '' })
}
function absPath(_t, rel) {
  return rootRel().then(function (root) {
    if (!root) return String(rel)
    const sep = root.indexOf('\\') !== -1 ? '\\' : '/'
    return root.replace(/[\\/]+$/, '') + sep + String(rel).replace(/\//g, sep)
  }).catch(function () { return String(rel) })
}

function collectNotes(nodes, out) {
  for (const nd of nodes || []) {
    if (nd.type === 'dir') collectNotes(nd.children, out)
    else if (nd.type === 'file') out.push({ rel: nd.rel, name: nd.name })
  }
  return out
}

function createNoteSource(t) {
  return {
    trigger: '@',
    name: 'note',
    order: 10,
    showGroupTitle: false,
    async candidates(_session, req) {
      const raw = String(req.query || '')
      const lower = raw.toLowerCase()
      const items = []
      // 一行：更改记录目录
      if (raw === '' || '更改目录'.indexOf(lower) !== -1 || 'change directory'.indexOf(lower) !== -1 || '/config'.indexOf(lower) !== -1) {
        items.push({
          name: '更改记录目录…',
          label: '更改记录目录…',
          icon: 'folder',
          section: t('section'),
          description: '当前根目录',
          value: '__set_root__',
        })
      }
      const q = raw.toLowerCase()
      const json = await api('/tree')
      if (json && json.ok) {
        const all = collectNotes(json.nodes, []).filter(function (n) {
          return q === '' || n.rel.toLowerCase().indexOf(q) !== -1 || n.name.toLowerCase().indexOf(q) !== -1
        })
        const section = t('section')
        for (const n of all.slice(0, 100)) {
          const slash = n.rel.lastIndexOf('/')
          const parent = slash < 0 ? '' : n.rel.slice(0, slash)
          items.push({
            name: n.rel,
            label: n.name,
            icon: 'file',
            section: section,
            description: parent || undefined,
            value: n.rel,
          })
        }
      }
      return items
    },
    onPick(arg) {
      const rel = arg.candidate.value
      if (rel === '__set_root__') {
        try { window.dispatchEvent(new CustomEvent('dsh-record-manager:open-config')) } catch (err) {}
        return { claim: true }
      }
      const name = arg.candidate.name
      return { insert: { source: 'note', ref: rel, label: name, appearance: 'file', clipboardText: rel } }
    },
    openReference(_session, reference) {
      void reference
      return false
    },
    codec: {
      clipboardText: function (ref) { return ref },
      serialize: function (ref) {
        return Promise.resolve('@' + String(ref))
      },
    },
  }
}

export function apply(ctx) {
  ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }) }, 'record-manager: dictionary')
  ctx.effect(function () { return ctx.locale.register(MENU_NS, { zh: menuZh, en: menuEn }) }, 'record-manager: menu dictionary')
  const t = ctx.locale.bind(NS)
  const tm = ctx.locale.bind(MENU_NS)
  ctx.slots.inject('sidebar.panellist', function () {
    return ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: function () { return t('panel') } }, RecordsIcon)
  })
  ctx.slots.inject('main', function () {
    return ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: function () { return { t: t } } }, RecordsPage)
  })
  // @note 是可选增强：用惰性可选 inject，且即使 inputTriggers 缺失/注册失败，
  // 也绝不能影响 sidebar.panellist / main 整页注册（否则整个页面会 blank）。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['inputTriggers'], function (scope) {
      if (!scope || !scope.inputTriggers || typeof scope.inputTriggers.registerSource !== 'function') return
      try {
        scope.effect(function () { return scope.inputTriggers.registerSource(createNoteSource(tm)) }, 'record-manager: @note source')
      } catch (err) { try { console.error('[dsh-record-manager] @note source registration failed:', err) } catch (e) {} }
    })
  }
}

// 只把两个必需的 slot 服务列为硬依赖；inputTriggers 走惰性可选 inject，
// 这样即使当前版本没有该服务也不会让插件 apply 失败、页面变空白。
export const inject = ['slots', 'locale']
