import { COEFFICIENTS, PARAMS, clamp } from './core.js?v=0.3.0-r2';
import { poseFromMatrix } from './expressions.js?v=0.3.0-r2';

export class CameraTracker {
  constructor(video, status) { this.video = video; this.status = status; this.stream = null; this.model = null; this.modelPromise = null; this.token = 0; this.lastVideoTime = -1; this.lastInference = -Infinity; this.categoryNames = []; this.frameCallback = null; this.frameMetadata = null; this.callbackCount = 0; this.missedCallbacks = 0; this.lastPresented = null; }
  async ensureModel() {
    if (this.model) return this.model;
    if (!this.modelPromise) this.modelPromise = (async () => {
      this.status('加载本地识别程序', 0.25);
      const { FilesetResolver, FaceLandmarker } = await import('./vendor/vision_bundle.mjs');
      const vision = await FilesetResolver.forVisionTasks('./vendor/wasm');
      this.status('加载本地面部模型', 0.5);
      const response = await fetch('./models/face_landmarker.task');
      if (!response.ok) throw new Error('本地面部模型不存在，请运行安装脚本');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const model = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetBuffer: bytes, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
      this.model = model;
      return model;
    })().catch(error => { this.modelPromise = null; throw error; });
    return this.modelPromise;
  }
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('请在桌面Chrome中通过本机地址打开');
    const token = ++this.token;
    this.status('等待摄像头授权', 0.1);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: PARAMS.camera_constraints.width_ideal }, height: { ideal: PARAMS.camera_constraints.height_ideal }, frameRate: { ideal: PARAMS.camera_constraints.frame_rate_ideal, max: PARAMS.camera_constraints.frame_rate_max }, facingMode: PARAMS.camera_constraints.facing_mode }, audio: false });
    if (token !== this.token) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream; this.video.srcObject = stream; await this.video.play();
    this.frameMetadata = null; this.callbackCount = 0; this.missedCallbacks = 0; this.lastPresented = null;
    if (this.video.requestVideoFrameCallback) {
      const onFrame = (now, metadata) => {
        if (token !== this.token) return;
        this.callbackCount++;
        if (this.lastPresented !== null && Number.isFinite(metadata.presentedFrames)) this.missedCallbacks += Math.max(0, metadata.presentedFrames - this.lastPresented - 1);
        this.lastPresented = metadata.presentedFrames;
        this.frameMetadata = { ...metadata, callbackTime: now };
        this.frameCallback = this.video.requestVideoFrameCallback(onFrame);
      };
      this.frameCallback = this.video.requestVideoFrameCallback(onFrame);
    }
    await this.ensureModel();
    if (token !== this.token) return false;
    this.lastVideoTime = -1; this.lastInference = -Infinity;
    this.status('摄像头与本地模型已就绪', 1);
    return true;
  }
  stop() { this.token++; if (this.frameCallback !== null) this.video.cancelVideoFrameCallback?.(this.frameCallback); this.frameCallback = null; this.frameMetadata = null; this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; this.video.srcObject = null; }
  live() { return Boolean(this.stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled)); }
  settings() { const settings = this.stream?.getVideoTracks()[0]?.getSettings() || {}; return Object.fromEntries(['width', 'height', 'frameRate', 'facingMode', 'aspectRatio'].filter(key => settings[key] !== undefined).map(key => [key, settings[key]])); }
  quality() {
    const quality = this.video.getVideoPlaybackQuality?.();
    return { total_video_frames: Number.isFinite(quality?.totalVideoFrames) ? quality.totalVideoFrames : null, dropped_video_frames: Number.isFinite(quality?.droppedVideoFrames) ? quality.droppedVideoFrames : null, callback_count: this.callbackCount, missed_callbacks: this.missedCallbacks };
  }
  sample(now) {
    if (!this.model || !this.live() || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime || now - this.lastInference < PARAMS.inference_interval_ms) return null;
    this.lastVideoTime = this.video.currentTime; this.lastInference = now;
    const metadata = this.frameMetadata;
    const matched = Boolean(metadata && Number.isFinite(metadata.mediaTime) && Math.abs(metadata.mediaTime - this.lastVideoTime) < 0.005);
    const finite = value => Number.isFinite(value) ? value : null;
    const timing = { camera_media_time_s: this.lastVideoTime, frame_metadata_matched: matched, frame_capture_at_ms: matched ? finite(metadata.captureTime) : null, video_presentation_at_ms: matched ? finite(metadata.presentationTime) : null, video_frame_callback_at_ms: matched ? finite(metadata.callbackTime) : null, camera_presented_frames: matched ? finite(metadata.presentedFrames) : null };
    const start = performance.now();
    const result = this.model.detectForVideo(this.video, start);
    const end = performance.now();
    const categories = result.faceBlendshapes?.[0]?.categories;
    const detected = Boolean(result.faceLandmarks?.length && categories?.length);
    if (!detected) return { detected: false, raw: null, pose: null, inference_ms: end - start, monotonic_ms: end, sample_kind: 'result', ...timing };
    this.categoryNames = categories.map(category => category.categoryName);
    const missing = COEFFICIENTS.filter(key => !this.categoryNames.includes(key));
    if (missing.length) throw new Error('识别模型缺少表情输出：' + missing.join('、'));
    return { detected: true, raw: Object.fromEntries(categories.filter(category => COEFFICIENTS.includes(category.categoryName)).map(category => [category.categoryName, clamp(category.score)])), pose: poseFromMatrix(result.facialTransformationMatrixes?.[0]), inference_ms: end - start, monotonic_ms: end, sample_kind: 'result', ...timing };
  }
}
