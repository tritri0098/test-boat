import { OceanWorld } from './core/OceanWorld.js';
import { SlideDeck } from './core/SlideDeck.js';
import { numberControl } from './ui/controls.js';

const ASSETS_BASE = new URL('../assets/', import.meta.url);

const viewport=document.querySelector('#viewport');
const status=document.querySelector('#webgl-status');
const sceneTitle=document.querySelector('#scene-title');
const sceneSubtitle=document.querySelector('#scene-subtitle');
const waveValue=document.querySelector('#wave-value');
const windValue=document.querySelector('#wind-value');
const rainValue=document.querySelector('#rain-value');
const boatCount=document.querySelector('#boat-count');
const boatSelect=document.querySelector('#boat-select');

if (!document.createElement('canvas').getContext('webgl2')) {
  status.textContent='WebGL2 indisponible';
  throw new Error('WebGL2 indisponible');
}

const world=new OceanWorld(viewport);
await world.addProceduralBoat({ id:'main', position:[3.1,0,-5.4], scale:0.94 });
status.textContent='WebGL2 ✅ · Three.js ✅';

const scenes=[
  {
    id:'calm', label:'Ciel clair', duration:3.2,
    weather:{storm:0,rain:0,wind:3,cloud:.12},
    camera:{position:[0,2.7,10.8],target:[0,.8,-6]}, cameraMode:'orbit'
  },
  {
    id:'storm', label:'Tempête', duration:4.2,
    weather:{storm:1,rain:1,wind:18,cloud:.95},
    camera:{position:[1.4,2.0,8.0],target:[1,.7,-5.5]}, cameraMode:'orbit'
  },
  {
    id:'cinematic', label:'Plan cinématique', duration:3.0,
    weather:{storm:.35,rain:.08,wind:7,cloud:.4},
    camera:{position:[5.2,1.7,6.6],target:[2.8,.8,-5.5]}, cameraMode:'orbit'
  }
];

const slides=new SlideDeck({world,scenes});
slides.onChange=(scene)=>{sceneTitle.textContent=scene.label;sceneSubtitle.textContent=`Scène: ${scene.id}`;};

function refreshBoatSelect(){
  const current=world.activeBoatId;
  boatSelect.innerHTML='';
  for(const [id] of world.boats){const o=document.createElement('option');o.value=id;o.textContent=id;boatSelect.append(o);}
  if(current&&world.boats.has(current))boatSelect.value=current;
  boatCount.textContent=String(world.boats.size);
}
refreshBoatSelect();

// Camera editor
const camWrap=document.querySelector('#camera-sliders');
const cameraInputs={
  x:numberControl(camWrap,{label:'Camera X',value:0,key:'x'}),
  y:numberControl(camWrap,{label:'Camera Y',value:2.7,key:'y'}),
  z:numberControl(camWrap,{label:'Camera Z',value:10.8,key:'z'}),
  tx:numberControl(camWrap,{label:'Target X',value:0,key:'tx'}),
  ty:numberControl(camWrap,{label:'Target Y',value:.8,key:'ty'}),
  tz:numberControl(camWrap,{label:'Target Z',value:-6,key:'tz'})
};

function applyCameraFromInputs(){
  const n=k=>Number(cameraInputs[k].value)||0;
  world.cameraController.setPose({position:[n('x'),n('y'),n('z')],target:[n('tx'),n('ty'),n('tz')]});
}
document.querySelector('#apply-camera').addEventListener('click',applyCameraFromInputs);
Object.values(cameraInputs).forEach(input=>input.addEventListener('input',applyCameraFromInputs));
document.querySelector('#reset-camera').addEventListener('click',()=>{
  world.cameraController.setPose({position:[0,2.7,10.8],target:[0,.8,-6]});
  Object.assign(cameraInputs,{ });
  cameraInputs.x.value=0;cameraInputs.y.value=2.7;cameraInputs.z.value=10.8;cameraInputs.tx.value=0;cameraInputs.ty.value=.8;cameraInputs.tz.value=-6;
});
document.querySelector('#camera-mode').addEventListener('change',(e)=>{
  world.cameraController.setMode(e.target.value,world.activeBoat);
  sceneSubtitle.textContent=e.target.value==='follow'?'Caméra: suivi du bateau':'Caméra: orbit libre';
});

// Boat editor
const boatWrap=document.querySelector('#boat-sliders');
const boatInputs={
  x:numberControl(boatWrap,{label:'Bateau X',value:3.1,key:'bx'}),
  z:numberControl(boatWrap,{label:'Bateau Z',value:-5.4,key:'bz'}),
  scale:numberControl(boatWrap,{label:'Scale',value:.94,step:.05,min:.01,max:100,key:'bs'})
};
function syncBoatInputs(){
  const b=world.activeBoat;if(!b)return;
  boatInputs.x.value=b.object.position.x.toFixed(2);boatInputs.z.value=b.object.position.z.toFixed(2);boatInputs.scale.value=b.object.scale.x.toFixed(2);
}
boatSelect.addEventListener('change',()=>{world.setActiveBoat(boatSelect.value);world.cameraController.followTarget=world.activeBoat;syncBoatInputs();});
function applyBoatFromInputs(){
  const b=world.activeBoat;if(!b)return;
  b.setXZ(Number(boatInputs.x.value)||0,Number(boatInputs.z.value)||0);
  const s=Math.max(.01,Number(boatInputs.scale.value)||1);b.object.scale.setScalar(s);
}
document.querySelector('#apply-boat').addEventListener('click',applyBoatFromInputs);
Object.values(boatInputs).forEach(input=>input.addEventListener('input',applyBoatFromInputs));
document.querySelector('#add-procedural').addEventListener('click',async()=>{
  const id=`boat-${world.boats.size+1}`;await world.addProceduralBoat({id,position:[-3-world.boats.size*1.5,0,-7-world.boats.size]});world.setActiveBoat(id);refreshBoatSelect();syncBoatInputs();
});
document.querySelector('#load-demo-obj').addEventListener('click',async()=>{
  const id=`obj-${world.boats.size+1}`;await world.addBoatFromUrl({id,url:new URL('models/demo_boat.obj', ASSETS_BASE).href,position:[-2,0,-8],scale:.8});world.setActiveBoat(id);refreshBoatSelect();syncBoatInputs();
});
document.querySelector('#model-file').addEventListener('change',async(e)=>{
  const file=e.target.files?.[0];if(!file)return;
  try{const b=await world.addBoatFromFile(file,{id:file.name,position:[-2,0,-8],scale:1});world.setActiveBoat(b.id);refreshBoatSelect();syncBoatInputs();status.textContent=`Modèle chargé: ${file.name}`;}catch(err){status.textContent=err.message;}
});
document.querySelector('#remove-boat').addEventListener('click',()=>{if(!world.activeBoatId)return;world.removeBoat(world.activeBoatId);refreshBoatSelect();syncBoatInputs();});

// Weather live editor
const weatherWrap=document.querySelector('#weather-sliders');
const weatherInputs={
  storm:numberControl(weatherWrap,{label:'Storm 0..1',value:0,step:.05,min:0,max:1,key:'storm'}),
  rain:numberControl(weatherWrap,{label:'Rain 0..1',value:0,step:.05,min:0,max:1,key:'rain'}),
  wind:numberControl(weatherWrap,{label:'Wind m/s',value:3,step:1,min:0,max:40,key:'wind'}),
  cloud:numberControl(weatherWrap,{label:'Cloud 0..1',value:.12,step:.05,min:0,max:1,key:'cloud'})
};
for(const [key,input] of Object.entries(weatherInputs))input.addEventListener('input',()=>{world.weather.state[key]=Number(input.value)||0;});

// Scene navigation
document.querySelector('#scene-calm').addEventListener('click',()=>slides.goTo('calm'));
document.querySelector('#scene-storm').addEventListener('click',()=>slides.goTo('storm'));
document.querySelector('#scene-cinematic').addEventListener('click',()=>slides.goTo('cinematic'));
document.querySelector('#prev-scene').addEventListener('click',()=>slides.prev());
document.querySelector('#next-scene').addEventListener('click',()=>slides.next());
document.querySelector('#pause').addEventListener('click',(e)=>{const running=world.togglePause();e.currentTarget.textContent=running?'Pause':'Reprendre';});

world.onTick=(_dt,s)=>{
  waveValue.textContent=(.2+s.storm*2.1).toFixed(1).replace('.',',')+' m';
  windValue.textContent=Math.round(s.wind)+' m/s';
  rainValue.textContent=Math.round(s.rain*100)+' %';
  weatherInputs.storm.value=s.storm.toFixed(2);weatherInputs.rain.value=s.rain.toFixed(2);weatherInputs.wind.value=s.wind.toFixed(1);weatherInputs.cloud.value=s.cloud.toFixed(2);
};

await slides.goTo('calm');
