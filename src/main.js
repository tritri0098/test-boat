import * as THREE from 'three';
import { OceanWorld } from './core/OceanWorld.js';
import { SceneTimeline } from './core/SceneTimeline.js';
import { SceneEditor } from './editor/SceneEditor.js';
import { BindingOffsetController } from './editor/BindingOffsetController.js';

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
const bindingOffsets=new BindingOffsetController({editor,timeline});

// Keep the transform inspector expressed in the child's local/offset space when
// a binding is active, without introducing any cross-window synchronization.
const editorTimelineTime=timeline.onTime;
timeline.onTime=(t)=>{editorTimelineTime?.(t);bindingOffsets.updateInspector();};

// Playback controls belong next to the viewport. Move the existing elements
// rather than duplicating them, so SceneEditor keeps the same references.
const playBtn=document.querySelector('#timeline-play');
const stopBtn=document.querySelector('#timeline-stop');
const timeLabel=document.querySelector('#timeline-time');
const oldPlaybackRow=playBtn.parentElement;
const playbackDivider=document.createElement('span');playbackDivider.className='toolbar-divider';
const viewButtons=document.querySelector('#view-cinematic');
viewButtons.after(playbackDivider,playBtn,stopBtn,timeLabel);
if(oldPlaybackRow&&!oldPlaybackRow.children.length)oldPlaybackRow.remove();

status.textContent='WebGL2 ✅ · Three.js ✅ · éditeur cinématique prêt';

const floatingInput=document.querySelector('#asset-floating'),filesInput=document.querySelector('#model-files'),assetName=document.querySelector('#asset-name'),selectedFiles=document.querySelector('#selected-files');
filesInput.addEventListener('change',()=>{const files=[...filesInput.files];selectedFiles.textContent=files.length?files.map(f=>f.name).join(', '):'Aucun fichier';if(files.length===1&&!assetName.value)assetName.value=files[0].name.replace(/\.[^.]+$/,'');});

document.querySelector('#load-model').addEventListener('click',async()=>{
  const files=[...filesInput.files];if(!files.length){status.textContent='Sélectionne un GLB/GLTF/OBJ.';return;}status.textContent='Chargement du modèle…';
  try{
    const floating=floatingInput.checked;
    const preferred=files.find(f=>/\.(glb|gltf|obj)$/i.test(f.name))?.name||files[0].name;
    const actor=await world.addModelFromFiles(files,{id:assetName.value||undefined,position:[0,0,-6],scale:1,floating,preferredName:preferred});
    editor.select(actor.id);status.textContent=`${actor.id} chargé · textures conservées`;
  }catch(err){console.error(err);status.textContent=`Erreur: ${err.message}`;}
});

document.querySelector('#add-procedural').addEventListener('click',async()=>{
  const boat=await world.addProceduralBoat({id:`boat-${world.objects.size+1}`,position:[-3-world.objects.size,0,-7]});
  editor.select(boat.id);
});

document.querySelector('#remove-object').addEventListener('click',()=>{
  if(!editor.selectedId)return;const id=editor.selectedId;timeline.removeObjectReferences(id);world.removeObject(id);
});

const weatherGrid=document.querySelector('.weather-grid');
const oceanModeLabel=document.createElement('label');
oceanModeLabel.innerHTML='Modèle de mer <select id="ocean-mode"><option value="standard">Standard · LOD léger</option><option value="geometric">Houle géométrique · maillage fin</option></select>';
const waveHeightLabel=document.createElement('label');
waveHeightLabel.innerHTML='Hauteur houle <input id="wave-height" data-weather="waveHeight" type="range" min="0" max="15" step=".1" value=".35">';
weatherGrid.prepend(waveHeightLabel);weatherGrid.prepend(oceanModeLabel);
const oceanMode=document.querySelector('#ocean-mode');oceanMode.value=world.ocean.mode;
oceanMode.addEventListener('change',()=>world.ocean.setMode(oceanMode.value));

for(const input of document.querySelectorAll('[data-weather]')){
  input.addEventListener('input',()=>{world.weather.state[input.dataset.weather]=Number(input.value);if(input.dataset.weather==='waveHeight')world.ocean.setWaveHeight(Number(input.value));});
}

world.onTick=(_dt,s)=>{
  document.querySelector('#wave-value').textContent=`${Number(s.waveHeight).toFixed(1).replace('.',',')} m`;
  document.querySelector('#wind-value').textContent=Math.round(s.wind)+' m/s';
  document.querySelector('#rain-value').textContent=Math.round(s.rain*100)+' %';
  for(const input of document.querySelectorAll('[data-weather]'))if(document.activeElement!==input&&input.dataset.weather in s)input.value=s[input.dataset.weather];
  bindingOffsets.updateInspector();
};

document.querySelector('#weather-calm').addEventListener('click',()=>world.weather.transitionTo({storm:0,rain:0,wind:3,cloud:.12,waveHeight:.35},2.5));
document.querySelector('#weather-storm').addEventListener('click',()=>world.weather.transitionTo({storm:1,rain:1,wind:18,cloud:.95,waveHeight:8},4));

world.setViewMode('editor');
window.sceneApp={world,timeline,editor,bindingOffsets};
