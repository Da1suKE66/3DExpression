import { COEFFICIENTS, DURATION_MS, PARAMS, validParticipantId } from './core.js?v=0.5.0';
import { readTrackingFile } from './replay.js?v=0.5.0';

// Profiles describe motion, not perceived naturalness or an established match.
export function expressionProfile(frames, prefix = 'applied_') {
  if (frames.length < 2) return null;
  const duration = (frames.at(-1).monotonic_ms - frames[0].monotonic_ms) / 1000;
  const actions = { jaw: ['jawOpen'], blink: ['eyeBlinkLeft', 'eyeBlinkRight'], smile: ['mouthSmileLeft', 'mouthSmileRight'], brow: ['browInnerUp','browOuterUpLeft','browOuterUpRight'] };
  return Object.fromEntries(Object.entries(actions).map(([action, keys]) => {
    const values = frames.map(f => keys.reduce((sum, key) => sum + f[prefix + key], 0) / keys.length);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    let armed = true, cycles = 0;
    for (const v of values) { if (v <= (action === 'brow' ? 0.05 : 0.15)) armed = true; if (armed && v >= (action === 'brow' ? 0.15 : 0.35)) { cycles++; armed = false; } }
    return [action, { min: Math.min(...values), max: Math.max(...values), mean, sd: Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length), threshold_cycles: cycles, cycles_per_min: duration > 0 ? cycles * 60 / duration : null }];
  }));
}

export async function readPrerecordedFile(file, modelInfo) {
  const record = await readTrackingFile(file);
  const data = record.data, frames = data.frames;
  if (data.record_type !== 'tracking_recording' || data.status !== 'complete' || data.source_type !== 'live_camera' || record.origin !== 'live_camera') throw new Error('A素材必须是独立真实摄像头录制的完整参数记录；合成、回放和实验会话不能作为素材');
  if (data.consent !== true || !validParticipantId(data.participant_id) || data.calibration.source_type !== 'live_camera' || data.calibration.sample_count < PARAMS.calibration_min_samples || !Number.isFinite(data.calibration.sample_count)) throw new Error('素材缺少同意、匿名录制编号或真实相机校准信息');
  if (data.model_info.avatar_key !== modelInfo.avatar_key || data.model_info.sha256 !== modelInfo.sha256) throw new Error('A素材与当前化身不一致，请先选择录制时的同一化身');
  const duration = frames.at(-1).monotonic_ms - frames[0].monotonic_ms;
  if (duration < DURATION_MS) throw new Error('A素材需至少60秒有效连续参数，建议独立录制75–120秒');
  if (frames.some((f, i) => f.detected !== 1 || f.source_type !== 'live_camera' || f.sample_kind !== 'result' || !['B', 'B_realtime'].includes(f.condition) || (i && (f.monotonic_ms <= frames[i - 1].monotonic_ms || f.monotonic_ms - frames[i - 1].monotonic_ms > PARAMS.tracking_stale_ms)) || COEFFICIENTS.some(k => !Number.isFinite(f['applied_' + k]) || f['applied_' + k] < 0 || f['applied_' + k] > 1))) throw new Error('A素材需全程真实跟踪、实时模式和完整应用系数；检测丢失、时间间隙或静态段请重新录制');
  const profile = expressionProfile(frames);
  if (Object.values(profile).some(p => p.threshold_cycles < 2)) throw new Error('素材中张嘴、眨眼、微笑和抬眉各需至少2次可辨变化；请自然混合录制后人工核对');
  return { ...record, profile, durationMs: duration };
}

export class PrerecordedPlayback {
  constructor(record, randomUnit) {
    if (!Number.isFinite(randomUnit) || randomUnit < 0 || randomUnit >= 1 || record.durationMs < DURATION_MS) throw new Error('预录素材时长或随机起点无效');
    this.record = record; this.frames = record.data.frames; this.first = this.frames[0].monotonic_ms;
    this.offsetMs = randomUnit * (record.durationMs - DURATION_MS); this.index = 0;
    this.windowProfile = expressionProfile(this.frames.filter(f => f.monotonic_ms >= this.first + this.offsetMs && f.monotonic_ms <= this.first + this.offsetMs + DURATION_MS));
    if (!this.windowProfile || Object.values(this.windowProfile).some(p => p.threshold_cycles < 1)) throw new Error('所选60秒窗口缺少足够的张嘴、眨眼、微笑或抬眉变化，请录制分布更均匀的独立素材');
  }
  sample(activeMs) {
    const position = this.offsetMs + Math.max(0, Math.min(DURATION_MS, activeMs));
    const time = this.first + position;
    while (this.index > 0 && this.frames[this.index].monotonic_ms > time) this.index--;
    while (this.index + 1 < this.frames.length && this.frames[this.index + 1].monotonic_ms <= time) this.index++;
    const a = this.frames[this.index], b = this.frames[Math.min(this.index + 1, this.frames.length - 1)];
    const t = b.monotonic_ms > a.monotonic_ms ? (time - a.monotonic_ms) / (b.monotonic_ms - a.monotonic_ms) : 0;
    return { position_ms: position, expression: Object.fromEntries(COEFFICIENTS.map(k => [k, a['applied_' + k] + t * (b['applied_' + k] - a['applied_' + k])])) };
  }
  metadata() {
    return { source_type: 'live_camera', sha256: this.record.sha256, session_id: this.record.data.session_id, donor_id: this.record.data.participant_id, protocol_version: this.record.data.protocol_version, avatar_key: this.record.data.model_info.avatar_key, model_sha256: this.record.data.model_info.sha256, duration_ms: this.record.durationMs, offset_ms: this.offsetMs, window_ms: DURATION_MS, sampling: 'recorded_applied_coefficients_linear_interpolation', selection: 'crypto_random_contiguous_window_without_task_alignment', profile: this.record.profile, window_profile: this.windowProfile };
  }
}
