import { createAvatar } from './avatar.js?v=0.3.1';
import { CameraTracker } from './tracker.js?v=0.3.1';
import { DemoRecorder } from './recording.js?v=0.3.1';
import { TrackingReplay, readTrackingFile } from './replay.js?v=0.3.1';
import { POSE_AXES, zeroPose, validPose, relativePose, PoseFilter, ACTIONS, actionStrength } from './expressions.js?v=0.3.1';
import { EngineeringEvaluation } from './evaluation.js?v=0.3.1';
import { APP_VERSION, PROTOCOL_VERSION, SCHEMA_VERSION, PROJECT_ID, PARAMS, QUESTIONS, COEFFICIENTS, neutral, median, makeCalibration, correctExpression, mapExpression, retargetExpression, ExpressionFilter, RateMeter, taskAt, validParticipantId, suggestedOrder, makeSession, StudyController, csv, FRAME_COLUMNS, RATING_COLUMNS } from './core.js?v=0.3.1';

const el = id => document.getElementById(id);
const iso = () => new Date().toISOString();
const fmt = value => value == null || !Number.isFinite(value) ? '—' : value.toFixed(1);
const copy = value => JSON.parse(JSON.stringify(value));
const query = new URLSearchParams(location.search);
const testSource = query.get('source') === 'synthetic_test';
const video = el('webcam');
let avatar, ready = false, loading = false, mode = query.get('mode') === 'demo' ? 'demo' : 'study', demoCondition = 'B';
let connectionSequence = 0;
let calibration = null, calibrating = null, study = null, clip = null, replay = null;
let exported = false, clipExported = true, lastPhase = '', lastTask = '', lastUI = -Infinity;
let detected = false, lastResultAt = -Infinity, raw = neutral(), corrected = neutral(), targetExpression = neutral(), filtered = neutral(), applied = neutral();
let recorder = null, recordedVideo = null, lastVideoLabel = -1, frameSequence = 0;
let lastRenderAt = -Infinity, cameraWasLive = false;
let rawPose = null, correctedPose = zeroPose(), appliedPose = zeroPose(), pendingFrame = null;
const poseFilter = new PoseFilter(PARAMS.head_smoothing_tau_ms);
const filter = new ExpressionFilter(), renderRate = new RateMeter(), resultRate = new RateMeter(), applyRate = new RateMeter();
const tracker = new CameraTracker(video, (text, progress) => { el('load-state').textContent = text; el('load-progress').value = progress; });
const evaluation = new EngineeringEvaluation(() => makeTrackingRecord());
const sourceType = () => replay ? 'recorded_tracking' : testSource ? 'synthetic_test' : 'live_camera';
const activeStudy = () => study && !['ready', 'complete', 'aborted'].includes(study.phase);
const tracked = () => detected && performance.now() - lastResultAt <= PARAMS.tracking_stale_ms && (replay ? replay.playing : tracker.live());
const condition = () => mode === 'study' ? study?.phase === 'running' ? study.block.condition : 'A' : demoCondition;
const viewportMatches = () => !study || (Math.abs(innerWidth - study.session.viewport.width) <= 2 && Math.abs(innerHeight - study.session.viewport.height) <= 2);
function message(text) { el('message').textContent = text; }
function log(type, details = {}) { const now = performance.now(), at = iso(); if (study) study.event(type, now, at, details); if (clip?.status === 'recording') clip.events.push({ type, at, monotonic_ms: now, ...details }); }
function renderExpression(now = performance.now()) { applied = mapExpression(tracked() ? filtered : neutral(), condition()); avatar?.apply(applied); avatar?.applyPose(tracked() && (mode === 'demo' || study?.phase === 'running') ? appliedPose : zeroPose()); applyRate.mark(now); }
function clearSignal() { detected = false; raw = neutral(); corrected = neutral(); targetExpression = neutral(); filtered = neutral(); rawPose = null; correctedPose = zeroPose(); appliedPose = zeroPose(); filter.reset(); poseFilter.reset(); renderExpression(); }
function sourceLabel() { if (replay) return replay.record.origin === 'synthetic_test' ? '参数回放 · 合成测试来源' : '参数回放 · recorded_tracking'; return testSource ? '软件测试 · synthetic_test' : tracker.live() ? '实时摄像头 · live_camera' : '等待连接'; }

async function startCamera() {
  if (!el('consent').checked) return message('请先阅读并勾选知情说明。');
  if (!ready || loading || tracker.live()) return;
  const attempt = ++connectionSequence;
  if (replay) exitReplay();
  calibration = null; calibrating = null; clearSignal(); resultRate.times = []; applyRate.times = []; loading = true;
  el('camera-stop').disabled = false; el('camera-start').disabled = true;
  try {
    const started = await tracker.start();
    if (started) { video.dataset.live = 'true'; el('camera-placeholder').hidden = true; cameraWasLive = true; message('连接就绪。请保持中性表情，完成一次3秒校准。'); }
  } catch (error) { if (attempt === connectionSequence) { tracker.stop(); clearSignal(); message('启动失败：' + error.message + '。请检查系统和浏览器相机权限，或稍后重试。真实摄像头待人工验收。'); } }
  finally { if (attempt === connectionSequence) { loading = false; updateUI(true); } }
}
function stopCamera(reason = 'camera_stopped') {
  connectionSequence++;
  if (activeStudy()) { study.abort(reason, performance.now(), iso()); exported = false; }
  if (clip?.status === 'recording') finishClip(reason);
  if (recorder?.active) recorder.stop(reason);
  if (evaluation.active) evaluation.stop(performance.now(), iso(), tracker.quality(), reason);
  tracker.stop(); cameraWasLive = false; loading = false; calibration = null; calibrating = null;
  delete video.dataset.live; el('camera-placeholder').hidden = false;
  el('load-state').textContent = '摄像头已停止'; el('load-progress').value = ready ? 1 : 0;
  clearSignal(); updateUI(true);
}
function beginCalibration() {
  if (!tracker.live() || !tracked()) return message('请先开启摄像头并面向镜头。');
  if (activeStudy() || clip?.status === 'recording' || recorder?.active || evaluation.active) return message('请结束当前体验、评估或录制后再校准。');
  calibration = null; calibrating = { samples: [], poses: [], start: null, started_at: iso() }; filter.reset(); poseFilter.reset();
  message('校准中：请正对镜头，合嘴、睁眼并放松，不刻意微笑。');
}
function calibrationSample(sample) {
  if (!calibrating) return;
  if (!sample.detected) { calibrating.samples = []; calibrating.poses = []; calibrating.start = null; return; }
  if (calibrating.start === null) calibrating.start = sample.monotonic_ms;
  calibrating.samples.push(sample.raw);
  if (validPose(sample.pose)) calibrating.poses.push(sample.pose);
  const observedDuration = sample.monotonic_ms - calibrating.start;
  if (observedDuration < PARAMS.calibration_ms) return;
  if (calibrating.samples.length < PARAMS.calibration_min_samples && observedDuration < 15000) return;
  try {
    const headBaseline = calibrating.poses.length >= PARAMS.calibration_min_samples ? Object.fromEntries(POSE_AXES.map(axis => [axis, median(calibrating.poses.map(p => p[axis]))])) : null;
    calibration = makeCalibration(calibrating.samples, { calibration_id: crypto.randomUUID(), source_type: sourceType(), started_at: calibrating.started_at, ended_at: iso(), observed_duration_ms: observedDuration, head_baseline: headBaseline, head_pose_sample_count: calibrating.poses.length, avatar_key: avatar.info.avatar_key, model_sha256: avatar.info.sha256 });
    filter.reset(); log('calibration_completed', { sample_count: calibration.sample_count, calibration_id: calibration.calibration_id });
    message('中性校准完成。配置将用于两条件，条件间不再改变。');
  } catch (error) { message(error.message); }
  calibrating = null;
}
function switchMode(next) {
  if (activeStudy() || recorder?.active || recordedVideo || (study && !exported) || (clip && !clipExported) || !evaluation.saved) return message('请先结束当前体验、评估或录制。');
  if (study && !exported) return message('请先保存完整记录或下载JSON，再切换模式。');
  mode = next; filter.reset(); renderExpression(); lastPhase = ''; updateUI(true);
}
async function switchAvatar() {
  if (!avatar) return;
  const previous = avatar.info.avatar_key, selected = el('avatar-select').value;
  if (replay || activeStudy() || recorder?.active || recordedVideo || clip?.status === 'recording' || (clip && !clipExported) || (study && !exported) || !evaluation.saved) { el('avatar-select').value = previous; return message('请先结束并保存当前体验、评估或录制，再切换角色。'); }
  ready = false; calibration = null; calibrating = null; clearSignal(); updateUI(true);
  try { await avatar.setAvatar(selected); message('已切换为' + avatar.info.label + '。请保持中性，重新校准；摄像头连接会保留。'); }
  catch (error) { el('avatar-select').value = previous; message('切换角色失败：' + error.message); }
  finally { ready = true; updateUI(true); }
}
function startStudy() {
  if (evaluation.active || clip?.status === 'recording' || recorder?.active) return message('请先结束工程评估或录制。');
  if (replay) return message('参数回放不能用于正式A/B体验。');
  if (!tracked() || !calibration) return message('请先完成中性校准并确认面部追踪稳定。');
  try {
    const session = makeSession({ id: crypto.randomUUID(), participantId: el('participant-id').value.trim(), order: el('condition-order').value.split(''), kind: el('record-kind').value, consent: el('consent').checked, sourceType: sourceType(), calibration, modelInfo: avatar.info, cameraSettings: tracker.settings(), viewport: { width: innerWidth, height: innerHeight, pixel_ratio: Math.min(devicePixelRatio, PARAMS.max_pixel_ratio) }, now: iso(), userAgent: navigator.userAgent });
    study = new StudyController(session); exported = false; lastTask = ''; filter.reset();
    study.event('session_started', performance.now(), iso()); study.begin(performance.now(), iso()); renderExpression(); updateUI(true);
    message('请按屏幕提示完成任务；没有需要迎合的理想体验。');
  } catch (error) { message(error.message); }
}
function submitRating(event) {
  event.preventDefault(); if (!study || study.phase !== 'survey') return;
  const form = new FormData(el('rating-form'));
  try { study.rate(Object.fromEntries(QUESTIONS.map(q => [q.id, Number(form.get(q.id))])), el('feedback').value.trim(), performance.now(), iso()); updateUI(true); if (study.phase === 'complete') { stopCamera('completed'); message('两条件已完成。请保存记录到项目并下载备份。'); } }
  catch (error) { message(error.message); }
}
function nextCondition() {
  if (!study || study.phase !== 'rest' || !tracked()) return;
  if (!viewportMatches()) return message(`请恢复开始时的窗口尺寸 ${study.session.viewport.width}×${study.session.viewport.height} 后继续，避免改变条件画质。`);
  try { filter.reset(); lastTask = ''; study.event('rest_ended', performance.now(), iso()); study.begin(performance.now(), iso()); renderExpression(); updateUI(true); }
  catch (error) { message(error.message); }
}
function makeFrame(sample) {
  const now = sample.monotonic_ms;
  const owner = study?.phase === 'running' ? study.session : clip?.status === 'recording' ? clip : null;
  const frame = { session_id: owner?.session_id || null, participant_id: owner?.participant_id || el('participant-id').value.trim(), source_type: sourceType(), condition: condition(), block_index: study?.phase === 'running' ? study.block.block_index : 0, captured_at: iso(), monotonic_ms: Number(now.toFixed(3)), wall_elapsed_ms: study?.phase === 'running' ? Math.round(now - study.block.start_monotonic_ms) : clip?.status === 'recording' ? Math.round(now - clip.start_monotonic_ms) : 0, active_ms: study?.phase === 'running' ? Math.round(study.activeMs) : null, task: study?.phase === 'running' ? taskAt(study.activeMs)?.id || 'finished' : 'demonstration', sample_kind: sample.sample_kind, result_index: sample.sample_kind === 'tracking_timeout' ? null : frameSequence++, detected: Number(sample.detected), paused: Number(Boolean(study?.paused || document.hidden || !sample.detected)), render_fps: renderRate.value(now), tracking_update_hz: resultRate.value(now), avatar_update_hz: applyRate.value(now), inference_ms: sample.inference_ms == null ? null : Number(sample.inference_ms.toFixed(3)) };
  for (const key of COEFFICIENTS) { frame['raw_' + key] = sample.detected ? raw[key] : null; frame['corrected_' + key] = sample.detected ? corrected[key] : null; frame['target_' + key] = sample.detected ? targetExpression[key] : null; frame['applied_' + key] = applied[key]; }
  frame.pose_valid = Boolean(sample.detected && validPose(rawPose));
  for (const axis of POSE_AXES) { frame['raw_pose_' + axis] = frame.pose_valid ? rawPose[axis] : null; frame['corrected_pose_' + axis] = sample.detected ? correctedPose[axis] : 0; frame['applied_pose_' + axis] = sample.detected ? appliedPose[axis] : 0; }
  for (const key of ['camera_media_time_s','frame_metadata_matched','frame_capture_at_ms','video_presentation_at_ms','video_frame_callback_at_ms','camera_presented_frames']) frame[key] = sample[key] ?? null;
  if (sample.original_captured_at) { frame.original_captured_at = sample.original_captured_at; frame.original_inference_ms = sample.original_inference_ms; }
  return frame;
}
function acceptSample(sample) {
  const wasDetected = detected;
  detected = sample.detected; lastResultAt = sample.monotonic_ms;
  if (sample.sample_kind !== 'tracking_timeout') resultRate.mark(sample.monotonic_ms);
  if (sample.detected) { raw = sample.raw; corrected = correctExpression(raw, calibration?.baseline); targetExpression = retargetExpression(corrected); filtered = filter.update(targetExpression, sample.monotonic_ms); rawPose = sample.pose; correctedPose = relativePose(rawPose, calibration?.head_baseline); appliedPose = poseFilter.update(correctedPose, sample.monotonic_ms); }
  else { raw = neutral(); corrected = neutral(); targetExpression = neutral(); filtered = neutral(); rawPose = null; correctedPose = zeroPose(); appliedPose = zeroPose(); filter.reset(); poseFilter.reset(); }
  if (wasDetected !== detected) log(detected ? 'tracking_recovered' : 'tracking_lost', { sample_kind: sample.sample_kind });
  calibrationSample(sample); renderExpression(sample.monotonic_ms);
  const frame = makeFrame(sample);
  pendingFrame = frame;
  if (study?.phase === 'running') study.session.frames.push(frame);
  if (clip?.status === 'recording') clip.frames.push(frame);
}
function makeTrackingRecord() {
  return { record_type: 'tracking_recording', schema_version: SCHEMA_VERSION, project_id: PROJECT_ID, app_version: APP_VERSION, protocol_version: PROTOCOL_VERSION, session_id: crypto.randomUUID(), participant_id: el('participant-id').value.trim() || 'DEMO', record_kind: 'engineering', source_type: sourceType(), consent: true, status: 'recording', started_at: iso(), ended_at: null, exported_at: null, start_monotonic_ms: performance.now(), parameters: copy(PARAMS), calibration: copy(calibration), model_info: avatar.info, camera_settings: tracker.settings(), video_quality_start: tracker.quality(), frames: [], events: [] };
}
function toggleClip() {
  if (evaluation.active) return message('请先结束工程评估。');
  if (clip?.status === 'recording') return finishClip('user');
  if (clip && !clipExported) return message('请先保存上一段参数，再开始新录制。');
  if (!tracker.live() || !calibration || replay) return message('真实参数录制需要摄像头和中性校准；回放不能重新标为实时输入。');
  clipExported = false;
  clip = makeTrackingRecord();
  message('正在录制真实参数。再次点击停止后可保存或回放；来源将随文件保留。'); updateUI(true);
}
function finishClip(reason = 'user') { if (!clip || clip.status !== 'recording') return; clip.ended_at = iso(); clip.end_monotonic_ms = performance.now(); clip.duration_ms = clip.end_monotonic_ms - clip.start_monotonic_ms; clip.status = 'complete'; clip.stop_reason = reason; clip.video_quality_end = tracker.quality(); el('tracking-save').disabled = !clip.frames.length; updateUI(true); message('参数录制已停止，共' + clip.frames.length + '条采样。请保存参数JSON。'); }
async function saveObject(endpoint, payload) { const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, exported_at: iso() }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '保存失败'); return result; }
function download(content, mime, filename) { const blob = content instanceof Blob ? content : new Blob([content], { type: mime }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
async function saveStudy() { if (!study) return; el('save-study').disabled = true; try { const result = await saveObject('/api/sessions', study.session); exported = true; message('已保存：' + result.path + '。证据编号：' + result.evidence_id + (result.warnings?.length ? '。提示：' + result.warnings.join('；') : '')); } catch (error) { el('save-study').disabled = false; message('保存失败：' + error.message + '。请先下载完整JSON保留记录。'); } }
async function saveClip() { if (!clip?.frames.length) return; try { const result = await saveObject('/api/tracking', clip); download(JSON.stringify({ ...clip, exported_at: iso() }, null, 2), 'application/json', `IPP31078_${clip.source_type}_${clip.session_id}_tracking.json`); clipExported = true; message('参数已保存：' + result.path + '；下载的JSON可在此处回放。'); } catch (error) { download(JSON.stringify({ ...clip, exported_at: iso() }, null, 2), 'application/json', `IPP31078_${clip.source_type}_${clip.session_id}_tracking.json`); clipExported = true; message('项目保存失败，已请求下载备份：' + error.message); } }

function toggleVideo() {
  if (evaluation.active) return message('请先结束工程评估，再录制演示。');
  if (recorder?.active) { if (recorder.duration() < 20000) return message('请至少连续录制20秒后停止；随时可点击“取消录像”。'); recorder.stop('user'); return; }
  if (recordedVideo) return message('请先保存或取消上一段录像，再开始新录制。');
  if (!tracker.live() || !calibration || !tracked() || replay || sourceType() !== 'live_camera') return message('请先连接真实摄像头并校准；软件测试与参数回放不能录为真人演示。');
  recordedVideo = null;
  recorder = new DemoRecorder({ avatarCanvas: el('avatar'), video, sourceType: sourceType(), onStatus: message, overlay: () => ({ condition: condition(), tracking: tracked() ? '检测到面部' : '追踪丢失，请回到镜头前', jaw: raw.jawOpen.toFixed(2), blink: ((raw.eyeBlinkLeft + raw.eyeBlinkRight) / 2).toFixed(2), smile: ((raw.mouthSmileLeft + raw.mouthSmileRight) / 2).toFixed(2), rate: fmt(resultRate.value(performance.now())) }), onFinished: result => { recordedVideo = result.stop_reason === 'cancelled' ? null : result; el('video-save').disabled = !recordedVideo || result.duration_ms < 20000; message(recordedVideo ? result.duration_ms >= 20000 ? '录制结束。可保存为media/raw/01_live.mp4，随后人工核对连续画面。' : '本段不足20秒，请重新录制；不会作为01_live.mp4保存。' : '录像已取消。'); updateUI(true); } });
  try { recorder.start(); lastVideoLabel = -1; message('正在连续录制真人演示，至少20秒。可在画面右上角切换A/B。'); updateUI(true); } catch (error) { recorder = null; message(error.message + '。可使用系统录屏，方法见README。'); }
}
async function saveVideo() {
  if (!recordedVideo || recordedVideo.duration_ms < 20000) return;
  el('video-save').disabled = true;
  try {
    const meta = { ...recordedVideo, blob: undefined, model_id: avatar.info.id, model_sha256: avatar.info.sha256, protocol_version: PROTOCOL_VERSION, parameters: PARAMS, calibration, continuous_capture_claim: true };
    const response = await fetch('/api/demo-video', { method: 'POST', headers: { 'Content-Type': recordedVideo.mime_type, 'X-Recording-Metadata': encodeURIComponent(JSON.stringify(meta)) }, body: recordedVideo.blob });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '保存失败');
    recordedVideo = null; recorder = null; updateUI(true); el('video-save').disabled = true;
    message('已保存真人演示：' + result.path + '。请核对至少20秒连续画面，证据编号 ' + result.evidence_id);
  } catch (error) { const extension = recordedVideo.mime_type.startsWith('video/mp4') ? 'mp4' : 'webm'; download(recordedVideo.blob, recordedVideo.mime_type, '01_live.' + extension); el('video-save').disabled = false; message('项目保存失败，已请求下载录像备份：' + error.message + '。若为webm，可按README转换成MP4。'); }
}
async function loadReplay(event) {
  const file = event.target.files?.[0]; if (!file) return;
  if (activeStudy() || recorder?.active || recordedVideo || (study && !exported) || (clip && !clipExported) || !evaluation.saved) { event.target.value = ''; return message('请先结束当前体验、评估或录制。'); }
  try { const record = await readTrackingFile(file); await avatar.setAvatar(record.data.model_info.avatar_key); if (avatar.info.sha256 !== record.data.model_info.sha256) throw new Error('回放模型校验和不一致'); stopCamera('replay_loaded'); replay = new TrackingReplay(record); calibration = copy(record.data.calibration); mode = 'demo'; filter.reset(); resultRate.times = []; applyRate.times = []; lastPhase = ''; updateUI(true); message('参数回放已加载。来源标识会一直显示；回放不能参加正式A/B体验。'); }
  catch (error) { message('回放失败：' + error.message); }
  event.target.value = '';
}
function exitReplay() { replay = null; calibration = null; clearSignal(); el('replay-file').value = ''; updateUI(true); message('已退出回放。请重新连接摄像头并校准。'); }
function updatePhase() {
  const phase = mode === 'demo' ? 'demo' : study?.phase || 'setup';
  if (phase === lastPhase) return;
  lastPhase = phase;
  const mapping = { setup: 'study-setup', ready: 'study-setup', running: 'running-panel', survey: 'survey-panel', rest: 'rest-panel', complete: 'complete-panel', aborted: 'complete-panel', demo: 'demo-panel' };
  for (const id of ['study-setup', 'running-panel', 'survey-panel', 'rest-panel', 'complete-panel', 'demo-panel']) el(id).hidden = id !== mapping[phase];
  document.body.classList.toggle('study-active', mode === 'study' && ['running', 'survey', 'rest'].includes(phase));
  if (phase === 'survey') { el('rating-form').reset(); el('survey-title').textContent = `体验 ${study.block.condition} 后的感受`; message('请只评价刚才的条件，按真实感受填写。'); }
  if (['complete', 'aborted'].includes(phase)) { el('save-study').disabled = false; el('completion-title').textContent = phase === 'complete' ? '两条件体验已完成' : '本次体验已结束'; el('completion-detail').textContent = phase === 'complete' ? '请保存原始记录。分析将逐题报告，不合成为具身感总分。' : '本次记录不完整，仍可保存故障过程；不完整配对不会纳入正式描述统计。'; }
}
function updateUI(force = false) {
  const now = performance.now(); if (!force && now - lastUI < 100) return; lastUI = now;
  updatePhase();
  const hasFace = tracked(), live = tracker.live(), locked = Boolean(activeStudy());
  el('avatar-select').disabled = !ready || loading || locked || Boolean(replay) || Boolean(calibrating) || evaluation.active || !evaluation.saved || Boolean(recorder?.active) || Boolean(recordedVideo) || clip?.status === 'recording' || Boolean(clip && !clipExported) || Boolean(study && !exported);
  if (avatar) { el('avatar-label').textContent = avatar.info.label; el('avatar-select').value = avatar.info.avatar_key; }
  el('camera-start').disabled = !ready || loading || live || Boolean(replay); el('camera-stop').disabled = !loading && !live;
  el('setup-fields').disabled = locked; el('consent').disabled = locked;
  const canCalibrate = live && hasFace && !locked && !calibrating && !recorder?.active && clip?.status !== 'recording' && !evaluation.active;
  el('calibrate').disabled = !canCalibrate; el('demo-calibrate').disabled = !canCalibrate;
  el('study-start').disabled = !calibration || !hasFace || !el('consent').checked || Boolean(replay) || !validParticipantId(el('participant-id').value.trim()) || evaluation.active || clip?.status === 'recording' || Boolean(recorder?.active);
  el('mode-study').classList.toggle('selected', mode === 'study'); el('mode-demo').classList.toggle('selected', mode === 'demo');
  el('mode-study').disabled = Boolean(replay); el('demo-switches').hidden = mode !== 'demo'; el('parameter-overlay').hidden = mode !== 'demo';
  el('source-badge').textContent = sourceLabel();
  el('source-warning').hidden = !testSource && !replay;
  el('source-warning').textContent = replay ? `参数回放 recorded_tracking · 原始来源 ${replay.record.origin} · 不是真人实时摄像头，不用于正式体验。` : '软件测试 synthetic_test：所有记录排除出研究统计；画面与评分不能作为真人验证。';
  el('camera-caption').textContent = replay ? '参数回放 · 不包含真人视频' : '真人摄像头 · 镜像预览';
  el('camera-placeholder').hidden = live;
  if (replay) el('camera-placeholder').innerHTML = '参数回放<small><br>不含摄像头视频</small>'; else el('camera-placeholder').innerHTML = '摄像头小窗<small><br>开启后仅在本机处理</small>';
  el('tracking-status').textContent = replay ? replay.playing ? hasFace ? '回放检测：有面部' : '回放检测：丢失' : '回放已暂停' : live ? hasFace ? '面部追踪正常' : '未检测到面部' : loading ? '正在启动…' : '摄像头未开启';
  el('render-rate').textContent = `画面 ${fmt(renderRate.value(now))} fps`; el('tracking-rate').textContent = `${replay ? '回放' : '结果'} ${fmt(resultRate.value(now))} Hz`;
  if (calibrating) { const elapsed = calibrating.start === null ? 0 : now - calibrating.start; el('calibration-status').textContent = `保持中性：${Math.min(3, elapsed / 1000).toFixed(1)} / 3.0秒，${calibrating.samples.length}个有效样本`; el('task-title').textContent = '保持自然中性表情'; el('task-description').textContent = hasFace ? '合嘴、睁眼、放松面部；丢失追踪将重新计时' : '请回到镜头前，校准计时已重新开始'; el('task-index').textContent = '中性校准'; }
  else el('calibration-status').textContent = calibration ? `中性校准完成 · ${calibration.sample_count}个样本 · 两条件共用` : '正对镜头，合嘴、睁眼并放松面部。';
  if (study?.phase === 'running' && mode === 'study') {
    const task = taskAt(study.activeMs);
    if (task) { el('task-title').textContent = task.text; el('task-description').textContent = task.detail; el('task-index').textContent = `体验 ${study.block.condition} · 任务 ${task.index + 1}/4 · 本任务剩余${Math.ceil(task.remaining_ms / 1000)}秒`; }
    el('task-progress').value = study.activeMs; el('phase-label').textContent = `体验 ${study.block.condition} · 有效 ${Math.floor(study.activeMs / 1000)} / 90秒`; el('condition-title').textContent = `体验 ${study.block.condition}`;
    el('pause-reason').textContent = !viewportMatches() ? `窗口尺寸改变，已暂停；请恢复为 ${study.session.viewport.width}×${study.session.viewport.height}` : study.paused ? '已暂停，点击继续恢复任务' : document.hidden ? '页面不在前台，有效计时暂停' : hasFace ? '正在记录本条件' : '追踪丢失，计时已暂停；正对镜头后自动恢复'; el('study-pause').textContent = study.paused ? '继续' : '暂停';
  } else if (study?.phase === 'rest' && mode === 'study') {
    const left = Math.max(0, Math.ceil((study.restUntil - now) / 1000)); el('next-condition').disabled = left > 0 || !hasFace || !viewportMatches(); el('next-condition').textContent = left ? `请再休息 ${left} 秒` : !viewportMatches() ? '请先恢复原窗口尺寸' : '开始下一条件'; el('task-title').textContent = '放松面部，稍作休息'; el('task-description').textContent = '保持相同光照、距离和窗口大小'; el('task-index').textContent = '条件间休息'; el('phase-label').textContent = '等待下一条件';
  } else if (study?.phase === 'survey' && mode === 'study') { el('task-title').textContent = '记录刚才的体验'; el('task-description').textContent = '请按真实感受作答，没有正确或理想答案'; el('task-index').textContent = `体验 ${study.block.condition} 结束`; el('phase-label').textContent = '本条件自评'; }
  else if (!calibrating && mode === 'demo') {
    el('task-index').textContent = `实时预览 · ${demoCondition}`;
    if (replay) {
      el('task-title').textContent = '参数回放';
      el('task-description').textContent = '回放不含本人实时画面；退出回放后可连接摄像头。';
    } else if (loading) {
      el('task-title').textContent = '正在连接摄像头';
      el('task-description').textContent = '请允许相机权限，等待本地面部模型加载完成。';
    } else if (!live) {
      el('task-title').textContent = '先开启摄像头';
      el('task-description').textContent = '勾选右侧知情说明，再点“启动摄像头”，左下角会显示本人画面。';
    } else if (!hasFace) {
      el('task-title').textContent = '未检测到面部';
      el('task-description').textContent = '请面向镜头，让整张脸进入左下角小窗，并保持光线充足。';
    } else if (demoCondition === 'A') {
      el('task-title').textContent = 'A：表情保持中性';
      el('task-description').textContent = '点击右上角“B · 实时跟随”，即可查看表情响应。';
    } else {
      el('task-title').textContent = 'B：实时表情跟随';
      el('task-description').textContent = calibration ? '试着微笑、嘴角下压、抬眉睁眼、皱眉、噘嘴，再缓慢转头。' : '先完成右侧3秒中性校准，再尝试表情和转头。';
    }
    el('phase-label').textContent = replay ? '回放展示 · 不用于正式体验' : '实时预览 · 本人小窗可见 · 非正式任务';
    if (!study) el('task-progress').value = 0;
  } else if (!calibrating) { el('task-title').textContent = study ? '本次体验已结束' : calibration ? '准备好后开始体验' : '从自然的中性表情开始'; el('task-description').textContent = '两条件各90秒，任务与设置完全相同'; el('task-index').textContent = study ? '等待保存记录' : '准备体验'; el('phase-label').textContent = study ? '体验结束' : '尚未开始'; if (!study) el('task-progress').value = 0; }
  const numbers = { jaw: raw.jawOpen, blink: actionStrength(raw,'blink'), smile: actionStrength(raw,'smile'), sad: actionStrength(raw,'sad'), surprise: actionStrength(raw,'surprise'), angry: actionStrength(raw,'angry'), pucker: raw.mouthPucker };
  for (const [key, value] of Object.entries(numbers)) { el(key + '-meter').value = hasFace ? value : 0; el(key + '-value').textContent = hasFace ? value.toFixed(2) : '—'; }
  el('head-pose').textContent = !calibration ? '校准后启用转头' : !hasFace || !validPose(rawPose) || !validPose(calibration.head_baseline) ? '头部姿态暂不可用' : `左右 ${(appliedPose.yaw * 180 / Math.PI).toFixed(0)}° · 上下 ${(appliedPose.pitch * 180 / Math.PI).toFixed(0)}° · 侧倾 ${(appliedPose.roll * 180 / Math.PI).toFixed(0)}°`;
  el('tracking-record').disabled = !live || !calibration || Boolean(replay) || evaluation.active; el('tracking-record').textContent = clip?.status === 'recording' ? `停止参数录制（${clip.frames.length}条）` : '录制参数'; el('tracking-save').disabled = !clip?.frames.length || clip.status === 'recording';
  el('video-record').disabled = !recorder?.active && (!live || !calibration || !hasFace || Boolean(replay) || sourceType() !== 'live_camera' || evaluation.active);
  if (recorder?.active) { const seconds = Math.floor(recorder.duration() / 1000); if (seconds !== lastVideoLabel) { lastVideoLabel = seconds; el('video-record').textContent = seconds < 20 ? `录制中 ${seconds}秒 · 至少20秒` : `停止录像 · 已录${seconds}秒`; } } else el('video-record').textContent = '开始真人演示录像';
  el('video-discard').disabled = !recorder?.active && !recordedVideo; el('replay-controls').hidden = !replay; el('replay-file').disabled = locked || Boolean(recorder?.active) || clip?.status === 'recording' || evaluation.active;
  if (replay) { el('replay-info').textContent = `${replay.record.origin} → recorded_tracking · ${(replay.position / 1000).toFixed(1)} / ${(replay.durationMs / 1000).toFixed(1)}秒`; el('replay-toggle').textContent = replay.playing ? '暂停回放' : '播放回放'; el('replay-progress').value = replay.durationMs ? replay.position / replay.durationMs : 0; }
  evaluation.updateUI(now, mode === 'demo' && live && hasFace && Boolean(calibration) && !recorder?.active && clip?.status !== 'recording' && !replay);
}
function loop(timestamp) {
  try {
    if (ready && !document.hidden) {
      const sample = replay ? replay.sample(performance.now()) : tracker.sample(performance.now());
      if (sample) acceptSample(sample);
      else if (detected && performance.now() - lastResultAt > PARAMS.tracking_stale_ms) acceptSample({ detected: false, raw: null, inference_ms: null, monotonic_ms: performance.now(), sample_kind: 'tracking_timeout' });
    }
    const now = performance.now();
    if (cameraWasLive && !tracker.live() && !loading) { log('camera_connection_lost'); stopCamera('camera_connection_lost'); message('摄像头连接已中断，请保存当前过程；重新连接后需再次校准。'); }
    if (study?.phase === 'running') { const previous = study.phase; study.tick(now, iso(), { tracked: tracked(), visible: !document.hidden }); const task = taskAt(study.activeMs); if (task && task.id !== lastTask) { lastTask = task.id; study.event('task_started', now, iso(), { task: task.id }); } if (study.phase !== previous) updateUI(true); }
    if (avatar && !document.hidden) {
      avatar.render(); renderRate.mark(now); lastRenderAt = now; evaluation.render();
      if (pendingFrame) {
        const submitted = performance.now(); pendingFrame.render_submitted_at_ms = submitted;
        const delta = start => Number.isFinite(start) && start >= 0 && submitted >= start ? submitted - start : null;
        pendingFrame.frame_to_render_submit_ms = delta(pendingFrame.frame_capture_at_ms);
        pendingFrame.video_present_to_render_submit_ms = delta(pendingFrame.video_presentation_at_ms);
        evaluation.frame(pendingFrame); pendingFrame = null;
      }
    }
    updateUI();
  } catch (error) { log('runtime_error', { message: error.message }); stopCamera('runtime_error'); replay?.pause(performance.now()); message('运行错误：' + error.message + '。已保留会话过程，请保存后重试。'); }
  requestAnimationFrame(loop);
}

for (const question of QUESTIONS) { const fieldset = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = question.text; fieldset.append(legend); const row = document.createElement('div'); row.className = 'likert'; for (let score = 1; score <= 7; score++) { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'radio'; input.name = question.id; input.value = String(score); input.required = true; label.append(input, document.createTextNode(String(score))); row.append(label); } fieldset.append(row); el('questions').append(fieldset); }
el('camera-start').addEventListener('click', startCamera);
el('camera-stop').addEventListener('click', () => { stopCamera('user_camera_stop'); message('摄像头已停止，已有会话可保存。'); });
el('consent').addEventListener('change', () => { if (!el('consent').checked && (tracker.live() || loading)) { stopCamera('consent_withdrawn'); message('已撤回体验选择，摄像头与记录已停止。'); } updateUI(true); });
el('participant-id').addEventListener('input', () => { el('condition-order').value = suggestedOrder(el('participant-id').value.trim()).join(''); updateUI(true); });
el('mode-study').addEventListener('click', () => switchMode('study')); el('mode-demo').addEventListener('click', () => switchMode('demo'));
el('avatar-select').addEventListener('change', switchAvatar);
el('calibrate').addEventListener('click', beginCalibration); el('demo-calibrate').addEventListener('click', beginCalibration); el('study-start').addEventListener('click', startStudy);
el('study-pause').addEventListener('click', () => { if (!study || study.phase !== 'running') return; if (study.paused && !viewportMatches()) return message(`请先恢复为 ${study.session.viewport.width}×${study.session.viewport.height} 的窗口，再继续体验。`); study.paused = !study.paused; log(study.paused ? 'manual_pause' : 'manual_resume'); updateUI(true); });
el('study-abort').addEventListener('click', () => { study?.abort('user_ended', performance.now(), iso()); stopCamera('user_ended'); message('本次体验已结束，仍可保存不完整记录。'); });
el('rating-form').addEventListener('submit', submitRating); el('next-condition').addEventListener('click', nextCondition); el('save-study').addEventListener('click', saveStudy);
el('download-json').addEventListener('click', () => { if (!study) return; download(JSON.stringify({ ...study.session, exported_at: iso() }, null, 2), 'application/json', `IPP31078_${study.session.source_type}_${study.session.participant_id}_${study.session.session_id}.json`); exported = true; });
el('download-frames').addEventListener('click', () => study && download(csv(study.session.frames, FRAME_COLUMNS), 'text/csv;charset=utf-8', `IPP31078_${study.session.source_type}_${study.session.participant_id}_frames.csv`));
el('download-ratings').addEventListener('click', () => study && download(csv(study.session.ratings, RATING_COLUMNS), 'text/csv;charset=utf-8', `IPP31078_${study.session.source_type}_${study.session.participant_id}_ratings.csv`));
el('new-participant').addEventListener('click', () => { if (!exported) return message('请先保存记录或下载完整JSON。'); const match = /^P(\d+)$/i.exec(el('participant-id').value); if (match) el('participant-id').value = 'P' + String(Number(match[1]) + 1).padStart(2, '0'); el('condition-order').value = suggestedOrder(el('participant-id').value).join(''); study = null; calibration = null; calibrating = null; el('consent').disabled = false; el('consent').checked = false; lastPhase = ''; updateUI(true); message('新会话需重新同意、连接和中性校准。匿名编号只是记录字段，不代表已完成参与。'); });
document.querySelectorAll('[data-demo-condition]').forEach(button => button.addEventListener('click', () => { demoCondition = button.dataset.demoCondition; document.querySelectorAll('[data-demo-condition]').forEach(b => b.classList.toggle('selected', b === button)); renderExpression(); log('demo_condition_changed', { condition: demoCondition }); updateUI(true); }));
el('tracking-record').addEventListener('click', toggleClip); el('tracking-save').addEventListener('click', saveClip); el('video-record').addEventListener('click', toggleVideo); el('video-save').addEventListener('click', saveVideo);
for (const [key, spec] of Object.entries(ACTIONS)) { const option = document.createElement('option'); option.value = key; option.textContent = spec.label; el('evaluation-action').append(option); }
function prepareTrialInputs(action) {
  el('trial-observed').replaceChildren(); const unknown = document.createElement('option'); unknown.value = ''; unknown.textContent = '未核对，不计成功率'; el('trial-observed').append(unknown);
  for (let i = 0; i <= ACTIONS[action].repetitions; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = `${i} 次`; el('trial-observed').append(option); }
  el('trial-notes').value = '';
}
el('evaluation-start').addEventListener('click', () => {
  try { evaluation.start(performance.now(), iso(), tracker.quality()); el('evaluation-action').value = 'neutral'; prepareTrialInputs('neutral'); evaluation.beginTrial('neutral', performance.now(), iso()); updateUI(true); message('开始工程评估：先保持中性至少10秒，随后完成本项并逐项检查动作。'); }
  catch (error) { message(error.message); }
});
el('trial-start').addEventListener('click', () => { try { const action = el('evaluation-action').value; prepareTrialInputs(action); evaluation.beginTrial(action, performance.now(), iso()); updateUI(true); } catch (error) { message(error.message); } });
el('trial-finish').addEventListener('click', () => {
  try {
    if (evaluation.trial?.action === 'neutral' && evaluation.visibleDuration(performance.now()) - evaluation.trial.visible_start_ms < 10000) return message('中性保持需至少10秒前台可见采样。');
    const count = el('trial-observed').value; evaluation.finishTrial(performance.now(), iso(), count === '' ? null : Number(count), el('trial-notes').value.trim());
    const completed = new Set(evaluation.record.trials.filter(trial => trial.status === 'completed').map(trial => trial.action));
    const next = Object.keys(ACTIONS).find(action => !completed.has(action)); if (next) el('evaluation-action').value = next;
    updateUI(true); message('本项已记录。选择下一动作并点击“开始本项”，也可结束并保存本次评估。');
  } catch (error) { message(error.message); }
});
el('evaluation-stop').addEventListener('click', () => { evaluation.stop(performance.now(), iso(), tracker.quality()); updateUI(true); message('工程评估已结束，请保存。未观察的成功次数保持未核对。'); });
el('evaluation-save').addEventListener('click', async () => {
  try { const record = evaluation.export(iso()); const result = await saveObject('/api/evaluations', record); evaluation.saved = true; updateUI(true); message('评估已保存：' + result.path + '。运行“评估分析.command”生成图中各项指标报告。'); }
  catch (error) { message('评估保存失败：' + error.message); }
});
el('video-discard').addEventListener('click', () => { if (recorder?.active) recorder.stop('cancelled'); recordedVideo = null; el('video-save').disabled = true; message('录像已取消，尚未保存的录像已清除。'); updateUI(true); });
el('replay-file').addEventListener('change', loadReplay); el('replay-exit').addEventListener('click', exitReplay); el('replay-toggle').addEventListener('click', () => { if (!replay) return; if (replay.playing) { replay.pause(performance.now()); clearSignal(); } else { filter.reset(); replay.play(performance.now()); } updateUI(true); });
el('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await el('stage').requestFullscreen(); } catch (error) { message('全屏不可用：' + error.message); } });
document.addEventListener('visibilitychange', () => { log(document.hidden ? 'page_hidden' : 'page_visible'); evaluation.visibility(!document.hidden, performance.now(), iso()); if (document.hidden) { if (recorder?.active) recorder.stop('page_hidden'); replay?.pause(performance.now()); clearSignal(); if (calibrating) { calibrating.samples = []; calibrating.poses = []; calibrating.start = null; } } if (study) study.lastTick = performance.now(); });
window.addEventListener('resize', () => { if (activeStudy()) { const deviation = { type: 'viewport_changed', at: iso(), width: innerWidth, height: innerHeight }; study.session.protocol_deviations.push(deviation); log('viewport_changed', deviation); if (!viewportMatches()) study.paused = true; updateUI(true); } });
window.addEventListener('beforeunload', event => { if ((study && !exported) || (clip && !clipExported) || recorder?.active || recordedVideo || !evaluation.saved) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { tracker.stop(); recorder?.stop('page_closed'); });

try { const protocolResponse = await fetch('/api/protocol'); if (!protocolResponse.ok) throw new Error('请使用启动原型.command启动本机服务'); const serverProtocol = await protocolResponse.json(); if (serverProtocol.protocol_version !== PROTOCOL_VERSION || JSON.stringify(serverProtocol.parameters) !== JSON.stringify(PARAMS)) throw new Error('页面与本机服务版本不一致，请停止旧服务后重新启动'); avatar = await createAvatar(el('avatar'), text => { el('load-state').textContent = text; }); ready = true; avatar.apply(neutral()); avatar.render(); el('load-progress').value = 1; message('本地化身已就绪。请阅读说明、连接摄像头并完成中性校准。真实摄像头待人工验收。'); }
catch (error) { message('化身加载失败：' + error.message + '。请重新运行安装与构建检查。'); el('load-state').textContent = '化身加载失败'; }
updateUI(true); requestAnimationFrame(loop);
