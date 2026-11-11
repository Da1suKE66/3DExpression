import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PARAMS, TASKS, QUESTIONS, COEFFICIENTS, neutral, mapExpression, correctExpression, retargetExpression, makeCalibration, ExpressionFilter, RateMeter, taskAt, makeSession, StudyController, suggestedOrder, csv } from '../app/core.js';
import { readTrackingFile, TrackingReplay } from '../app/replay.js';

const model = JSON.parse(fs.readFileSync(new URL('../app/model_manifest.json',import.meta.url),'utf8'));
const baseline = () => makeCalibration(Array.from({length:40},()=>Object.fromEntries(COEFFICIENTS.map(key=>[key,0.02]))),{source_type:'synthetic_test',avatar_key:model.key,model_sha256:model.sha256});
const make = order => makeSession({ id:'00000000-0000-4000-8000-000000000001',participantId:'TEST01',order:order||['A_prerecorded','B_realtime','C_delayed'],kind:'internal',consent:true,sourceType:'synthetic_test',calibration:baseline(),stimulusConfirmed:true,prerecorded:{source_type:'live_camera',sha256:'a'.repeat(64),donor_id:'STIMULUS01',avatar_key:model.key,model_sha256:model.sha256,duration_ms:120000,offset_ms:1000,window_ms:60000},now:'2026-11-07T01:00:00+08:00',modelInfo:{id:model.id,avatar_key:model.key,sha256:model.sha256} });
const at = '2026-11-07T01:00:00+08:00';

test('legacy demo A remains neutral while demo B follows all seventeen expression signals',()=>{
 const raw=Object.fromEntries(COEFFICIENTS.map((key,index)=>[key,(index+1)/(COEFFICIENTS.length+1)]));
 assert.ok(Object.values(mapExpression(raw,'A')).every(value=>value===0));assert.deepEqual(mapExpression(raw,'B'),raw);assert.throws(()=>mapExpression(raw,'third'));
});
test('calibration uses robust medians and rejects insufficient or non-neutral capture',()=>{
 const samples=Array.from({length:40},()=>Object.fromEntries(COEFFICIENTS.map(key=>[key,0.03])));samples[0].eyeBlinkLeft=0.9;
 assert.equal(makeCalibration(samples).baseline.eyeBlinkLeft,0.03);assert.throws(()=>makeCalibration(samples.slice(0,10)));
 assert.throws(()=>makeCalibration(samples.map(row=>({...row,jawOpen:0.8}))));
});
test('neutral subtraction and deadzone preserve zero and independent smile sides',()=>{
 const b=neutral();b.jawOpen=0.1;const raw={...neutral(),jawOpen:0.1,mouthSmileLeft:0.5};
 const corrected=correctExpression(raw,b);assert.equal(corrected.jawOpen,0);assert.ok(corrected.mouthSmileLeft>0.45);assert.equal(corrected.mouthSmileRight,0);
 assert.equal(correctExpression({...neutral(),jawOpen:1},b).jawOpen,1);
});
test('time-based smoothing is stable across update frequencies and resets after loss',()=>{
 const a=new ExpressionFilter(),b=new ExpressionFilter(),target={...neutral(),jawOpen:1};
 a.update(target,0);b.update(target,0);const two=a.update(target,80);b.update(target,40);const three=b.update(target,80);
 assert.ok(Math.abs(two.jawOpen-three.jawOpen)<1e-10);assert.ok(two.jawOpen<1);a.reset();assert.equal(a.value.jawOpen,0);
});
test('reported update rate uses observed timestamps and becomes unavailable after a gap',()=>{
 const meter=new RateMeter();assert.equal(meter.value(0),null);for(let t=0;t<=1000;t+=50)meter.mark(t);
 assert.equal(meter.value(1000),20);assert.equal(meter.value(4000),null);
});
test('60 second plan has adaptation, basic actions, free expression and observation',()=>{
 assert.equal(TASKS.reduce((sum,task)=>sum+task.duration_ms,0),60000);assert.equal(taskAt(0).id,'adapt');assert.equal(taskAt(10000).id,'basic');assert.equal(taskAt(30000).id,'free');assert.equal(taskAt(50000).id,'observe');assert.equal(taskAt(60000),null);assert.equal(QUESTIONS.length,6);
});
test('anonymous ID, consent and calibration are required before creating a study',()=>{
 const s=make();assert.equal(s.source_type,'synthetic_test');assert.equal(s.ratings.length,0);
 assert.throws(()=>makeSession({...s,id:s.session_id,participantId:'x',order:['A','B'],kind:'internal',consent:true,calibration:baseline(),now:at}));
 assert.throws(()=>makeSession({id:'x',participantId:'TEST',order:['A','B'],kind:'internal',consent:false,calibration:baseline(),now:at}));
 assert.deepEqual(suggestedOrder('P02'),['A','C','B']);assert.deepEqual(suggestedOrder('P01'),['A','B','C']);
});
test('lost face, hidden page and manual pause never add effective task time',()=>{
 const c=new StudyController(make());c.begin(0,at);c.tick(50,at,{tracked:true,visible:true});assert.equal(c.activeMs,50);
 c.tick(100,at,{tracked:false,visible:true});c.tick(150,at,{tracked:true,visible:false});c.paused=true;c.tick(200,at,{tracked:true,visible:true});assert.equal(c.activeMs,50);
 c.paused=false;c.tick(250,at,{tracked:true,visible:true});assert.equal(c.activeMs,100);
});
test('three 60 second blocks require three ratings and a final anonymous preference',()=>{
 const c=new StudyController(make());let time=0;const scores=Object.fromEntries(QUESTIONS.map(q=>[q.id,4]));
 for(let index=0;index<3;index++){
  c.begin(time,at);assert.equal(c.block.condition_position,index+1);
  while(c.phase==='running'){time+=50;c.tick(time,at,{tracked:true,visible:true});}
  assert.equal(c.block.active_ms,60000);assert.throws(()=>c.rate({control:8},'',time,at));
  c.rate(scores,'synthetic unit fixture',time,at);
  if(index<2){assert.throws(()=>c.begin(time,at));time+=15000;}
 }
 assert.equal(c.phase,'preference');assert.throws(()=>c.prefer('invalid',time,at));c.prefer('no_preference',time,at);
 assert.equal(c.phase,'complete');assert.equal(c.session.ratings.length,3);assert.equal(c.session.preference.selected_condition,'no_preference');
});

test('aborting retains partial time without fabricating completion or scores',()=>{
 const c=new StudyController(make());c.begin(0,at);c.tick(50,at,{tracked:true,visible:true});c.abort('test_abort',80,at);
 assert.equal(c.session.status,'aborted');assert.equal(c.session.conditions[0].active_ms,50);assert.equal(c.session.ratings.length,0);
});
test('CSV neutralizes text formulas and preserves negative numeric differences',()=>{
 const text=csv([{feedback:'=TEST()',difference:-4,chinese:'真实,"\n文字'}],['feedback','difference','chinese']);
 assert.ok(text.includes("'="));assert.ok(text.includes('"-4"'));assert.ok(!text.includes("'-4"));assert.ok(text.startsWith('\uFEFF'));
});
test('replay keeps synthetic origin, checks parameter equality independent of key order',async()=>{
 const s=make();s.frames=[0,100].map((time,index)=>({monotonic_ms:time,detected:1,captured_at:at,inference_ms:1,...Object.fromEntries(COEFFICIENTS.map(key=>['raw_'+key,index/2]))}));
 s.parameters=Object.fromEntries(Object.entries(s.parameters).reverse());const file=new File([JSON.stringify(s)],'synthetic.json');const record=await readTrackingFile(file);assert.equal(record.origin,'synthetic_test');
 const replay=new TrackingReplay(record);replay.play(0);assert.equal(replay.sample(0).sample_kind,'replay_frame');assert.equal(replay.sample(100).raw.jawOpen,0.5);
 s.parameters.gain.jawOpen=2;await assert.rejects(()=>readTrackingFile(new File([JSON.stringify(s)],'changed.json')));
});


test('calibrated blink closes fully without waiting for raw coefficient one and stays independent',()=>{
 const target=retargetExpression({...neutral(),eyeBlinkLeft:0.55,eyeBlinkRight:0.06,eyeWideLeft:1,eyeWideRight:0.7});
 assert.equal(target.eyeBlinkLeft,1);assert.equal(target.eyeBlinkRight,0);assert.equal(target.eyeWideLeft,0);assert.equal(target.eyeWideRight,0.7);
 const filtered=new ExpressionFilter();filtered.update({...target,jawOpen:1},0);const next=filtered.update({...target,jawOpen:1},40);
 assert.ok(next.eyeBlinkLeft>=PARAMS.blink_mapping.hide_eyeball_threshold);assert.ok(next.jawOpen<next.eyeBlinkLeft);
 filtered.update(neutral(),80);assert.ok(filtered.value.eyeBlinkLeft<0.4);
});

test('replay rejects calibration belonging to another character',async()=>{
 const s=make();s.frames=[{monotonic_ms:0,detected:0}];s.calibration.avatar_key='pikachu';
 await assert.rejects(()=>readTrackingFile(new File([JSON.stringify(s)],'wrong-character.json')),/角色与校准/);
});
