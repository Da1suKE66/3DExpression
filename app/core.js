import { EXTENDED_COEFFICIENTS, POSE_LIMITS } from './expressions.js?v=0.5.0';
export const APP_VERSION = '0.5.0';
export const PROTOCOL_VERSION = 'IPP31078-ABC60-v5';
export const SCHEMA_VERSION = '5.0.0';
export const CONDITIONS = Object.freeze(['A_prerecorded', 'B_realtime', 'C_delayed']);
export const orderCode = order => order.map(c => c === 'A_prerecorded' ? 'A' : c === 'B_realtime' ? 'B' : c === 'C_delayed' ? 'C' : c).join('');
export const ORDER_CODES = Object.freeze(['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA']);
export const studyOrder = code => ORDER_CODES.includes(code) ? [...code].map(letter => CONDITIONS['ABC'.indexOf(letter)]) : [];
export const PREFERENCE_COLUMNS = ['participant_id','session_id','condition_order','selected_condition','submitted_at'];
export const PROJECT_ID = 'IPP31078';
export const OFFICIAL_TITLE = '基于面部识别跟踪技术探究化身面部表情对于用户具身感的影响';
export const COEFFICIENTS = EXTENDED_COEFFICIENTS;
export const TASKS = Object.freeze([
  { id: 'adapt', text: '适应观察', detail: '自然观察化身，熟悉当前交互方式', duration_ms: 10000 },
  { id: 'basic', text: '基础面部动作', detail: '舒适地尝试张嘴、眨眼、微笑、抬眉，再自然放松', duration_ms: 20000 },
  { id: 'free', text: '自由面部表达', detail: '自由组合不同面部动作，观察化身变化', duration_ms: 20000 },
  { id: 'observe', text: '整体观察', detail: '自由观察和尝试动作，形成整体体验印象', duration_ms: 10000 },
]);
export const QUESTIONS = Object.freeze([
  { id: 'control', label: '面部控制感', text: '我感觉自己的面部动作能够直接影响化身的表情。' },
  { id: 'congruence', label: '时间一致性', text: '化身的表情变化与我的面部动作在时间上保持一致。' },
  { id: 'identification', label: '化身认同', text: '观看化身时，我感觉它能够代表我自己的虚拟形象。' },
  { id: 'ownership', label: '面部所有权感', text: '我有一种化身的面部仿佛属于我自己的感觉。' },
  { id: 'naturalness', label: '自然流畅度', text: '我认为化身的面部表情自然、流畅，没有明显违和感。' },
  { id: 'expression', label: '表达自然度', text: '我能够自然地通过化身表达自己的面部状态。' },
]);
export const PARAMS = Object.freeze({
  duration_ms: 60000, added_delay_ms: 400, rest_ms: 15000, calibration_ms: 3000, calibration_min_samples: 30,
  inference_interval_ms: 40, tracking_stale_ms: 400, smoothing_tau_ms: 80,
  deadzone: 0.015, max_timer_step_ms: 100, max_pixel_ratio: 1.5,
  blink_mapping: Object.freeze({ open_threshold: 0.08, closed_threshold: 0.55, hide_eyeball_threshold: 0.82, priority_over_eye_wide: true }),
  coefficient_smoothing_tau_ms: Object.freeze({ eyeBlinkLeft: 35, eyeBlinkRight: 35 }),
  gain: Object.freeze(Object.fromEntries(COEFFICIENTS.map(key => [key, 1]))),
  head_tracking: true, head_tracking_conditions: 'identical_in_A_B_C', head_rotation_limits_rad: POSE_LIMITS,
  head_smoothing_tau_ms: 100, show_camera_in_study: false, outside_task_face: 'neutral',
  camera_constraints: Object.freeze({ width_ideal: 640, height_ideal: 480, frame_rate_ideal: 30, frame_rate_max: 30, facing_mode: 'user' }),
  condition_mapping: Object.freeze({ A_prerecorded: 'independent_recorded_dynamic', B_realtime: 'live_synchronous', C_delayed: 'same_live_pipeline_with_added_delay' }),
  avatar_id: 'ipp31078-character-catalog-v1', camera_pose: [0, 0.08, 7.1], background: '#edf2f1',
});
export const DURATION_MS = PARAMS.duration_ms;
export const SOURCE_TYPES = Object.freeze(['live_camera', 'recorded_tracking', 'synthetic_test']);
export const neutral = () => Object.fromEntries(COEFFICIENTS.map(key => [key, 0]));
export const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export function median(values) { if (!values.length) return null; const v = [...values].sort((a, b) => a - b); return (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2; }
export function taskAt(ms) { let end = 0; for (const [index, task] of TASKS.entries()) { end += task.duration_ms; if (ms < end) return { ...task, index, remaining_ms: end - ms }; } return null; }
export function validParticipantId(id) { return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{1,23}$/.test(id); }
export function suggestedOrder(id) { const match = /^P(\d+)$/i.exec(id); return [...ORDER_CODES[match ? Math.max(0, Number(match[1])-1) % 6 : 0]]; }
export function makeCalibration(samples, meta = {}) {
  if (samples.length < PARAMS.calibration_min_samples) throw new Error('有效校准样本不足，请保持中性表情重试');
  const baseline = Object.fromEntries(COEFFICIENTS.map(key => [key, median(samples.map(row => clamp(row[key])))]));
  if (baseline.jawOpen > 0.3 || baseline.eyeBlinkLeft > 0.4 || baseline.eyeBlinkRight > 0.4 || baseline.mouthSmileLeft > 0.45 || baseline.mouthSmileRight > 0.45) throw new Error('校准时面部未保持中性，请睁眼、合嘴并放松后重试');
  return { ...meta, baseline, sample_count: samples.length, duration_ms: PARAMS.calibration_ms, method: 'per_coefficient_median', status: 'complete' };
}
export function correctExpression(raw, baseline = neutral()) {
  return Object.fromEntries(COEFFICIENTS.map(key => { const b = clamp(baseline[key]); return [key, clamp((clamp(raw[key]) - b - PARAMS.deadzone) / Math.max(0.1, 1 - b - PARAMS.deadzone)) * PARAMS.gain[key]]; }));
}
export function mapExpression(expression, condition, prerecorded = null) {
  if (['A', 'static_neutral'].includes(condition)) return neutral(); // Legacy A is demo-only.
  if (!['B', 'B_realtime', 'C_delayed', 'A_prerecorded'].includes(condition)) throw new Error('未知条件');
  if (condition === 'A_prerecorded' && !prerecorded) throw new Error('缺少独立预录表情');
  const source = condition === 'A_prerecorded' ? prerecorded : expression;
  return Object.fromEntries(COEFFICIENTS.map(key => [key, clamp(source[key])]));
}
export function retargetExpression(expression) {
  const target = Object.fromEntries(COEFFICIENTS.map(key => [key, clamp(expression[key])]));
  for (const side of ['Left','Right']) {
    const t = clamp((target['eyeBlink'+side] - PARAMS.blink_mapping.open_threshold) / (PARAMS.blink_mapping.closed_threshold - PARAMS.blink_mapping.open_threshold));
    target['eyeBlink'+side] = t*t*(3-2*t);
    target['eyeWide'+side] *= 1-target['eyeBlink'+side];
  }
  return target;
}
export class ExpressionFilter {
  constructor() { this.reset(); }
  reset() { this.value = neutral(); this.last = null; }
  update(target, now) { const dt = this.last === null ? PARAMS.inference_interval_ms : Math.max(1, Math.min(250, now - this.last)); this.last = now; this.value = Object.fromEntries(COEFFICIENTS.map(key => { const alpha = 1 - Math.exp(-dt / (PARAMS.coefficient_smoothing_tau_ms[key] || PARAMS.smoothing_tau_ms)); return [key, this.value[key] + alpha * (clamp(target[key]) - this.value[key])]; })); return { ...this.value }; }
}
export class RateMeter {
  constructor(windowMs = 2000) { this.windowMs = windowMs; this.times = []; }
  mark(now) { this.times.push(now); this.prune(now); }
  prune(now) { while (this.times.length && this.times[0] < now - this.windowMs) this.times.shift(); }
  value(now) { this.prune(now); const span = this.times.length ? now - this.times[0] : 0; return span >= 500 && this.times.length >= 2 ? (this.times.length - 1) * 1000 / Math.max(1, this.times.at(-1) - this.times[0]) : null; }
}
export function makeSession({ id, participantId, order, kind, consent, sourceType = 'live_camera', calibration, modelInfo, prerecorded, stimulusConfirmed = false, cameraSettings = {}, viewport = {}, now, userAgent = '', addedDelayMs = PARAMS.added_delay_ms }) {
  if (!validParticipantId(participantId)) throw new Error('请填写2–24位匿名编号（字母、数字、下划线或短横线）');
  if (!Array.isArray(order) || !ORDER_CODES.includes(orderCode(order)) || new Set(order).size !== 3 || order.some(c => !CONDITIONS.includes(c))) throw new Error('请选择ABC、ACB、BAC、BCA、CAB或CBA顺序');
  if (!['internal', 'exploratory'].includes(kind) || !SOURCE_TYPES.includes(sourceType)) throw new Error('记录类型无效');
  if (!consent || calibration?.status !== 'complete') throw new Error('请先完成知情同意与中性校准');
  if (!stimulusConfirmed || prerecorded?.source_type !== 'live_camera' || !/^[a-f0-9]{64}$/.test(prerecorded.sha256 || '') || prerecorded.avatar_key !== modelInfo?.avatar_key || prerecorded.model_sha256 !== modelInfo?.sha256 || prerecorded.donor_id === participantId || !Number.isFinite(prerecorded.offset_ms) || prerecorded.offset_ms < 0 || prerecorded.offset_ms + DURATION_MS > prerecorded.duration_ms) throw new Error('请加载同角色独立真实预录素材，并确认不是本参与者、未按正式任务提示录制');
  if (!Number.isInteger(addedDelayMs) || addedDelayMs < 0 || addedDelayMs > 2000) throw new Error('附加延迟须为0–2000ms整数');
  return { record_type: 'study_session', schema_version: SCHEMA_VERSION, project_id: PROJECT_ID, app_version: APP_VERSION, protocol_version: PROTOCOL_VERSION,
    session_id: id, participant_id: participantId, record_kind: kind, source_type: sourceType,
    consent: true, started_at: now, ended_at: null, exported_at: null, status: 'in_progress',
    condition_order: [...order], parameters: { ...JSON.parse(JSON.stringify(PARAMS)), added_delay_ms: addedDelayMs }, task_plan: TASKS,
    question_items: QUESTIONS, calibration: JSON.parse(JSON.stringify(calibration)), model_info: modelInfo,
    prerecorded_stimulus: { ...prerecorded, independence_confirmed: true },
    camera_settings: cameraSettings, viewport, user_agent: userAgent, validation_status: 'pending_manual_verification',
    measurement_note: 'inference_ms is compute time only; update rates use observed monotonic timestamps. No end-to-end latency was measured.',
    preference: null, conditions: [], frames: [], ratings: [], events: [], protocol_deviations: [],
  };
}
export class StudyController {
  constructor(session) { this.session = session; this.phase = 'ready'; this.activeMs = 0; this.block = null; this.paused = false; this.lastTick = null; this.restUntil = 0; }
  event(type, now, at, detail = {}) { this.session.events.push({ type, at, monotonic_ms: now, condition: this.block?.condition ?? null, active_ms: Math.round(this.activeMs), ...detail }); }
  begin(now, at) {
    if (!['ready', 'rest'].includes(this.phase)) throw new Error('当前不能开始条件');
    if (this.phase === 'rest' && now < this.restUntil) throw new Error('请完成条件间休息');
    const index = this.session.conditions.length;
    if (index >= CONDITIONS.length) throw new Error('三条件已完成');
    this.block = { condition: this.session.condition_order[index], block_index: index + 1, condition_position: index + 1, added_delay_ms: this.session.condition_order[index] === 'C_delayed' ? this.session.parameters.added_delay_ms : 0, started_at: at, ended_at: null, start_monotonic_ms: now, end_monotonic_ms: null, active_ms: 0, wall_elapsed_ms: 0, status: 'running' };
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
    if (QUESTIONS.some(q => !Number.isInteger(scores[q.id]) || scores[q.id] < 1 || scores[q.id] > 7)) throw new Error('请完成六题1–7分自评');
    this.session.ratings.push({ session_id: this.session.session_id, participant_id: this.session.participant_id, source_type: this.session.source_type, record_kind: this.session.record_kind, protocol_version: this.session.protocol_version, condition_order: orderCode(this.session.condition_order), condition: this.block.condition, block_index: this.block.block_index, condition_position: this.block.block_index, added_delay_ms: this.block.added_delay_ms, submitted_at: at, ...scores, comment: String(comment).slice(0, 1000), open_feedback: String(comment).slice(0, 1000) });
    this.event('ratings_submitted', now, at);
    if (this.session.conditions.length === CONDITIONS.length) { this.phase = 'preference'; this.session.status = 'awaiting_preference'; this.event('all_ratings_submitted', now, at); }
    else { this.phase = 'rest'; this.restUntil = now + PARAMS.rest_ms; this.session.status = 'in_progress'; this.event('rest_started', now, at); }
  }
  prefer(choice, now, at) {
    if (this.phase !== 'preference' || ![...CONDITIONS,'no_preference'].includes(choice)) throw new Error('请选择一种模式或无明显偏好');
    this.session.preference = { participant_id: this.session.participant_id, session_id: this.session.session_id, condition_order: orderCode(this.session.condition_order), selected_condition: choice, submitted_at: at };
    for (const rating of this.session.ratings) rating.overall_preference = choice;
    this.phase = 'complete'; this.session.status = 'complete'; this.session.ended_at = at; this.event('session_completed', now, at);
  }
  abort(reason, now, at) { if (['complete', 'aborted'].includes(this.phase)) return; if (this.block?.status === 'running') { this.block.status = 'aborted'; this.block.ended_at = at; this.block.end_monotonic_ms = now; this.block.wall_elapsed_ms = now - this.block.start_monotonic_ms; } this.phase = 'aborted'; this.session.status = 'aborted'; this.session.ended_at = at; this.session.abort_reason = reason; this.event('session_aborted', now, at, { reason }); }
}
export function csv(rows, columns) {
  const safe = value => { let text = value == null ? '' : String(value); if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return '\uFEFF' + [columns.map(safe).join(','), ...rows.map(row => columns.map(key => safe(row[key])).join(','))].join('\r\n') + '\r\n';
}
export const FRAME_COLUMNS = ['session_id', 'participant_id', 'source_type', 'protocol_version', 'condition_order', 'condition', 'block_index', 'condition_position', 'task_id', 'timestamp', 'added_delay_ms', 'tracking_valid', 'tracking_fps', 'camera_input_fps', 'input_timestamp_ms', 'input_available_at_ms', 'feedback_input_timestamp_ms', 'feedback_buffer_enqueue_ms', 'feedback_applied_at_ms', 'actual_buffer_delay_ms', 'feedback_state', 'output_rendered', 'software_latency_ms', 'normal_processing_ms', 'feedback_processing_start_ms', 'feedback_frame_capture_ms', 'feedback_video_presentation_ms', 'captured_at', 'monotonic_ms', 'wall_elapsed_ms', 'active_ms', 'task', 'detected', 'paused', 'prerecorded_sha256', 'prerecorded_position_ms', 'render_fps', 'tracking_update_hz', 'avatar_update_hz', 'inference_ms', 'frame_to_render_submit_ms', 'video_present_to_render_submit_ms', 'render_submitted_at_ms', 'pose_valid', ...['pitch','yaw','roll'].flatMap(k => ['raw_pose_' + k, 'corrected_pose_' + k, 'applied_pose_' + k]), ...COEFFICIENTS.flatMap(k => ['raw_' + k, 'corrected_' + k, 'target_' + k, 'live_filtered_' + k, 'applied_' + k])];
export const RATING_COLUMNS = ['session_id', 'participant_id', 'record_kind', 'source_type', 'protocol_version', 'condition_order', 'condition', 'block_index', 'condition_position', 'added_delay_ms', 'submitted_at', ...QUESTIONS.map(q => q.id), 'comment', 'open_feedback', 'overall_preference'];
