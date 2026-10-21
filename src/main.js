import { OceanWorld } from './core/OceanWorld.js';
import { SceneTimeline } from './core/SceneTimeline.js';
import { SceneEditor } from './editor/SceneEditor.js';

const viewport=document.querySelector('#viewport');
const status=document.querySelector('#webgl-status');

if(!document.createElement('canvas').getContext('webgl2')){
  status.textContent='WebGL2 indisponible';
  throw new Error('WebGL2 indisponible');
}

const world=new OceanWorld(viewport);
await world.addProceduralBoat({id:'main-boat',position:[3.1,0,-5.4],scale:.94});

const timeline=new SceneTimeline({
  resolveObject:(id)=>world.getEditableObject(id),
  duration:12,
  loop:false
});
world.setTimeline(timeline);

const editor=new SceneEditor({world,timeline,root:document});
status.textContent='WebGL2 ✅ · Three.js ✅ · éditeur prêt';

// Seed a useful two-keyframe example. The editor computes the interpolation.
timeline.captureKeyframe('main-boat',0,{interpolation:'smooth'});
const main=world.getEditableObject('main-boat');
main.position.set(-2,0,-7);
main.rotation.y=.25;
timeline.captureKeyframe('main-boat',5,{interpolation:'smooth'});
timeline.setTime(0,true);

const floatingInput=document.querySelector('#asset-floating');
const filesInput=document.querySelector('#model-files');
const assetName=document.querySelector('#asset-name');
const selectedFiles=document.querySelector('#selected-files');

filesInput.addEventListener('change',()=>{
  const files=[...filesInput.files];
  selectedFiles.textContent=files.length?files.map(f=>f.name).join(', '):'Aucun fichier';
  if(files.length===1&&!assetName.value) assetName.value=files[0].name.replace(/\.[^.]+$/,'');
});

document.querySelector('#load-model').addEventListener('click',async()=>{
  const files=[...filesInput.files];
  if(!files.length){status.textContent='Sélectionne un GLB/GLTF/OBJ.';return;}
  status.textContent='Chargement du modèle…';
  try{
    const actor=await world.addModelFromFiles(files,{id:assetName.value||undefined,position:[0,0,-6],scale:1,floating:floatingInput.checked});
    editor.select(actor.id);status.textContent=`${actor.id} chargé · textures conservées`;
  }catch(err){console.error(err);status.textContent=`Erreur: ${err.message}`;}
});

document.querySelector('#add-procedural').addEventListener('click',async()=>{
  const boat=await world.addProceduralBoat({id:`boat-${world.objects.size+1}`,position:[-3-world.objects.size,0,-7]});editor.select(boat.id);
});

document.querySelector('#remove-object').addEventListener('click',()=>{
  if(!editor.selectedId)return;
  const id=editor.selectedId;timeline.tracks.delete(id);timeline.bindings=timeline.bindings.filter(b=>b.childId!==id&&b.targetId!==id);world.removeObject(id);timeline.onChange?.();
});

// Simple live weather controls remain independent from the object timeline.
for(const input of document.querySelectorAll('[data-weather]')){
  input.addEventListener('input',()=>world.weather.state[input.dataset.weather]=Number(input.value));
}
world.onTick=(_dt,s)=>{
  document.querySelector('#wave-value').textContent=(.2+s.storm*2.1).toFixed(1).replace('.',',')+' m';
  document.querySelector('#wind-value').textContent=Math.round(s.wind)+' m/s';
  document.querySelector('#rain-value').textContent=Math.round(s.rain*100)+' %';
};

// Handy presets, still separate from the scene-object timeline.
document.querySelector('#weather-calm').addEventListener('click',()=>world.weather.transitionTo({storm:0,rain:0,wind:3,cloud:.12},2.5));
document.querySelector('#weather-storm').addEventListener('click',()=>world.weather.transitionTo({storm:1,rain:1,wind:18,cloud:.95},4));

window.sceneApp={world,timeline,editor};
