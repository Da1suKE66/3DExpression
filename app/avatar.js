import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { COEFFICIENTS, PARAMS, neutral } from './core.js?v=0.3.1';
import { POSE_AXES, POSE_LIMITS, zeroPose, validPose } from './expressions.js?v=0.3.1';

export async function createAvatar(canvas,onLoad=()=>{},options={}){
  const response=await fetch('./avatar_catalog.json',{cache:'no-store'});
  if(!response.ok)throw new Error('角色清单缺失，请重新构建');
  const catalog=await response.json();
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,PARAMS.max_pixel_ratio));renderer.setClearColor(PARAMS.background);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,0.1,100);
  camera.position.set(...PARAMS.camera_pose);camera.lookAt(0,0.02,0);
  scene.add(new THREE.HemisphereLight(0xffffff,0x879792,2.5));
  const key=new THREE.DirectionalLight(0xfff2e6,2.5);key.position.set(-3,4,5);scene.add(key);
  const fill=new THREE.DirectionalLight(0xbddde4,1.1);fill.position.set(4,1,2);scene.add(fill);
  let current=null,manifest=null,info=null,headPivot=null,morphMeshes=[],eyeMeshes=[];
  let lastApplied=neutral(),lastPose=zeroPose(),sequence=0;
  function disposeScene(object){object?.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();}});}
  function apply(values){
    lastApplied={...values};
    for(const mesh of morphMeshes){mesh.morphTargetInfluences.fill(0);for(const coefficient of COEFFICIENTS){const index=mesh.morphTargetDictionary[manifest.mapping[coefficient]];if(index!==undefined)mesh.morphTargetInfluences[index]=values[coefficient]||0;}}
    for(const mesh of eyeMeshes){const side=mesh.name.includes('_left_')?'Left':'Right';mesh.visible=(values['eyeBlink'+side]||0)<PARAMS.blink_mapping.hide_eyeball_threshold;}
  }
  function applyPose(pose){
    lastPose=validPose(pose)?Object.fromEntries(POSE_AXES.map(axis=>[axis,Math.max(-POSE_LIMITS[axis],Math.min(POSE_LIMITS[axis],pose[axis]))])):zeroPose();
    headPivot?.rotation.set(lastPose.pitch,lastPose.yaw,lastPose.roll,'YXZ');
  }
  function render(){
    const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);
    if(canvas.width!==Math.round(width*renderer.getPixelRatio())||canvas.height!==Math.round(height*renderer.getPixelRatio())){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
    renderer.render(scene,camera);
  }
  async function setAvatar(avatarKey){
    const candidate=catalog.avatars.find(item=>item.key===avatarKey);
    if(!candidate)throw new Error('未知卡通角色');
    if(manifest?.key===avatarKey)return {...info};
    const request=++sequence;onLoad('正在加载'+candidate.label+'…');
    const asset=await fetch('./'+candidate.asset_path+'?sha256='+encodeURIComponent(candidate.sha256));
    if(!asset.ok)throw new Error('角色GLB不存在');const bytes=await asset.arrayBuffer();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==candidate.sha256)throw new Error('角色文件校验不一致，请重新构建');
    const gltf=await new GLTFLoader().parseAsync(bytes,new URL('./models/',location.href).href);
    const pivot=gltf.scene.getObjectByName(candidate.head_pivot),morphs=[],eyes=[],available=new Set();
    gltf.scene.traverse(mesh=>{
      if(mesh.isMesh&&/^eye_(left|right)_(white|iris|glint)$/.test(mesh.name))eyes.push(mesh);
      if(mesh.isMesh&&mesh.morphTargetDictionary){morphs.push(mesh);Object.keys(mesh.morphTargetDictionary).forEach(name=>available.add(name));}
    });
    const missing=COEFFICIENTS.filter(coefficient=>!available.has(candidate.mapping[coefficient]));
    if(!pivot||missing.length){disposeScene(gltf.scene);throw new Error(!pivot?'角色缺少头部旋转节点':'角色缺少实际形变：'+missing.join('、'));}
    if(request!==sequence){disposeScene(gltf.scene);return null;}
    if(current){scene.remove(current);disposeScene(current);}
    current=gltf.scene;manifest=candidate;headPivot=pivot;morphMeshes=morphs;eyeMeshes=eyes;scene.add(current);
    info={id:candidate.id,avatar_key:candidate.key,catalog_id:catalog.id,label:candidate.label,sha256:hash,actual_morph_names:[...available],mapping:candidate.mapping,eyelid_mode:candidate.eyelid_mode,animation_clips_in_file:gltf.animations.length,animation_playback_enabled:false,morph_meshes:morphs.map(mesh=>({mesh:mesh.name,morphTargetDictionary:{...mesh.morphTargetDictionary}}))};
    apply(neutral());applyPose(zeroPose());render();onLoad('化身已就绪');return {...info};
  }
  const requested=options.avatarKey||new URLSearchParams(location.search).get('avatar')||catalog.default_avatar;
  await setAvatar(catalog.avatars.some(item=>item.key===requested)?requested:catalog.default_avatar);
  return {apply,applyPose,render,setAvatar,get info(){return {...info};},choices:catalog.avatars.map(({key,label})=>({key,label})),getApplied:()=>({...lastApplied}),inspect:()=>({...info,head_pose:{...lastPose},head_pivot:headPivot.name,eyes:eyeMeshes.map(mesh=>({name:mesh.name,visible:mesh.visible})),meshes:morphMeshes.map(mesh=>({name:mesh.name,dictionary:{...mesh.morphTargetDictionary},influences:[...mesh.morphTargetInfluences]}))}),dispose:()=>{disposeScene(current);renderer.dispose();}};
}
