import { OceanWorld } from './core/OceanWorld.js';
import { SceneTimeline } from './core/SceneTimeline.js';
import { SCENE_CHANNEL } from './core/SceneSync.js';

const viewport=document.querySelector('#detached-viewport');
const status=document.querySelector('#detached-status');
const world=new OceanWorld(viewport);
const timeline=new SceneTimeline({resolveObject:(id)=>world.getEditableObject(id),duration:12,loop:false});
world.setTimeline(timeline);world.setViewMode('cinematic');

const channel=new BroadcastChannel(SCENE_CHANNEL);
let initialized=false,rebuildToken=0;

function applyTransform(object,t){
  object.position.fromArray(t?.position||[0,0,0]);
  object.quaternion.fromArray(t?.quaternion||[0,0,0,1]);
  object.scale.fromArray(t?.scale||[1,1,1]);
  object.updateMatrixWorld(true);
}

function applyOcean(state){
  if(!state)return;
  if(state.mode)world.ocean.setMode(state.mode);
  if(Number.isFinite(Number(state.waveHeight))){
    world.weather.state.waveHeight=Number(state.waveHeight);
    world.ocean.setWaveHeight(Number(state.waveHeight));
  }
}

async function rebuild(state){
  const token=++rebuildToken;status.textContent='Synchronisation de la scène…';
  for(const id of [...world.objects.keys()])world.removeObject(id);

  for(const desc of state.objects||[]){
    if(token!==rebuildToken)return;
    let actor;
    if(desc.kind==='camera')actor=world.addCinematicCamera({id:desc.id,position:desc.transform?.position||[0,2.7,10.8],...desc.lens});
    else if(desc.source==='local')actor=await world.addModelFromFiles(desc.files||[],{id:desc.id,position:desc.transform?.position||[0,0,-6],scale:1,floating:desc.floating!==false,preferredName:desc.preferredName||undefined});
    else actor=await world.addProceduralBoat({id:desc.id,position:desc.transform?.position||[0,0,-6],scale:1});
    applyTransform(actor.object,desc.transform);
  }

  if(token!==rebuildToken)return;
  timeline.load(state.timeline||{version:5,duration:12,tracks:{},bindings:[],oceanFollows:[],cameraCuts:[],effects:[]});
  timeline.setTime(Number(state.time)||0,true);state.playing?timeline.play():timeline.pause();
  Object.assign(world.weather.state,state.weather||{});applyOcean(state.ocean);
  if(state.activeCamera)world.cameraManager.setActiveCamera(state.activeCamera);
  world.setViewMode('cinematic');initialized=true;status.textContent='Synchronisé';
}

channel.addEventListener('message',(event)=>{
  const msg=event.data||{};
  if(msg.type==='full-state'){rebuild(msg).catch(err=>{console.error(err);status.textContent=`Erreur: ${err.message}`;});return;}
  if(!initialized)return;

  if(msg.type==='timeline'){
    const current=Number(msg.time)||0;timeline.load(msg.timeline);timeline.setTime(current,true);msg.playing?timeline.play():timeline.pause();return;
  }

  if(msg.type==='pose'){
    if(!world.getEditableObject(msg.id))return;
    if(msg.persist)timeline.setManualBase(msg.id,msg.base,{evaluate:false});
    timeline.previewBaseSnapshot(msg.id,msg.base,Number(msg.time)||timeline.time);return;
  }

  if(msg.type==='clock'){
    Object.assign(world.weather.state,msg.weather||{});applyOcean(msg.ocean);
    if(msg.activeCamera)world.cameraManager.setActiveCamera(msg.activeCamera);
    const t=Number(msg.time)||0;if(Math.abs(timeline.time-t)>.06)timeline.setTime(t,true);
    msg.playing?timeline.play():timeline.pause();
    status.textContent=`${timeline.time.toFixed(2)} s · ${msg.activeCamera||'caméra'} · ${world.ocean.mode==='geometric'?'houle géométrique':'mer standard'} · ${world.ocean.waveHeight.toFixed(1)} m`;
  }
});

document.querySelector('#detached-fullscreen').addEventListener('click',()=>document.documentElement.requestFullscreen?.());
channel.postMessage({type:'request-full-state'});
window.addEventListener('beforeunload',()=>channel.close());
