// Coefficients describe visible movements, not a person's emotional state.
export const EXTENDED_COEFFICIENTS = Object.freeze([
  'jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthFrownLeft', 'mouthFrownRight', 'browDownLeft', 'browDownRight', 'browInnerUp',
  'browOuterUpLeft', 'browOuterUpRight', 'eyeWideLeft', 'eyeWideRight',
  'mouthPucker', 'mouthPressLeft', 'mouthPressRight',
]);
export const POSE_AXES = Object.freeze(['pitch', 'yaw', 'roll']);
export const POSE_LIMITS = Object.freeze({ pitch: 25 * Math.PI / 180, yaw: 35 * Math.PI / 180, roll: 20 * Math.PI / 180 });
export const zeroPose = () => ({ pitch: 0, yaw: 0, roll: 0 });
export const validPose = pose => Boolean(pose && POSE_AXES.every(axis => Number.isFinite(pose[axis])));
const bound = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const wrap = n => Math.atan2(Math.sin(n), Math.cos(n));

export function poseFromMatrix(matrix) {
  const data = matrix?.data || matrix;
  if (!data || data.length !== 16 || !Array.from(data).every(Number.isFinite)) return null;
  // MediaPipe/Three.js column-major matrix. Remove scale before YXZ decomposition.
  const scales = [0, 4, 8].map(i => Math.hypot(data[i], data[i + 1], data[i + 2]));
  if (scales.some(s => s < 1e-6)) return null;
  const c = [0, 4, 8].map((i, column) => [data[i], data[i + 1], data[i + 2]].map(x => x / scales[column]));
  const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
  if (Math.abs(dot(c[0], c[1])) > 0.1 || Math.abs(dot(c[0], c[2])) > 0.1 || Math.abs(dot(c[1], c[2])) > 0.1) return null;
  const pitch = Math.asin(-bound(c[2][1], -1, 1));
  const yaw = Math.abs(c[2][1]) < 0.99999 ? Math.atan2(c[2][0], c[2][2]) : Math.atan2(-c[0][2], c[0][0]);
  const roll = Math.abs(c[2][1]) < 0.99999 ? Math.atan2(c[0][1], c[1][1]) : 0;
  // Mirror the rotation to match the CSS-mirrored local camera preview.
  return { pitch, yaw: -yaw, roll: -roll };
}

export function relativePose(pose, baseline, limits = POSE_LIMITS) {
  if (!validPose(pose) || !validPose(baseline)) return zeroPose();
  return Object.fromEntries(POSE_AXES.map(axis => [axis, bound(wrap(pose[axis] - baseline[axis]), -limits[axis], limits[axis])]));
}

export class PoseFilter {
  constructor(tau = 100) { this.tau = tau; this.reset(); }
  reset() { this.value = zeroPose(); this.last = null; }
  update(target, now) {
    if (!validPose(target)) { this.reset(); return zeroPose(); }
    const dt = this.last === null ? 40 : bound(now - this.last, 1, 250);
    this.last = now;
    const alpha = 1 - Math.exp(-dt / this.tau);
    for (const axis of POSE_AXES) this.value[axis] += alpha * (target[axis] - this.value[axis]);
    return { ...this.value };
  }
}

export const ACTIONS = Object.freeze({
  neutral: { label: '中性保持', instruction: '合嘴、睁眼，放松面部和头部，保持至少10秒。', channels: [], repetitions: 0 },
  jaw: { label: '张嘴', instruction: '缓慢张嘴、合拢5次。', channels: ['jawOpen'], repetitions: 5 },
  blink: { label: '眨眼', instruction: '缓慢闭眼、睁眼5次；可分别尝试左右眼。', channels: ['eyeBlinkLeft', 'eyeBlinkRight'], repetitions: 5 },
  smile: { label: '微笑', instruction: '微笑、放松5次。', channels: ['mouthSmileLeft', 'mouthSmileRight'], repetitions: 5 },
  sad: { label: '伤心动作', instruction: '嘴角向下、眉心轻抬，再放松，重复5次；这是动作模仿。', channels: ['mouthFrownLeft', 'mouthFrownRight', 'browInnerUp'], repetitions: 5 },
  surprise: { label: '惊讶动作', instruction: '抬眉、睁大眼睛、轻张嘴，再放松，重复5次。', channels: ['browOuterUpLeft', 'browOuterUpRight', 'eyeWideLeft', 'eyeWideRight', 'jawOpen'], repetitions: 5 },
  angry: { label: '皱眉抿嘴', instruction: '轻皱眉、抿嘴，再放松，重复5次。', channels: ['browDownLeft', 'browDownRight', 'mouthPressLeft', 'mouthPressRight'], repetitions: 5 },
  pucker: { label: '噘嘴', instruction: '噘嘴、放松5次。', channels: ['mouthPucker'], repetitions: 5 },
  head_yaw: { label: '左右转头', instruction: '缓慢左右转头、回正3次，幅度适中。', channels: ['pose_yaw'], repetitions: 3 },
  head_pitch: { label: '抬头低头', instruction: '缓慢抬头、低头、回正3次。', channels: ['pose_pitch'], repetitions: 3 },
  head_roll: { label: '左右侧倾', instruction: '缓慢左右歪头、回正3次。', channels: ['pose_roll'], repetitions: 3 },
  switching: { label: '连续切换', instruction: '按微笑→伤心动作→惊讶动作→噘嘴顺序做一轮，重复3轮。', channels: ['mouthSmileLeft', 'mouthFrownLeft', 'browOuterUpLeft', 'mouthPucker'], repetitions: 3 },
  recovery: { label: '离开与恢复', instruction: '离开画面，再回到镜头前。准确恢复时间需配合同步视频标注。', channels: [], repetitions: 1 },
});

export function actionStrength(raw, action) {
  const channels = ACTIONS[action]?.channels.filter(key => !key.startsWith('pose_')) || [];
  return channels.length ? channels.reduce((sum, key) => sum + (raw[key] || 0), 0) / channels.length : 0;
}
