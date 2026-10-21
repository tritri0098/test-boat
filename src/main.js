import * as THREE from 'three';
import { OceanWorld } from './core/OceanWorld.js';
import { SceneTimeline } from './core/SceneTimeline.js';
import { SceneEditor } from './editor/SceneEditor.js';

const viewport=document.querySelector('#viewport');
const status=document.querySelector('#webgl-status');
if(!document.createElement('canvas').getContext('webgl2')){status.textContent='WebGL2 indisponible';throw new Error('WebGL2 indisponible');}

const world=new OceanWorld(viewport);
await world.addProceduralBoat({id:'main-boat',position:[3.1,0,-5.4],scale:.94});

const cameraA=world.addCinematicCamera({id:'camera-A',position:[0,2.7,10.8],target:[0,.8,-6],focalLength:35,focusDistance:13,aperture:.00018,maxBlur:.009,dofEnabled:false});
const cameraB=world.addCinematicCamera({id:'camera-B',position:[7,2.1,3.5],target:[1,.7,-6],focalLength:50,focusDistance:10,aperture:.00022,maxBlur:.012,dofEnabled:false});

const timeline=new SceneTimeline({resolveObject:(id)=>world.getEditableObject(id),duration:12,loop:false});
world.setTimeline(timeline);

timeline.captureKeyframe('main-boat',0,{interpolation:'smooth'});
const main=world.getEditableObject('main-boat');main.position.set(-2,0,-7);main.rotation.y=.25;timeline.captureKeyframe('main-boat',5,{interpolation:'smooth'});

timeline.captureKeyframe('camera-A',0,{interpolation:'smooth'});
cameraA.object.position.set(-1.3,2.15,8.7);cameraA.object.lookAt(new THREE.Vector3(0,.8,-6));world.cameraManager.applyLens(cameraA.object,{focalLength:42,zoom:1,focusDistance:10});
timeline.captureKeyframe('camera-A',5.8,{interpolation:'smooth'});

timeline.captureKeyframe('camera-B',6,{interpolation:'smooth'});
cameraB.object.position.set(4.5,1.5,1.5);cameraB.object.lookAt(new THREE.Vector3(-1,.7,-7));world.cameraManager.applyLens(cameraB.object,{focalLength:65,zoom:1,focusDistance:8});
timeline.captureKeyframe('camera-B',12,{interpolation:'smooth'});

timeline.addCameraCut('camera-A',0);timeline.addCameraCut('camera-B',6);timeline.setTime(0,true);

const editor=new SceneEditor({world,timeline,root:document});
status.textContent='WebGL2 ✅ · Three.js ✅ · éditeur cinématique prêt';

const floatingInput=document.querySelector('#asset-floating'),filesInput=document.querySelector('#model-files'),assetName=document.querySelector('#asset-name'),selectedFiles=document.querySelector('#selected-files');
filesInput.addEventListener('change',()=>{const files=[...filesInput.files];selectedFiles.textContent=files.length?files.map(f=>f.name).join(', '):'Aucun fichier';if(files.length===1&&!assetName.value)assetName.value=files[0].name.replace(/\.[^.]+$/,'');});

document.querySelector('#load-model').addEventListener('click',async()=>{
  const files=[...filesInput.files];if(!files.length){status.textContent='Sélectionne un GLB/GLTF/OBJ.';return;}status.textContent='Chargement du modèle…';
  try{const actor=await world.addModelFromFiles(files,{id:assetName.value||undefined,position:[0,0,-6],scale:1,floating:floatingInput.checked});editor.select(actor.id);status.textContent=`${actor.id} chargé · textures conservées`;}
  catch(err){console.error(err);status.textContent=`Erreur: ${err.message}`;}
});

document.querySelector('#add-procedural').addEventListener('click',async()=>{const boat=await world.addProceduralBoat({id:`boat-${world.objects.size+1}`,position:[-3-world.objects.size,0,-7]});editor.select(boat.id);});

document.querySelector('#remove-object').addEventListener('click',()=>{if(!editor.selectedId)return;const id=editor.selectedId;timeline.removeObjectReferences(id);world.removeObject(id);});

for(const input of document.querySelectorAll('[data-weather]'))input.addEventListener('input',()=>world.weather.state[input.dataset.weather]=Number(input.value));
world.onTick=(_dt,s)=>{
  document.querySelector('#wave-value').textContent=(.2+s.storm*2.1).toFixed(1).replace('.',',')+' m';
  document.querySelector('#wind-value').textContent=Math.round(s.wind)+' m/s';
  document.querySelector('#rain-value').textContent=Math.round(s.rain*100)+' %';
};
document.querySelector('#weather-calm').addEventListener('click',()=>world.weather.transitionTo({storm:0,rain:0,wind:3,cloud:.12},2.5));
document.querySelector('#weather-storm').addEventListener('click',()=>world.weather.transitionTo({storm:1,rain:1,wind:18,cloud:.95},4));

world.setViewMode('editor');
window.sceneApp={world,timeline,editor};
