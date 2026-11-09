#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd "$(dirname "$0")" && pwd)
cd "$TASK_ROOT"
for TASK_CANDIDATE in "${IPP31078_PYTHON:-}" "$TASK_ROOT/.venv/bin/python3" python3.12 python3.13 python3.14 python3 python; do
    [ -n "$TASK_CANDIDATE" ] || continue
    if "$TASK_CANDIDATE" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
        exec "$TASK_CANDIDATE" -u launch.py "$@"
    fi
done
printf '%s\n' '未找到 Python 3.12 或以上。请从 https://www.python.org/downloads/ 安装 Python，重新打开终端后再启动。' '无需 Node.js 即可体验。详见“笔记本迁移说明.md”。'
exit 1
