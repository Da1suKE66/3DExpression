"""Validate v2 exports. Structural validation never certifies a human operator."""
from datetime import datetime
from pathlib import Path
from uuid import UUID
import json
import math
import re

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = json.loads((ROOT / 'app/protocol.json').read_text(encoding='utf-8'))
PARAMS = PROTOCOL['parameters']
COEFFICIENTS = PROTOCOL['coefficients']
QUESTIONS = [question['id'] for question in PROTOCOL['questions']]
PARTICIPANT_COLUMNS = ['participant_id', 'session_id', 'record_kind', 'source_type', 'protocol_version', 'condition_order', 'condition', 'submitted_at', *QUESTIONS, 'comment']
MODEL = json.loads((ROOT / 'app/model_manifest.json').read_text(encoding='utf-8'))
LEGACY_PROTOCOL = json.loads((ROOT / 'app/protocol-v2.json').read_text(encoding='utf-8'))
LEGACY_MODEL = json.loads((ROOT / 'app/model_manifest-v1.json').read_text(encoding='utf-8'))
PREVIOUS_PROTOCOL = json.loads((ROOT / 'app/protocol-v3.json').read_text(encoding='utf-8'))
PREVIOUS_MODEL = json.loads((ROOT / 'app/model_manifest-v2.json').read_text(encoding='utf-8'))
AVATAR_CATALOG = json.loads((ROOT / 'app/avatar_catalog.json').read_text(encoding='utf-8'))

def specification(data):
    if isinstance(data,dict) and data.get('protocol_version') == LEGACY_PROTOCOL['protocol_version']: return LEGACY_PROTOCOL,LEGACY_MODEL
    if isinstance(data,dict) and data.get('protocol_version') == PREVIOUS_PROTOCOL['protocol_version']: return PREVIOUS_PROTOCOL,PREVIOUS_MODEL
    model_info = data.get('model_info') if isinstance(data,dict) else None
    selected = next((m for m in AVATAR_CATALOG['avatars'] if isinstance(model_info,dict) and m['id'] == model_info.get('id')),MODEL)
    return PROTOCOL,selected

def number(value, low=0, high=1):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high

def timestamp(value):
    try:
        return isinstance(value, str) and datetime.fromisoformat(value.replace('Z', '+00:00')).utcoffset() is not None
    except (TypeError, ValueError):
        return False

def uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except (TypeError, ValueError, AttributeError):
        return False

def participant_id(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{1,23}', value) is not None

def base_errors(data, record_type):
    if not isinstance(data, dict):
        return ['记录必须为JSON对象']
    errors = []
    protocol, model_spec = specification(data)
    params, coefficients = protocol['parameters'], protocol['coefficients']
    for key, expected in [('record_type', record_type), ('project_id', 'IPP31078'), ('schema_version', protocol['schema_version']), ('app_version', protocol['app_version']), ('protocol_version', protocol['protocol_version'])]:
        if data.get(key) != expected:
            errors.append(key + ' 与当前版本不匹配')
    if not uuid(data.get('session_id')):
        errors.append('会话编号必须为标准UUID')
    if not participant_id(data.get('participant_id')):
        errors.append('匿名编号须为2–24位字母、数字、下划线或短横线')
    if data.get('source_type') not in ('live_camera', 'synthetic_test'):
        errors.append('只接受实时输入或明确标注的软件测试；回放不能保存为正式体验')
    if data.get('consent') is not True:
        errors.append('缺少知情同意')
    for key in ['started_at', 'ended_at', 'exported_at']:
        if not timestamp(data.get(key)):
            errors.append(key + ' 必须含时区')
    if data.get('parameters') != params:
        errors.append('固定参数被改变，不能与当前协议混用')
    calibration = data.get('calibration')
    if not isinstance(calibration, dict) or calibration.get('status') != 'complete' or not number(calibration.get('sample_count'), params['calibration_min_samples'], 10000) or calibration.get('duration_ms') != params['calibration_ms']:
        errors.append('中性校准不完整')
    elif not isinstance(calibration.get('baseline'), dict) or any(not number(calibration['baseline'].get(key)) for key in coefficients):
        errors.append('校准基线缺失或越界')
    elif calibration.get('source_type') != data.get('source_type'):
        errors.append('校准来源与记录来源不一致')
    model = data.get('model_info')
    if not isinstance(model, dict) or model.get('id') != model_spec['id'] or model.get('sha256') != model_spec['sha256'] or model.get('animation_playback_enabled') is not False:
        errors.append('化身身份、校验和或动画状态不匹配')
    if protocol['protocol_version'] == 'IPP31078-AB90-v3.1':
        if not isinstance(model,dict) or model.get('avatar_key') != model_spec['key'] or model.get('catalog_id') != AVATAR_CATALOG['id']:
            errors.append('卡通角色选择未正确记录')
        if not isinstance(calibration,dict) or calibration.get('avatar_key') != model_spec['key'] or calibration.get('model_sha256') != model_spec['sha256']:
            errors.append('切换角色后尚未重新校准')
    return errors

def frame_errors(data, study=True):
    protocol, _ = specification(data)
    params, coefficients = protocol['parameters'], protocol['coefficients']
    frames = data.get('frames')
    if not isinstance(frames, list) or len(frames) > 30000:
        return ['帧记录必须为不超过30000条的数组']
    errors, previous_time, previous_active = [], -math.inf, {}
    for frame in frames:
        if not isinstance(frame, dict):
            return ['每帧必须为对象']
        if frame.get('source_type') != data.get('source_type') or frame.get('session_id') != data.get('session_id') or frame.get('participant_id') != data.get('participant_id'):
            errors.append('帧的来源、会话或匿名编号不一致'); break
        if not timestamp(frame.get('captured_at')) or not number(frame.get('monotonic_ms'), 0, 10**12) or frame['monotonic_ms'] < previous_time:
            errors.append('帧时间戳无效或逆行'); break
        previous_time = frame['monotonic_ms']
        condition = frame.get('condition')
        if condition not in ('A', 'B') or type(frame.get('detected')) is not int or frame['detected'] not in (0, 1) or frame.get('paused') not in (0, 1):
            errors.append('条件、检测或暂停标记无效'); break
        if frame.get('sample_kind') not in ('result', 'tracking_timeout'):
            errors.append('帧来源类型不适用于实时记录'); break
        if study:
            active = frame.get('active_ms')
            if not number(active, 0, params['duration_ms']) or active < previous_active.get(condition, 0):
                errors.append('条件内有效时间无效或逆行'); break
            previous_active[condition] = active
            order = data.get('condition_order') if isinstance(data.get('condition_order'), list) else []
            if condition not in order:
                errors.append('帧条件不在预先设置的顺序中'); break
        for metric in ['render_fps', 'tracking_update_hz', 'avatar_update_hz']:
            if frame.get(metric) is not None and not number(frame[metric], 0, 10000):
                errors.append('实际更新率或帧率字段无效'); break
        if frame.get('inference_ms') is not None and not number(frame['inference_ms'], 0, 120000):
            errors.append('推理耗时无效'); break
        for key in coefficients:
            raw, corrected, applied = frame.get('raw_' + key), frame.get('corrected_' + key), frame.get('applied_' + key)
            if not number(applied) or (condition == 'A' and applied != 0) or (not frame['detected'] and applied != 0):
                errors.append('静态或丢失状态存在非零驱动，或应用系数越界'); break
            if frame['detected'] and (not number(raw) or not number(corrected)):
                errors.append('已检测帧缺少有效系数'); break
            if not frame['detected'] and (raw is not None or corrected is not None):
                errors.append('丢失帧不能填入虚构原始系数'); break
            if protocol['protocol_version'] == 'IPP31078-AB90-v3.1':
                target = frame.get('target_' + key)
                if (frame['detected'] and not number(target)) or (not frame['detected'] and target is not None):
                    errors.append('闭眼重定向后的目标系数缺失或越界'); break
        if protocol['schema_version'] == '3.0.0':
            if type(frame.get('pose_valid')) is not bool:
                errors.append('缺少头部姿态有效性标记'); break
            for axis, limit in params['head_rotation_limits_rad'].items():
                applied = frame.get('applied_pose_' + axis)
                raw = frame.get('raw_pose_' + axis)
                if not number(applied, -limit-1e-7, limit+1e-7) or (not frame['detected'] and applied != 0):
                    errors.append('头部旋转越界或丢失时未回中性'); break
                if frame['pose_valid'] and (not frame['detected'] or not number(raw, -math.pi, math.pi)):
                    errors.append('已声明有效的头部姿态缺少合法数据'); break
                if not frame['pose_valid'] and raw is not None:
                    errors.append('无效头部姿态不能填写原始旋转'); break
            for key in ['frame_to_render_submit_ms','video_present_to_render_submit_ms']:
                if frame.get(key) is not None and not number(frame[key], 0, 120000): errors.append('浏览器管线耗时无效')
    return errors

def validate_session(data):
    errors = base_errors(data, 'study_session')
    if not isinstance(data, dict):
        return errors
    if data.get('record_kind') not in ('internal', 'exploratory'):
        errors.append('体验用途无效')
    if data.get('status') not in ('complete', 'aborted'):
        errors.append('须先完成或结束体验再保存')
    order = data.get('condition_order')
    if order not in (['A', 'B'], ['B', 'A']):
        errors.append('条件顺序须为AB或BA'); order = []
    blocks, ratings = data.get('conditions'), data.get('ratings')
    if not isinstance(blocks, list) or len(blocks) > 2:
        errors.append('条件记录无效'); blocks = []
    if not isinstance(ratings, list) or len(ratings) > 2:
        errors.append('自评记录无效'); ratings = []
    for index, block in enumerate(blocks):
        if not isinstance(block, dict) or index >= len(order) or block.get('condition') != order[index] or block.get('block_index') != index + 1 or not number(block.get('active_ms'), 0, 90000):
            errors.append('条件记录顺序或时长不符')
    seen = set()
    for rating in ratings:
        if not isinstance(rating, dict):
            errors.append('自评记录必须为对象'); continue
        condition = rating.get('condition')
        if not isinstance(condition, str) or condition not in order or condition in seen:
            errors.append('自评条件无效或重复')
        else:
            seen.add(condition)
        for key in ['session_id', 'participant_id', 'record_kind', 'source_type']:
            if rating.get(key) != data.get(key):
                errors.append('自评身份或来源字段不一致')
        if data.get('protocol_version') == PROTOCOL['protocol_version'] and rating.get('protocol_version') != data['protocol_version']:
            errors.append('自评缺少当前协议版本')
        if rating.get('condition_order') != ''.join(order) or not timestamp(rating.get('submitted_at')):
            errors.append('自评顺序或时间戳无效')
        if any(type(rating.get(key)) is not int or not 1 <= rating[key] <= 7 for key in QUESTIONS):
            errors.append('四题评分须为1–7整数')
        if not isinstance(rating.get('comment', ''), str) or len(rating.get('comment', '')) > 1000:
            errors.append('开放反馈无效')
    errors.extend(frame_errors(data))
    if data.get('status') == 'complete':
        if len(blocks) != 2 or len(ratings) != 2 or seen != {'A', 'B'}:
            errors.append('完整体验必须包含两条件与两份四题自评')
        for block in blocks:
            if not isinstance(block, dict) or block.get('status') != 'completed' or block.get('active_ms') != 90000:
                errors.append('每条件须完成90000毫秒有效任务')
        frames = data.get('frames') if isinstance(data.get('frames'), list) else []
        for condition in ('A', 'B'):
            if not any(isinstance(frame, dict) and frame.get('condition') == condition and frame.get('detected') == 1 for frame in frames):
                errors.append(condition + ' 缺少真实输入声明下的检测帧（仍需人工核验）')
    return list(dict.fromkeys(errors))

def validate_tracking(data):
    errors = base_errors(data, 'tracking_recording')
    if not isinstance(data, dict):
        return errors
    if data.get('record_kind') != 'engineering' or data.get('status') != 'complete' or not number(data.get('duration_ms'), 1, 3600000):
        errors.append('工程参数记录尚未完成或时长无效')
    if not data.get('frames'):
        errors.append('参数记录为空')
    errors.extend(frame_errors(data, study=False))
    return list(dict.fromkeys(errors))

EVALUATION_ACTIONS = {'neutral':0,'jaw':5,'blink':5,'smile':5,'sad':5,'surprise':5,'angry':5,'pucker':5,'head_yaw':3,'head_pitch':3,'head_roll':3,'switching':3,'recovery':1}

def validate_evaluation(data):
    if not isinstance(data, dict): return ['评估记录必须为对象']
    errors = []
    if (data.get('record_type'),data.get('schema_version'),data.get('evaluation_protocol')) != ('engineering_evaluation','1.0.0','IPP31078-EVAL-v1'): errors.append('评估协议或结构版本不符')
    tracking = data.get('tracking')
    if not isinstance(tracking,dict): return errors + ['评估缺少完整参数记录']
    errors.extend(validate_tracking(tracking))
    if any(data.get(k) != tracking.get(k) for k in ['session_id','source_type','started_at','ended_at']): errors.append('评估与参数记录身份、来源或时间冲突')
    if data.get('status') not in ('complete','interrupted') or not timestamp(data.get('exported_at')): errors.append('评估尚未结束或导出时间无效')
    duration = tracking.get('duration_ms')
    if not number(duration,1,3600000): return errors + ['评估总时长无效']
    if not number(data.get('visible_duration_ms'), 0, duration+1) or type(data.get('render_count')) is not int or not 0 <= data['render_count'] <= 10000000: errors.append('可见计时或实际渲染计数无效')
    trials = data.get('trials')
    if not isinstance(trials,list) or len(trials)>200: return errors + ['评估动作列表无效或超过200项']
    ids, previous_end = {}, -math.inf
    start = tracking.get('start_monotonic_ms'); end = tracking.get('end_monotonic_ms')
    if not number(start,0,1e12) or not number(end,start or 0,1e12): return errors + ['评估单调时间范围无效']
    for trial in trials:
        if not isinstance(trial,dict): errors.append('评估动作须为对象'); continue
        action = trial.get('action'); tid = trial.get('trial_id')
        if not uuid(tid) or tid in ids or not isinstance(action,str) or action not in EVALUATION_ACTIONS: errors.append('动作编号重复、无效或动作未知'); continue
        begin, finish = trial.get('start_monotonic_ms'), trial.get('end_monotonic_ms')
        if not number(begin,start,end) or not number(finish,begin or start,end) or begin < previous_end: errors.append('动作时间范围无效或重叠'); continue
        previous_end = finish
        ids[tid] = trial
        if trial.get('requested_repetitions') != EVALUATION_ACTIONS[action] or trial.get('status') not in ('completed','interrupted'): errors.append('动作要求次数或状态不符')
        observed = trial.get('observed_successes')
        if observed is not None and (type(observed) is not int or not 0 <= observed <= EVALUATION_ACTIONS[action] or trial.get('observation_method') != 'operator_visual_count'): errors.append('实际观察次数或观察方法无效')
        if not isinstance(trial.get('notes',''),str) or len(trial.get('notes',''))>1000: errors.append('动作观察备注无效')
    for frame in tracking.get('frames',[]):
        if not isinstance(frame,dict): continue
        tid = frame.get('trial_id')
        if tid is None: continue
        trial = ids.get(tid)
        if not trial or frame.get('evaluation_action') != trial['action'] or not number(frame.get('monotonic_ms'),trial['start_monotonic_ms'],trial['end_monotonic_ms']+1): errors.append('采样帧与动作标签或时间不匹配'); break
    return list(dict.fromkeys(errors))
