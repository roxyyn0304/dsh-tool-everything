# 把本项目同步安装到 DSH web profile 的插件目录
$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$dest = "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh-tool-everything"

if (-not (Test-Path "$src\lib\index.js")) { throw "找不到 lib\index.js，请在项目目录运行" }
if (-not (Test-Path "$src\native\Everything64.dll")) { throw "找不到 native\Everything64.dll" }

New-Item -ItemType Directory -Force -Path $dest, "$dest\lib", "$dest\native" | Out-Null
Copy-Item "$src\package.json" $dest -Force
Copy-Item "$src\lib\index.js" "$dest\lib\" -Force
Copy-Item "$src\native\Everything64.dll" "$dest\native\" -Force
Copy-Item "$src\README.md" $dest -Force

Write-Host "已同步到: $dest"
Write-Host "如 cordis.patch.yml 尚未注册，请在 $env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml 添加："
Write-Host @"

- insert:
    - id: tool-everything
      name: '@deepseek-ai/dsh-tool-everything'
      config:
        maxResults: 100
        timeoutMs: 30000
"@
