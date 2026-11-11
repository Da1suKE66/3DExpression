import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpressionDelayBuffer } from '../app/delay.js';
import { neutral, CONDITIONS, ORDER_CODES, studyOrder } from '../app/core.js';
const input = (at, value) => ({ available_at_ms: at, input_timestamp_ms: at, expression: { ...neutral(), jawOpen: value } });
test('400ms queue returns the original processed values without stopping inference', () => {
  const buffer = new ExpressionDelayBuffer();
  for (let now=0;now<=1000;now+=40) {
    buffer.push(input(now,now/1000)); const output=buffer.sample(now);
    if (now<400) assert.equal(output,null);
    else { assert.equal(output.available_at_ms,now-400); assert.equal(output.expression.jawOpen,(now-400)/1000); }
  }
  assert.equal(buffer.lastTime,1000);
});
test('jittered input applies the latest due sample and records at least the configured delay', () => {
  const buffer=new ExpressionDelayBuffer(400);let tested=0;
  for (const t of [0,41,89,133,184,227,278,321,377,422,470,516,559,605]) {
    buffer.push(input(t,0.3));const selected=buffer.sample(t);
    if(selected){assert.ok(t-selected.available_at_ms>=400);assert.ok(t-selected.available_at_ms<460);tested++;}
  }
  assert.ok(tested>0);
});
test('loss, condition reset, invalid clocks and insufficient input cannot leak previous expressions', () => {
  const b=new ExpressionDelayBuffer(400);b.push(input(0,0.8));b.push(input(400,0.9));assert.ok(b.sample(400));
  b.reset('condition_changed');b.push(input(440,0.1));assert.equal(b.sample(440),null);
  b.push(input(480,0.2));assert.equal(b.push(input(479,0.8)),false);assert.equal(b.sample(480),null);
  b.push(input(500,0.3));assert.equal(b.sample(499),null);
  assert.equal(b.push({...input(510,0.3),input_timestamp_ms:NaN}),false);
  b.push(input(1000,0.5));assert.equal(b.sample(1500),null);
  assert.throws(()=>b.configure(-1));assert.throws(()=>b.configure(2001));b.configure(0);b.push(input(1600,0.4));assert.equal(b.sample(1600).expression.jawOpen,0.4);
});
test('all six complete orders use each condition once',()=>{
  assert.equal(ORDER_CODES.length,6);
  for(const code of ORDER_CODES)assert.deepEqual([...studyOrder(code)].sort(),[...CONDITIONS].sort());
});
