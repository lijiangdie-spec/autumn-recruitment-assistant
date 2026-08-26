$ErrorActionPreference = "Stop"
$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) { throw "秋招助手需要 Node.js 20 或更高版本。" }
npm ci
Write-Host "依赖安装完成。运行 npm run dev，然后打开 http://127.0.0.1:3000。"
Write-Host "首次进入会检测 Codex CLI / Claude Code CLI 与可选 PDF 工具。"
