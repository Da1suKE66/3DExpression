// Project-created geometry. No external face mesh, portrait, or example animation.
import * as THREE from '../app/vendor/three.module.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { COEFFICIENTS } from '../app/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pieces = [];
const colors = { skin: 0xe8b99b, hair: 0x263744, shirt: 0x326e7a, white: 0xf7f6ee, iris: 0x293c43, mouth: 0x713c40, collar: 0xe5e9e4 };
function sphere(name, color, center, scale, morphs = {}) {
  const geometry = new THREE.SphereGeometry(1, 40, 28);
  geometry.scale(...scale); geometry.translate(...center);
  pieces.push({ name, color, geometry, morphs });
}
const jawSkin = (x, y, z) => [x, y - Math.max(0, (0.15 - y) / 0.95) * 0.11, z];
sphere('torso', colors.shirt, [0, -1.12, -0.13], [0.96, 0.57, 0.48]);
sphere('neck', colors.skin, [0, -0.64, -0.02], [0.23, 0.35, 0.25]);
sphere('collar', colors.collar, [0, -0.85, 0.05], [0.32, 0.12, 0.29]);
sphere('head', colors.skin, [0, 0.22, 0], [0.71, 0.91, 0.6], { jawOpen: jawSkin });
sphere('ear_left', colors.skin, [0.7, 0.16, -0.01], [0.105, 0.2, 0.11]);
sphere('ear_right', colors.skin, [-0.7, 0.16, -0.01], [0.105, 0.2, 0.11]);
sphere('hair', colors.hair, [0, 1.01, -0.05], [0.72, 0.28, 0.59]);
sphere('hair_part', colors.hair, [-0.32, 0.98, 0.14], [0.37, 0.18, 0.43]);
sphere('nose', colors.skin, [0, 0.17, 0.595], [0.082, 0.145, 0.115]);

// Stage 1: jaw opening. Targets hold actual vertex displacement, not canned clips.
const mouthY = -0.15;
const mouthMorphs = {
  jawOpen: (x, y, z) => [x, mouthY + (y - mouthY) * 12 - 0.075, z],
};
// Stage 2: left/right blinks, with identical target names on white and iris meshes.
for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
  const y = 0.44;
  const blink = {
    ['eyeBlink' + side]: (x, vy, z) => [x, y + (vy - y) * 0.06, z],
    ['eyeWide' + side]: (x, vy, z) => [x, y + (vy - y) * 1.5, z],
  };
  sphere('eye_' + side.toLowerCase() + '_white', colors.white, [sign * 0.275, y, 0.553], [0.153, 0.108, 0.068], blink);
  sphere('eye_' + side.toLowerCase() + '_iris', colors.iris, [sign * 0.275, y, 0.617], [0.058, 0.072, 0.019], blink);
  sphere('eye_' + side.toLowerCase() + '_glint', 0xffffff, [sign * 0.275 - 0.015, y + 0.025, 0.635], [0.015, 0.019, 0.004], blink);
  sphere('brow_' + side.toLowerCase(), colors.hair, [sign * 0.275, 0.65, 0.542], [0.153, 0.025, 0.025], {
    browInnerUp: (x, vy, z) => [x, vy + 0.16 * Math.max(0, Math.min(1, (0.44 - sign * x) / 0.32)), z],
    ['browOuterUp' + side]: (x, vy, z) => [x, vy + 0.14 * Math.max(0, Math.min(1, (sign * x - 0.11) / 0.32)), z],
    ['browDown' + side]: (x, vy, z) => [x - sign * 0.025, vy - 0.11 * Math.max(0.25, (0.52 - sign * x) / 0.4), z],
  });
}
// Stage 3: independent mouth corners. Subject-left maps to the avatar's left.
for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
  mouthMorphs['mouthSmile' + side] = (x, y, z) => {
    const weight = Math.max(0, x * sign / 0.21);
    return [x + sign * 0.07 * weight, y + 0.13 * weight ** 1.7, z];
  };
  mouthMorphs['mouthFrown' + side] = (x, y, z) => {
    const weight = Math.max(0, x * sign / 0.21);
    return [x + sign * 0.02 * weight, y - 0.14 * weight ** 1.5, z];
  };
  mouthMorphs['mouthPress' + side] = (x, y, z) => {
    const weight = Math.max(0, Math.min(1, x * sign / 0.21));
    return [x + sign * 0.02 * weight, mouthY + (y - mouthY) * (1 - 0.6 * weight), z - 0.012 * weight];
  };
}
mouthMorphs.mouthPucker = (x, y, z) => [x * 0.5, mouthY + (y - mouthY) * 2.8, z + 0.07];
sphere('mouth', colors.mouth, [0, mouthY, 0.577], [0.213, 0.014, 0.024], mouthMorphs);

const chunks = [], views = [], accessors = [];
let byteLength = 0;
function accessor(typed, components, componentType = 5126, bounds = false) {
  const buffer = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const padded = Buffer.alloc(Math.ceil(buffer.length / 4) * 4); buffer.copy(padded);
  const view = views.length; views.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length });
  chunks.push(padded); byteLength += padded.length;
  const value = { bufferView: view, componentType, count: typed.length / components, type: ({ 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' })[components] };
  if (bounds) {
    value.min = Array(components).fill(Infinity); value.max = Array(components).fill(-Infinity);
    for (let i = 0; i < typed.length; i++) { const c = i % components; value.min[c] = Math.min(value.min[c], typed[i]); value.max[c] = Math.max(value.max[c], typed[i]); }
  }
  accessors.push(value); return accessors.length - 1;
}
const materials = [], meshes = [], nodes = [], details = [];
for (const piece of pieces) {
  const { geometry, morphs } = piece;
  const basePosition = geometry.attributes.position.array;
  const baseNormal = geometry.attributes.normal.array;
  const names = Object.keys(morphs);
  const primitive = { attributes: { POSITION: accessor(basePosition, 3, 5126, true), NORMAL: accessor(baseNormal, 3) }, indices: accessor(geometry.index.array, 1, geometry.index.array.BYTES_PER_ELEMENT === 2 ? 5123 : 5125), material: materials.length };
  materials.push({ name: piece.name + '_material', pbrMetallicRoughness: { baseColorFactor: [...new THREE.Color(piece.color).toArray(), 1], metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: false });
  if (names.length) {
    primitive.targets = names.map(name => {
      const target = geometry.clone();
      const pos = target.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        const result = morphs[name](...basePosition.subarray(i, i + 3));
        pos.set(result, i);
      }
      target.computeVertexNormals();
      const positionDelta = Float32Array.from(pos, (v, i) => v - basePosition[i]);
      const normalDelta = Float32Array.from(target.attributes.normal.array, (v, i) => v - baseNormal[i]);
      return { POSITION: accessor(positionDelta, 3, 5126, true), NORMAL: accessor(normalDelta, 3) };
    });
  }
  const mesh = { name: piece.name, primitives: [primitive] };
  if (names.length) { mesh.weights = names.map(() => 0); mesh.extras = { targetNames: names }; }
  meshes.push(mesh); nodes.push({ name: piece.name, mesh: meshes.length - 1 });
  details.push({ mesh: piece.name, vertices: basePosition.length / 3, morph_target_names: names });
}
const headNodes = nodes.map((node, i) => i).filter(i => !['torso','neck','collar'].includes(nodes[i].name));
for (const i of headNodes) nodes[i].translation = [0, -0.2, 0];
const headPivot = nodes.length;
nodes.push({ name: 'head_pivot', translation: [0, 0.2, 0], children: headNodes });
const gltf = { asset: { version: '2.0', generator: 'IPP31078 create_avatar.mjs v2', extras: { provenance: 'Project-created simplified cartoon avatar. No external face model or portrait.', license: 'Project deliverable; external distribution license to be decided by the project team.' } }, scene: 0, scenes: [{ name: 'IPP31078 simplified cartoon', nodes: [0, 1, 2, headPivot] }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength }] };
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(jsonPadded);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binary.length, 8);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonPadded.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
const glb = Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binary]);
await fs.mkdir(path.join(root, 'app/models'), { recursive: true });
await fs.writeFile(path.join(root, 'app/models/ipp31078-cartoon-v2.glb'), glb);
const sha256 = createHash('sha256').update(glb).digest('hex');
const mapping = Object.fromEntries(COEFFICIENTS.map(name => [name, name]));
const manifest = { id: 'ipp31078-cartoon-v2', label: '扩展表情卡通化身', asset_path: 'models/ipp31078-cartoon-v2.glb', sha256, bytes: glb.length, head_pivot: 'head_pivot', creator: 'project_created_geometry', generator: 'scripts/create_avatar.mjs', animation_clips: [], automatic_animation: false, mapping, meshes: details, source_note: 'Original parametric project geometry; Three.js API/GLTFLoader MIT; no Face Cap mesh included.' };
await fs.writeFile(path.join(root, 'app/model_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ asset: manifest.asset_path, bytes: glb.length, sha256, meshes: meshes.length, actual_morph_names: [...new Set(details.flatMap(d => d.morph_target_names))], animation_clips: 0 }, null, 2));
