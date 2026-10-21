import * as THREE from 'three';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { v=clamp01(v); return v*v*(3-2*v); };

function snapshot(object) {
  return {
    position: object.position.toArray(),
    quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray()
  };
}

function easing(name, t) {
  if (name === 'step') return t < 1 ? 0 : 1;
  if (name === 'smooth') return smooth(t);
  if (name === 'easeIn') return t*t;
  if (name === 'easeOut') return 1-(1-t)*(1-t);
  return t;
}

export class SceneTimeline {
  constructor({ resolveObject, duration=12, loop=false }={}) {
    this.resolveObject = resolveObject;
    this.duration = duration;
    this.loop = loop;
    this.time = 0;
    this.playing = false;
    this.rate = 1;
    this.tracks = new Map();
    this.bindings = [];
    this.onChange = null;
    this.onTime = null;
  }

  ensureTrack(id) {
    if (!this.tracks.has(id)) this.tracks.set(id, []);
    return this.tracks.get(id);
  }

  captureKeyframe(id, time=this.time, { interpolation='smooth' }={}) {
    const object = this.resolveObject(id);
    if (!object) throw new Error(`Objet introuvable: ${id}`);
    return this.addKeyframe(id, { time, ...snapshot(object), interpolation });
  }

  addKeyframe(id, frame) {
    const track = this.ensureTrack(id);
    const normalized = {
      time: Math.max(0, Math.min(this.duration, Number(frame.time) || 0)),
      position: [...frame.position],
      quaternion: [...frame.quaternion],
      scale: [...frame.scale],
      interpolation: frame.interpolation || 'smooth'
    };
    const existing = track.findIndex(k => Math.abs(k.time-normalized.time) < 1e-4);
    if (existing >= 0) track[existing] = normalized; else track.push(normalized);
    track.sort((a,b)=>a.time-b.time);
    this.onChange?.();
    return normalized;
  }

  removeKeyframe(id, time, tolerance=0.12) {
    const track=this.tracks.get(id); if(!track) return false;
    const index=track.findIndex(k=>Math.abs(k.time-time)<=tolerance);
    if(index<0) return false;
    track.splice(index,1); this.onChange?.(); return true;
  }

  addBinding({ childId, targetId, start=this.time, end=this.time+2, blend=0.25, axes=[true,true,true], followRotation=false, offset=null }={}) {
    if (!childId || !targetId || childId===targetId) throw new Error('Choisis deux objets différents.');
    const child=this.resolveObject(childId), target=this.resolveObject(targetId);
    if(!child||!target) throw new Error('Objet de liaison introuvable.');
    const childWorld=new THREE.Vector3(), targetWorld=new THREE.Vector3();
    child.getWorldPosition(childWorld); target.getWorldPosition(targetWorld);
    const binding={
      id: crypto.randomUUID?.() ?? `binding-${Date.now()}-${Math.random()}`,
      childId,targetId,
      start:Math.max(0,Number(start)||0), end:Math.min(this.duration,Number(end)||0),
      blend:Math.max(0,Number(blend)||0), axes:[...axes], followRotation:Boolean(followRotation),
      offset: offset ? [...offset] : childWorld.sub(targetWorld).toArray()
    };
    if(binding.end<=binding.start) throw new Error('La fin de liaison doit être après le début.');
    this.bindings.push(binding); this.onChange?.(); return binding;
  }

  removeBinding(id) {
    const n=this.bindings.length;
    this.bindings=this.bindings.filter(b=>b.id!==id);
    if(this.bindings.length!==n) this.onChange?.();
  }

  setDuration(seconds) {
    this.duration=Math.max(.1,Number(seconds)||12);
    this.time=Math.min(this.time,this.duration);
    for(const track of this.tracks.values()) for(const k of track) k.time=Math.min(k.time,this.duration);
    this.bindings=this.bindings.filter(b=>b.start<this.duration).map(b=>({...b,end:Math.min(b.end,this.duration)}));
    this.onChange?.(); this.setTime(this.time);
  }

  setTime(time, evaluate=true) {
    this.time=Math.max(0,Math.min(this.duration,Number(time)||0));
    if(evaluate) this.evaluate(this.time);
    this.onTime?.(this.time);
  }

  play(){this.playing=true;}
  pause(){this.playing=false;}
  toggle(){this.playing=!this.playing;return this.playing;}

  update(dt) {
    if(!this.playing) return;
    let next=this.time+dt*this.rate;
    if(next>this.duration){
      if(this.loop) next=next%this.duration; else {next=this.duration;this.playing=false;}
    }
    this.setTime(next,true);
  }

  evaluate(time=this.time) {
    for(const [id,track] of this.tracks) {
      const object=this.resolveObject(id); if(!object||!track.length) continue;
      this.#evaluateTrack(object,track,time);
    }
    for(const binding of this.bindings) this.#applyBinding(binding,time);
  }

  #evaluateTrack(object, track, time) {
    if(track.length===1 || time<=track[0].time){this.#applyFrame(object,track[0]);return;}
    const last=track[track.length-1]; if(time>=last.time){this.#applyFrame(object,last);return;}
    let a=track[0],b=last;
    for(let i=0;i<track.length-1;i++) if(time>=track[i].time&&time<=track[i+1].time){a=track[i];b=track[i+1];break;}
    const raw=(time-a.time)/Math.max(1e-6,b.time-a.time);
    const t=easing(a.interpolation,raw);
    object.position.set(
      THREE.MathUtils.lerp(a.position[0],b.position[0],t),
      THREE.MathUtils.lerp(a.position[1],b.position[1],t),
      THREE.MathUtils.lerp(a.position[2],b.position[2],t)
    );
    const qa=new THREE.Quaternion(...a.quaternion),qb=new THREE.Quaternion(...b.quaternion);
    object.quaternion.copy(qa).slerp(qb,t);
    object.scale.set(
      THREE.MathUtils.lerp(a.scale[0],b.scale[0],t),
      THREE.MathUtils.lerp(a.scale[1],b.scale[1],t),
      THREE.MathUtils.lerp(a.scale[2],b.scale[2],t)
    );
  }

  #applyFrame(object,frame){
    object.position.fromArray(frame.position); object.quaternion.fromArray(frame.quaternion); object.scale.fromArray(frame.scale);
  }

  #applyBinding(binding,time) {
    if(time<binding.start||time>binding.end) return;
    const child=this.resolveObject(binding.childId),target=this.resolveObject(binding.targetId);
    if(!child||!target) return;
    const blend=Math.min(binding.blend,(binding.end-binding.start)/2);
    let weight=1;
    if(blend>0){
      if(time<binding.start+blend) weight=smooth((time-binding.start)/blend);
      else if(time>binding.end-blend) weight=smooth((binding.end-time)/blend);
    }
    const cw=new THREE.Vector3(),tw=new THREE.Vector3(),desired=new THREE.Vector3();
    child.getWorldPosition(cw); target.getWorldPosition(tw); desired.copy(tw).add(new THREE.Vector3(...binding.offset));
    if(!binding.axes[0]) desired.x=cw.x; if(!binding.axes[1]) desired.y=cw.y; if(!binding.axes[2]) desired.z=cw.z;
    desired.lerp(cw,1-weight);
    if(child.parent){child.parent.worldToLocal(desired);child.position.copy(desired);}else child.position.copy(desired);

    if(binding.followRotation){
      const cq=new THREE.Quaternion(),tq=new THREE.Quaternion(); child.getWorldQuaternion(cq);target.getWorldQuaternion(tq);cq.slerp(tq,weight);
      if(child.parent){const pq=new THREE.Quaternion();child.parent.getWorldQuaternion(pq);child.quaternion.copy(pq.invert().multiply(cq));}else child.quaternion.copy(cq);
    }
  }

  toJSON(){
    return {version:1,duration:this.duration,loop:this.loop,tracks:Object.fromEntries(this.tracks),bindings:this.bindings};
  }

  load(data){
    if(!data||data.version!==1) throw new Error('Format de timeline non reconnu.');
    this.duration=Math.max(.1,Number(data.duration)||12); this.loop=Boolean(data.loop);
    this.tracks=new Map(Object.entries(data.tracks||{}).map(([id,frames])=>[id,frames.map(f=>({...f}))]));
    this.bindings=(data.bindings||[]).map(b=>({...b,axes:[...(b.axes||[true,true,true])],offset:[...(b.offset||[0,0,0])]}));
    this.time=0;this.playing=false;this.onChange?.();this.setTime(0,true);
  }
}
