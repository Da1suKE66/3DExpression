"""Create a source-only publication directory from an explicit allowlist.

Never copies raw recordings, participants, personal school documents or the local
project state. Vendored runtime binaries are fetched from the pinned public URLs
after cloning. The original project is untouched.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import shutil

ROOT=Path(__file__).resolve().parents[1]
TOP=['README.md','ASSET_SOURCES.md','launch.py','启动_笔记本.command','启动_笔记本_Windows.bat','启动原型.command','安装环境.command','构建检查.command','运行分析.command','评估分析.command','requirements-analysis.txt','analysis-requirements.lock.txt']
SCRIPTS=['serve.py','session_data.py','evidence_registry.py','video_tools.py','runtime_paths.py','install.py','fetch_assets.py','create_avatar.mjs','build.mjs','analyze.py','evaluate.py','import_demo.py','prepare_public_repo.py']
TESTS=['core.test.mjs','expressions.test.mjs','test_pipeline.py','test_server.py','test_evaluation.py']
MATERIALS=['experience_protocol.md','operator_guide.md','data_dictionary.md','questionnaire_blank.md','evaluation_protocol.md']

def prepare(destination):
    destination=Path(destination).resolve()
    if destination==ROOT or destination.is_relative_to(ROOT):raise ValueError('发布目录须在原项目之外，避免覆盖工作区')
    if destination.exists() and any(destination.iterdir()):raise ValueError('发布目录必须为空；已有工作不会被覆盖')
    destination.mkdir(parents=True,exist_ok=True)
    paths=[*map(Path,TOP),*[Path('scripts')/n for n in SCRIPTS],*[Path('tests')/n for n in TESTS],*[Path('materials')/n for n in MATERIALS]]
    paths += [p.relative_to(ROOT) for p in (ROOT/'app').iterdir() if p.is_file() and p.suffix in ('.js','.json','.css','.html')]
    catalog=json.loads((ROOT/'app/avatar_catalog.json').read_text())
    paths += [Path('app')/model['asset_path'] for model in catalog['avatars']]
    paths += [Path('app/vendor/THREE-LICENSE.txt'),Path('app/vendor/MEDIAPIPE-LICENSE.txt'),Path('evidence/dependency_lock.json'),Path('evidence/model_inspection_v3_1.json'),Path('evidence/testing/v3_1/build_report.json'),Path('evidence/testing/v3_1/browser_render_check.json'),Path('evidence/testing/v3_1/original_browser_check.json'),Path('evidence/testing/v3_1/original_geometry_restore.json')]
    paths += [p.relative_to(ROOT) for p in (ROOT/'portable').iterdir() if p.is_file()]
    for rel in paths:
        source=ROOT/rel
        if source.is_symlink() or not source.is_file():raise ValueError('发布文件不存在或不是普通文件：'+str(rel))
        target=destination/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    for name in ['SYNTHETIC_doraemon.jpg','SYNTHETIC_doraemon_closed.jpg','SYNTHETIC_pikachu.jpg','SYNTHETIC_pikachu_closed.jpg','SYNTHETIC_original.jpg','SYNTHETIC_original_closed.jpg']:
        target=destination/'docs/assets'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/'evidence/testing/v3_1'/name,target)
    for name in ['engineering_acceptance.csv','video_metric_annotations.csv']:
        source=(ROOT/'templates'/name) if (ROOT/'templates'/name).exists() else ROOT/'materials'/name
        with source.open(encoding='utf-8-sig',newline='') as handle:fields=next(csv.reader(handle))
        template=destination/'templates'/name;template.parent.mkdir(parents=True,exist_ok=True)
        with template.open('w',encoding='utf-8-sig',newline='') as handle:csv.writer(handle).writerow(fields)
    raw=destination/'data/raw';raw.mkdir(parents=True)
    with (ROOT/'templates/participants.csv').open(encoding='utf-8-sig',newline='') as handle:fields=next(csv.reader(handle))
    with (destination/'templates/participants.csv').open('w',encoding='utf-8-sig',newline='') as handle:csv.writer(handle).writerow(fields)
    (raw/'README.md').write_text('# 本机原始数据\n\n只随仓库提供空表。真实记录、录像和参与者数据保存在本机，不提交到Git。\n')
    (destination/'.gitignore').write_text('''# Local runtime and private data
.DS_Store
__pycache__/
*.pyc
node_modules/
.analysis_deps/
.venv/
*.partial
app/vendor/**
!app/vendor/THREE-LICENSE.txt
!app/vendor/MEDIAPIPE-LICENSE.txt
app/models/face_landmarker.task
data/raw/**
!data/raw/README.md
materials/engineering_acceptance.csv
materials/video_metric_annotations.csv
data/processed/
media/
evidence/live_*/
evidence/history/
evidence/publish_*/
evidence/testing/*/sessions/
delivery/
input/
*.doc
*.docx
*.pptx
project_meta.json
PROJECT_STATE.md
MIGRATION_MANIFEST.json
''')
    # Filled operational tables stay ignored; only templates are versioned.
    (destination/'.gitattributes').write_text('*.command text eol=lf\n*.bat text eol=crlf\n*.glb binary\n*.whl binary\n*.jpg binary\n')
    (destination/'tests/README.md').write_text('# 检查\n\n先下载固定运行资产，然后运行README中的JS和Python检查。夹具只写临时目录或明确标记的synthetic_test目录，不写成真人数据。软件形变检查页不请求真人摄像头。\n')
    files=[]
    for path in sorted(destination.rglob('*')):
        if not path.is_file():continue
        rel=str(path.relative_to(destination))
        if path.is_symlink() or '/live_sessions/' in rel or '/tracking/' in rel or '/evaluations/' in rel or 'live_acceptance' in rel or rel.endswith(('.mp4','.webm','.mov','.doc','.docx','.pptx')):raise ValueError('发现不应发布的文件：'+rel)
        if rel.startswith('templates/') and rel.endswith('.csv'):
            with path.open(encoding='utf-8-sig',newline='') as handle:
                if list(csv.DictReader(handle)):raise ValueError('发布模板中有实际数据：'+rel)
        data=path.read_bytes();files.append({'path':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'mode':'100755' if path.suffix=='.command' else '100644'})
    manifest={'repository':'Da1suKE66/3DExpression','source_version':'0.3.1','scope':'source_model_blank_templates_and_synthetic_software_evidence_only','human_data_included':False,'files':files,'file_count':len(files),'bytes':sum(f['bytes'] for f in files)}
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('destination',type=Path);parser.add_argument('--manifest',type=Path,required=True);args=parser.parse_args()
    result=prepare(args.destination);args.manifest.parent.mkdir(parents=True,exist_ok=True);args.manifest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='files'},ensure_ascii=False,indent=2))
