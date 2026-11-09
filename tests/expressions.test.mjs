import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Euler } from '../app/vendor/three.module.js';
import { EXTENDED_COEFFICIENTS, POSE_LIMITS, poseFromMatrix, relativePose, zeroPose, PoseFilter } from '../app/expressions.js';
import { EngineeringEvaluation } from '../app/evaluation.js';

test('extended coefficients include independently driven sad, surprised and lip movements', () => {
  assert.equal(new Set(EXTENDED_COEFFICIENTS).size, 17);
  for (const key of ['mouthFrownLeft','mouthFrownRight','browInnerUp','eyeWideLeft','browDownRight','mouthPucker','mouthPressLeft']) assert.ok(EXTENDED_COEFFICIENTS.includes(key));
});
test('matrix pose removes scale and mirrors yaw/roll while preserving pitch', () => {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(0.18,0.3,-0.12,'YXZ'));
  matrix.scale({x:2,y:3,z:4});
  const pose = poseFromMatrix(matrix.elements);
  assert.ok(Math.abs(pose.pitch-0.18)<1e-10);
  assert.ok(Math.abs(pose.yaw+0.3)<1e-10);
  assert.ok(Math.abs(pose.roll-0.12)<1e-10);
});
test('invalid, missing and degenerate pose matrices fail to neutral', () => {
  assert.equal(poseFromMatrix(null),null);
  assert.equal(poseFromMatrix(Array(16).fill(0)),null);
  const bad = new Matrix4().elements; bad[0] = NaN;
  assert.equal(poseFromMatrix(bad),null);
  assert.deepEqual(relativePose(null,zeroPose()),zeroPose());
});
test('relative head pose subtracts calibration, wraps angles and limits movement', () => {
  const pose=relativePose({pitch:0.5,yaw:1.1,roll:-0.8},{pitch:0.1,yaw:0.1,roll:0});
  assert.ok(Math.abs(pose.pitch-0.4)<1e-10);
  assert.equal(pose.yaw,POSE_LIMITS.yaw); assert.equal(pose.roll,-POSE_LIMITS.roll);
  assert.ok(Math.abs(relativePose({pitch:0,yaw:3.13,roll:0},{pitch:0,yaw:-3.13,roll:0}).yaw)<0.03);
});
test('head smoothing remains time based and resets after tracking loss', () => {
  const a=new PoseFilter(), b=new PoseFilter(), target={pitch:0.2,yaw:0.3,roll:-0.1};
  a.update(target,0); b.update(target,0); a.update(target,100); b.update(target,50); b.update(target,100);
  assert.ok(Math.abs(a.value.yaw-b.value.yaw)<1e-10);
  a.reset(); assert.deepEqual(a.value,zeroPose());
});
const makeRecord=()=>({session_id:crypto.randomUUID(),source_type:'synthetic_test',participant_id:'TEST_EVAL',started_at:'2026-11-09T12:00:00+08:00',start_monotonic_ms:0,frames:[]});
test('unobserved engineering trials never become successful trials', () => {
  const run=new EngineeringEvaluation(makeRecord);run.start(0,'start',{});run.beginTrial('jaw',100,'start');
  run.finishTrial(5100,'end',null);run.stop(5200,'end',{});
  const trial=run.record.trials[0]; assert.equal(trial.observed_successes,null);assert.equal(trial.observation_method,null);assert.equal(trial.wall_completion_ms,5000);
});
test('engineering counters exclude hidden time and do not invent render events', () => {
  const run=new EngineeringEvaluation(makeRecord);run.start(0,'start',{});run.render();run.visibility(false,100,'hidden');run.render();run.visibility(true,1000,'visible');run.render();run.stop(1100,'end',{});
  assert.equal(run.record.render_count,2);assert.equal(run.record.visible_duration_ms,200);
});
test('invalid observation counts reject and an unfinished trial stays interrupted', () => {
  const run=new EngineeringEvaluation(makeRecord);run.start(0,'start',{});run.beginTrial('sad',10,'start');
  assert.throws(()=>run.finishTrial(100,'end',6));assert.throws(()=>run.finishTrial(100,'end',1.5));
  run.stop(1000,'end',{});assert.equal(run.record.trials[0].status,'interrupted');assert.equal(run.record.trials[0].observed_successes,null);
});


test('neutral trial needs ten visible seconds and evaluation uses one clock anchor',()=>{
 const run=new EngineeringEvaluation(makeRecord);run.start(500,'same-anchor',{});
 assert.equal(run.record.tracking.start_monotonic_ms,500);assert.equal(run.record.tracking.started_at,'same-anchor');
 run.beginTrial('neutral',500,'start');run.visibility(false,1500,'hidden');run.visibility(true,21500,'visible');
 assert.throws(()=>run.finishTrial(22000,'too-early'),/10秒/);run.finishTrial(30500,'complete');
 assert.equal(run.record.trials[0].visible_duration_ms,10000);assert.equal(run.record.trials[0].wall_completion_ms,30000);
});
