#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd "$(dirname "$0")" && pwd)
exec sh "$TASK_ROOT/启动_笔记本.command" serve "$@"
