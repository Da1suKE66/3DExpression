import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { COEFFICIENTS, PARAMS, neutral } from './core.js?v=0.3.0-r2';
import { POSE_AXES, POSE_LIMITS, zeroPose, validPose } from './expressions.js?v=0.3.0-r2';

export async function createAvatar(canvas, onLoad = () => {}) {
  onLoad('正在加载本地化身…');
  const response = await fetch('./model_manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('化身清单缺失，请重新构建');
  const manifest = await response.json();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, PARAMS.max_pixel_ratio));
  renderer.setClearColor(PARAMS.background);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(...PARAMS.camera_pose); camera.lookAt(0, 0.02, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x879792, 2.5));
  const key = new THREE.DirectionalLight(0xfff2e6, 2.5); key.position.set(-3, 4, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbddde4, 1.1); fill.position.set(4, 1, 2); scene.add(fill);
  const modelResponse = await fetch('./' + manifest.asset_path + '?sha256=' + encodeURIComponent(manifest.sha256));
  if (!modelResponse.ok) throw new Error('本地GLB模型不存在');
  const modelBytes = await modelResponse.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', modelBytes);
  const actualHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (actualHash !== manifest.sha256) throw new Error('化身文件校验不一致，请重新构建后再体验');
  const gltf = await new GLTFLoader().parseAsync(modelBytes, new URL('./models/', location.href).href);
  scene.add(gltf.scene);
  const headPivot = gltf.scene.getObjectByName(manifest.head_pivot);
  if (!headPivot) throw new Error('化身缺少头部旋转节点');
  // Deliberately no AnimationMixer, clipAction, idle motion, or automatic blinking.
  const morphMeshes = [];
  const available = new Set();
  gltf.scene.traverse(object => {
    if (object.isMesh && object.morphTargetDictionary) {
      morphMeshes.push(object);
      Object.keys(object.morphTargetDictionary).forEach(name => available.add(name));
      object.morphTargetInfluences.fill(0);
    }
  });
  const missing = COEFFICIENTS.filter(key => !available.has(manifest.mapping[key]));
  if (missing.length) throw new Error('化身缺少实际形变：' + missing.join('、'));
  const info = { id: manifest.id, label: manifest.label, sha256: manifest.sha256, actual_morph_names: [...available], mapping: manifest.mapping, animation_clips_in_file: gltf.animations.length, animation_playback_enabled: false, morph_meshes: morphMeshes.map(mesh => ({ mesh: mesh.name, morphTargetDictionary: mesh.morphTargetDictionary })) };
  let lastApplied = neutral();
  let lastPose = zeroPose();
  function applyPose(pose) {
    lastPose = validPose(pose) ? Object.fromEntries(POSE_AXES.map(axis => [axis, Math.max(-POSE_LIMITS[axis], Math.min(POSE_LIMITS[axis], pose[axis]))])) : zeroPose();
    headPivot.rotation.set(lastPose.pitch, lastPose.yaw, lastPose.roll, 'YXZ');
  }
  function apply(values) {
    lastApplied = { ...values };
    for (const mesh of morphMeshes) {
      mesh.morphTargetInfluences.fill(0);
      for (const key of COEFFICIENTS) {
        const index = mesh.morphTargetDictionary[manifest.mapping[key]];
        if (index !== undefined) mesh.morphTargetInfluences[index] = values[key] || 0;
      }
    }
  }
  function render() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
  }
  onLoad('化身已就绪');
  return { apply, applyPose, render, info, getApplied: () => ({ ...lastApplied }), inspect: () => ({ ...info, head_pose: { ...lastPose }, head_pivot: headPivot.name, meshes: morphMeshes.map(mesh => ({ name: mesh.name, dictionary: mesh.morphTargetDictionary, influences: [...mesh.morphTargetInfluences] })) }), dispose: () => renderer.dispose() };
}
