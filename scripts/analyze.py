"""Validate declared live observations and report per-item paired descriptions only."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from statistics import mean, median, stdev
from collections import defaultdict, Counter
from itertools import permutations
import argparse
import csv
import hashlib
import json
import math
import os

import runtime_paths
from session_data import validate_session, validate_tracking, participant_id, timestamp, QUESTIONS, COEFFICIENTS, PROTOCOL, PARTICIPANT_COLUMNS, CURRENT_CONDITIONS
from evidence_registry import register

ROOT = Path(__file__).resolve().parents[1]
LABELS = {question['id']: question['label'] for question in PROTOCOL['questions']}
LIMITATIONS = [
    'A/B除同步外仍有内容和录制者差异；B/C延迟变量更明确。本设计不是完整双因素析因设计，不能报告独立主效应与交互效应。',
    '400ms是人为设定；实际软件缓冲和软件链路分别报告，均不等于物理屏幕端到端视觉延迟。A不存在本人与输出的实时响应配对。',
    '六题是自编探索性条目，逐题报告，不合成为具身感总分；1–7分属于有序评分，均值和差值仅作描述。',
    '目标约6人不等于已招募人数；参与者数按实际匿名编号去重，是否同一人使用多个编号仍需操作者核对。',
    '内部试用与外部探索性体验分开；synthetic_test和recorded_tracking不进入真人评分或真实摄像头工程统计。',
    '桌面简化卡通化身、三条件相同头部跟随，不能推广到沉浸VR、全身具身感或一般人群。',
    '没有显著性检验、预设正向结果、因果结论或效能证明；小样本顺序和练习影响仍存在。',
    '推理耗时是detectForVideo执行时间，不是端到端延迟；更新率由实际结果时间戳计算，画面帧率来自实际渲染计数。',
    '检测比例是已记录采样的状态比例；丢失时长按采样边界估算，不是全视频逐帧真值。动作系数阈值计数不是动作识别准确率。',
    '文件中的live_camera是来源声明，真实性、同意和操作者身份仍须对照原始演示与记录人工核验。',
]

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def stats(values):
    if not values:
        return {'n': 0, 'mean': None, 'median': None, 'sd': None, 'min': None, 'max': None}
    return {'n': len(values), 'mean': mean(values), 'median': median(values), 'sd': stdev(values) if len(values) > 1 else None, 'min': min(values), 'max': max(values)}

def percent(values, p):
    if not values:
        return None
    values = sorted(values); i = (len(values) - 1) * p
    return values[math.floor(i)] + (values[math.ceil(i)] - values[math.floor(i)]) * (i - math.floor(i))

def signal_cycles(values, low=0.15, high=0.35):
    armed, count = True, 0
    for value in values:
        if value <= low:
            armed = True
        if armed and value >= high:
            count += 1; armed = False
    return count

def engineering_metrics(record):
    output = []
    for condition in (CURRENT_CONDITIONS if record.get('record_type') == 'study_session' else ('A','B','static_neutral')):
        frames = [frame for frame in record['frames'] if frame['condition'] == condition]
        if not frames:
            continue
        result_frames = [frame for frame in frames if frame.get('sample_kind') == 'result']
        times = sorted(set(frame['monotonic_ms'] for frame in result_frames))
        span_ms = times[-1] - times[0] if len(times) > 1 else 0
        inference = [frame['inference_ms'] for frame in result_frames if frame.get('inference_ms') is not None]
        fps = [frame['render_fps'] for frame in frames if frame.get('render_fps') is not None]
        apply_rates = [frame['avatar_update_hz'] for frame in frames if frame.get('avatar_update_hz') is not None]
        segments, loss_start = [], None
        for frame in frames:
            if not frame['detected'] and loss_start is None:
                loss_start = frame['monotonic_ms']
            if frame['detected'] and loss_start is not None:
                segments.append((frame['monotonic_ms'] - loss_start) / 1000); loss_start = None
        if loss_start is not None:
            segments.append(max(0, frames[-1]['monotonic_ms'] - loss_start) / 1000)
        row = {'session_id': record['session_id'], 'participant_id': record['participant_id'], 'record_kind': record['record_kind'], 'source_type': record['source_type'], 'record_type': record['record_type'], 'condition': condition, 'sample_count': len(frames), 'result_count': len(result_frames), 'observed_span_s': span_ms / 1000, 'result_update_hz': (len(times) - 1) * 1000 / span_ms if span_ms else None, 'logged_render_fps_median': median(fps) if fps else None, 'logged_avatar_update_hz_median': median(apply_rates) if apply_rates else None, 'detected_sample_fraction': mean(frame['detected'] for frame in frames), 'loss_segments': len(segments), 'estimated_loss_total_s': sum(segments), 'estimated_longest_loss_s': max(segments) if segments else 0, 'inference_ms_median': median(inference) if inference else None, 'inference_ms_p95': percent(inference, 0.95)}
        signals = {key: [frame['raw_' + key] for frame in frames if frame['detected']] for key in COEFFICIENTS}
        row['signal_ranges'] = {key: {'min': min(values) if values else None, 'max': max(values) if values else None, 'threshold_cycles_estimate': signal_cycles(values)} for key, values in signals.items()}
        output.append(row)
    for row in output:
        rows=[f for f in record['frames'] if f['condition']==row['condition']]
        results=[f for f in rows if f.get('sample_kind')=='result']
        row['tracking_success_rate']=sum(f['detected'] for f in results)/len(results) if results else None
        for source,target in [('camera_input_fps','camera_input_fps_median'),('software_latency_ms','software_latency_ms_median'),('actual_buffer_delay_ms','actual_buffer_delay_ms_median')]:
            values=[f[source] for f in rows if f.get(source) is not None]
            row[target]=median(values) if values else None
        row['added_delay_ms']=record['parameters'].get('added_delay_ms',0) if row['condition']=='C_delayed' else 0
        neutral=[f for f in results if f.get('evaluation_action')=='neutral' and f['detected']]
        row['neutral_jitter_sd']= {k:stdev([f['live_filtered_'+k] for f in neutral]) for k in COEFFICIENTS} if len(neutral)>1 else None
    return output

def parse_rating(row, source, line, issue):
    if not any(str(value).strip() for value in row.values() if value is not None):
        return None
    row = {key: value.strip() if isinstance(value,str) and key != 'comment' else value for key,value in row.items()}
    source_type = str(row.get('source_type') or '').strip()
    if source_type != 'live_camera':
        issue('excluded_source', source, line, row.get('participant_id', ''), row.get('session_id', ''), '来源为' + (source_type or '缺失') + '，不计入真人统计')
        return None
    if row.get('protocol_version') != PROTOCOL['protocol_version']:
        issue('excluded_protocol', source, line, row.get('participant_id',''), row.get('session_id',''), '旧版或未注明协议的评分不与当前协议合并')
        return None
    errors = []
    for key in ['participant_id', 'session_id', 'record_kind', 'condition_order', 'condition', 'submitted_at']:
        if not isinstance(row.get(key), str) or not row[key].strip():
            errors.append(key + '缺失')
    if not participant_id(row.get('participant_id')):
        errors.append('匿名编号格式无效')
    if row.get('record_kind') not in ('internal', 'exploratory'):
        errors.append('记录用途缺失或无效')
    if row.get('condition_order') not in [''.join(p) for p in permutations('ABC')] or row.get('condition') not in CURRENT_CONDITIONS:
        errors.append('条件或顺序无效')
    elif str(row.get('block_index')) != str(row['condition_order'].index(row['condition'][0])+1):
        errors.append('条件位置与顺序不一致')
    if not timestamp(row.get('submitted_at')):
        errors.append('自评时间须含时区')
    try:
        added=int(str(row.get('added_delay_ms','')))
        if not 0<=added<=2000 or (row.get('condition')!='C_delayed' and added!=0):raise ValueError()
    except (TypeError,ValueError):errors.append('附加延迟字段无效')
    if row.get('open_feedback')!=row.get('comment'):errors.append('开放反馈字段不一致')
    if row.get('overall_preference') not in (*CURRENT_CONDITIONS,'no_preference'): errors.append('整体偏好缺失或无效')
    scores = {}
    for key in QUESTIONS:
        value = str(row.get(key, '')).strip()
        try:
            numeric = float(value)
            if not math.isfinite(numeric) or numeric != int(numeric) or not 1 <= numeric <= 7:
                raise ValueError()
            score = int(numeric)
            scores[key] = score
        except (ValueError, TypeError):
            errors.append(key + '须为1–7整数，不能缺失')
    if errors:
        issue('invalid_rating', source, line, row.get('participant_id', ''), row.get('session_id', ''), '；'.join(errors))
        return None
    return {key: row.get(key, '') for key in PARTICIPANT_COLUMNS} | scores | {'_source': source, '_line': line}

def paired_summary(pairs):
    return {key: {'label': LABELS[key], 'A': stats([pair[key + '_A'] for pair in pairs]), 'B': stats([pair[key + '_B'] for pair in pairs]), 'C': stats([pair[key + '_C'] for pair in pairs]), 'B_minus_A': stats([pair[key + '_B_minus_A'] for pair in pairs]), 'C_minus_B': stats([pair[key + '_C_minus_B'] for pair in pairs])} for key in QUESTIONS}

def write_csv(path, fields, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction='ignore'); writer.writeheader(); writer.writerows(rows)

def checked_csv(path, required, source, issue):
    try:
        with path.open(encoding='utf-8-sig',newline='') as handle:
            reader=csv.DictReader(handle)
            if not set(required).issubset(reader.fieldnames or []):
                issue('invalid_csv_header',source,message='表头缺少必需字段');return []
            return list(enumerate(reader,2))
    except (UnicodeError,OSError,csv.Error) as error:
        issue('invalid_csv_file',source,message='无法按UTF-8 CSV读取：'+str(error));return []

def manual_engineering(root, source_name, issue):
    path=root/'materials/engineering_acceptance.csv'
    if not path.exists():return []
    fields=['record_id','source_type','started_at','action','requested_repetitions','operator_observed_repetitions','visual_response','tracking_loss_notes','observed_render_fps','observed_result_hz','continuous_duration_s','operator','notes']
    rows=[];groups=defaultdict(list)
    for line,row in checked_csv(path,fields,source_name,issue):
        if not any(str(value or '').strip() for value in row.values()):continue
        if row.get('source_type')!='live_camera':
            issue('excluded_engineering_source',source_name,line,message='人工工程记录来源不是live_camera，排除');continue
        errors=[];action=row.get('action');normalized=dict(row)
        if not row.get('record_id') or not timestamp(row.get('started_at')):errors.append('记录编号或带时区的实际时间缺失')
        if action not in ['jaw','blink','smile','combined','stability']:errors.append('动作须为jaw、blink、smile、combined或stability')
        if action in ['jaw','blink','smile','combined']:
            for key in ['requested_repetitions','operator_observed_repetitions']:
                try:
                    value=float(row.get(key) or '')
                    if not math.isfinite(value) or int(value)!=value or value<(1 if key=='requested_repetitions' else 0):raise ValueError()
                    normalized[key]=int(value)
                except (ValueError,TypeError):errors.append(key+'须为真实次数，不能空填或推算')
            if not str(row.get('visual_response') or '').strip():errors.append('实际视觉响应记录缺失')
        for key in ['observed_render_fps','observed_result_hz','continuous_duration_s']:
            if not row.get(key):
                if action=='stability':errors.append(key+'缺失')
                continue
            try:
                value=float(row[key])
                if not math.isfinite(value) or value<0:raise ValueError()
                normalized[key]=value
            except (ValueError,TypeError):errors.append(key+'无效')
        if errors:
            issue('invalid_engineering_observation',source_name,line,sid=row.get('record_id',''),message='；'.join(errors));continue
        normalized['source_file']=source_name;normalized['source_line']=line;groups[(row['record_id'],action)].append(normalized)
    for (rid,action),entries in groups.items():
        if len(entries)>1:issue('duplicate_engineering_observation',source_name,sid=rid,message='同记录编号和动作重复，需核对');continue
        rows.extend(entries)
    return rows

def draw_figures(out_dir, external, internal, engineering, qa_banner=None):
    os.environ.setdefault('MPLCONFIGDIR', str(out_dir / '.matplotlib'))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    font_path = next((path for path in [Path('/System/Library/Fonts/PingFang.ttc'), Path('/System/Library/Fonts/STHeiti Light.ttc'), Path('/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc')] if path.exists()), None)
    if font_path:
        font_manager.fontManager.addfont(str(font_path)); font_name = font_manager.FontProperties(fname=str(font_path)).get_name(); plt.rcParams['font.family'] = font_name
    plt.rcParams.update({'axes.spines.top': False, 'axes.spines.right': False, 'axes.unicode_minus': False, 'svg.fonttype': 'path', 'font.size': 10, 'axes.titleweight': 'medium', 'figure.facecolor': '#ffffff'})
    pairs = external or internal; group = '外部探索性体验' if external else '内部试用' if internal else '尚无真实配对记录'
    fig, axes = plt.subplots(2, 3, figsize=(12.8, 8), sharey=True); axes = axes.flat
    colors = ['#2c6d7b', '#c27e4f', '#6e779d', '#5e8d6a', '#987596', '#798983']
    for index, (key, axis) in enumerate(zip(QUESTIONS, axes)):
        axis.set_title(LABELS[key], pad=16); axis.set_xlim(-0.35, 2.35); axis.set_ylim(0.5, 7.5); axis.set_xticks([0,1,2], ['A','B','C']); axis.set_yticks(range(1,8)); axis.grid(axis='y', color='#e8edef', linewidth=0.7); axis.set_axisbelow(True)
        if not pairs:
            axis.text(0.5, 4, '暂无真实数据\nn = 0', ha='center', va='center', color='#6d7d83', fontsize=12)
        for j, pair in enumerate(pairs):
            color = colors[j % len(colors)]; offset = (j - (len(pairs) - 1) / 2) * 0.035
            a, b, c = pair[key + '_A'], pair[key + '_B'], pair[key + '_C']; axis.plot([offset,1+offset,2+offset],[a,b,c],color=color,alpha=0.65,linewidth=1.2); axis.scatter([offset],[a],s=43,facecolors='white',edgecolors=color,linewidths=1.4,zorder=3); axis.scatter([1+offset],[b],s=43,color=color,zorder=3); axis.scatter([2+offset],[c],s=43,marker='s',color=color,zorder=3)
        if index == 0:
            axis.set_ylabel('自编探索性评分（1–7）')
    fig.suptitle(qa_banner or f'IPP31078 逐项配对描述  |  {group}  n = {len(pairs)}', x=0.07, ha='left', y=0.98, fontsize=14)
    if pairs:
        from matplotlib.lines import Line2D
        fig.legend([Line2D([0],[0],color=colors[index%len(colors)],marker='o',linewidth=1) for index,_ in enumerate(pairs)],[pair['participant_id'] for pair in pairs],loc='lower center',bbox_to_anchor=(0.5,0.085),ncol=min(6,len(pairs)),frameon=False,fontsize=9)
    fig.text(0.07, 0.035, 'A独立预录，B本人实时，C本人同流程附加延迟。每条线表示同一匿名编号；六题不合成总分，不预设差异方向。', fontsize=9, color='#61767e')
    fig.subplots_adjust(left=0.07,right=0.97,bottom=0.24 if pairs else 0.17,top=0.8,wspace=0.18)
    paths = []
    for extension in ['png','svg']:
        path = out_dir / ('paired_individual.' + extension); fig.savefig(path,dpi=180); paths.append(path)
    plt.close(fig)
    fig, axes = plt.subplots(1,3,figsize=(12.8,4.0))
    fields = [('logged_render_fps_median','实际画面帧率中位数','fps'),('result_update_hz','实际结果更新率','Hz'),('estimated_loss_total_s','估计追踪丢失时长','秒')]
    for axis,(key,title,unit) in zip(axes,fields):
        axis.set_title(title,pad=14); axis.set_ylabel(unit); axis.grid(axis='y',color='#e8edef'); axis.set_axisbelow(True)
        values = [(row['participant_id']+'-'+row['condition'],row[key]) for row in engineering if row[key] is not None]
        if values:
            axis.bar(range(len(values)),[value for _,value in values],color='#397b85',width=0.55); axis.set_xticks(range(len(values)),[label for label,_ in values],rotation=30,ha='right')
        else:
            axis.set_xticks([]); axis.set_ylim(0,1); axis.set_yticks([]); axis.text(0.5,0.5,'暂无真实工程记录',transform=axis.transAxes,ha='center',color='#6d7d83')
    fig.suptitle(qa_banner or '真实摄像头工程记录  |  合成测试与参数回放已排除',x=0.07,ha='left',fontsize=13)
    fig.text(0.07,0.015,'结果更新率由结果时间戳计算。单次推理耗时不是端到端延迟。',fontsize=9,color='#61767e'); fig.tight_layout(rect=[0.03,0.06,1,0.88])
    path=out_dir/'engineering_metrics.png';fig.savefig(path,dpi=180);paths.append(path);plt.close(fig)
    return paths

def run(raw_dir, out_dir, root=ROOT, render=True):
    raw_dir, out_dir, root = Path(raw_dir).resolve(), Path(out_dir).resolve(), Path(root).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    rows, issues, sources, engineering, records = [], [], [], [], []
    observed = {'internal': set(), 'exploratory': set()}; invalid_participants = set(); excluded_source_counts = Counter()
    def relative(path):
        return str(path.relative_to(root)) if path.is_relative_to(root) else path.name
    def issue(code, source, line='', pid='', sid='', message=''):
        issues.append({'code': code, 'source': source, 'line': line, 'participant_id': pid, 'session_id': sid, 'message': message})
        if code in ('invalid_rating','duplicate_csv_condition','conflicting_record','duplicate_participant_sessions','missing_condition','conflicting_order') and pid:
            invalid_participants.add(pid)
    json_by_id = defaultdict(list)
    for path in sorted(raw_dir.rglob('*.json')):
        source = relative(path); sources.append({'path': source, 'sha256': sha(path)})
        try:
            data = json.loads(path.read_text(encoding='utf-8-sig'))
            if not isinstance(data, dict):
                raise ValueError('JSON不是对象')
            source_type = data.get('source_type')
            if source_type != 'live_camera':
                excluded_source_counts[source_type or 'unknown'] += 1; issue('excluded_source',source,message='来源不为live_camera，不进入真人统计或真实工程统计'); continue
            if data.get('record_type') == 'engineering_evaluation':
                issue('separate_engineering_evaluation',source,message='工程评估由evaluate.py按协议分别分析，不计问卷样本'); continue
            if data.get('protocol_version') != PROTOCOL['protocol_version']:
                issue('excluded_protocol',source,message='旧协议不与当前三条件问卷合并；工程参数可用evaluate.py分别分析'); continue
            if data.get('record_type')=='study_session' and isinstance(data.get('parameters'),dict) and data['parameters'].get('added_delay_ms')!=PROTOCOL['parameters']['added_delay_ms']:
                issue('excluded_delay_configuration',source,message='非正式400ms配置，原始数据保留，须另行分层分析');continue
            calibration_source = data['calibration'].get('source_type') if isinstance(data.get('calibration'),dict) else None
            declared_frames = data.get('frames') if isinstance(data.get('frames'),list) else []
            if calibration_source not in (None,'live_camera') or any(isinstance(frame,dict) and frame.get('source_type') != 'live_camera' for frame in declared_frames):
                excluded_source_counts['mixed_source'] += 1; issue('excluded_source',source,message='记录内部来源不一致，不能改写合成或回放为实时来源'); continue
            if data.get('record_type') == 'study_session' and data.get('record_kind') in observed and participant_id(data.get('participant_id')):
                observed[data['record_kind']].add(data['participant_id'])
            validator = validate_tracking if data.get('record_type') == 'tracking_recording' else validate_session
            errors = validator(data)
            if errors:
                issue('invalid_json',source,pid=data.get('participant_id',''),sid=data.get('session_id',''),message='；'.join(errors)); continue
            if data['record_type'] == 'study_session':
                observed[data['record_kind']].add(data['participant_id'])
            json_by_id[data['session_id']].append((path,data))
        except (OSError,ValueError,TypeError) as error:
            issue('invalid_json',source,message=str(error))
    for sid, versions in json_by_id.items():
        fingerprints = {hashlib.sha256(json.dumps({key:value for key,value in data.items() if key != 'exported_at'},sort_keys=True,ensure_ascii=False).encode()).hexdigest() for _,data in versions}
        if len(fingerprints) > 1:
            for path,data in versions:
                issue('conflicting_record',relative(path),pid=data['participant_id'],sid=sid,message='同会话的导出内容发生冲突，需人工核对，不自动挑选有利版本')
            continue
        versions.sort(key=lambda pair:datetime.fromisoformat(pair[1]['exported_at'].replace('Z','+00:00')))
        path,data = versions[-1]; records.append(data); engineering.extend(engineering_metrics(data))
        for older,_ in versions[:-1]:
            issue('duplicate_export_merged',relative(older),pid=data['participant_id'],sid=sid,message='同内容的重复导出已合并，不增加人数')
        if data['record_type'] == 'study_session':
            if data['status'] != 'complete':
                issue('incomplete_session',relative(path),pid=data['participant_id'],sid=sid,message='会话中断，工程过程保留，评分不进入完整三条件记录'); continue
            for index,rating in enumerate(data['ratings'],1):
                row = parse_rating({key:str(rating.get(key,'')) for key in PARTICIPANT_COLUMNS},relative(path),index,issue)
                if row:
                    rows.append(row)
    table = raw_dir/'participants_v5.csv'
    if table.exists():
        source=relative(table); sources.append({'path':source,'sha256':sha(table)})
        for line,raw in checked_csv(table,PARTICIPANT_COLUMNS,source,issue):
            if raw.get('source_type') == 'live_camera' and raw.get('record_kind') in observed and participant_id(raw.get('participant_id')):
                observed[raw['record_kind']].add(raw['participant_id'])
            row=parse_rating(raw,source,line,issue)
            if row:
                observed[row['record_kind']].add(row['participant_id']); rows.append(row)
            elif raw.get('source_type') in ('synthetic_test','recorded_tracking'):
                excluded_source_counts[raw['source_type']]+=1
    manual_path=root/'materials/engineering_acceptance.csv'
    if manual_path.exists():sources.append({'path':relative(manual_path),'sha256':sha(manual_path)})
    observations=manual_engineering(root,relative(manual_path),issue)
    by_key=defaultdict(list)
    for row in rows:
        by_key[(row['participant_id'],row['session_id'],row['condition'])].append(row)
    unique=[]
    for (pid,sid,condition),entries in by_key.items():
        source_count=Counter(entry['_source'] for entry in entries)
        if any(count>1 for count in source_count.values()):
            issue('duplicate_csv_condition',entries[0]['_source'],pid=pid,sid=sid,message='同来源中同一编号/会话/条件重复，未静默去重');continue
        signatures={tuple(str(entry.get(key,'')) for key in PARTICIPANT_COLUMNS) for entry in entries}
        if len(signatures)>1:
            issue('conflicting_record',entries[0]['_source'],pid=pid,sid=sid,message='JSON与表格或其他来源评分不一致，需人工核对');continue
        unique.append(entries[0])
        if len(entries)>1:
            issue('cross_source_match_merged',entries[0]['_source'],pid=pid,sid=sid,message='相同会话的JSON与CSV一致，合并为同一观察，不重复计数')
    by_person=defaultdict(list)
    for row in unique:
        by_person[row['participant_id']].append(row)
    pairs=[]
    for pid,entries in by_person.items():
        sessions={row['session_id'] for row in entries}; orders={row['condition_order'] for row in entries}; kinds={row['record_kind'] for row in entries}; conditions={row['condition'] for row in entries}
        if len(sessions)!=1:
            issue('duplicate_participant_sessions',entries[0]['_source'],pid=pid,message='同一匿名编号对应多个会话，需人工选定本次体验，全部暂排除');continue
        if conditions!=set(CURRENT_CONDITIONS) or len(entries)!=3:
            issue('missing_condition',entries[0]['_source'],pid=pid,sid=entries[0]['session_id'],message='缺失A、B或C条件，不能形成完整三条件记录');continue
        if len({row.get('overall_preference') for row in entries})!=1:
            issue('conflicting_record',entries[0]['_source'],pid=pid,message='整体偏好不一致');continue
        if len(orders)!=1 or len(kinds)!=1:
            issue('conflicting_order',entries[0]['_source'],pid=pid,message='同编号的顺序或内部/外部用途不一致');continue
        if pid in invalid_participants:
            continue
        by_condition={row['condition']:row for row in entries}; pair={'participant_id':pid,'session_id':entries[0]['session_id'],'record_kind':entries[0]['record_kind'],'condition_order':entries[0]['condition_order']}
        if str(by_condition['C_delayed'].get('added_delay_ms'))!=str(PROTOCOL['parameters']['added_delay_ms']):
            issue('excluded_delay_configuration',entries[0]['_source'],pid=pid,message='非默认延迟不并入400ms三条件统计');continue
        for key in QUESTIONS:
            pair[key+'_A']=by_condition['A_prerecorded'][key];pair[key+'_B']=by_condition['B_realtime'][key];pair[key+'_B_minus_A']=by_condition['B_realtime'][key]-by_condition['A_prerecorded'][key];pair[key+'_C']=by_condition['C_delayed'][key];pair[key+'_C_minus_B']=by_condition['C_delayed'][key]-by_condition['B_realtime'][key]
        pair['feedback_A']=by_condition['A_prerecorded']['comment'];pair['feedback_B']=by_condition['B_realtime']['comment'];pair['feedback_C']=by_condition['C_delayed']['comment'];pair['overall_preference']=by_condition['C_delayed']['overall_preference'];pairs.append(pair)
    external=[pair for pair in pairs if pair['record_kind']=='exploratory'];internal=[pair for pair in pairs if pair['record_kind']=='internal']
    order_counts=dict(Counter(pair['condition_order'] for pair in external))
    fields=['participant_id','session_id','record_kind','condition_order']+[key+suffix for key in QUESTIONS for suffix in ['_A','_B','_C','_B_minus_A','_C_minus_B']]+['feedback_A','feedback_B','feedback_C','overall_preference']
    write_csv(out_dir/'paired_scores.csv',fields,pairs)
    metric_fields=['session_id','participant_id','record_kind','source_type','record_type','condition','sample_count','result_count','observed_span_s','result_update_hz','logged_render_fps_median','logged_avatar_update_hz_median','detected_sample_fraction','loss_segments','estimated_loss_total_s','estimated_longest_loss_s','inference_ms_median','inference_ms_p95','tracking_success_rate','camera_input_fps_median','software_latency_ms_median','actual_buffer_delay_ms_median','added_delay_ms']
    write_csv(out_dir/'engineering_metrics.csv',metric_fields,engineering)
    write_csv(out_dir/'validation_issues.csv',['code','source','line','participant_id','session_id','message'],issues)
    status='no_real_data' if not records and not any(observed.values()) and not observations else 'incomplete_or_invalid_data' if not engineering and not external and not internal and not observations else 'engineering_or_internal_only' if not external else 'exploratory_descriptive_only'
    result={'generated_at':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),'project_id':'IPP31078','protocol_version':PROTOCOL['protocol_version'],'status':status,'source_policy':{'included':'user_declared_live_camera','excluded':['synthetic_test','recorded_tracking','unknown'],'authenticity':'requires_operator_review'},'target_sample_size':{'planned':6,'orders':[''.join(p) for p in permutations('ABC')]},'actual_counts':{'unique_declared_live_anonymous_ids':len(observed['exploratory']|observed['internal']),'observed_external_anonymous_ids':len(observed['exploratory']),'complete_external_triplets':len(external),'observed_internal_anonymous_ids':len(observed['internal']),'complete_internal_triplets':len(internal),'live_engineering_recordings':len(records),'excluded_source_counts':dict(excluded_source_counts)},'order_balance':{'counts':order_counts,'balanced':len({order_counts.get(''.join(p),0) for p in permutations('ABC')})==1 if external else None},'external_item_descriptions':paired_summary(external),'internal_item_descriptions':paired_summary(internal),'included_triplets':pairs,'engineering_metrics':engineering,'validation_issues':issues,'input_files':sources,'limitations':LIMITATIONS,'conclusion':'尚无真实数据；不生成条件效果、动作准确率或真人参与者结论。' if status=='no_real_data' else '只有真实来源声明下的工程记录或内部试用；不报告外部人群效果。' if not external else '逐题报告配对描述与个体分布；任何方向的差值都如实保留，不作显著性或因果结论。'}
    if status == 'incomplete_or_invalid_data':
        result['conclusion']='存在不完整或待核对的真实来源声明记录，暂无可报告配对；请按检查清单核对，不填补评分或预设效果。'
    result['preference_counts']=dict(Counter(pair['overall_preference'] for pair in external))
    result['actual_counts']['manual_engineering_observation_rows']=len(observations)
    result['manual_engineering_observations']=observations
    observation_fields=['record_id','source_type','started_at','action','requested_repetitions','operator_observed_repetitions','visual_response','tracking_loss_notes','observed_render_fps','observed_result_hz','continuous_duration_s','operator','notes','source_file','source_line']
    write_csv(out_dir/'engineering_observations.csv',observation_fields,observations)
    (out_dir/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    figures=draw_figures(out_dir,external,internal,engineering) if render else []
    materials=root/'materials';materials.mkdir(parents=True,exist_ok=True)
    soak_path=root/'evidence/testing/v2/software_soak.json';soak=json.loads(soak_path.read_text()) if soak_path.exists() else None
    note=f"# IPP31078 当前结果说明\n\n生成时间：{result['generated_at']}。协议：{PROTOCOL['protocol_version']}。\n\n{result['conclusion']}\n\n实际收到的外部探索性匿名编号{len(observed['exploratory'])}个，完整外部三条件记录{len(external)}人；内部编号{len(observed['internal'])}个，完整内部三条件记录{len(internal)}人。目标约6人只是计划，不是已完成人数。真实来源声明下的工程记录{len(records)}份。编号是否对应独立真人及来源真实性需操作者核对。\n\nA独立预录、B本人实时、C同流程附加延迟；每条件60秒。六项评分分别为面部控制感、时间一致性、化身认同、探索性面部所有权感、自然流畅度和表达自然度，均为1–7分自编探索性条目，不相加为总具身感分数。\n\n"
    if external:
        note+='## 外部探索性逐题描述\n\n'
        for key,values in result['external_item_descriptions'].items():
            note+=f"- {LABELS[key]}：A中位数{values['A']['median']}，B中位数{values['B']['median']}，C中位数{values['C']['median']}；个体B−A中位数{values['B_minus_A']['median']}，C−B中位数{values['C_minus_B']['median']}，n={values['A']['n']}。\n"
        note+='\n整体偏好（每会话计一次）：'+json.dumps(result['preference_counts'],ensure_ascii=False)+'\n\n'
    if not external:
        note+='当前没有可报告的完整外部问卷配对，不写“增强”“降低”“无差异”或“验证了假设”等结果。点图保留空坐标和无数据说明，不能理解为阴性结果。\n\n'
    note+='## 真实工程验收\n\n'
    note+=f"当前可分析的真实摄像头工程参数记录{len(records)}份，人工动作/稳定性观察{len(observations)}条。记录字段包括实际渲染fps、实际结果/应用更新Hz、追踪丢失、重复动作系数范围和阈值周期估计。人工动作重复次数与视觉响应另填materials/engineering_acceptance.csv，处理后的观察保留在engineering_observations.csv与results.json，不能从系数循环直接推断准确率。单次推理耗时不是端到端延迟。\n\n"
    if soak:
        note+=f"软件连续试用记录：状态{soak.get('overall')}，实际墙钟{soak.get('actual_wall_duration_s',0):.1f}秒，来源synthetic_test。该记录仅证明软件流程运行，全部排除出真人评分及真实摄像头工程统计；不代表相机帧率、真人体验或参与人数。\n\n"
    note+=f"## 数据检查\n\n记录检查项共{len(issues)}条，详见data/processed/validation_issues.csv和results.json。重复匿名编号、缺失条件、分值范围、顺序冲突与来源冲突不会静默修补。同会话同内容的重复导出以及一致的JSON/CSV可合并，不增加人数。原始文件不改写。\n\n## 图表与来源\n\ndata/processed/paired_individual.png及SVG展示逐题个体配对；engineering_metrics.png只展示真实摄像头来源声明下的工程指标。输入文件的路径和SHA-256登记在results.json。\n\n## 局限\n\n"+'\n'.join('- '+text for text in LIMITATIONS)+'\n'
    (materials/'results_note_v5.md').write_text(note,encoding='utf-8')
    if out_dir.is_relative_to(root):
        artifacts=[out_dir/'results.json',out_dir/'paired_scores.csv',out_dir/'engineering_metrics.csv',out_dir/'engineering_observations.csv',out_dir/'validation_issues.csv',*figures,materials/'results_note_v5.md']
        for path in artifacts:
            eid='P3-RESULT-'+path.stem.replace('_','-').upper()+('-SVG' if path.suffix=='.svg' else '-'+path.suffix[1:].upper())
            register(eid,'result',path,'scripts/analyze.py','per_item_description_and_real_source_engineering_status','no_real_data' if status=='no_real_data' else 'pending_manual_source_verification','no' if status=='no_real_data' else 'yes','合成及回放已排除；无数据时图表不填虚构点。',root=root)
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--raw',type=Path,default=ROOT/'data/raw');parser.add_argument('--out',type=Path,default=ROOT/'data/processed/abc_v5');args=parser.parse_args()
    try:result=run(args.raw,args.out)
    except ModuleNotFoundError as error:raise SystemExit('缺少分析依赖：'+str(error)+'。请先运行安装环境.command，再重新运行分析。')
    print(json.dumps({'status':result['status'],'actual_counts':result['actual_counts'],'issues':len(result['validation_issues']),'conclusion':result['conclusion']},ensure_ascii=False,indent=2))
