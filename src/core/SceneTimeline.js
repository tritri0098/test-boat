import * as THREE from 'three';

const clamp01=(v)=>Math.max(0,Math.min(1,v));
const smooth=(v)=>{v=clamp01(v);return v*v*(3-2*v);};
const lerp=(a,b,t)=>THREE.MathUtils.lerp(Number(a)||0,Number(b)||0,t);
const uid=(prefix)=>crypto.randomUUID?.()??`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function snapshot(object){
  const out={position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()};
  if(object.isPerspectiveCamera){
    const s=object.userData.cameraSettings||{};
    out.camera={focalLength:object.getFocalLength(),zoom:object.zoom,focusDistance:Number(s.focusDistance)||12,aperture:Number(s.aperture)||0,maxBlur:Number(s.maxBlur)||0,dofEnabled:Boolean(s.dofEnabled)};
  }
  return out;
}

function cloneFrame(frame){
  return {...frame,id:frame.id||uid('key'),position:[...(frame.position||[0,0,0])],quaternion:[...(frame.quaternion||[0,0,0,1])],scale:[...(frame.scale||[1,1,1])],camera:frame.camera?{...frame.camera}:undefined};
}

function easing(name,t){
  if(name==='step')return t<1?0:1;
  if(name==='smooth')return smooth(t);
  if(name==='easeIn')return t*t;
  if(name==='easeOut')return 1-(1-t)*(1-t);
  return t;
}

function readWorld(object){
  object.updateMatrixWorld(true);
  const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
  object.matrixWorld.decompose(position,quaternion,scale);
  return {position,quaternion,scale};
}

function writeWorld(object,{position,quaternion,scale}){
  const m=new THREE.Matrix4().compose(position,quaternion,scale);
  if(object.parent){object.parent.updateMatrixWorld(true);m.premultiply(object.parent.matrixWorld.clone().invert());}
  m.decompose(object.position,object.quaternion,object.scale);object.updateMatrixWorld(true);
}

function worldToLocalSnapshot(object,world,cameraData=null){
  const m=new THREE.Matrix4().compose(world.position,world.quaternion,world.scale);
  if(object.parent){object.parent.updateMatrixWorld(true);m.premultiply(object.parent.matrixWorld.clone().invert());}
  const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();m.decompose(p,q,s);
  return {position:p.toArray(),quaternion:q.toArray(),scale:s.toArray(),camera:cameraData?{...cameraData}:undefined};
}

export class SceneTimeline{
  constructor({resolveObject,duration=12,loop=false}={}){
    this.resolveObject=resolveObject;this.duration=duration;this.loop=loop;this.time=0;this.playing=false;this.rate=1;
    this.tracks=new Map();this.bindings=[];this.oceanFollows=[];this.cameraCuts=[];this.effects=[];this.manualBases=new Map();
    this.onChange=null;this.onTime=null;this.onCameraCut=null;this._lastCameraId=null;
  }

  ensureTrack(id){if(!this.tracks.has(id))this.tracks.set(id,[]);return this.tracks.get(id);}
  getKeyframe(id,frameId){return this.tracks.get(id)?.find(k=>k.id===frameId)||null;}
  hasActiveBinding(id,time=this.time){return this.activeBindingsAt(time).some(b=>b.childId===id);}

  snapshotObject(id){const object=this.resolveObject(id);if(!object)throw new Error(`Objet introuvable: ${id}`);return snapshot(object);}

  snapshotEditableObject(id,time=this.time){
    const object=this.resolveObject(id);if(!object)throw new Error(`Objet introuvable: ${id}`);
    if(!this.hasActiveBinding(id,time))return snapshot(object);

    const world=readWorld(object);
    const direct=this.activeBindingsAt(time).filter(b=>b.childId===id);
    for(let i=direct.length-1;i>=0;i--){
      const binding=direct[i],info=this.#bindingDelta(binding,time);
      if(!info)continue;
      const {weight,deltaPosition,deltaQuaternion}=info;
      if(binding.axes[0])world.position.x-=deltaPosition.x*weight;
      if(binding.axes[1])world.position.y-=deltaPosition.y*weight;
      if(binding.axes[2])world.position.z-=deltaPosition.z*weight;
      if(binding.followRotation){
        const applied=new THREE.Quaternion().identity().slerp(deltaQuaternion,weight);
        world.quaternion.premultiply(applied.invert());
      }
    }

    const cameraData=object.isPerspectiveCamera?this.snapshotObject(id).camera:null;
    return worldToLocalSnapshot(object,world,cameraData);
  }

  setManualBase(id,base,{evaluate=true}={}){
    this.manualBases.set(id,cloneFrame({id:'manual',time:this.time,...base,interpolation:'linear'}));
    if(evaluate)this.evaluate(this.time);
  }

  previewBaseSnapshot(id,base,time=this.time){this.evaluate(time,new Map([[id,base]]));}

  findKeyframeNear(id,time=this.time,tolerance=.12){
    const track=this.tracks.get(id)||[];let best=null,bestDistance=Infinity;
    for(const frame of track){const d=Math.abs(frame.time-time);if(d<bestDistance){best=frame;bestDistance=d;}}
    return bestDistance<=tolerance?best:null;
  }

  captureKeyframe(id,time=this.time,{interpolation='smooth'}={}){
    return this.addKeyframe(id,{time,...this.snapshotEditableObject(id,time),interpolation});
  }

  addKeyframe(id,frame){
    const track=this.ensureTrack(id),normalized=this.#normalizeFrame(frame);
    const existing=track.findIndex(k=>Math.abs(k.time-normalized.time)<1e-4);
    if(existing>=0){normalized.id=track[existing].id||normalized.id;track[existing]=normalized;}else track.push(normalized);
    track.sort((a,b)=>a.time-b.time);this.onChange?.();return normalized;
  }

  updateKeyframe(id,frameId,patch,{evaluate=true}={}){
    const track=this.tracks.get(id);if(!track)throw new Error(`Piste introuvable: ${id}`);
    const index=track.findIndex(k=>k.id===frameId);if(index<0)throw new Error('Keyframe introuvable.');
    const current=track[index],candidate=this.#normalizeFrame({...current,...patch,id:current.id});
    const collision=track.find((k,i)=>i!==index&&Math.abs(k.time-candidate.time)<1e-4);
    if(collision)throw new Error(`Une autre keyframe de ${id} existe déjà à ${candidate.time.toFixed(3)} s.`);
    track[index]=candidate;track.sort((a,b)=>a.time-b.time);this.onChange?.();if(evaluate)this.evaluate(this.time);return candidate;
  }

  updateKeyframeFromObject(id,frameId,{time=null,interpolation=null}={}){
    const current=this.getKeyframe(id,frameId);if(!current)throw new Error('Keyframe introuvable.');
    return this.updateKeyframe(id,frameId,{...this.snapshotEditableObject(id,this.time),time:time??current.time,interpolation:interpolation??current.interpolation});
  }

  removeKeyframeById(id,frameId){const track=this.tracks.get(id);if(!track)return false;const index=track.findIndex(k=>k.id===frameId);if(index<0)return false;track.splice(index,1);this.onChange?.();return true;}
  removeKeyframe(id,time,tolerance=.12){const frame=this.findKeyframeNear(id,time,tolerance);return frame?this.removeKeyframeById(id,frame.id):false;}
  previewFrame(id,frame,time=this.time){this.previewBaseSnapshot(id,frame,time);}

  addBinding({childId,targetId,start=this.time,end=this.time+2,blend=.25,axes=[true,true,true],followRotation=false}={}){
    if(!childId||!targetId||childId===targetId)throw new Error('Choisis deux objets différents.');
    const child=this.resolveObject(childId),target=this.resolveObject(targetId);if(!child||!target)throw new Error('Objet de liaison introuvable.');
    const s=Math.max(0,Number(start)||0),e=Math.min(this.duration,Number(end)||0);if(e<=s)throw new Error('La fin de liaison doit être après le début.');

    // Capture the parent's actual world pose at the instant the constraint starts.
    // The child then receives the parent's DELTA from that pose, not the parent's
    // absolute coordinates. This is what guarantees the same trajectory with any offset.
    const restore=this.time;this.evaluate(s);const ref=readWorld(target);this.evaluate(restore);
    if(!(this.tracks.get(childId)?.length))this.manualBases.set(childId,this.snapshotEditableObject(childId,restore));

    const binding={
      id:uid('binding'),childId,targetId,start:s,end:e,blend:Math.max(0,Number(blend)||0),
      axes:[...axes],followRotation:Boolean(followRotation),
      referenceTargetPosition:ref.position.toArray(),referenceTargetQuaternion:ref.quaternion.toArray()
    };
    this.bindings.push(binding);this.onChange?.();this.evaluate(this.time);return binding;
  }

  removeBinding(id){const n=this.bindings.length;this.bindings=this.bindings.filter(b=>b.id!==id);if(this.bindings.length!==n){this.onChange?.();this.evaluate(this.time);}}
  activeBindingsAt(time=this.time){return this.bindings.filter(b=>time>=b.start&&time<=b.end);}
  isBound(id,time=this.time){return this.hasActiveBinding(id,time);}

  applyBindings(time=this.time){
    const active=this.activeBindingsAt(time);if(!active.length)return;
    const byChild=new Map();for(const binding of active){if(!byChild.has(binding.childId))byChild.set(binding.childId,[]);byChild.get(binding.childId).push(binding);}
    const ordered=[],permanent=new Set(),temporary=new Set();
    const visit=(binding)=>{
      if(permanent.has(binding.id)||temporary.has(binding.id))return;
      temporary.add(binding.id);for(const dependency of byChild.get(binding.targetId)||[])visit(dependency);
      temporary.delete(binding.id);permanent.add(binding.id);ordered.push(binding);
    };
    for(const binding of active)visit(binding);
    for(const binding of ordered)this.#applyBinding(binding,time);
  }

  addOceanFollowKey(objectId,time=this.time,{enabled=true,offset=0}={}){
    const object=this.resolveObject(objectId);if(!object)throw new Error(`Objet introuvable: ${objectId}`);if(object.isPerspectiveCamera)throw new Error('Une caméra ne peut pas suivre verticalement le niveau de la mer.');
    const event={id:uid('sea'),objectId,time:Math.max(0,Math.min(this.duration,Number(time)||0)),enabled:Boolean(enabled),offset:Number(offset)||0};
    const existing=this.oceanFollows.findIndex(k=>k.objectId===objectId&&Math.abs(k.time-event.time)<1e-4);if(existing>=0){event.id=this.oceanFollows[existing].id||event.id;this.oceanFollows[existing]=event;}else this.oceanFollows.push(event);
    this.oceanFollows.sort((a,b)=>a.time-b.time);this.onChange?.();return event;
  }

  removeOceanFollowKey(id){const n=this.oceanFollows.length;this.oceanFollows=this.oceanFollows.filter(k=>k.id!==id);if(this.oceanFollows.length!==n){this.onChange?.();return true;}return false;}
  oceanFollowKeysFor(objectId){return this.oceanFollows.filter(k=>k.objectId===objectId).sort((a,b)=>a.time-b.time);}
  oceanFollowStateAt(objectId,time=this.time){const keys=this.oceanFollowKeysFor(objectId);let state={enabled:false,offset:0,key:null};for(const key of keys){if(key.time<=time+1e-6)state={enabled:Boolean(key.enabled),offset:Number(key.offset)||0,key};else break;}return state;}
  activeOceanFollowsAt(time=this.time){const ids=new Set(this.oceanFollows.map(k=>k.objectId)),active=[];for(const objectId of ids){const state=this.oceanFollowStateAt(objectId,time);if(state.enabled)active.push({objectId,offset:state.offset,key:state.key});}return active;}

  addCameraCut(cameraId,time=this.time){const object=this.resolveObject(cameraId);if(!object?.isPerspectiveCamera)throw new Error('La coupe doit cibler une caméra cinématique.');const cut={id:uid('cut'),cameraId,time:Math.max(0,Math.min(this.duration,Number(time)||0))};const existing=this.cameraCuts.findIndex(c=>Math.abs(c.time-cut.time)<1e-4);if(existing>=0)this.cameraCuts[existing]=cut;else this.cameraCuts.push(cut);this.cameraCuts.sort((a,b)=>a.time-b.time);this._lastCameraId=null;this.onChange?.();this.#evaluateCameraCut(this.time);return cut;}
  removeCameraCut(id){const n=this.cameraCuts.length;this.cameraCuts=this.cameraCuts.filter(c=>c.id!==id);if(this.cameraCuts.length!==n){this._lastCameraId=null;this.onChange?.();this.#evaluateCameraCut(this.time);}}
  removeCameraCutNear(time=this.time,tolerance=.2){const cut=this.cameraCuts.reduce((best,c)=>Math.abs(c.time-time)<Math.abs((best?.time??Infinity)-time)?c:best,null);if(cut&&Math.abs(cut.time-time)<=tolerance){this.removeCameraCut(cut.id);return true;}return false;}
  cameraAt(time=this.time){if(!this.cameraCuts.length)return null;let current=this.cameraCuts[0].cameraId;for(const cut of this.cameraCuts){if(cut.time<=time+1e-6)current=cut.cameraId;else break;}return current;}

  addEffect({type='explosion',targetId=null,start=this.time,end=null,offset=[0,0,0],direction=[0,0,1],size=1,intensity=1}={}){const duration=type==='explosion'?1.15:3;const effect={id:uid('fx'),type:type==='rocketFlame'?'rocketFlame':'explosion',targetId:targetId||null,start:Math.max(0,Number(start)||0),end:Math.min(this.duration,Number(end??((Number(start)||0)+duration))),offset:[...offset].map(v=>Number(v)||0),direction:[...direction].map(v=>Number(v)||0),size:Math.max(.01,Number(size)||1),intensity:Math.max(0,Number(intensity)||1)};if(effect.end<=effect.start)throw new Error("La fin de l'effet doit être après le début.");if(effect.targetId&&!this.resolveObject(effect.targetId))throw new Error(`Cible d'effet introuvable: ${effect.targetId}`);this.effects.push(effect);this.onChange?.();return effect;}
  removeEffect(id){const n=this.effects.length;this.effects=this.effects.filter(f=>f.id!==id);if(this.effects.length!==n)this.onChange?.();}

  removeObjectReferences(id){this.tracks.delete(id);this.manualBases.delete(id);this.bindings=this.bindings.filter(b=>b.childId!==id&&b.targetId!==id);this.oceanFollows=this.oceanFollows.filter(k=>k.objectId!==id);this.cameraCuts=this.cameraCuts.filter(c=>c.cameraId!==id);this.effects=this.effects.filter(f=>f.targetId!==id);this._lastCameraId=null;this.onChange?.();}

  setDuration(seconds){this.duration=Math.max(.1,Number(seconds)||12);this.time=Math.min(this.time,this.duration);for(const track of this.tracks.values())for(const k of track)k.time=Math.min(k.time,this.duration);this.bindings=this.bindings.filter(b=>b.start<this.duration).map(b=>({...b,end:Math.min(b.end,this.duration)}));this.oceanFollows=this.oceanFollows.filter(k=>k.time<=this.duration);this.cameraCuts=this.cameraCuts.filter(c=>c.time<=this.duration);this.effects=this.effects.filter(f=>f.start<this.duration).map(f=>({...f,end:Math.min(f.end,this.duration)}));this.onChange?.();this.setTime(this.time);}
  setTime(time,evaluate=true){this.time=Math.max(0,Math.min(this.duration,Number(time)||0));if(evaluate)this.evaluate(this.time);this.onTime?.(this.time);}
  play(){this.playing=true;} pause(){this.playing=false;} toggle(){this.playing=!this.playing;return this.playing;}
  update(dt){if(!this.playing)return;let next=this.time+dt*this.rate;if(next>this.duration){if(this.loop)next=next%this.duration;else{next=this.duration;this.playing=false;}}this.setTime(next,true);}

  evaluate(time=this.time,overrides=null){
    const ids=new Set([...this.tracks.keys(),...this.manualBases.keys(),...(overrides?.keys?.()||[])]);
    for(const id of ids){
      const object=this.resolveObject(id);if(!object)continue;
      const override=overrides?.get?.(id);if(override){this.#applyFrame(object,override);continue;}
      const track=this.tracks.get(id)||[];if(track.length)this.#evaluateTrack(object,track,time);else if(this.manualBases.has(id))this.#applyFrame(object,this.manualBases.get(id));
    }
    this.applyBindings(time);this.#evaluateCameraCut(time);
  }

  #normalizeFrame(frame){return {id:frame.id||uid('key'),time:Math.max(0,Math.min(this.duration,Number(frame.time)||0)),position:[...(frame.position||[0,0,0])],quaternion:[...(frame.quaternion||[0,0,0,1])],scale:[...(frame.scale||[1,1,1])],interpolation:frame.interpolation||'smooth',camera:frame.camera?{...frame.camera}:undefined};}

  #evaluateTrack(object,track,time){
    if(track.length===1||time<=track[0].time){this.#applyFrame(object,track[0]);return;}const last=track[track.length-1];if(time>=last.time){this.#applyFrame(object,last);return;}
    let a=track[0],b=last;for(let i=0;i<track.length-1;i++)if(time>=track[i].time&&time<=track[i+1].time){a=track[i];b=track[i+1];break;}
    const raw=(time-a.time)/Math.max(1e-6,b.time-a.time),t=easing(a.interpolation,raw);
    object.position.set(lerp(a.position[0],b.position[0],t),lerp(a.position[1],b.position[1],t),lerp(a.position[2],b.position[2],t));
    const qa=new THREE.Quaternion(...a.quaternion),qb=new THREE.Quaternion(...b.quaternion);object.quaternion.copy(qa).slerp(qb,t);
    object.scale.set(lerp(a.scale[0],b.scale[0],t),lerp(a.scale[1],b.scale[1],t),lerp(a.scale[2],b.scale[2],t));
    if(object.isPerspectiveCamera&&(a.camera||b.camera))this.#applyCameraInterpolation(object,a.camera||b.camera,b.camera||a.camera,t);
  }

  #applyFrame(object,frame){object.position.fromArray(frame.position||[0,0,0]);object.quaternion.fromArray(frame.quaternion||[0,0,0,1]);object.scale.fromArray(frame.scale||[1,1,1]);if(object.isPerspectiveCamera&&frame.camera)this.#applyCameraInterpolation(object,frame.camera,frame.camera,0);object.updateMatrixWorld(true);}

  #applyCameraInterpolation(camera,a,b,t){const current=camera.userData.cameraSettings??={};const focal=lerp(a.focalLength,b.focalLength,t),zoom=lerp(a.zoom,b.zoom,t);current.focusDistance=lerp(a.focusDistance,b.focusDistance,t);current.aperture=lerp(a.aperture,b.aperture,t);current.maxBlur=lerp(a.maxBlur,b.maxBlur,t);current.dofEnabled=t<.5?Boolean(a.dofEnabled):Boolean(b.dofEnabled);current.focalLength=focal;current.zoom=zoom;camera.setFocalLength(Math.max(1,focal));camera.zoom=Math.max(.05,zoom);camera.updateProjectionMatrix();}

  #bindingWeight(binding,time){const blend=Math.min(binding.blend,(binding.end-binding.start)/2);if(blend<=0)return 1;if(time<binding.start+blend)return smooth((time-binding.start)/blend);if(time>binding.end-blend)return smooth((binding.end-time)/blend);return 1;}

  #bindingDelta(binding,time){
    const target=this.resolveObject(binding.targetId);if(!target)return null;this.#ensureBindingReference(binding);
    const tw=readWorld(target),refPos=new THREE.Vector3().fromArray(binding.referenceTargetPosition),refQ=new THREE.Quaternion().fromArray(binding.referenceTargetQuaternion);
    return {weight:this.#bindingWeight(binding,time),deltaPosition:tw.position.clone().sub(refPos),deltaQuaternion:tw.quaternion.clone().multiply(refQ.clone().invert()).normalize()};
  }

  #applyBinding(binding,time){
    if(time<binding.start||time>binding.end)return;
    const child=this.resolveObject(binding.childId);if(!child)return;const info=this.#bindingDelta(binding,time);if(!info)return;
    const world=readWorld(child),{weight,deltaPosition,deltaQuaternion}=info;
    if(binding.axes[0])world.position.x+=deltaPosition.x*weight;
    if(binding.axes[1])world.position.y+=deltaPosition.y*weight;
    if(binding.axes[2])world.position.z+=deltaPosition.z*weight;
    if(binding.followRotation){const applied=new THREE.Quaternion().identity().slerp(deltaQuaternion,weight);world.quaternion.premultiply(applied).normalize();}
    writeWorld(child,world);
  }

  #ensureBindingReference(binding){
    if(binding.referenceTargetPosition&&binding.referenceTargetQuaternion)return;
    const target=this.resolveObject(binding.targetId);if(!target)return;
    const track=this.tracks.get(binding.targetId)||[];
    if(track.length){
      const current=snapshot(target);this.#evaluateTrack(target,track,binding.start);const w=readWorld(target);this.#applyFrame(target,current);binding.referenceTargetPosition=w.position.toArray();binding.referenceTargetQuaternion=w.quaternion.toArray();
    }else{
      const w=readWorld(target);binding.referenceTargetPosition=w.position.toArray();binding.referenceTargetQuaternion=w.quaternion.toArray();
    }
  }

  #evaluateCameraCut(time){const id=this.cameraAt(time);if(id!==this._lastCameraId){this._lastCameraId=id;this.onCameraCut?.(id,time);}}

  toJSON(){return {version:5,duration:this.duration,loop:this.loop,tracks:Object.fromEntries([...this.tracks].map(([id,frames])=>[id,frames.map(cloneFrame)])),bindings:this.bindings.map(b=>({...b,referenceTargetPosition:[...(b.referenceTargetPosition||[])],referenceTargetQuaternion:[...(b.referenceTargetQuaternion||[])]})),oceanFollows:this.oceanFollows,cameraCuts:this.cameraCuts,effects:this.effects};}

  load(data){
    if(!data||![1,2,3,4,5].includes(data.version))throw new Error('Format de timeline non reconnu.');
    this.duration=Math.max(.1,Number(data.duration)||12);this.loop=Boolean(data.loop);this.manualBases.clear();
    this.tracks=new Map(Object.entries(data.tracks||{}).map(([id,frames])=>[id,frames.map(f=>this.#normalizeFrame(cloneFrame(f))).sort((a,b)=>a.time-b.time)]));
    this.bindings=(data.bindings||[]).map(b=>({...b,id:b.id||uid('binding'),axes:[...(b.axes||[true,true,true])],referenceTargetPosition:b.referenceTargetPosition?[...b.referenceTargetPosition]:null,referenceTargetQuaternion:b.referenceTargetQuaternion?[...b.referenceTargetQuaternion]:null}));
    this.oceanFollows=(data.oceanFollows||[]).map(k=>({...k,id:k.id||uid('sea'),enabled:Boolean(k.enabled),offset:Number(k.offset)||0})).sort((a,b)=>a.time-b.time);
    this.cameraCuts=(data.cameraCuts||[]).map(c=>({...c,id:c.id||uid('cut')})).sort((a,b)=>a.time-b.time);
    this.effects=(data.effects||[]).map(f=>({...f,id:f.id||uid('fx'),offset:[...(f.offset||[0,0,0])],direction:[...(f.direction||[0,0,1])]}));
    for(const b of this.bindings)if(!(this.tracks.get(b.childId)?.length)){const o=this.resolveObject(b.childId);if(o)this.manualBases.set(b.childId,snapshot(o));}
    this.time=0;this.playing=false;this._lastCameraId=null;this.onChange?.();this.setTime(0,true);
  }
}
