import { EXTENDED_COEFFICIENTS, POSE_LIMITS } from './expressions.js?v=0.3.0-r2';
export const APP_VERSION = '0.3.0';
export const PROTOCOL_VERSION = 'IPP31078-AB90-v3';
export const SCHEMA_VERSION = '3.0.0';
export const PROJECT_ID = 'IPP31078';
export const OFFICIAL_TITLE = '基于面部识别跟踪技术探究化身面部表情对于用户具身感的影响';
export const COEFFICIENTS = EXTENDED_COEFFICIENTS;
export const TASKS = Object.freeze([
  { id: 'jaw', text: '缓慢张嘴，再自然合拢', detail: '约每 5 秒重复一次，保持头部自然稳定', duration_ms: 20000 },
  { id: 'blink', text: '自然眨眼，间或缓慢闭眼', detail: '约每 5 秒缓慢闭眼一次，避免用力挤眼', duration_ms: 20000 },
  { id: 'smile', text: '轻轻微笑，再放松面部', detail: '约每 5 秒重复一次，幅度以舒适为准', duration_ms: 20000 },
  { id: 'free', text: '自由组合刚才的面部动作', detail: '尝试张嘴、眨眼和微笑，注视同一个化身', duration_ms: 30000 },
]);
export const QUESTIONS = Object.freeze([
  { id: 'control', label: '面部控制感', text: '我感觉自己能够控制化身的面部动作。' },
  { id: 'congruence', label: '动作一致性', text: '化身的面部动作与我做出的动作一致。' },
  { id: 'identification', label: '化身认同', text: '体验时，我对这个化身有认同感。' },
  { id: 'naturalness', label: '自然程度', text: '化身的面部表现让我感觉自然。' },
]);
export const PARAMS = Object.freeze({
  duration_ms: 90000, rest_ms: 15000, calibration_ms: 3000, calibration_min_samples: 30,
  inference_interval_ms: 40, tracking_stale_ms: 400, smoothing_tau_ms: 80,
  deadzone: 0.015, max_timer_step_ms: 100, max_pixel_ratio: 1.5,
  gain: Object.freeze(Object.fromEntries(COEFFICIENTS.map(key => [key, 1]))),
  head_tracking: true, head_tracking_conditions: 'identical_in_A_and_B', head_rotation_limits_rad: POSE_LIMITS,
  head_smoothing_tau_ms: 100, show_camera_in_study: false, outside_task_face: 'neutral',
  camera_constraints: Object.freeze({ width_ideal: 640, height_ideal: 480, frame_rate_ideal: 30, frame_rate_max: 30, facing_mode: 'user' }),
  condition_mapping: Object.freeze({ A: 'static_neutral', B: 'live_synchronous' }),
  avatar_id: 'ipp31078-cartoon-v2', camera_pose: [0, 0.08, 6.4], background: '#edf2f1',
});
export const DURATION_MS = PARAMS.duration_ms;
export const SOURCE_TYPES = Object.freeze(['live_camera', 'recorded_tracking', 'synthetic_test']);
export const neutral = () => Object.fromEntries(COEFFICIENTS.map(key => [key, 0]));
export const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export function median(values) { if (!values.length) return null; const v = [...values].sort((a, b) => a - b); return (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2; }
export function taskAt(ms) { let end = 0; for (const [index, task] of TASKS.entries()) { end += task.duration_ms; if (ms < end) return { ...task, index, remaining_ms: end - ms }; } return null; }
export function validParticipantId(id) { return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{1,23}$/.test(id); }
export function suggestedOrder(id) { const match = /^P(\d+)$/i.exec(id); return match && Number(match[1]) % 2 === 0 ? ['B', 'A'] : ['A', 'B']; }
export function makeCalibration(samples, meta = {}) {
  if (samples.length < PARAMS.calibration_min_samples) throw new Error('有效校准样本不足，请保持中性表情重试');
  const baseline = Object.fromEntries(COEFFICIENTS.map(key => [key, median(samples.map(row => clamp(row[key])))]));
  if (baseline.jawOpen > 0.3 || baseline.eyeBlinkLeft > 0.4 || baseline.eyeBlinkRight > 0.4 || baseline.mouthSmileLeft > 0.45 || baseline.mouthSmileRight > 0.45) throw new Error('校准时面部未保持中性，请睁眼、合嘴并放松后重试');
  return { ...meta, baseline, sample_count: samples.length, duration_ms: PARAMS.calibration_ms, method: 'per_coefficient_median', status: 'complete' };
}
export function correctExpression(raw, baseline = neutral()) {
  return Object.fromEntries(COEFFICIENTS.map(key => { const b = clamp(baseline[key]); return [key, clamp((clamp(raw[key]) - b - PARAMS.deadzone) / Math.max(0.1, 1 - b - PARAMS.deadzone)) * PARAMS.gain[key]]; }));
}
export function mapExpression(expression, condition) { if (!['A', 'B'].includes(condition)) throw new Error('未知条件'); return condition === 'A' ? neutral() : Object.fromEntries(COEFFICIENTS.map(key => [key, clamp(expression[key])])); }
export class ExpressionFilter {
  constructor() { this.reset(); }
  reset() { this.value = neutral(); this.last = null; }
  update(target, now) { const dt = this.last === null ? PARAMS.inference_interval_ms : Math.max(1, Math.min(250, now - this.last)); this.last = now; const alpha = 1 - Math.exp(-dt / PARAMS.smoothing_tau_ms); this.value = Object.fromEntries(COEFFICIENTS.map(key => [key, this.value[key] + alpha * (clamp(target[key]) - this.value[key])])); return { ...this.value }; }
}
export class RateMeter {
  constructor(windowMs = 2000) { this.windowMs = windowMs; this.times = []; }
  mark(now) { this.times.push(now); this.prune(now); }
  prune(now) { while (this.times.length && this.times[0] < now - this.windowMs) this.times.shift(); }
  value(now) { this.prune(now); const span = this.times.length ? now - this.times[0] : 0; return span >= 500 && this.times.length >= 2 ? (this.times.length - 1) * 1000 / Math.max(1, this.times.at(-1) - this.times[0]) : null; }
}
export function makeSession({ id, participantId, order, kind, consent, sourceType = 'live_camera', calibration, modelInfo, cameraSettings = {}, viewport = {}, now, userAgent = '' }) {
  if (!validParticipantId(participantId)) throw new Error('请填写2–24位匿名编号（字母、数字、下划线或短横线）');
  if (!['A,B', 'B,A'].includes(order.join(','))) throw new Error('条件顺序须为AB或BA');
  if (!['internal', 'exploratory'].includes(kind) || !SOURCE_TYPES.includes(sourceType)) throw new Error('记录类型无效');
  if (!consent || calibration?.status !== 'complete') throw new Error('请先完成知情同意与中性校准');
  return { record_type: 'study_session', schema_version: SCHEMA_VERSION, project_id: PROJECT_ID, app_version: APP_VERSION, protocol_version: PROTOCOL_VERSION,
    session_id: id, participant_id: participantId, record_kind: kind, source_type: sourceType,
    consent: true, started_at: now, ended_at: null, exported_at: null, status: 'in_progress',
    condition_order: [...order], parameters: JSON.parse(JSON.stringify(PARAMS)), task_plan: TASKS,
    question_items: QUESTIONS, calibration: JSON.parse(JSON.stringify(calibration)), model_info: modelInfo,
    camera_settings: cameraSettings, viewport, user_agent: userAgent, validation_status: 'pending_manual_verification',
    measurement_note: 'inference_ms is compute time only; update rates use observed monotonic timestamps. No end-to-end latency was measured.',
    conditions: [], frames: [], ratings: [], events: [], protocol_deviations: [],
  };
}
export class StudyController {
  constructor(session) { this.session = session; this.phase = 'ready'; this.activeMs = 0; this.block = null; this.paused = false; this.lastTick = null; this.restUntil = 0; }
  event(type, now, at, detail = {}) { this.session.events.push({ type, at, monotonic_ms: now, condition: this.block?.condition ?? null, active_ms: Math.round(this.activeMs), ...detail }); }
  begin(now, at) {
    if (!['ready', 'rest'].includes(this.phase)) throw new Error('当前不能开始条件');
    if (this.phase === 'rest' && now < this.restUntil) throw new Error('请完成条件间休息');
    const index = this.session.conditions.length;
    if (index >= 2) throw new Error('两条件已完成');
    this.block = { condition: this.session.condition_order[index], block_index: index + 1, started_at: at, ended_at: null, start_monotonic_ms: now, end_monotonic_ms: null, active_ms: 0, wall_elapsed_ms: 0, status: 'running' };
    this.session.conditions.push(this.block); this.phase = 'running'; this.paused = false; this.activeMs = 0; this.lastTick = now;
    this.event('condition_started', now, at);
  }
  tick(now, at, { tracked, visible }) {
    const delta = this.lastTick === null ? 0 : Math.min(PARAMS.max_timer_step_ms, Math.max(0, now - this.lastTick)); this.lastTick = now;
    if (this.phase !== 'running') return;
    if (tracked && visible && !this.paused) this.activeMs = Math.min(DURATION_MS, this.activeMs + delta);
    this.block.active_ms = Math.round(this.activeMs); this.block.wall_elapsed_ms = Math.round(now - this.block.start_monotonic_ms);
    if (this.activeMs >= DURATION_MS) { this.block.ended_at = at; this.block.end_monotonic_ms = now; this.block.status = 'completed'; this.phase = 'survey'; this.session.status = 'awaiting_ratings'; this.event('condition_completed', now, at); }
  }
  rate(scores, comment, now, at) {
    if (this.phase !== 'survey') throw new Error('当前不能填写自评');
    if (QUESTIONS.some(q => !Number.isInteger(scores[q.id]) || scores[q.id] < 1 || scores[q.id] > 7)) throw new Error('请完成四题1–7分自评');
    this.session.ratings.push({ session_id: this.session.session_id, participant_id: this.session.participant_id, source_type: this.session.source_type, record_kind: this.session.record_kind, protocol_version: this.session.protocol_version, condition_order: this.session.condition_order.join(''), condition: this.block.condition, block_index: this.block.block_index, submitted_at: at, ...scores, comment: String(comment).slice(0, 1000) });
    this.event('ratings_submitted', now, at);
    if (this.session.conditions.length === 2) { this.phase = 'complete'; this.session.status = 'complete'; this.session.ended_at = at; this.event('session_completed', now, at); }
    else { this.phase = 'rest'; this.restUntil = now + PARAMS.rest_ms; this.session.status = 'in_progress'; this.event('rest_started', now, at); }
  }
  abort(reason, now, at) { if (['complete', 'aborted'].includes(this.phase)) return; if (this.block?.status === 'running') { this.block.status = 'aborted'; this.block.ended_at = at; this.block.end_monotonic_ms = now; this.block.wall_elapsed_ms = now - this.block.start_monotonic_ms; } this.phase = 'aborted'; this.session.status = 'aborted'; this.session.ended_at = at; this.session.abort_reason = reason; this.event('session_aborted', now, at, { reason }); }
}
export function csv(rows, columns) {
  const safe = value => { let text = value == null ? '' : String(value); if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return '\uFEFF' + [columns.map(safe).join(','), ...rows.map(row => columns.map(key => safe(row[key])).join(','))].join('\r\n') + '\r\n';
}
export const FRAME_COLUMNS = ['session_id', 'participant_id', 'source_type', 'condition', 'block_index', 'captured_at', 'monotonic_ms', 'wall_elapsed_ms', 'active_ms', 'task', 'detected', 'paused', 'render_fps', 'tracking_update_hz', 'avatar_update_hz', 'inference_ms', 'frame_to_render_submit_ms', 'video_present_to_render_submit_ms', 'render_submitted_at_ms', 'pose_valid', ...['pitch','yaw','roll'].flatMap(k => ['raw_pose_' + k, 'corrected_pose_' + k, 'applied_pose_' + k]), ...COEFFICIENTS.flatMap(k => ['raw_' + k, 'corrected_' + k, 'applied_' + k])];
export const RATING_COLUMNS = ['session_id', 'participant_id', 'record_kind', 'source_type', 'protocol_version', 'condition_order', 'condition', 'block_index', 'submitted_at', ...QUESTIONS.map(q => q.id), 'comment'];
