// The actual main.js runs against in-memory DOM/camera/render stubs, never a real camera.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../app/core.js';
import * as expressions from '../app/expressions.js';
import * as replay from '../app/replay.js';
import * as prerecorded from '../app/prerecorded.js';
import { ExpressionDelayBuffer } from '../app/delay.js';
import { EngineeringEvaluation } from '../app/evaluation.js';

test('actual page handlers execute all six orders, require three six-item surveys and preference, pause, delay, save and export', async () => {
  for (const {order,delay} of [...core.ORDER_CODES.map(order=>({order,delay:400})),{order:'CAB',delay:200}]) {
    class Element {
      constructor() { this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.children = []; this.dataset = {}; this.listeners = {}; this.classList = { toggle() {} }; }
      addEventListener(name, fn) { this.listeners[name] = fn; }
      append(...children) { this.children.push(...children); }
      replaceChildren(...children) { this.children = children; }
      reset() { this.value = ''; }
      click() { if (this.href) downloads.push(blobs.get(this.href)); }
    }
    const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
    const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], new Element()]));
    const demo = ['A', 'B'].map(c => { const e = new Element(); e.dataset.demoCondition = c; return e; });
    const document = { getElementById: id => { assert.ok(elements[id], 'unknown element ' + id); return elements[id]; }, createElement: () => new Element(), createTextNode: value => value, querySelectorAll: () => demo, addEventListener() {}, hidden: false, body: new Element() };
    const clock = { now: 0 }, pending = [], blobs = new Map(), downloads = [], posts = [];
    let live = false, scores = {}, avatarCount = 0, anomalous = false;
    const model = JSON.parse(fs.readFileSync(new URL('../app/model_manifest.json', import.meta.url)));
    const catalog = JSON.parse(fs.readFileSync(new URL('../app/avatar_catalog.json', import.meta.url)));
    const info = { id: model.id, avatar_key: model.key, sha256: model.sha256, catalog_id: catalog.id, animation_playback_enabled: false, label: 'UNIT TEST AVATAR' };
    const raw = () => Object.fromEntries(core.COEFFICIENTS.map(k => [k, clock.now < 4000 ? 0.02 : 0.45 + 0.4 * Math.sin(clock.now / 550)]));
    class CameraTracker {
      async start() { live = true; return true; } stop() { live = false; } live() { return live; }
      inputFps() { return 25; } settings() { return {}; } quality() { return {}; }
      sample(now) { const timestamp=anomalous ? now-100000 : now;anomalous=false; return live ? { monotonic_ms: timestamp, detected: true, raw: raw(), pose: expressions.zeroPose(), inference_ms: 2, processing_start_ms: now-2, sample_kind: 'result' } : null; }
    }
    const deps = { ...core, ...expressions, ...replay, ...prerecorded, ExpressionDelayBuffer, EngineeringEvaluation: class extends EngineeringEvaluation { updateUI() {} }, CameraTracker, DemoRecorder: class {}, createAvatar: async () => { avatarCount++; return { info, apply() {}, applyPose() {}, render() {}, async setAvatar() {} }; }, document, window: { addEventListener() {} }, navigator: { userAgent: 'SYNTHETIC DOM HARNESS' }, location: { search: '?source=synthetic_test' }, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, performance: { now: () => clock.now }, crypto, URLSearchParams, FormData: class { get(key) { return scores[key] ?? null; } }, URL: { createObjectURL(blob) { const id = String(blobs.size); blobs.set(id, blob); return id; }, revokeObjectURL() {} }, setTimeout() {}, requestAnimationFrame(fn) { pending.push(fn); }, fetch: async (url, opts) => {
      if (url === '/api/protocol') return { ok: true, json: async () => JSON.parse(fs.readFileSync(new URL('../app/protocol.json', import.meta.url))) };
      posts.push({ url, data: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ path: 'SYNTHETIC_TEMP_ONLY.json', evidence_id: 'SYNTHETIC-UNIT' }) };
    } };
    elements['participant-id'].value = 'TEST01'; elements['record-kind'].value = 'internal'; elements['condition-order'].value = order; elements['added-delay-ms'].value = String(delay); elements['recording-id'].value = 'STIMULUS_TEST';
    const source = fs.readFileSync(new URL('../app/main.js', import.meta.url), 'utf8').replace(/^import .+;\r?\n/gm, '');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const app = await new AsyncFunction(...Object.keys(deps), source + '\nreturn { session: () => study?.session, phase: () => study?.phase };')(...Object.values(deps));
    const fire = async (id, event = 'click') => { const e = elements[id]; await e.listeners[event]({ target: e, preventDefault() {} }); };
    const step = (ms = 40) => { clock.now += ms; pending.shift()(clock.now); };
    assert.equal(elements.questions.children.length, 6); assert.equal(elements['study-start'].disabled, true);
    const record = { record_type: 'tracking_recording', status: 'complete', consent: true, source_type: 'live_camera', app_version: core.APP_VERSION, schema_version: core.SCHEMA_VERSION, protocol_version: core.PROTOCOL_VERSION, parameters: core.PARAMS, participant_id: 'STIMULUS_TEST', session_id: crypto.randomUUID(), model_info: info, calibration: { status: 'complete', source_type: 'live_camera', sample_count: 40, avatar_key: model.key, model_sha256: model.sha256 }, frames: Array.from({ length: 3001 }, (_, i) => ({ monotonic_ms: i * 40, detected: 1, source_type: 'live_camera', condition: 'B', sample_kind: 'result', ...Object.fromEntries(core.COEFFICIENTS.flatMap(k => [['raw_' + k, (Math.sin(i / 31) + 1) / 2], ['applied_' + k, (Math.sin(i / 31) + 1) / 2]])) })) };
    elements['stimulus-file'].files = [new File([JSON.stringify(record)], 'SYNTHETIC_IN_MEMORY_NOT_REAL.json')]; await fire('stimulus-file', 'change');
    assert.match(elements['stimulus-info'].textContent, /120.0秒/);
    elements.consent.checked = true; await fire('camera-start'); step(); await fire('calibrate');
    for (let i = 0; i < 80; i++) step();
    elements['stimulus-confirm'].checked = true; await fire('stimulus-confirm', 'change');
    assert.equal(elements['study-start'].disabled, false, elements.message.textContent);
    if(order==='ABC'){elements['added-delay-ms'].value='';await fire('study-start');assert.equal(app.session(),undefined);assert.match(elements.message.textContent,/附加延迟/);elements['added-delay-ms'].value=String(delay);}
    await fire('study-start');
    for (let block = 0; block < 3; block++) {
      assert.equal(app.phase(), 'running');
      for (let i = 0; i < 25; i++) step();
      if(block===0){anomalous=true;step();assert.ok(app.session().events.some(e=>e.type==='tracking_timestamp_anomaly'));await fire('study-pause');step();}
      const before = app.session().conditions[block].active_ms; await fire('study-pause');
      for (let i = 0; i < 25; i++) step();
      assert.equal(app.session().conditions[block].active_ms, before); await fire('study-pause');
      for (let i = 0; app.phase() === 'running' && i < 1700; i++) step();
      assert.equal(app.phase(), 'survey');
      scores = { control: 4 }; await fire('rating-form', 'submit'); assert.equal(app.phase(), 'survey');
      scores = Object.fromEntries(core.QUESTIONS.map(q => [q.id, 4])); await fire('rating-form', 'submit');
      if (block<2) { step(16000); await fire('next-condition'); }
    }
    const preference=[...core.CONDITIONS,'no_preference'][core.ORDER_CODES.indexOf(order)%4];
    assert.equal(app.phase(), 'preference');assert.equal(live,false); elements['preference-choice'].value = preference; await fire('preference-form','submit');
    assert.equal(app.phase(), 'complete'); assert.equal(avatarCount, 1);
    const s = app.session(); assert.deepEqual(s.condition_order, core.studyOrder(order)); assert.equal(s.ratings.length, 3);
    assert.ok(s.frames.some(f => f.condition === 'A_prerecorded' && f.applied_jawOpen > 0.1 && Math.abs(f.applied_jawOpen - f.live_filtered_jawOpen) > 0.1));
    assert.ok(s.frames.filter(f => f.condition === 'B_realtime' && !f.paused).every(f => f.applied_jawOpen === f.live_filtered_jawOpen));
    assert.ok(s.frames.filter(f => f.condition === 'A_prerecorded').every(f => Math.abs(f.prerecorded_position_ms - s.prerecorded_stimulus.offset_ms - f.active_ms) < 1));
    assert.ok(s.expression_matching.A_prerecorded); assert.ok(s.expression_matching.B_realtime);
    await fire('save-study'); assert.equal(posts[0].data.source_type, 'synthetic_test'); assert.ok(posts[0].data.exported_at);
    const delayed=s.frames.filter(f=>f.condition==='C_delayed' && f.feedback_state==='ready' && f.output_rendered);
    assert.ok(delayed.length>0);assert.ok(delayed.every(f=>f.actual_buffer_delay_ms===delay && f.software_latency_ms===delay+2));
    assert.ok(s.frames.some(f=>f.condition==='C_delayed' && f.feedback_state==='warming_up'));
    assert.ok(delayed.every(f=>s.frames.some(src=>src.condition==='C_delayed' && src.input_timestamp_ms===f.feedback_input_timestamp_ms && src.live_filtered_jawOpen===f.applied_jawOpen)));
    assert.ok(s.conditions.every(b=>b.active_ms===60000));
    await fire('download-preference');
    await fire('download-json'); await fire('download-frames'); await fire('download-ratings');
    assert.equal(downloads.length, 4); assert.equal(JSON.parse(await downloads[1].text()).ratings.length, 3);
    const csv = await downloads[3].text(); for (const q of core.QUESTIONS) assert.ok(csv.includes('"' + q.id + '"'));
    assert.ok(csv.includes('A_prerecorded')); assert.ok(csv.includes('B_realtime')); assert.ok(csv.includes(order));
    assert.equal(s.preference.selected_condition,preference);
    if(process.argv[2] && order==='ABC' && delay===400)fs.writeFileSync(process.argv[2],JSON.stringify(posts[0].data));
  }
});
