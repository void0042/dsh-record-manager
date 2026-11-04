# dsh-record-manager

外置笔记 —— 一个 [DSH](https://deepseek.com) 插件，把笔记直接存成磁盘上的纯文本文件（`.txt` / `.md`），
随时可以用外部编辑器打开。提供三种入口：

- **侧边栏面板**：在 DSH Web 界面里浏览、编辑、搜索笔记；
- **独立窗口（popout）**：`/dsh-record-manager/popout` 单独打开一个编辑器窗口；
- **Agent 工具 `record_note`**：对助手说"记一下：…"即可追加到每日流水。

## 特性

- 数据即文件：笔记是真的 `.txt` / `.md`，放在你指定的目录里，不锁定任何私有格式。
- 每日流水：追加时自动按 `MMDD：` 分区、自动编号，跨天自动新起分区。
- 全文搜索：支持大小写敏感 / 正则 / 全词匹配。
- 回收站：删除 = 移入 `<root>/.trash`，可恢复。
- 冲突保护：保存时比对 mtime，文件被外部修改会提示重新加载 / 覆盖。
- 目录可配置：写入 `root` 目录下的 `.dsh-record-manager.json`，界面里可随时切换。
- 中英双语。

## 安装

推荐作为本地插件放进 DSH 的 profile（不需要发到 npm）：

```bash
git clone https://github.com/void0042/dsh-record-manager.git
```

把整个目录放到 DSH profile 的 `node_modules` 下，例如
`~/.dsh/profiles/desktop/node_modules/dsh-record-manager`，然后让 DSH 加载它的挂载声明
`cordis.patch.yml`（DSH 会在启动时合并该 patch）。重启 DSH 后，侧边栏会出现「外置笔记」面板。

> 挂载声明里默认不写 `root`，此时笔记会存到用户主目录下的 `dsh-notes` 文件夹。
> 想指定别的目录，编辑 `cordis.patch.yml` 的 `config.root`，或在插件「设置」里改（会持久化到记录目录的
> `.dsh-record-manager.json`）。

## 配置

| 配置项 | 位置 | 说明 |
| --- | --- | --- |
| `root` | `cordis.patch.yml` 的 `config.root` / 插件设置页 | 笔记根目录。默认 `<用户主目录>/dsh-notes` |
| `dailyFile` | `cordis.patch.yml` 的 `config.dailyFile` | 每日流水文件名，默认 `日常/记录.txt` |

## 开发

```bash
npm install

# 重新构建前端产物（client.js / popout.js）
npm run build
# 或分开构建
npm run build:client
npm run build:popout
```

- 源码在 `src/`：`src/client.js` 是面板与编辑器的 React 实现，`src/popout.js` 是独立窗口入口。
- `client.js` / `popout.js` 是 esbuild 的**构建产物**，已随仓库提供，无需构建即可使用；
  改动 `src/` 后再跑 `npm run build` 重新生成。
- Host 半在 `index.js`：注册 HTTP 路由 `/dsh-record-manager/api/*` 与 Agent 工具 `record_note`。

## 平台

- 已在 **Windows** 上测试。
- 打开文件夹 / 弹出窗口等操作按平台分支：Windows `rundll32`/`explorer.exe`，
  macOS `open`，Linux `xdg-open`。其他平台未充分验证，欢迎反馈。

## 许可

[MIT](LICENSE)
