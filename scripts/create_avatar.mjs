// Project-authored parametric character meshes. No downloaded character models.
import * as THREE from '../app/vendor/three.module.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { COEFFICIENTS } from '../app/core.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configs=[
  {key:'doraemon',id:'ipp31078-doraemon-v1',label:'哆啦A梦 · 自制卡通版',skin:0xffffff,body:0x158dcc,eye:0xffffff,iris:0x172631,ex:0.18,ey:0.62,ew:0.151,eh:0.185,ez:0.68,my:-0.14,mw:0.34,mz:0.678,browY:0.86},
  {key:'pikachu',id:'ipp31078-pikachu-v1',label:'皮卡丘 · 自制卡通版',skin:0xf5d340,body:0xf5d340,eye:0x172631,iris:0x172631,ex:0.285,ey:0.49,ew:0.11,eh:0.127,ez:0.575,my:0.025,mw:0.17,mz:0.632,browY:0.76},
];
const clamp=n=>Math.max(0,Math.min(1,n));
async function buildCharacter(c){
  const pieces=[];
  function add(name,color,geometry,morphs={},region='head'){pieces.push({name,color,geometry,morphs,region});}
  function sphere(name,color,center,scale,morphs={},region='head',angle=0){
    const g=new THREE.SphereGeometry(1,36,26);g.scale(...scale);if(angle)g.rotateZ(angle);g.translate(...center);add(name,color,g,morphs,region);
  }
  function line(name,color,points,radius=0.006,morphs={},region='head'){
    add(name,color,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),36,radius,6,false),morphs,region);
  }
  const jawSkin=(x,y,z)=>[x,y-clamp((0.15-y)/0.95)*0.09,z];
  if(c.key==='doraemon'){
    sphere('torso',c.body,[0,-0.99,-0.10],[0.66,0.69,0.46],{},'body');
    sphere('belly',0xffffff,[0,-1.02,0.345],[0.46,0.47,0.13],{},'body');
    sphere('collar',0xd94048,[0,-0.40,0.09],[0.57,0.065,0.40],{},'body');
    sphere('bell',0xeac841,[0,-0.55,0.51],[0.125,0.125,0.10],{},'body');
    line('bell_line',0x5b4b22,[[-0.10,-0.55,0.59],[0,-0.55,0.615],[0.10,-0.55,0.59]],0.009,{},'body');
    sphere('bell_hole',0x544528,[0,-0.61,0.602],[0.021,0.025,0.008],{},'body');
    line('pocket',0x597583,[[-0.35,-0.99,0.48],[-0.24,-1.24,0.48],[0,-1.32,0.48],[0.24,-1.24,0.48],[0.35,-0.99,0.48]],0.008,{},'body');
    sphere('head',c.body,[0,0.30,0],[0.82,0.83,0.62],{jawOpen:jawSkin});
    sphere('face_patch',0xffffff,[0,0.115,0.22],[0.69,0.68,0.44],{jawOpen:jawSkin});
    sphere('nose',0xd73b42,[0,0.365,0.759],[0.095,0.09,0.09]);
    sphere('nose_glint',0xffffff,[-0.025,0.397,0.838],[0.024,0.025,0.008]);
    line('nose_line',0x22313b,[[0,0.275,0.735],[0,0.12,0.704],[0,-0.12,0.699]],0.006);
    for(const sign of [-1,1])for(const offset of [-1,0,1])line('whisker_'+sign+'_'+offset,0x22313b,[[sign*0.34,0.20+offset*0.085,0.685],[sign*0.52,0.20+offset*0.12,0.67],[sign*0.70,0.20+offset*0.15,0.61]],0.006);
  }else{
    sphere('torso',c.body,[0,-0.99,-0.08],[0.51,0.66,0.40],{},'body');
    sphere('head',c.skin,[0,0.28,0],[0.78,0.71,0.59],{jawOpen:jawSkin});
    sphere('nose',0x24313a,[0,0.30,0.631],[0.048,0.025,0.036]);
    for(const sign of [-1,1]){
      sphere('ear_'+sign,c.skin,[sign*0.50,1.12,-0.025],[0.145,0.58,0.10],{},'head',-sign*0.32);
      sphere('ear_tip_'+sign,0x24313a,[sign*0.657,1.59,-0.025],[0.117,0.22,0.107],{},'head',-sign*0.32);
      sphere('cheek_'+sign,0xde5844,[sign*0.55,0.15,0.477],[0.14,0.13,0.055]);
    }
    const shape=new THREE.Shape();[[0,-0.20],[0.35,-0.03],[0.19,0.18],[0.50,0.35],[0.31,0.54],[0.70,0.72],[0.52,0.85],[-0.04,0.60],[0.10,0.38],[-0.17,0.16]].forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
    const tail=new THREE.ExtrudeGeometry(shape,{depth:0.08,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:0.025,bevelThickness:0.025});tail.translate(0.40,-1.12,-0.30);add('lightning_tail',c.body,tail,{},'body');
  }
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    const lower=side.toLowerCase();
    sphere('arm_'+lower,c.body,[sign*(c.key==='doraemon'?0.64:0.48),-0.98,-0.01],[0.18,0.36,0.20],{},'body',sign*0.22);
    sphere('hand_'+lower,c.key==='doraemon'?0xffffff:c.skin,[sign*(c.key==='doraemon'?0.74:0.56),-1.21,0.08],[0.19,0.18,0.21],{},'body');
    sphere('foot_'+lower,c.key==='doraemon'?0xffffff:c.skin,[sign*0.31,-1.60,0.06],[0.31,0.15,0.32],{},'body');
    const cx=sign*c.ex,cy=c.ey;
    sphere('eye_'+lower+'_white',c.eye,[cx,cy,c.ez],[c.ew,c.eh,0.061],{['eyeWide'+side]:(x,y,z)=>[x,cy+(y-cy)*1.5,z]});
    sphere('eye_'+lower+'_iris',c.iris,[cx-sign*0.008,cy-0.004,c.ez+0.058],[c.ew*0.34,c.eh*0.43,0.020]);
    sphere('eye_'+lower+'_glint',0xffffff,[cx-0.015,cy+c.eh*0.19,c.ez+0.078],[0.016,0.021,0.007]);
    const half=c.ew*1.08,front=c.ez+0.091;
    const ellipse=x=>Math.sqrt(Math.max(0,1-((x-cx)/half)**2));
    const closed=x=>cy-c.eh*0.04+c.eh*0.08*((x-cx)/half)**2;
    for(const upper of [true,false]){
      const signY=upper?1:-1,edge=x=>cy+signY*c.eh*1.035*ellipse(x);
      const positions=[],indices=[],columns=40,rows=8;
      for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
        const t=row/rows,x=cx-half+2*half*col/columns;positions.push(x,edge(x),front+t*0.001);
      }
      for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
        const a=row*(columns+1)+col,b=a+1,d=a+columns+2,e=a+columns+1;indices.push(...(upper?[a,b,e,b,d,e]:[a,e,b,b,e,d]));
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
      add('lid_'+lower+'_'+(upper?'upper':'lower'),c.skin,g,{
        ['eyeBlink'+side]:(x,y,z)=>[x,y+(closed(x)-edge(x))*(1-clamp((z-front)/0.001)),z],
        ['eyeWide'+side]:(x,y,z)=>[x,y+signY*c.eh*0.5*ellipse(x),z],
      });
    }
    const open=x=>cy+c.eh*1.035*ellipse(x);
    const points=Array.from({length:21},(_,i)=>{const x=cx-half+2*half*i/20;return[x,open(x),front+0.006]});
    line('lash_'+lower,0x263640,points,0.0045,{
      ['eyeBlink'+side]:(x,y,z)=>[x,y+closed(x)-open(x),z],
      ['eyeWide'+side]:(x,y,z)=>[x,y+c.eh*0.5*ellipse(x),z],
    });
    sphere('brow_'+lower,0x263640,[cx,c.browY,c.ez-0.05],[c.ew*0.8,0.011,0.016],{
      browInnerUp:(x,y,z)=>[x,y+0.13*clamp((c.ex+c.ew-sign*x)/(2*c.ew)),z],
      ['browOuterUp'+side]:(x,y,z)=>[x,y+0.13*clamp((sign*x-c.ex+c.ew)/(2*c.ew)),z],
      ['browDown'+side]:(x,y,z)=>[x-sign*0.018,y-0.095*clamp((c.ex+c.ew-sign*x)/(2*c.ew)),z],
    });
  }
  const mouthCurve=x=>(c.key==='doraemon'?0.045:0.025)*(x/c.mw)**2;
  const mouthMorphs={jawOpen:(x,y,z)=>[x,c.my+(y-c.my-mouthCurve(x))*12+mouthCurve(x)-0.065,z],mouthPucker:(x,y,z)=>[x*0.52,c.my+(y-c.my)*2.8,z+0.07]};
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    const weight=x=>Math.max(0,sign*x/c.mw);
    mouthMorphs['mouthSmile'+side]=(x,y,z)=>[x+sign*0.04*weight(x),y+0.12*weight(x)**1.6,z];
    mouthMorphs['mouthFrown'+side]=(x,y,z)=>[x+sign*0.02*weight(x),y-0.13*weight(x)**1.5,z];
    mouthMorphs['mouthPress'+side]=(x,y,z)=>[x+sign*0.015*weight(x),c.my+(y-c.my)*(1-0.65*clamp(weight(x))),z-0.012*clamp(weight(x))];
  }
  sphere('mouth',c.key==='doraemon'?0x763340:0x3b292b,[0,c.my,c.mz],[c.mw,0.014,0.026],mouthMorphs);
  const mouthGeometry=pieces.at(-1).geometry,mp=mouthGeometry.attributes.position;
  for(let i=0;i<mp.count;i++)mp.setY(i,mp.getY(i)+mouthCurve(mp.getX(i)));
  mouthGeometry.computeVertexNormals();
  const chunks=[],views=[],accessors=[],materials=[],meshes=[],nodes=[],details=[];let byteLength=0;
  function accessor(typed,components,componentType=5126,bounds=false){
    const b=Buffer.from(typed.buffer,typed.byteOffset,typed.byteLength),padded=Buffer.alloc(Math.ceil(b.length/4)*4);b.copy(padded);
    const view=views.length;views.push({buffer:0,byteOffset:byteLength,byteLength:b.length});chunks.push(padded);byteLength+=padded.length;
    const item={bufferView:view,componentType,count:typed.length/components,type:({1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'})[components]};
    if(bounds){item.min=Array(components).fill(Infinity);item.max=Array(components).fill(-Infinity);for(let i=0;i<typed.length;i++){const k=i%components;item.min[k]=Math.min(item.min[k],typed[i]);item.max[k]=Math.max(item.max[k],typed[i]);}}
    accessors.push(item);return accessors.length-1;
  }
  for(const piece of pieces){
    const g=piece.geometry;if(!g.attributes.normal)g.computeVertexNormals();const base=g.attributes.position.array,names=Object.keys(piece.morphs);
    const primitive={attributes:{POSITION:accessor(base,3,5126,true),NORMAL:accessor(g.attributes.normal.array,3)},material:materials.length};
    if(g.index)primitive.indices=accessor(g.index.array,1,g.index.array.BYTES_PER_ELEMENT===2?5123:5125);
    materials.push({name:piece.name+'_material',pbrMetallicRoughness:{baseColorFactor:[...new THREE.Color(piece.color).toArray(),1],metallicFactor:0,roughnessFactor:0.82},doubleSided:piece.name.startsWith('lid_')});
    if(names.length)primitive.targets=names.map(name=>{
      const target=g.clone(),pos=target.attributes.position.array;for(let i=0;i<pos.length;i+=3)pos.set(piece.morphs[name](...base.subarray(i,i+3)),i);target.computeVertexNormals();
      return{POSITION:accessor(Float32Array.from(pos,(v,i)=>v-base[i]),3,5126,true),NORMAL:accessor(Float32Array.from(target.attributes.normal.array,(v,i)=>v-g.attributes.normal.array[i]),3)};
    });
    const mesh={name:piece.name,primitives:[primitive]};if(names.length){mesh.weights=names.map(()=>0);mesh.extras={targetNames:names};}
    meshes.push(mesh);nodes.push({name:piece.name,mesh:meshes.length-1});details.push({mesh:piece.name,vertices:base.length/3,morph_target_names:names,region:piece.region});
  }
  const headNodes=pieces.flatMap((p,i)=>p.region==='head'?[i]:[]),bodyNodes=pieces.flatMap((p,i)=>p.region==='body'?[i]:[]);
  for(const i of headNodes)nodes[i].translation=[0,-0.25,0];const pivot=nodes.length;nodes.push({name:'head_pivot',translation:[0,0.25,0],children:headNodes});
  const gltf={asset:{version:'2.0',generator:'IPP31078 parametric cartoon characters v3',extras:{provenance:'Project-authored parametric fan character geometry; no downloaded character mesh.',automatic_animation:false}},scene:0,scenes:[{name:c.label,nodes:[...bodyNodes,pivot]}],nodes,meshes,materials,accessors,bufferViews:views,buffers:[{byteLength}]};
  const json=Buffer.from(JSON.stringify(gltf)),jp=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(jp);const binary=Buffer.concat(chunks);
  const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jp.length+8+binary.length,8);
  const jh=Buffer.alloc(8);jh.writeUInt32LE(jp.length);jh.writeUInt32LE(0x4e4f534a,4);const bh=Buffer.alloc(8);bh.writeUInt32LE(binary.length);bh.writeUInt32LE(0x004e4942,4);const glb=Buffer.concat([header,jh,jp,bh,binary]);
  const assetPath='models/'+c.key+'-v1.glb';await fs.mkdir(path.join(root,'app/models'),{recursive:true});await fs.writeFile(path.join(root,'app',assetPath),glb);
  const manifest={key:c.key,id:c.id,label:c.label,asset_path:assetPath,sha256:createHash('sha256').update(glb).digest('hex'),bytes:glb.length,head_pivot:'head_pivot',creator:'project_authored_parametric_character_mesh',generator:'scripts/create_avatar.mjs',animation_clips:[],automatic_animation:false,eyelid_mode:'skin_lids_and_lashline_over_fixed_eyeball',mapping:Object.fromEntries(COEFFICIENTS.map(k=>[k,k])),meshes:details};
  console.log(JSON.stringify({key:c.key,bytes:glb.length,meshes:meshes.length,morphs:[...new Set(details.flatMap(d=>d.morph_target_names))].length,sha256:manifest.sha256}));return manifest;
}
const avatars=[];for(const c of configs)avatars.push(await buildCharacter(c));
await fs.writeFile(path.join(root,'app/avatar_catalog.json'),JSON.stringify({id:'ipp31078-character-catalog-v1',default_avatar:'doraemon',avatars},null,2)+'\n');
await fs.writeFile(path.join(root,'app/model_manifest.json'),JSON.stringify(avatars[0],null,2)+'\n');
