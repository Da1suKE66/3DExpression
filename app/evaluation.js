import { ACTIONS } from './expressions.js?v=0.3.0-r2';

// A separate engineering capture. An unscored trial never becomes a success.
export class EngineeringEvaluation {
  constructor(makeTrackingRecord) { this.makeTrackingRecord = makeTrackingRecord; this.record = null; this.active = false; this.saved = true; this.trial = null; this.visibleSince = null; this.visibleMs = 0; }
  start(now, at, quality) {
    if (this.active || (this.record && !this.saved)) throw new Error('请先结束并保存上一份评估。');
    const tracking = this.makeTrackingRecord();
    this.record = { record_type: 'engineering_evaluation', schema_version: '1.0.0', evaluation_protocol: 'IPP31078-EVAL-v1', source_type: tracking.source_type, session_id: tracking.session_id, started_at: at, ended_at: null, status: 'in_progress', tracking, trials: [], visibility_events: [], render_count: 0, visible_duration_ms: 0, video_quality_start: quality, video_quality_end: null, measurement_note: 'Browser capture/presentation to render submission is a pipeline proxy, not physical end-to-end latency. Manual observations are never inferred from coefficients.' };
    this.active = true; this.saved = false; this.trial = null; this.visibleMs = 0; this.visibleSince = now;
  }
  visibleDuration(now) { return this.visibleMs + (this.visibleSince === null ? 0 : Math.max(0, now - this.visibleSince)); }
  visibility(visible, now, at) {
    if (!this.active) return;
    if (this.visibleSince !== null) this.visibleMs += Math.max(0, now - this.visibleSince);
    this.visibleSince = visible ? now : null;
    this.record.visibility_events.push({ visible, monotonic_ms: now, at });
  }
  beginTrial(action, now, at) {
    if (!this.active || this.trial || !ACTIONS[action]) throw new Error('请先开始评估，并完成当前动作。');
    const spec = ACTIONS[action];
    this.trial = { trial_id: crypto.randomUUID(), action, label: spec.label, requested_repetitions: spec.repetitions, started_at: at, start_monotonic_ms: now, visible_start_ms: this.visibleDuration(now), ended_at: null, end_monotonic_ms: null, observed_successes: null, observation_method: null, notes: '', status: 'in_progress' };
    this.record.trials.push(this.trial);
  }
  finishTrial(now, at, observed = null, notes = '', reason = 'user_completed') {
    if (!this.trial) throw new Error('当前没有正在检查的动作。');
    if (observed !== null && (!Number.isInteger(observed) || observed < 0 || observed > this.trial.requested_repetitions)) throw new Error('观察成功次数须在本项要求次数范围内；未核对请留空。');
    Object.assign(this.trial, { ended_at: at, end_monotonic_ms: now, visible_duration_ms: this.visibleDuration(now) - this.trial.visible_start_ms, wall_completion_ms: now - this.trial.start_monotonic_ms, observed_successes: observed, observation_method: observed === null ? null : 'operator_visual_count', notes, status: reason === 'user_completed' ? 'completed' : 'interrupted', end_reason: reason });
    this.trial = null;
  }
  frame(frame) {
    if (!this.active || this.visibleSince === null) return;
    if (this.record.tracking.frames.length >= 30000) throw new Error('评估达到30000条采样上限，请结束并保存。');
    const tracking = this.record.tracking;
    tracking.frames.push({ ...frame, session_id: tracking.session_id, participant_id: tracking.participant_id, trial_id: this.trial?.trial_id || null, evaluation_action: this.trial?.action || null, expected_face_visible: this.trial ? this.trial.action !== 'recovery' : null });
  }
  render() { if (this.active && this.visibleSince !== null) this.record.render_count++; }
  stop(now, at, quality, reason = 'user_ended') {
    if (!this.active) return;
    if (this.trial) this.finishTrial(now, at, null, '', 'evaluation_ended_before_trial_completion');
    const tracking = this.record.tracking;
    Object.assign(tracking, { ended_at: at, exported_at: at, status: 'complete', duration_ms: now - tracking.start_monotonic_ms, end_monotonic_ms: now, stop_reason: reason });
    Object.assign(this.record, { ended_at: at, status: reason === 'user_ended' ? 'complete' : 'interrupted', visible_duration_ms: this.visibleDuration(now), video_quality_end: quality, stop_reason: reason });
    this.active = false; this.visibleSince = null;
  }
  export(at) {
    if (this.active || !this.record?.tracking.frames.length) throw new Error('请先完成至少一段有实际采样的评估并结束。');
    this.record.tracking.exported_at = at;
    return { ...this.record, exported_at: at };
  }
  updateUI(now, ready) {
    const el = id => document.getElementById(id);
    el('evaluation-start').disabled = this.active || !ready || Boolean(this.record && !this.saved);
    el('evaluation-stop').disabled = !this.active;
    el('evaluation-save').disabled = this.active || !this.record?.tracking.frames.length;
    el('trial-start').disabled = !this.active || Boolean(this.trial) || !ready;
    el('trial-finish').disabled = !this.active || !this.trial || (this.trial.action === 'neutral' && now - this.trial.start_monotonic_ms < 10000);
    el('evaluation-action').disabled = !this.active || Boolean(this.trial);
    el('trial-observed').disabled = !this.trial || this.trial.requested_repetitions === 0;
    el('trial-notes').disabled = !this.trial;
    el('evaluation-status').textContent = this.active ? `评估中 · 可见计时 ${(this.visibleDuration(now) / 1000).toFixed(0)}秒 · ${this.record.tracking.frames.length}条采样 · ${this.record.trials.filter(t => t.status === 'completed').length}项已完成` : this.record ? this.saved ? '评估已保存。可运行“评估分析.command”生成指标报告。' : '评估已结束，请保存记录。' : '先连接摄像头并中性校准。评估记录与正式问卷分开保存。';
    if (this.active && this.trial) {
      el('task-index').textContent = `工程评估 · ${this.trial.label}`;
      el('task-title').textContent = this.trial.label;
      el('task-description').textContent = ACTIONS[this.trial.action].instruction + ' 完成后在右侧记录实际观察并点击“完成本项”。';
      el('trial-time').textContent = `本项用时 ${((now - this.trial.start_monotonic_ms) / 1000).toFixed(1)} 秒`;
    } else el('trial-time').textContent = '';
  }
}
