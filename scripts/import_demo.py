"""Import an explicitly labelled video without overwriting the source or earlier evidence."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from uuid import uuid4
import argparse
import hashlib
import json
import shutil
import tempfile

from video_tools import ensure_mp4, inspect_video
from evidence_registry import register

ROOT=Path(__file__).resolve().parents[1]

def import_video(source,source_type,root=ROOT):
    source=Path(source).resolve();root=Path(root).resolve()
    if not source.is_file():raise ValueError('输入录像不存在')
    if source_type not in ['live_camera','recorded_tracking','synthetic_test']:raise ValueError('必须明确提供实际来源')
    with tempfile.TemporaryDirectory(prefix='ipp31078_import_') as temp:
        converted=Path(temp)/'converted.mp4';mime='video/mp4' if source.suffix.lower()=='.mp4' else 'video/other'
        method=ensure_mp4(source,converted,mime);inspection=inspect_video(converted)
        if inspection['duration_s'] is None:raise ValueError('请先运行安装环境.command，以验证实际录像时长')
        if inspection['duration_s']<20:raise ValueError('实际录像少于20秒，请保留原件并重新录制22–25秒')
        folder=root/('media/raw' if source_type=='live_camera' else 'media/output' if source_type=='recorded_tracking' else 'evidence/testing/v2')
        folder.mkdir(parents=True,exist_ok=True);stem='01_live' if source_type=='live_camera' else source_type+'_video'
        destination=folder/(stem+'.mp4')
        if destination.exists():destination=folder/(stem+'_'+datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d_%H%M%S')+'_'+str(uuid4())[:6]+'.mp4')
        with destination.open('xb') as handle:handle.write(converted.read_bytes())
    eid='IMPORTED-VIDEO-'+str(uuid4());metadata={'source_type':source_type,'input_name':source.name,'input_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'output_sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'saved_at':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),'media_validation':inspection,'conversion':method,'authenticity':'user_declared_source_pending_manual_review','source_original_preserved':True}
    sidecar=destination.with_suffix('.metadata.json');sidecar.write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    register(eid,'video' if source_type!='synthetic_test' else 'test',destination,'explicit_user_declared_'+source_type,'imported_demonstration_not_questionnaire_data','pending_manual_verification' if source_type=='live_camera' else 'excluded_from_real_research', 'yes' if source_type=='live_camera' else 'unknown','保留输入原件，未仅修改扩展名。',root=root)
    register(eid+'-META','document',sidecar,eid,'source_hash_duration_and_conversion','source_declaration_recorded','unknown',root=root)
    return {'path':str(destination.relative_to(root)),'source_type':source_type,'duration_s':inspection['duration_s'],'evidence_id':eid}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('video',type=Path);parser.add_argument('--source',required=True,choices=['live_camera','recorded_tracking','synthetic_test']);args=parser.parse_args()
    try:print(json.dumps(import_video(args.video,args.source),ensure_ascii=False,indent=2))
    except (ValueError,OSError) as error:raise SystemExit(str(error))
