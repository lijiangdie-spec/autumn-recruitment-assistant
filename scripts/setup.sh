#!/usr/bin/env bash
set -euo pipefail
major="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "$major" -lt 20 ]; then echo "秋招助手需要 Node.js 20 或更高版本。" >&2; exit 1; fi
npm ci
echo "依赖安装完成。运行 npm run dev，然后打开 http://127.0.0.1:3000。"
echo "首次进入会检测 Codex CLI / Claude Code CLI 与可选 PDF 工具。"
