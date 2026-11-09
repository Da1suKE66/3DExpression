"""Engineering metrics with explicit measurement scope and missing-data states.

No external dependencies. Real camera claims and manual video annotations remain
separate from synthetic software checks and questionnaire participants.
"""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from collections import defaultdict
import argparse
import csv
import hashlib
import json
import math
import statistics

from session_data import validate_tracking, validate_session, validate_evaluation, specification, uuid

ROOT = Path(__file__).resolve().parents[1]
METRICS = {
    'end_to_end_latency': ('系统性能', '端到端延迟', 'ms'),
    'tracking_fps': ('系统性能', '面部跟踪帧率', 'Hz'),
    'rendering_fps': ('系统性能', '化身渲染帧率', 'fps'),
    'tracking_success_rate': ('系统性能', '跟踪成功率', 'fraction'),
    'frame_drop_rate': ('系统性能', '丢帧率', 'fraction'),
    'recovery_time': ('系统性能', '跟踪恢复时间', 'ms'),
    'expression_jitter': ('系统性能', '表情参数抖动', 'coefficient'),
    'action_response_success_rate': ('交互行为', '面部动作响应成功率', 'fraction'),
    'expression_response_time': ('交互行为', '表情响应时间', 'ms'),
    'switching_stability': ('交互行为', '连续动作切换稳定性', 'coefficient'),
    'task_completion_time': ('交互行为', '用户任务完成时间', 's'),
    'expression_drive_consistency': ('交互行为', '不同表情的驱动一致性', 'coefficient'),
}
ACTION_CHANNELS = {
    'jaw':['jawOpen'], 'blink':['eyeBlinkLeft','eyeBlinkRight'],
    'smile':['mouthSmileLeft','mouthSmileRight'],
    'sad':['mouthFrownLeft','mouthFrownRight','browInnerUp'],
    'surprise':['browOuterUpLeft','browOuterUpRight','eyeWideLeft','eyeWideRight','jawOpen'],
    'angry':['browDownLeft','browDownRight','mouthPressLeft','mouthPressRight'],
    'pucker':['mouthPucker'], 'head_yaw':['pose_yaw'], 'head_pitch':['pose_pitch'],
    'head_roll':['pose_roll'], 'switching':['mouthSmileLeft','mouthFrownLeft','browOuterUpLeft','mouthPucker'],
}

def finite(value): return type(value) in (int,float) and math.isfinite(value)
def median(values):
    values=[v for v in values if finite(v)]
    return statistics.median(values) if values else None
def rms(values):
    values=[v for v in values if finite(v)]
    return math.sqrt(statistics.mean(v*v for v in values)) if values else None
def correlation(a,b):
    if len(a)<4 or len(a)!=len(b): return None
    ma,mb=statistics.mean(a),statistics.mean(b)
    da,db=[x-ma for x in a],[x-mb for x in b]
    denominator=math.sqrt(sum(x*x for x in da)*sum(x*x for x in db))
    return sum(x*y for x,y in zip(da,db))/denominator if denominator>1e-10 else None
def metric(key,value=None,status='pending',method='',n=0,details=None):
    section,label,unit=METRICS[key]
    return {'id':key,'section':section,'label':label,'value':value,'unit':unit,'status':status,'method':method,'n':n,'details':details or {}}

def load_records(root):
    records, issues, by_id = [], [], {}
    for folder in ['data/raw/tracking','data/raw/live_sessions','data/raw/evaluations']:
        for path in sorted((root/folder).glob('*.json')):
            rel=str(path.relative_to(root))
            try:
                data=json.loads(path.read_text(encoding='utf-8-sig'))
                if not isinstance(data,dict): raise ValueError('JSON根须为对象')
                if data.get('source_type')!='live_camera':
                    issues.append({'path':rel,'code':'excluded_source','message':'非live_camera，不进入真人工程报告'});continue
                evaluation=data if data.get('record_type')=='engineering_evaluation' else None
                tracking=data['tracking'] if evaluation else data
                errors=validate_evaluation(data) if evaluation else validate_session(data) if data.get('record_type')=='study_session' else validate_tracking(data)
                if errors: raise ValueError('；'.join(errors))
                sid=tracking['session_id']; frame_hash=hashlib.sha256(json.dumps(tracking['frames'],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
                if sid in by_id:
                    old=by_id[sid]
                    if old['frame_hash']!=frame_hash:
                        old['conflict']=True; issues.append({'path':rel,'code':'conflicting_session','message':'同编号不同参数，保留原件并排除冲突记录'})
                    elif evaluation and not old['evaluation']:
                        old.update(evaluation=evaluation,path=rel)
                    else: issues.append({'path':rel,'code':'duplicate_merged','message':'同会话同参数合并，不重复计数'})
                    continue
                item={'path':rel,'record':tracking,'evaluation':evaluation,'frame_hash':frame_hash,'conflict':False,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
                by_id[sid]=item;records.append(item)
            except (ValueError,KeyError,TypeError,OSError) as error:
                issues.append({'path':rel,'code':'invalid_record','message':str(error)})
    return [r for r in records if not r['conflict']],issues

def video_annotations(root, issues):
    path=root/'materials/video_metric_annotations.csv'
    if not path.exists(): return []
    valid=[]
    with path.open(encoding='utf-8-sig',newline='') as handle:
        for line,row in enumerate(csv.DictReader(handle),2):
            if not any(row.values()): continue
            try:
                if row.get('source_type')!='live_camera': raise ValueError('不是实时真人来源')
                key=row.get('metric'); scope=row.get('recording_scope')
                if not uuid(row.get('session_id')): raise ValueError('缺少与工程记录对应的会话UUID')
                if key not in ('end_to_end_latency','expression_response_time','recovery_time'): raise ValueError('标注指标未知')
                video=(root/row['recording_path']).resolve()
                if not video.is_relative_to((root/'media/raw').resolve()) or not video.is_file(): raise ValueError('录像须为media/raw中的实际文件')
                actual=hashlib.sha256(video.read_bytes()).hexdigest()
                if actual!=row.get('recording_sha256'): raise ValueError('录像摘要不匹配')
                if scope not in ('external_face_and_display','browser_composite'): raise ValueError('录像视野来源未标明')
                if row.get('capture_rate_verified')!='yes': raise ValueError('实际拍摄帧率尚未人工核对，不能用慢动作文件播放帧率代替')
                fps=float(row['actual_capture_fps']);first=float(row['input_onset_frame']);last=float(row['output_onset_frame'])
                if not all(math.isfinite(x) for x in [fps,first,last]) or not 1<=fps<=1000 or first<0 or last<first or first!=int(first) or last!=int(last): raise ValueError('帧率或起止帧无效')
                if not row.get('annotator','').strip() or not row.get('event_id','').strip(): raise ValueError('缺少标注者或事件编号')
                item={**row,'delay_ms':(last-first)*1000/fps,'frame_quantization_bound_ms':2000/fps,'physical':scope=='external_face_and_display'}
                if any(old['event_id']==item['event_id'] and old['metric']==key for old in valid): raise ValueError('重复事件标注，需先人工核对')
                valid.append(item)
            except (ValueError,KeyError,TypeError,OSError) as error:
                issues.append({'path':str(path.relative_to(root)),'line':line,'code':'invalid_video_annotation','message':str(error)})
    return valid

def paired_channels(frames,channels):
    result=[]
    for channel in channels:
        pairs=[(f.get('corrected_'+channel),f.get('applied_'+channel)) for f in frames if f.get('detected')==1 and f.get('condition')=='B' and (not channel.startswith('pose_') or f.get('pose_valid'))]
        pairs=[(a,b) for a,b in pairs if finite(a) and finite(b)]
        if len(pairs)<4: continue
        a,b=zip(*pairs)
        result.append({'channel':channel,'samples':len(pairs),'mean_absolute_error':statistics.mean(abs(x-y) for x,y in pairs),'pearson_r':correlation(a,b),'reference':'calibrated_input','output':'smoothed_applied_coefficient','unit':'rad' if channel.startswith('pose_') else 'coefficient'})
    return result

def summarize_record(item, annotations):
    record=item['record'];evaluation=item['evaluation'];frames=record['frames']
    results=[f for f in frames if f.get('sample_kind')=='result']
    times=[f['monotonic_ms'] for f in results]
    duration=(times[-1]-times[0])/1000 if len(times)>1 else 0
    visible=evaluation.get('visible_duration_ms',0)/1000 if evaluation else 0
    tracking_rate=len(results)/visible if visible>0 else (len(results)-1)/duration if duration>0 else None
    output={}
    output['tracking_fps']=metric('tracking_fps',tracking_rate,'measured' if tracking_rate is not None else 'unavailable','实际推理结果数/评估前台可见秒数' if visible else '相邻结果时间戳跨度平均率；旧日志无法排除所有后台时间',len(results),{'span_s':duration,'visible_s':visible or None})
    rendering=evaluation['render_count']/visible if visible>0 else median(f.get('render_fps') for f in frames)
    output['rendering_fps']=metric('rendering_fps',rendering,'measured' if rendering is not None else 'unavailable','实际渲染调用计数/前台可见秒数' if visible else '日志中的实际渲染率中位数；不等于显示器呈现帧率',evaluation['render_count'] if evaluation else len(frames))
    eligible=[f for f in results if f.get('expected_face_visible') is True]
    detection=eligible or results
    fraction=sum(f['detected'] for f in detection)/len(detection) if detection else None
    output['tracking_success_rate']=metric('tracking_success_rate',fraction,'measured_sample_fraction' if eligible else 'proxy' if fraction is not None else 'unavailable','标记要求面部可见的检测样本成功比例；仍需核对真人画面' if eligible else '无逐帧面部可见真值，仅报告检测样本比例，不是检测准确率',len(detection))
    quality0=evaluation.get('video_quality_start') if evaluation else record.get('video_quality_start')
    quality1=evaluation.get('video_quality_end') if evaluation else record.get('video_quality_end')
    drop=total=dropped=None
    if isinstance(quality0,dict) and isinstance(quality1,dict):
        keys=['total_video_frames','dropped_video_frames']
        if all(finite(q.get(k)) for q in [quality0,quality1] for k in keys):
            total=quality1[keys[0]]-quality0[keys[0]];dropped=quality1[keys[1]]-quality0[keys[1]]
            if total>0 and 0<=dropped<=total: drop=dropped/total
    output['frame_drop_rate']=metric('frame_drop_rate',drop,'measured_browser_counter' if drop is not None else 'unavailable','浏览器视频丢帧计数增量/总帧计数增量；主动降低推理采样率不算丢帧',int(total) if total and total>0 else 0,{'dropped':dropped,'total':total,'limitation':'浏览器计数不包含相机传感器之前丢失的帧；零或缺失总计数不解释为零丢帧'})
    for key in ['end_to_end_latency','expression_response_time','recovery_time']:
        values=[a for a in annotations if a['metric']==key and a['physical'] and a['session_id']==record['session_id']]
        output[key]=metric(key,median(a['delay_ms'] for a in values),'measured_manual_video' if values else 'pending_external_video','独立摄像机同时拍摄本人脸与显示器；人工标注输入和输出起始帧，按核对后的实际拍摄帧率换算',len(values),{'events':[{'event_id':a['event_id'],'delay_ms':a['delay_ms'],'frame_quantization_bound_ms':a['frame_quantization_bound_ms']} for a in values],'scope':'所附同步录像标注，不代表每一份参数记录独立测量'})
    trials=evaluation['trials'] if evaluation else []
    neutral_ids={t['trial_id'] for t in trials if t['action']=='neutral' and t['status']=='completed' and t['end_monotonic_ms']-t['start_monotonic_ms']>=10000}
    neutral=[f for f in results if f.get('trial_id') in neutral_ids and f['detected']==1]
    coefficients=specification(record)[0]['coefficients'];jitter={}
    # Pair only consecutive samples inside the same stationary trial, no loss gap.
    for key in coefficients:
        pairs=[(a,b) for a,b in zip(neutral,neutral[1:]) if a.get('trial_id')==b.get('trial_id') and 0 < b['monotonic_ms']-a['monotonic_ms']<=200]
        before=[b['raw_'+key]-a['raw_'+key] for a,b in pairs]
        after=[b['applied_'+key]-a['applied_'+key] for a,b in pairs]
        if pairs: jitter[key]={'raw_successive_difference_rms':rms(before),'applied_successive_difference_rms':rms(after),'samples':len(pairs)+1}
    output['expression_jitter']=metric('expression_jitter',median(v['applied_successive_difference_rms'] for v in jitter.values()),'measured_neutral_segment' if jitter else 'pending_neutral_trial','至少10秒的已完成中性任务内，逐系数相邻样本差分RMS；动作段不当作静态抖动',len(neutral),{'per_channel':jitter,'limitation':'中性保持是操作者任务声明，需核对视频是否确实静止；差分RMS与采样频率有关'})
    observed=[t for t in trials if t['status']=='completed' and t.get('observed_successes') is not None and t['requested_repetitions']>0 and t.get('observation_method')=='operator_visual_count']
    requested=sum(t['requested_repetitions'] for t in observed);successes=sum(t['observed_successes'] for t in observed)
    output['action_response_success_rate']=metric('action_response_success_rate',successes/requested if requested else None,'measured_operator_observation' if requested else 'pending_operator_observation','实际肉眼观察到的响应次数/已人工核对试次要求次数；未核对试次不进入分母',requested,{'observed_successes':successes,'scored_trials':len(observed),'unscored_trials':sum(t['requested_repetitions']>0 and t.get('observed_successes') is None for t in trials),'per_trial':observed})
    completed=[t for t in trials if t['status']=='completed' and t['action']!='neutral']
    output['task_completion_time']=metric('task_completion_time',median((t['end_monotonic_ms']-t['start_monotonic_ms'])/1000 for t in completed),'measured_user_completion_event' if completed else 'pending_completed_trials','点击开始本项至点击完成本项的墙钟用时；包含反应、操作及可能的切页时间',len(completed),{'trials':[{'action':t['action'],'wall_s':(t['end_monotonic_ms']-t['start_monotonic_ms'])/1000,'visible_s':t.get('visible_duration_ms',0)/1000} for t in completed]})
    consistency={}
    for trial in completed:
        selected=[f for f in results if f.get('trial_id')==trial['trial_id']]
        channels=paired_channels(selected,ACTION_CHANNELS.get(trial['action'],[]))
        if channels: consistency[trial['trial_id']]={'action':trial['action'],'channels':channels}
    values=[c['mean_absolute_error'] for t in consistency.values() for c in t['channels'] if c['unit']=='coefficient']
    output['expression_drive_consistency']=metric('expression_drive_consistency',median(values),'measured_parameter_agreement' if consistency else 'pending_labelled_trials','各动作已校准输入与实际平滑驱动的同时间配对MAE及相关；不等于真实情绪识别准确率',sum(len(t['channels']) for t in consistency.values()),{'per_trial':consistency,'limitation':'80ms平滑会产生正常相位差；低变异输入的相关系数返回空值'})
    switching=[f for f in results if any(t['action']=='switching' and t['status']=='completed' and t['trial_id']==f.get('trial_id') for t in trials) and f['detected']==1 and f['condition']=='B']
    switch_diffs=[]
    for a,b in zip(switching,switching[1:]):
        if a.get('trial_id')==b.get('trial_id') and 0<b['monotonic_ms']-a['monotonic_ms']<=200:
            switch_diffs.extend(b['applied_'+k]-a['applied_'+k] for k in ACTION_CHANNELS['switching'])
    output['switching_stability']=metric('switching_stability',rms(switch_diffs),'measured_signal_descriptor' if switch_diffs else 'pending_switching_trial','连续切换任务中输出参数相邻差分RMS；结合丢失情况及人工备注判断，未设定通过阈值',len(switching),{'limitation':'刻意动作本身也会变化；此数值不直接判定稳定或不稳定'})
    loss_gaps=[];loss_start=None
    for frame in results:
        if not frame['detected'] and loss_start is None: loss_start=frame['monotonic_ms']
        elif frame['detected'] and loss_start is not None: loss_gaps.append(frame['monotonic_ms']-loss_start);loss_start=None
    pipeline={key:{'median_ms':median(f.get(key) for f in results),'n':sum(finite(f.get(key)) for f in results)} for key in ['inference_ms','frame_to_render_submit_ms','video_present_to_render_submit_ms']}
    return {'session_id':record['session_id'],'protocol_version':record['protocol_version'],'app_version':record['app_version'],'source_type':'live_camera','input_path':item['path'],'input_sha256':item['sha256'],'metrics':[output[key] for key in METRICS], 'diagnostics':{'pipeline_times':pipeline,'pipeline_note':'这些浏览器管线时间均不是物理端到端延迟。','observed_loss_gap_ms':loss_gaps,'loss_gap_note':'从丢失检测到重获检测的间隔，不是从本人已返回到重获检测的恢复时间。','real_camera_authenticity':'requires_operator_review'}}

def write_csv(path,rows,fields):
    with path.open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.DictWriter(handle,fieldnames=fields);writer.writeheader();writer.writerows(rows)

def run(root=ROOT):
    root=Path(root).resolve();records,issues=load_records(root);annotations=video_annotations(root,issues)
    reports=[summarize_record(record,annotations) for record in records]
    out=root/'data/processed/evaluation';out.mkdir(parents=True,exist_ok=True)
    report={'generated_at':datetime.now(ZoneInfo('Asia/Taipei')).isoformat(timespec='seconds'),'status':'real_engineering_records_available' if reports else 'no_real_engineering_records','metric_count':len(METRICS),'real_record_count':len(reports),'questionnaire_participants_added':0,'protocols':sorted({r['protocol_version'] for r in reports}),'records':reports,'valid_video_annotations':annotations,'validation_issues':issues,'conclusion':'按协议和每份记录分别报告；缺失指标保留待采集。工程记录不增加参与者人数，不支持具身感效果或因果结论。'}
    (out/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    rows=[{'session_id':r['session_id'],'protocol_version':r['protocol_version'],**{k:m[k] for k in ['section','id','label','value','unit','status','method','n']}} for r in reports for m in r['metrics']]
    write_csv(out/'metrics.csv',rows,['session_id','protocol_version','section','id','label','value','unit','status','method','n'])
    issue_rows=[{'path':i.get('path',''),'code':i['code'],'message':i['message']} for i in issues]
    write_csv(out/'validation_issues.csv',issue_rows,['path','code','message'])
    note=['# 工程评估结果','',f"生成时间：{report['generated_at']}。真实来源声明下的工程记录：{len(reports)}份。",'',report['conclusion'],'','本次覆盖图中的7项系统性能和5项交互行为指标。measured表示按所列方法测得；proxy表示近似指标；pending/unavailable表示缺少所需数据，不能理解为零。','']
    if not reports: note += ['当前无真实工程记录；12项均待采集。','']
    for r in reports:
        note += [f"## {r['protocol_version']} / {r['session_id']}",'',f"来源：`{r['input_path']}`。",'','| 类别 | 指标 | 数值 | 单位 | 状态 |','| --- | --- | ---: | --- | --- |']
        for m in r['metrics']:
            value='待采集' if m['value'] is None else f"{m['value']:.4f}"
            note.append(f"| {m['section']} | {m['label']} | {value} | {m['unit']} | {m['status']} |")
        note += ['','各指标定义、分母和限制详见results.json及materials/evaluation_protocol.md。单次推理和浏览器提交时间不代替端到端延迟。','']
    (out/'report.md').write_text('\n'.join(note)+'\n',encoding='utf-8')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=ROOT);args=parser.parse_args()
    result=run(args.root)
    print(json.dumps({'status':result['status'],'real_record_count':result['real_record_count'],'metric_count':result['metric_count'],'validation_issues':len(result['validation_issues']),'report':str(args.root/'data/processed/evaluation/report.md')},ensure_ascii=False,indent=2))
