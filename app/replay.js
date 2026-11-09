import { PROTOCOL_VERSION, COEFFICIENTS, PARAMS } from './core.js?v=0.3.1';
import { POSE_AXES } from './expressions.js?v=0.3.1';

const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export async function readTrackingFile(file) {
  if (file.size > 32 * 1024 * 1024) throw new Error('回放文件超过32MB');
  const text = await file.text(); let data;
  try { data = JSON.parse(text); } catch { throw new Error('请选择完整的参数JSON文件'); }
  if (data.protocol_version !== PROTOCOL_VERSION || !Array.isArray(data.frames) || !data.frames.length) throw new Error('需要当前90秒协议导出的参数或会话JSON；旧版与空记录不能回放');
  const origin = data.source_type === 'recorded_tracking' ? data.replay_metadata?.original_source_type : data.source_type;
  if (!['live_camera', 'synthetic_test'].includes(origin)) throw new Error('回放缺少原始输入来源');
  if (data.parameters?.avatar_id !== PARAMS.avatar_id || data.calibration?.status !== 'complete') throw new Error('模型或校准信息不匹配');
  if (!['doraemon','pikachu'].includes(data.model_info?.avatar_key) || !/^[a-f0-9]{64}$/.test(data.model_info?.sha256 || '') || data.calibration.avatar_key !== data.model_info.avatar_key || data.calibration.model_sha256 !== data.model_info.sha256) throw new Error('角色与校准记录不匹配');
  if (JSON.stringify(canonical(data.parameters)) !== JSON.stringify(canonical(PARAMS))) throw new Error('记录的固定参数与当前版本不一致，无法按同一配置回放');
  let previous = -Infinity;
  for (const frame of data.frames) {
    if (!Number.isFinite(frame.monotonic_ms) || frame.monotonic_ms < previous || ![0, 1].includes(frame.detected)) throw new Error('参数时间轴或检测状态无效');
    if (frame.detected && COEFFICIENTS.some(key => !Number.isFinite(frame['raw_' + key]) || frame['raw_' + key] < 0 || frame['raw_' + key] > 1)) throw new Error('回放系数缺失或越界');
    previous = frame.monotonic_ms;
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return { data, origin, sha256: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') };
}

export class TrackingReplay {
  constructor(record) { this.record = record; this.frames = record.data.frames; this.first = this.frames[0].monotonic_ms; this.durationMs = this.frames.at(-1).monotonic_ms - this.first; this.position = 0; this.playing = false; this.lastIndex = -1; this.offset = 0; this.started = 0; }
  play(now) { if (this.position >= this.durationMs) { this.position = 0; this.lastIndex = -1; } this.started = now; this.offset = this.position; this.playing = true; }
  pause(now) { this.position = Math.min(this.durationMs, this.offset + now - this.started); this.playing = false; }
  sample(now) {
    if (!this.playing) return null;
    this.position = Math.min(this.durationMs, this.offset + now - this.started);
    let index = Math.max(0, this.lastIndex);
    while (index + 1 < this.frames.length && this.frames[index + 1].monotonic_ms - this.first <= this.position) index++;
    if (index === this.lastIndex) { if (this.position >= this.durationMs) this.playing = false; return null; }
    this.lastIndex = index;
    const frame = this.frames[index];
    if (this.position >= this.durationMs) this.playing = false;
    return { detected: Boolean(frame.detected), raw: frame.detected ? Object.fromEntries(COEFFICIENTS.map(key => [key, frame['raw_' + key]])) : null, pose: frame.detected && frame.pose_valid ? Object.fromEntries(POSE_AXES.map(axis => [axis, frame['raw_pose_' + axis]])) : null, inference_ms: null, original_inference_ms: frame.inference_ms, original_captured_at: frame.captured_at, monotonic_ms: now, sample_kind: 'replay_frame' };
  }
}
