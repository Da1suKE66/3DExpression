import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraTracker } from '../app/tracker.js';
test('camera FPS comes from observed video counters and stays unavailable without them',()=>{
 const t=new CameraTracker({},()=>{});assert.equal(t.inputFps(1000),null);
 t.inputFrames=[{at:0,count:10},{at:500,count:20},{at:1000,count:30}];assert.equal(t.inputFps(1000),20);assert.equal(t.inputFps(1600),null);
});
