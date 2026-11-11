// Fabricated in-memory fixtures only: these are not live recordings or participant data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readPrerecordedFile, PrerecordedPlayback } from '../app/prerecorded.js';
import { PARAMS, COEFFICIENTS, APP_VERSION, PROTOCOL_VERSION, SCHEMA_VERSION, QUESTIONS, neutral, mapExpression, FRAME_COLUMNS, RATING_COLUMNS } from '../app/core.js';
const model = JSON.parse(fs.readFileSync(new URL('../app/model_manifest.json', import.meta.url)));
const info = { avatar_key: model.key, sha256: model.sha256 };
function fixture() {
  return { record_type: 'tracking_recording', status: 'complete', consent: true, source_type: 'live_camera', participant_id: 'STIMULUS_TEST_ONLY', session_id: '00000000-0000-4000-8000-000000000099', protocol_version: PROTOCOL_VERSION, app_version: APP_VERSION, schema_version: SCHEMA_VERSION, parameters: PARAMS, model_info: info, calibration: { status: 'complete', source_type: 'live_camera', sample_count: 40, avatar_key: model.key, model_sha256: model.sha256 }, frames: Array.from({ length: 3001 }, (_, i) => ({ monotonic_ms: i * 40, detected: 1, source_type: 'live_camera', sample_kind: 'result', condition: 'B', ...Object.fromEntries(COEFFICIENTS.flatMap(k => [['raw_' + k, (Math.sin(i / 31) + 1) / 2], ['applied_' + k, (Math.sin(i / 31) + 1) / 2]])) })) };
}
const file = data => new File([JSON.stringify(data)], 'SYNTHETIC_UNIT_FIXTURE_NOT_REAL.json');
test('A samples independent stored motion; B uses live values; static is demo-only', async () => {
  const record = await readPrerecordedFile(file(fixture()), info);
  const playback = new PrerecordedPlayback(record, 0.5);
  const sample = playback.sample(12345);
  assert.equal(sample.position_ms, 42345); assert.equal(playback.metadata().offset_ms, 30000);
  assert.deepEqual(mapExpression(neutral(), 'A_prerecorded', sample.expression), mapExpression({ ...neutral(), jawOpen: 1 }, 'A_prerecorded', sample.expression));
  assert.equal(mapExpression({ ...neutral(), jawOpen: 1 }, 'B_realtime').jawOpen, 1);
  assert.equal(mapExpression({ ...neutral(), jawOpen: 1 }, 'static_neutral').jawOpen, 0);
  assert.throws(() => mapExpression(neutral(), 'A_prerecorded'));
  assert.deepEqual(playback.sample(12345), sample); // Paused time stays at the same source position.
  assert.ok(playback.sample(60000).position_ms <= record.durationMs);
});
test('source loader rejects synthetic/replayed/session/static/short/frozen/gapped/mismatched input', async () => {
  const mutations = [d => d.source_type = 'synthetic_test', d => { d.source_type = 'recorded_tracking'; d.replay_metadata = { original_source_type: 'live_camera' }; }, d => d.record_type = 'study_session', d => d.frames[8].condition = 'A', d => d.frames.splice(1500), d => { for (const f of d.frames) for (const k of COEFFICIENTS) f['applied_' + k] = 0; }, d => d.frames.splice(20, 12), d => d.frames[3].applied_jawOpen = NaN, d => d.frames[3].detected = 0, d => d.calibration.avatar_key = 'wrong'];
  for (const mutate of mutations) { const d = fixture(); mutate(d); await assert.rejects(() => readPrerecordedFile(file(d), info)); }
  await assert.rejects(() => readPrerecordedFile(file(fixture()), { ...info, sha256: '0'.repeat(64) }));
});
test('compatible v3.1 genuine-claim input can be inspected without rewriting the old file', async () => {
  const d = fixture(); d.protocol_version = 'IPP31078-AB90-v3.1'; d.app_version = '0.3.1'; d.schema_version = '3.0.0'; d.parameters = JSON.parse(fs.readFileSync(new URL('../app/protocol-v3_1.json', import.meta.url))).parameters;
  const before = JSON.stringify(d); const record = await readPrerecordedFile(file(d), info);
  assert.equal(JSON.stringify(d), before); assert.equal(record.origin, 'live_camera'); assert.match(record.sha256, /^[a-f0-9]{64}$/);
});
test('six exact questions and exported metadata are present', () => {
  assert.equal(QUESTIONS.length, 6); assert.equal(new Set(QUESTIONS.map(q => q.id)).size, 6);
  assert.equal(QUESTIONS[3].text, '我有一种化身的面部仿佛属于我自己的感觉。');
  for (const column of ['condition', 'block_index', 'captured_at', 'protocol_version', 'condition_order', 'prerecorded_position_ms', 'prerecorded_sha256', 'live_filtered_jawOpen']) assert.ok(FRAME_COLUMNS.includes(column));
  for (const q of QUESTIONS) assert.ok(RATING_COLUMNS.includes(q.id));
});
