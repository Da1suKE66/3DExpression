#!/usr/bin/env python3
"""Portable entry point; uses the laptop's Python, never the server's paths."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def prepare_runtime():
    if sys.version_info < (3, 12):
        raise RuntimeError('需要 Python 3.12 或以上。请安装后重新启动；普通体验不需要 Node.js。')
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')
    source = json.loads((ROOT / 'portable/source.json').read_text(encoding='utf-8'))
    wheel = ROOT / 'portable' / source['filename']
    if not wheel.is_file() or digest(wheel) != source['sha256']:
        raise RuntimeError('随包时区数据缺失或校验失败，请重新完整解压迁移包。')
    paths = [str(wheel), str(ROOT / 'scripts')]
    sys.path[:0] = paths
    # Optional installer subprocesses also receive the same offline time-zone data.
    os.environ['PYTHONPATH'] = os.pathsep.join(paths + ([os.environ['PYTHONPATH']] if os.environ.get('PYTHONPATH') else []))
    from zoneinfo import ZoneInfo
    ZoneInfo('Asia/Shanghai')
    os.chdir(ROOT)
    # Fresh source checkouts keep only blank templates under version control.
    for template, relative in [('participants.csv','data/raw/participants.csv'),('engineering_acceptance.csv','materials/engineering_acceptance.csv'),('video_metric_annotations.csv','materials/video_metric_annotations.csv')]:
        source, target = ROOT/'templates'/template, ROOT/relative
        if source.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)


def check_copy():
    manifest_path = ROOT / 'MIGRATION_MANIFEST.json'
    checked = 0
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        failures = []
        for item in manifest['files']:
            relative = Path(item['path'])
            if relative.is_absolute() or '..' in relative.parts:
                raise RuntimeError('迁移清单包含不合法路径。')
            path = ROOT / relative
            if not path.is_file() or digest(path) != item['sha256']:
                failures.append(item['path'])
            checked += 1
        if failures:
            raise RuntimeError('以下文件与迁移时的快照不同（采集后原始表和证据表变化属于正常情况）：\n' + '\n'.join(failures[:30]))
    else:
        print('当前为源项目目录；尚无解压后的迁移清单，仅校验本地运行资产。', flush=True)
    sys.argv = ['scripts/install.py', '--app-only']
    runpy.run_path(str(ROOT / 'scripts/install.py'), run_name='__main__')
    print(json.dumps({'status': 'passed', 'migration_files_checked': checked, 'python': sys.version.split()[0], 'local_assets': 'verified', 'timezone': 'Asia/Shanghai', 'real_camera_validation': 'pending_manual_acceptance'}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description='IPP31078 笔记本本地入口；需要 Python 3.12+。')
    parser.add_argument('action', nargs='?', default='serve', choices=['serve', 'check', 'install', 'analyze', 'evaluate', 'build', 'import-demo'])
    args, extra = parser.parse_known_args()
    prepare_runtime()
    if args.action == 'check':
        if extra:
            parser.error('check 不需要其他参数')
        check_copy()
        return 0
    if args.action == 'build':
        node = shutil.which('node')
        if not node:
            raise RuntimeError('重新构建需要 Node.js。直接体验请运行 launch.py serve，无需构建。')
        return subprocess.run([node, str(ROOT / 'scripts/build.mjs'), '--package', *extra], cwd=ROOT).returncode
    scripts = {'serve': 'serve.py', 'install': 'install.py', 'analyze': 'analyze.py', 'evaluate': 'evaluate.py', 'import-demo': 'import_demo.py'}
    if args.action == 'serve':
        print('IPP31078 正在本机启动。请在本机 Chrome 打开 http://127.0.0.1:8765 ，保持此窗口打开。', flush=True)
        print('如指定了 --port，请打开对应端口。Ctrl+C 停止；摄像头需本人主动授权。', flush=True)
    script = ROOT / 'scripts' / scripts[args.action]
    sys.argv = [str(script), *extra]
    runpy.run_path(str(script), run_name='__main__')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print('\n已停止本地服务。')
    except (RuntimeError, OSError, ValueError) as error:
        print('启动检查未通过：' + str(error), file=sys.stderr)
        raise SystemExit(1)
