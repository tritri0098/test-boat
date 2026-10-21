import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Ocean } from './Ocean.js';
import { Boat, createProceduralBoat } from './Boat.js';
import { SceneActor } from './SceneActor.js';
import { ModelLoader } from './ModelLoader.js';
import { CameraController } from './CameraController.js';
import { CameraManager } from './CameraManager.js';
import { EffectsManager } from './EffectsManager.js';
import { Rain } from './Rain.js';
import { Weather } from './Weather.js';

export class OceanWorld{
  constructor(viewport){
    this.viewport=viewport;this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2(0xbad8e3,.009);
    this.camera=new THREE.PerspectiveCamera(46,16/9,.05,1000);this.camera.position.set(0,2.7,10.8);
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;viewport.prepend(this.renderer.domElement);

    const pmrem=new THREE.PMREMGenerator(this.renderer);this.scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;this.scene.environmentIntensity=.55;pmrem.dispose();

    this.cameraController=new CameraController(this.camera,this.renderer.domElement);this.cameraController.setPose({position:[0,2.7,10.8],target:[0,.8,-6]});
    this.cameraManager=new CameraManager({scene:this.scene,renderer:this.renderer,editorCamera:this.camera,viewport});
    this.ocean=new Ocean();this.scene.add(this.ocean.mesh);this.weather=new Weather();this.rain=new Rain(this.scene);this.loader=new ModelLoader(this.renderer);
    this.objects=new Map();this.boats=new Map();this.activeObjectId=null;this.timeline=null;
    this.effects=new EffectsManager(this.scene,{resolveTarget:(id)=>this.getEffectTarget(id)});
    this.onObjectsChanged=null;this.onTick=null;this.onViewModeChanged=null;

    this.#createSky();this.#createLights();this.#createClouds();
    this.running=true;this.time=0;this.last=performance.now();
    this.#resize();this.resizeObserver=new ResizeObserver(()=>this.#resize());this.resizeObserver.observe(viewport);
    requestAnimationFrame(t=>this.#frame(t));
  }

  setTimeline(timeline){
    this.timeline=timeline;
    timeline.onCameraCut=(id)=>{if(id)this.cameraManager.setActiveCamera(id);};
  }

  setViewMode(mode){
    const normalized=mode==='cinematic'?'cinematic':'editor';
    this.cameraManager.setMode(normalized);this.cameraController.controls.enabled=normalized==='editor';
    if(normalized==='cinematic'){
      const cut=this.timeline?.cameraAt(this.timeline.time);if(cut)this.cameraManager.setActiveCamera(cut);
      else if(!this.cameraManager.activeId&&this.cameraManager.cameras.size)this.cameraManager.setActiveCamera(this.cameraManager.cameras.keys().next().value);
    }
    this.onViewModeChanged?.(normalized);return normalized;
  }

  get viewMode(){return this.cameraManager.mode;}
  getRenderCamera(){return this.cameraManager.getRenderCamera();}

  async addProceduralBoat({id=`boat-${this.objects.size+1}`,position=[3,0,-5],scale=.94}={}){return this.#registerBoat({id,visual:createProceduralBoat(),position,scale});}
  async addBoatFromUrl({id,url,mtlUrl=null,position=[0,0,-5],scale=1}){const visual=await this.loader.fromUrl({url,mtlUrl});return this.#registerBoat({id:id||`boat-${this.objects.size+1}`,visual,position,scale});}
  async addModelFromFiles(files,{id,position=[0,0,-5],scale=1,floating=true,preferredName=null}={}){const visual=await this.loader.fromLocalFiles(files,preferredName);const objectId=this.#uniqueId(id||preferredName||Array.from(files)[0]?.name||`object-${this.objects.size+1}`);return floating?this.#registerBoat({id:objectId,visual,position,scale}):this.#registerActor({id:objectId,visual,position,scale});}
  async addBoatFromFile(file,options={}){return this.addModelFromFiles([file],{...options,floating:true,preferredName:file.name});}

  addCinematicCamera({id=`camera-${this.cameraManager.cameras.size+1}`,position=null,target=null,...lens}={}){
    id=this.#uniqueId(id);
    const p=position||this.camera.position.toArray();const t=target||this.cameraController.controls.target.toArray();
    const actor=this.cameraManager.createCamera({id,position:p,target:t,...lens});this.objects.set(id,actor);if(!this.activeObjectId)this.activeObjectId=id;this.cameraManager.setActiveCamera(id);this.onObjectsChanged?.();return actor;
  }

  getEditableObject(id){return this.objects.get(id)?.object||null;}
  getEffectTarget(id){const actor=this.objects.get(id);return actor?.floatRoot||actor?.object||null;}
  get activeObject(){return this.objects.get(this.activeObjectId)||null;}
  get activeBoat(){return this.boats.get(this.activeObjectId)||null;}
  setActiveObject(id){if(this.objects.has(id)){this.activeObjectId=id;if(this.objects.get(id)?.kind==='camera')this.cameraManager.setActiveCamera(id);}}
  setActiveBoat(id){this.setActiveObject(id);}

  removeObject(id){
    const actor=this.objects.get(id);if(!actor)return;
    if(actor.kind==='camera')this.cameraManager.removeCamera(id);else actor.dispose();
    this.objects.delete(id);this.boats.delete(id);if(this.activeObjectId===id)this.activeObjectId=this.objects.keys().next().value||null;this.onObjectsChanged?.();
  }
  removeBoat(id){this.removeObject(id);}
  togglePause(){this.running=!this.running;return this.running;}

  #uniqueId(base){let id=String(base).replace(/\.[^.]+$/,'')||'object';let n=2,root=id;while(this.objects.has(id))id=`${root}-${n++}`;return id;}
  #registerBoat({id,visual,position,scale}){id=this.#uniqueId(id);const boat=new Boat({id,visual,ocean:this.ocean,scene:this.scene,position,scale});boat.kind='boat';this.objects.set(id,boat);this.boats.set(id,boat);if(!this.activeObjectId)this.activeObjectId=id;this.onObjectsChanged?.();return boat;}
  #registerActor({id,visual,position,scale}){id=this.#uniqueId(id);const actor=new SceneActor({id,visual,scene:this.scene,position,scale});actor.kind='object';this.objects.set(id,actor);if(!this.activeObjectId)this.activeObjectId=id;this.onObjectsChanged?.();return actor;}

  #createLights(){
    this.hemi=new THREE.HemisphereLight(0xdff4ff,0x263d4d,1.8);this.scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight(0xffe8b9,4.1);this.sun.position.set(10,13,7);this.sun.castShadow=true;this.sun.shadow.mapSize.set(1024,1024);this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=70;this.sun.shadow.camera.left=-18;this.sun.shadow.camera.right=18;this.sun.shadow.camera.top=18;this.sun.shadow.camera.bottom=-18;this.scene.add(this.sun);
  }

  #createSky(){
    this.skyUniforms={uStorm:{value:0},uSun:{value:new THREE.Vector3(.35,.48,.8).normalize()}};
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(600,36,20),new THREE.ShaderMaterial({depthWrite:false,side:THREE.BackSide,uniforms:this.skyUniforms,vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`uniform float uStorm;uniform vec3 uSun;varying vec3 p;void main(){vec3 d=normalize(p);float y=d.y*.5+.5;vec3 c=mix(mix(vec3(.80,.92,.98),vec3(.22,.60,.88),smoothstep(.18,.9,y)),mix(vec3(.38,.42,.46),vec3(.08,.11,.15),smoothstep(.18,.9,y)),uStorm);float disc=pow(max(dot(d,uSun),0.),900.);float glow=pow(max(dot(d,uSun),0.),42.);c+=vec3(1.,.78,.42)*(disc*2.6+glow*.18)*(1.-uStorm*.72);gl_FragColor=vec4(c,1.);}`}));this.sky.frustumCulled=false;this.scene.add(this.sky);
  }

  #createClouds(){
    this.cloudAnchor=new THREE.Group();this.scene.add(this.cloudAnchor);this.clouds=[];
    const geo=new THREE.SphereGeometry(1,14,10);this.cloudMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,transparent:true,opacity:.84});
    const add=(x,y,z,s)=>{const g=new THREE.Group();[[0,0,0,1.25],[1.1,.15,.05,.95],[-1.05,.07,.12,.82],[.24,.58,.1,.92]].forEach(p=>{const m=new THREE.Mesh(geo,this.cloudMaterial);m.position.set(p[0],p[1],p[2]);m.scale.set(p[3]*1.5,p[3]*.62,p[3]);g.add(m);});g.position.set(x,y,z);g.scale.setScalar(s);this.cloudAnchor.add(g);this.clouds.push(g);};
    add(-20,9,-28,1.5);add(3,11,-35,1.1);add(21,8,-24,1.25);add(-4,15,-48,2.0);add(28,13,-52,1.8);
  }

  #resize(){const r=this.viewport.getBoundingClientRect();if(!r.width||!r.height)return;this.renderer.setSize(r.width,r.height,false);this.cameraManager.resize(r.width,r.height);}

  #frame(now){
    const rawDt=Math.min(.033,(now-this.last)/1000||0);this.last=now;const dt=this.running?rawDt:0;if(this.running)this.time+=dt;
    if(this.running)this.timeline?.update(dt);
    this.cameraController.update(dt||.0001);
    const renderCamera=this.getRenderCamera();const s=this.weather.state;

    this.scene.fog.color.setRGB(.73-s.storm*.34,.84-s.storm*.42,.88-s.storm*.46);this.scene.fog.density=.009+s.storm*.017;
    this.ocean.update(this.time,s.storm,renderCamera.position,this.scene.fog);
    this.skyUniforms.uStorm.value=s.storm;this.sky.position.copy(renderCamera.position);
    this.hemi.intensity=1.8-s.storm*.65;this.sun.intensity=4.1-s.storm*3.15;this.scene.environmentIntensity=.55-s.storm*.2;
    this.cloudMaterial.color.setRGB(1-s.storm*.46,1-s.storm*.44,1-s.storm*.40);
    this.cloudAnchor.position.set(renderCamera.position.x,0,renderCamera.position.z);
    for(let i=0;i<this.clouds.length;i++){const c=this.clouds[i];c.position.x+=dt*(.08+i*.018)*(1+s.wind*.08);if(c.position.x>42)c.position.x=-42;}

    for(const actor of this.objects.values())actor.update(this.time,s.storm,dt||.0001);
    this.rain.update(dt,s.rain,s.wind,renderCamera);
    this.effects.update(this.timeline?.time??this.time,this.timeline?.effects??[]);
    this.cameraManager.render();
    this.onTick?.(dt,s);requestAnimationFrame(t=>this.#frame(t));
  }
}
