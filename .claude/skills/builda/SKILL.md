---
name: builda
description: BuildaGame（Builda）游戏发布工具链：接入 Builda SDK、本地 mock 调试、导出 Godot Web / Unity WebGL 或打包 HTML5 构建、上传/更新游戏草稿。
---

本项目已安装项目级 BuildaGame 工具链（发布 Godot Web / HTML5 / Unity WebGL 游戏到 Builda）。工具、说明书、SDK 全部随项目走，同一版本号：

1. 完整说明书（先读）：项目根的 `.builda-agent/SKILL.md`
2. 每次任务开始先跑：`./.builda-agent/builda check`（自动对齐工具链版本，并提示 SDK 是否需要同步）

若上述文件缺失（例如刚 clone 本仓库），在项目根目录重装：

```bash
curl -fsSL https://ai.builda.game/agent/install.sh | bash
```

Windows（下载为文件，禁止 `iwr | iex`）：

```powershell
$p = Join-Path $env:TEMP "builda-install.ps1"; iwr https://ai.builda.game/agent/install.ps1 -UseBasicParsing -OutFile $p; & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $p; Remove-Item -Force $p -ErrorAction SilentlyContinue
```
