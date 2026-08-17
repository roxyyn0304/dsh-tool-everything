# dsh-tool-everything

DSH（DeepSeek Harness）的 Everything 搜索工具插件。给 DSH Agent 注册
`everything_search` 工具：通过 [Everything](https://www.voidtools.com)
索引按文件名**全盘秒搜** Windows 文件系统。

> 🚀 **零配置**：无需启用 Everything HTTP 服务器，无需 es.exe，不改
> Everything 的任何设置。只要 Everything 在运行，装完插件就能用。

## ✨ 特性

- ⚡ **极速**：直接调用 Everything SDK（koffi FFI），走 IPC 通道——毫秒级响应
- 🔍 **完整语法**：通配符 `*.pdf`、`path:C:\code`、`ext:zip`、`size:>10mb`、`regex:`、`|` 或、`!` 非
- 🎯 **结构化结果**：返回路径 + 文件大小 + 是否文件夹，UI 自动渲染搜索卡片
- 📦 **零依赖安装**：自带 `Everything64.dll`，无需系统安装任何额外组件
- 🔥 **DSH 原生**：Cordis 插件，支持 HMR 热重载，无需重启 DSH

## 📋 前提

- Windows 系统
- [Everything](https://www.voidtools.com/Everything-Download) **正在运行**
- DeepSeek Harness（DSH）profile 的 node_modules 中有 `koffi`（DSH 自带）

## 🛠️ 安装

```powershell
dsh plugin --profile web add "github:roxyyn0304/dsh-tool-everything"
```

装完**硬刷新浏览器**（`Ctrl+Shift+R`），**新开会话**即可使用。

## ⚙️ 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `maxResults` | `100` | 单次返回结果上限 |
| `timeoutMs` | `30000` | 工具超时预算（ms） |
| `everythingDllPath` | 包内 `native/` | 自定义 Everything64.dll 路径（一般不用） |

## ❌ 错误码

| code | 含义 |
| --- | --- |
| `EVERYTHING_SDK_LOAD_FAILED` | 找不到或无法加载 `Everything64.dll` |
| `EVERYTHING_NOT_RUNNING` | Everything 未运行 |
| `SEARCH_ABORTED` | 工具被超时/用户取消终止 |

## 🧩 技术细节

```
┌─────────────────────────────────────────────┐
│  DSH Agent (你)                              │
│  调用 everything_search("npm", max=10)       │
├─────────────────────────────────────────────┤
│  dsh-tool-everything (本插件)                │
│  koffi FFI → Everything64.dll               │
├─────────────────────────────────────────────┤
│  Everything SDK (IPC 通道)                   │
├─────────────────────────────────────────────┤
│  Everything.exe (全盘 NTFS 索引引擎)         │
└─────────────────────────────────────────────┘
```

- `Everything64.dll` 来自 [Everything SDK 1.5](https://www.voidtools.com/Everything-SDK.zip)
- FFI 通过 [koffi](https://koffi.dev) 实现（DSH 自带）
- 插件单文件 `lib/index.js`，ESM 模块，Cordis 插件规范

## 📄 License

MIT

## 🙏 致谢

- [voidtools](https://www.voidtools.com) — Everything 文件搜索引擎
- [koffi](https://koffi.dev) — Node.js FFI 库
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — DSH Agent 框架
