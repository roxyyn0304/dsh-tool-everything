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
- [Everything](https://www.voidtools.com/Everything-Download) **正在运行**（`Everything.exe -startup` 即可，开机自启最稳）
- DeepSeek Harness（DSH）profile 的 node_modules 中有 `koffi`（DSH 自带）

## 🛠️ 安装

### 方式一：一键安装（推荐）

```powershell
dsh plugin --profile web add "github:roxyyn0304/dsh-tool-everything"
```

装完**硬刷新浏览器**（`Ctrl+Shift+R`），**新开会话**即可使用。

### 方式二：从源码安装 / 开发

```powershell
git clone https://github.com/roxyyn0304/dsh-tool-everything.git
cd dsh-tool-everything
.\scripts\install.ps1
```

### 方式三：手动安装

1. 把本仓库复制到 DSH profile 的 node_modules 下：

```
$DSH_HOME/profiles/web/node_modules/dsh-tool-everything/
```

2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中添加：

```yaml
- insert:
    - id: tool-everything
      name: 'dsh-tool-everything'
      config:
        maxResults: 100
        timeoutMs: 30000
```

3. 等 DSH HMR 自动重载，**新开会话**即可使用（未生效则重启 `dsh web`）。

## ⚙️ 配置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `maxResults` | `100` | 单次返回结果上限 |
| `timeoutMs` | `30000` | 工具超时预算（ms） |
| `everythingDllPath` | 包内 `native/` | 自定义 Everything64.dll 路径（一般不用） |

## 🧪 测试

```powershell
# 将本项目复制到可解析 koffi 的目录（如 DSH profiles/node_modules/）
# 然后运行测试脚本
node test_everything_plugin.mjs
```

测试会模拟 DSH 环境：注册工具 → 调用 Everything 查询 → 验证格式化/卡片/空结果/参数校验。

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
