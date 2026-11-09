// An explicit composite recording of the live avatar and camera, started by the user.
export class DemoRecorder {
  constructor({ avatarCanvas, video, overlay, sourceType, onStatus, onFinished }) { Object.assign(this, { avatarCanvas, video, overlay, sourceType, onStatus, onFinished }); this.active = false; this.animation = 0; this.recorder = null; }
  start() {
    if (this.sourceType !== 'live_camera') throw new Error('真人演示录像仅接受实时摄像头输入，参数回放和软件测试不能录为真人演示');
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('当前浏览器不支持内置录制，请使用系统录屏');
    this.mimeType = ['video/mp4;codecs=avc1.42001E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!this.mimeType) throw new Error('当前浏览器无可用编码器，请使用系统录屏');
    this.canvas = document.createElement('canvas'); this.canvas.width = 1280; this.canvas.height = 900;
    this.ctx = this.canvas.getContext('2d'); this.stream = this.canvas.captureStream(30);
    this.chunks = []; this.started = performance.now(); this.startedAt = new Date().toISOString(); this.active = true;
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType, videoBitsPerSecond: 5_000_000 });
    this.recorder.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
    this.recorder.onerror = event => { this.onStatus('录制错误：' + (event.error?.message || '编码器异常')); this.stop('encoder_error'); };
    this.recorder.onstop = () => { this.stream.getTracks().forEach(track => track.stop()); this.onFinished({ blob: new Blob(this.chunks, { type: this.mimeType }), duration_ms: performance.now() - this.started, started_at: this.startedAt, ended_at: new Date().toISOString(), source_type: 'live_camera', stop_reason: this.reason || 'user', mime_type: this.mimeType }); };
    this.recorder.start(1000); this.draw();
  }
  draw() {
    if (!this.active) return;
    const ctx = this.ctx, info = this.overlay();
    ctx.fillStyle = '#edf2f1'; ctx.fillRect(0, 0, 1280, 900);
    const ratio = Math.min(1280 / this.avatarCanvas.width, 775 / this.avatarCanvas.height);
    const w = this.avatarCanvas.width * ratio, h = this.avatarCanvas.height * ratio;
    ctx.drawImage(this.avatarCanvas, (1280 - w) / 2, 38, w, h);
    if (this.video.readyState >= 2) {
      ctx.save(); ctx.translate(265, 795); ctx.scale(-1, 1); ctx.drawImage(this.video, 0, -180, 240, 180); ctx.restore();
      ctx.fillStyle = '#173b44'; ctx.font = '16px sans-serif'; ctx.fillText('真人摄像头（镜像）', 25, 820);
    }
    ctx.fillStyle = '#173b44'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('IPP31078  面部化身演示', 30, 40);
    ctx.font = '18px sans-serif'; ctx.fillText('live_camera · 简化卡通化身 · 条件 ' + info.condition, 30, 72);
    ctx.fillText(info.tracking, 30, 105);
    ctx.fillText(`张嘴 ${info.jaw}  眨眼 ${info.blink}  微笑 ${info.smile}`, 320, 825);
    ctx.fillText(`结果更新 ${info.rate} Hz   连续录制 ${((performance.now() - this.started) / 1000).toFixed(1)} 秒`, 320, 855);
    ctx.font = '14px sans-serif'; ctx.fillStyle = '#647c80'; ctx.fillText('人工操作录像，真实性和动作响应仍需操作者复核；该录像不等于问卷结果。', 30, 885);
    this.animation = requestAnimationFrame(() => this.draw());
  }
  stop(reason = 'user') { if (!this.active) return; this.active = false; this.reason = reason; cancelAnimationFrame(this.animation); if (this.recorder?.state !== 'inactive') this.recorder.stop(); }
  duration() { return this.active ? performance.now() - this.started : 0; }
}
