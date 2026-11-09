"""Check local app assets and install optional plotting/video tools into this project."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--app-only',action='store_true');args=parser.parse_args()
    lock_path=ROOT/'evidence/dependency_lock.json'
    if not lock_path.exists():raise SystemExit('缺少依赖清单，请使用完整交付包。')
    lock=json.loads(lock_path.read_text());missing=[]
    for item in lock['files']:
        path=ROOT/item['path']
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:missing.append(item['path'])
    if missing:
        fetcher=ROOT/'scripts/fetch_assets.py'
        if not fetcher.exists():raise SystemExit('交付包缺失资产，请重新复制完整app目录：'+','.join(missing))
        print('正在修复固定版本运行资产，首次下载需要网络。',flush=True);subprocess.run([sys.executable,str(fetcher)],cwd=ROOT,check=True)
    catalog=json.loads((ROOT/'app/avatar_catalog.json').read_text())
    for model in catalog['avatars']:
        path=ROOT/'app'/model['asset_path']
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=model['sha256']:raise SystemExit('卡通化身缺失或被修改：'+model['label']+'；请使用完整交付包或重新构建。')
    print('本地运行资产校验通过。原型可离线运行。',flush=True)
    if not args.app_only:
        target=ROOT/'.analysis_deps'
        lock=ROOT/'analysis-requirements.lock.txt'
        print('将固定版本绘图和视频工具安装到当前项目.analysis_deps；需要网络，不修改系统Python。',flush=True)
        subprocess.run([sys.executable,'-m','pip','install','--disable-pip-version-check','--target',str(target),'--upgrade','-r',str(lock if lock.exists() else ROOT/'requirements-analysis.txt')],cwd=ROOT,check=True)
        print('分析与本地MP4转换工具已安装。',flush=True)

if __name__=='__main__':main()
