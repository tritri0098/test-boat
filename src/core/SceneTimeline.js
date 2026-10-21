import * as THREE from 'three';

const clamp01=(v)=>Math.max(0,Math.min(1,v));
const smooth=(v)=>{v=clamp01(v);return v*v*(3-2*v);};
const lerp=(a,b,t)=>THREE.MathUtils.lerp(Number(a)||0,Number(b)||0,t);
const uid=(prefix)=>crypto.randomUUID?.()??`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function snapshot(object){
  const out={
    position:object.position.toArray(),
    quaternion:object.quaternion.toArray(),
    scale:object.scale.toArray()
  };
  if(object.isPerspectiveCamera){
    const s=object.userData.cameraSettings||{};
    out.camera={
      focalLength:object.getFocalLength(),
      zoom:object.zoom,
      focusDistance:Number(s.focusDistance)||12,
      aperture:Number(s.aperture)||0,
      maxBlur:Number(s.maxBlur)||0,
      dofEnabled:Boolean(s.dofEnabled)
    };
  }
  return out;
}

function easing(name,t){
  if(name==='step')return t<1?0:1;
  if(name==='smooth')return smooth(t);
  if(name==='easeIn')return t*t;
  if(name==='easeOut')return 1-(1-t)*(1-t);
  return t;
}

function cloneFrame(frame){
  return {
    ...frame,
    id:frame.id||uid('key'),
    position:[...(frame.position||[0,0,0])],
    quaternion:[...(frame.quaternion||[0,0,0,1])],
    scale:[...(frame.scale||[1,1,1])],
    camera:frame.camera?{...frame.camera}:undefined
  };
}

export class SceneTimeline{
  constructor({resolveObject,duration=12,loop=false}={}){
    this.resolveObject=resolveObject;
    this.duration=duration;
    this.loop=loop;
    this.time=0;
    this.playing=false;
    this.rate=1;
    this.tracks=new Map();
    this.bindings=[];
    this.cameraCuts=[];
    this.effects=[];
    this.onChange=null;
    this.onTime=null;
    this.onCameraCut=null;
    this._lastCameraId=null;
  }

  ensureTrack(id){if(!this.tracks.has(id))this.tracks.set(id,[]);return this.tracks.get(id);}

  snapshotObject(id){
    const object=this.resolveObject(id);
    if(!object)throw new Error(`Objet introuvable: ${id}`);
    return snapshot(object);
  }

  getKeyframe(id,frameId){return this.tracks.get(id)?.find(k=>k.id===frameId)||null;}

  findKeyframeNear(id,time=this.time,tolerance=.12){
    const track=this.tracks.get(id)||[];
    let best=null,bestDistance=Infinity;
    for(const frame of track){
      const d=Math.abs(frame.time-time);
      if(d<bestDistance){best=frame;bestDistance=d;}
    }
    return bestDistance<=tolerance?best:null;
  }

  captureKeyframe(id,time=this.time,{interpolation='smooth'}={}){
    const object=this.resolveObject(id);
    if(!object)throw new Error(`Objet introuvable: ${id}`);
    return this.addKeyframe(id,{time,...snapshot(object),interpolation});
  }

  addKeyframe(id,frame){
    const track=this.ensureTrack(id);
    const normalized=this.#normalizeFrame(frame);
    const existing=track.findIndex(k=>Math.abs(k.time-normalized.time)<1e-4);
    if(existing>=0){
      normalized.id=track[existing].id||normalized.id;
      track[existing]=normalized;
    }else track.push(normalized);
    track.sort((a,b)=>a.time-b.time);
    this.onChange?.();
    return normalized;
  }

  updateKeyframe(id,frameId,patch,{evaluate=true}={}){
    const track=this.tracks.get(id);
    if(!track)throw new Error(`Piste introuvable: ${id}`);
    const index=track.findIndex(k=>k.id===frameId);
    if(index<0)throw new Error('Keyframe introuvable.');
    const current=track[index];
    const candidate=this.#normalizeFrame({...current,...patch,id:current.id});
    const collision=track.find((k,i)=>i!==index&&Math.abs(k.time-candidate.time)<1e-4);
    if(collision)throw new Error(`Une autre keyframe de ${id} existe déjà à ${candidate.time.toFixed(3)} s.`);
    track[index]=candidate;
    track.sort((a,b)=>a.time-b.time);
    this.onChange?.();
    if(evaluate)this.evaluate(this.time);
    return candidate;
  }

  updateKeyframeFromObject(id,frameId,{time=null,interpolation=null}={}){
    const object=this.resolveObject(id);
    if(!object)throw new Error(`Objet introuvable: ${id}`);
    const current=this.getKeyframe(id,frameId);
    if(!current)throw new Error('Keyframe introuvable.');
    return this.updateKeyframe(id,frameId,{
      ...snapshot(object),
      time:time??current.time,
      interpolation:interpolation??current.interpolation
    });
  }

  removeKeyframeById(id,frameId){
    const track=this.tracks.get(id);if(!track)return false;
    const index=track.findIndex(k=>k.id===frameId);if(index<0)return false;
    track.splice(index,1);this.onChange?.();return true;
  }

  removeKeyframe(id,time,tolerance=.12){
    const frame=this.findKeyframeNear(id,time,tolerance);
    return frame?this.removeKeyframeById(id,frame.id):false;
  }

  previewFrame(id,frame,time=this.time){
    const object=this.resolveObject(id);
    if(!object)return;
    this.#applyFrame(object,frame);
    this.applyBindings(time);
  }

  addBinding({childId,targetId,start=this.time,end=this.time+2,blend=.25,axes=[true,true,true],followRotation=false,offset=null}={}){
    if(!childId||!targetId||childId===targetId)throw new Error('Choisis deux objets différents.');
    const child=this.resolveObject(childId),target=this.resolveObject(targetId);
    if(!child||!target)throw new Error('Objet de liaison introuvable.');
    const childWorld=new THREE.Vector3(),targetWorld=new THREE.Vector3();
    child.getWorldPosition(childWorld);target.getWorldPosition(targetWorld);
    const binding={
      id:uid('binding'),
      childId,targetId,
      start:Math.max(0,Number(start)||0),end:Math.min(this.duration,Number(end)||0),
      blend:Math.max(0,Number(blend)||0),axes:[...axes],followRotation:Boolean(followRotation),
      offset:offset?[...offset]:childWorld.sub(targetWorld).toArray()
    };
    if(binding.end<=binding.start)throw new Error('La fin de liaison doit être après le début.');
    this.bindings.push(binding);this.onChange?.();this.evaluate(this.time);return binding;
  }

  removeBinding(id){
    const n=this.bindings.length;this.bindings=this.bindings.filter(b=>b.id!==id);
    if(this.bindings.length!==n){this.onChange?.();this.evaluate(this.time);}
  }

  activeBindingsAt(time=this.time){return this.bindings.filter(b=>time>=b.start&&time<=b.end);}
  isBound(id,time=this.time){return this.activeBindingsAt(time).some(b=>b.childId===id);}

  applyBindings(time=this.time){
    const active=this.activeBindingsAt(time);
    if(!active.length)return;

    const byChild=new Map();
    for(const binding of active){
      if(!byChild.has(binding.childId))byChild.set(binding.childId,[]);
      byChild.get(binding.childId).push(binding);
    }
    const ordered=[];
    const permanent=new Set(),temporary=new Set();
    const visit=(binding)=>{
      if(permanent.has(binding.id))return;
      if(temporary.has(binding.id))return;
      temporary.add(binding.id);
      for(const dependency of byChild.get(binding.targetId)||[])visit(dependency);
      temporary.delete(binding.id);permanent.add(binding.id);ordered.push(binding);
    };
    for(const binding of active)visit(binding);
    for(const binding of ordered)this.#applyBinding(binding,time);
  }

  addCameraCut(cameraId,time=this.time){
    const object=this.resolveObject(cameraId);
    if(!object?.isPerspectiveCamera)throw new Error('La coupe doit cibler une caméra cinématique.');
    const cut={id:uid('cut'),cameraId,time:Math.max(0,Math.min(this.duration,Number(time)||0))};
    const existing=this.cameraCuts.findIndex(c=>Math.abs(c.time-cut.time)<1e-4);
    if(existing>=0)this.cameraCuts[existing]=cut;else this.cameraCuts.push(cut);
    this.cameraCuts.sort((a,b)=>a.time-b.time);
    this._lastCameraId=null;this.onChange?.();this.#evaluateCameraCut(this.time);return cut;
  }

  removeCameraCut(id){
    const n=this.cameraCuts.length;this.cameraCuts=this.cameraCuts.filter(c=>c.id!==id);
    if(this.cameraCuts.length!==n){this._lastCameraId=null;this.onChange?.();this.#evaluateCameraCut(this.time);}
  }

  removeCameraCutNear(time=this.time,tolerance=.2){
    const cut=this.cameraCuts.reduce((best,c)=>Math.abs(c.time-time)<Math.abs((best?.time??Infinity)-time)?c:best,null);
    if(cut&&Math.abs(cut.time-time)<=tolerance){this.removeCameraCut(cut.id);return true;}return false;
  }

  cameraAt(time=this.time){
    if(!this.cameraCuts.length)return null;
    let current=this.cameraCuts[0].cameraId;
    for(const cut of this.cameraCuts){if(cut.time<=time+1e-6)current=cut.cameraId;else break;}
    return current;
  }

  addEffect({type='explosion',targetId=null,start=this.time,end=null,offset=[0,0,0],direction=[0,0,1],size=1,intensity=1}={}){
    const duration=type==='explosion'?1.15:3;
    const effect={
      id:uid('fx'),
      type:type==='rocketFlame'?'rocketFlame':'explosion',
      targetId:targetId||null,
      start:Math.max(0,Number(start)||0),
      end:Math.min(this.duration,Number(end??((Number(start)||0)+duration))),
      offset:[...offset].map(v=>Number(v)||0),
      direction:[...direction].map(v=>Number(v)||0),
      size:Math.max(.01,Number(size)||1),
      intensity:Math.max(0,Number(intensity)||1)
    };
    if(effect.end<=effect.start)throw new Error("La fin de l'effet doit être après le début.");
    if(effect.targetId&&!this.resolveObject(effect.targetId))throw new Error(`Cible d'effet introuvable: ${effect.targetId}`);
    this.effects.push(effect);this.onChange?.();return effect;
  }

  removeEffect(id){const n=this.effects.length;this.effects=this.effects.filter(f=>f.id!==id);if(this.effects.length!==n)this.onChange?.();}

  removeObjectReferences(id){
    this.tracks.delete(id);
    this.bindings=this.bindings.filter(b=>b.childId!==id&&b.targetId!==id);
    this.cameraCuts=this.cameraCuts.filter(c=>c.cameraId!==id);
    this.effects=this.effects.filter(f=>f.targetId!==id);
    this._lastCameraId=null;this.onChange?.();
  }

  setDuration(seconds){
    this.duration=Math.max(.1,Number(seconds)||12);this.time=Math.min(this.time,this.duration);
    for(const track of this.tracks.values())for(const k of track)k.time=Math.min(k.time,this.duration);
    this.bindings=this.bindings.filter(b=>b.start<this.duration).map(b=>({...b,end:Math.min(b.end,this.duration)}));
    this.cameraCuts=this.cameraCuts.filter(c=>c.time<=this.duration);
    this.effects=this.effects.filter(f=>f.start<this.duration).map(f=>({...f,end:Math.min(f.end,this.duration)}));
    this.onChange?.();this.setTime(this.time);
  }

  setTime(time,evaluate=true){this.time=Math.max(0,Math.min(this.duration,Number(time)||0));if(evaluate)this.evaluate(this.time);this.onTime?.(this.time);}
  play(){this.playing=true;}
  pause(){this.playing=false;}
  toggle(){this.playing=!this.playing;return this.playing;}

  update(dt){
    if(!this.playing)return;
    let next=this.time+dt*this.rate;
    if(next>this.duration){if(this.loop)next=next%this.duration;else{next=this.duration;this.playing=false;}}
    this.setTime(next,true);
  }

  evaluate(time=this.time){
    for(const [id,track] of this.tracks){const object=this.resolveObject(id);if(!object||!track.length)continue;this.#evaluateTrack(object,track,time);}
    this.applyBindings(time);
    this.#evaluateCameraCut(time);
  }

  #normalizeFrame(frame){
    return {
      id:frame.id||uid('key'),
      time:Math.max(0,Math.min(this.duration,Number(frame.time)||0)),
      position:[...(frame.position||[0,0,0])],
      quaternion:[...(frame.quaternion||[0,0,0,1])],
      scale:[...(frame.scale||[1,1,1])],
      interpolation:frame.interpolation||'smooth',
      camera:frame.camera?{...frame.camera}:undefined
    };
  }

  #evaluateTrack(object,track,time){
    if(track.length===1||time<=track[0].time){this.#applyFrame(object,track[0]);return;}
    const last=track[track.length-1];if(time>=last.time){this.#applyFrame(object,last);return;}
    let a=track[0],b=last;
    for(let i=0;i<track.length-1;i++)if(time>=track[i].time&&time<=track[i+1].time){a=track[i];b=track[i+1];break;}
    const raw=(time-a.time)/Math.max(1e-6,b.time-a.time),t=easing(a.interpolation,raw);
    object.position.set(lerp(a.position[0],b.position[0],t),lerp(a.position[1],b.position[1],t),lerp(a.position[2],b.position[2],t));
    const qa=new THREE.Quaternion(...a.quaternion),qb=new THREE.Quaternion(...b.quaternion);object.quaternion.copy(qa).slerp(qb,t);
    object.scale.set(lerp(a.scale[0],b.scale[0],t),lerp(a.scale[1],b.scale[1],t),lerp(a.scale[2],b.scale[2],t));
    if(object.isPerspectiveCamera&&(a.camera||b.camera))this.#applyCameraInterpolation(object,a.camera||b.camera,b.camera||a.camera,t);
  }

  #applyFrame(object,frame){
    object.position.fromArray(frame.position);object.quaternion.fromArray(frame.quaternion);object.scale.fromArray(frame.scale);
    if(object.isPerspectiveCamera&&frame.camera)this.#applyCameraInterpolation(object,frame.camera,frame.camera,0);
  }

  #applyCameraInterpolation(camera,a,b,t){
    const current=camera.userData.cameraSettings??={};
    const focal=lerp(a.focalLength,b.focalLength,t),zoom=lerp(a.zoom,b.zoom,t);
    current.focusDistance=lerp(a.focusDistance,b.focusDistance,t);
    current.aperture=lerp(a.aperture,b.aperture,t);
    current.maxBlur=lerp(a.maxBlur,b.maxBlur,t);
    current.dofEnabled=t<.5?Boolean(a.dofEnabled):Boolean(b.dofEnabled);
    current.focalLength=focal;current.zoom=zoom;
    camera.setFocalLength(Math.max(1,focal));camera.zoom=Math.max(.05,zoom);camera.updateProjectionMatrix();
  }

  #applyBinding(binding,time){
    if(time<binding.start||time>binding.end)return;
    const child=this.resolveObject(binding.childId),target=this.resolveObject(binding.targetId);if(!child||!target)return;
    const blend=Math.min(binding.blend,(binding.end-binding.start)/2);let weight=1;
    if(blend>0){if(time<binding.start+blend)weight=smooth((time-binding.start)/blend);else if(time>binding.end-blend)weight=smooth((binding.end-time)/blend);}
    const cw=new THREE.Vector3(),tw=new THREE.Vector3(),desired=new THREE.Vector3();child.getWorldPosition(cw);target.getWorldPosition(tw);desired.copy(tw).add(new THREE.Vector3(...binding.offset));
    if(!binding.axes[0])desired.x=cw.x;if(!binding.axes[1])desired.y=cw.y;if(!binding.axes[2])desired.z=cw.z;desired.lerp(cw,1-weight);
    if(child.parent){child.parent.worldToLocal(desired);child.position.copy(desired);}else child.position.copy(desired);
    if(binding.followRotation){const cq=new THREE.Quaternion(),tq=new THREE.Quaternion();child.getWorldQuaternion(cq);target.getWorldQuaternion(tq);cq.slerp(tq,weight);if(child.parent){const pq=new THREE.Quaternion();child.parent.getWorldQuaternion(pq);child.quaternion.copy(pq.invert().multiply(cq));}else child.quaternion.copy(cq);}
  }

  #evaluateCameraCut(time){
    const id=this.cameraAt(time);
    if(id!==this._lastCameraId){this._lastCameraId=id;this.onCameraCut?.(id,time);}
  }

  toJSON(){return {version:3,duration:this.duration,loop:this.loop,tracks:Object.fromEntries([...this.tracks].map(([id,frames])=>[id,frames.map(cloneFrame)])),bindings:this.bindings,cameraCuts:this.cameraCuts,effects:this.effects};}

  load(data){
    if(!data||![1,2,3].includes(data.version))throw new Error('Format de timeline non reconnu.');
    this.duration=Math.max(.1,Number(data.duration)||12);this.loop=Boolean(data.loop);
    this.tracks=new Map(Object.entries(data.tracks||{}).map(([id,frames])=>[id,frames.map(f=>this.#normalizeFrame(cloneFrame(f))).sort((a,b)=>a.time-b.time)]));
    this.bindings=(data.bindings||[]).map(b=>({...b,id:b.id||uid('binding'),axes:[...(b.axes||[true,true,true])],offset:[...(b.offset||[0,0,0])]}));
    this.cameraCuts=(data.cameraCuts||[]).map(c=>({...c,id:c.id||uid('cut')})).sort((a,b)=>a.time-b.time);
    this.effects=(data.effects||[]).map(f=>({...f,id:f.id||uid('fx'),offset:[...(f.offset||[0,0,0])],direction:[...(f.direction||[0,0,1])]}));
    this.time=0;this.playing=false;this._lastCameraId=null;this.onChange?.();this.setTime(0,true);
  }
}
