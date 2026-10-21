import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class SceneEditor {
  constructor({ world, timeline, root }) {
    this.world=world; this.timeline=timeline; this.root=root;
    this.selectedId=null; this.transformMode='translate'; this.scrubbing=false;
    this.transform=new TransformControls(world.camera,world.renderer.domElement);
    this.transform.setSize(.85);
    world.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed',(e)=>{
      world.cameraController.controls.enabled=!e.value;
      if(e.value) timeline.pause();
      this.#syncPlayButton();
    });
    this.transform.addEventListener('objectChange',()=>this.#updateInspector());

    this.#cache(); this.#bind(); this.#enableViewportPicking();
    timeline.onTime=(t)=>this.#renderPlayhead(t);
    timeline.onChange=()=>this.renderTimeline();
    world.onObjectsChanged=()=>this.refreshObjects();
    this.refreshObjects(); this.renderTimeline(); this.#renderPlayhead(0);
  }

  #enableViewportPicking(){
    const canvas=this.world.renderer.domElement;
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
    let down=null;
    canvas.addEventListener('pointerdown',(e)=>{down={x:e.clientX,y:e.clientY};});
    canvas.addEventListener('pointerup',(e)=>{
      if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){down=null;return;}
      down=null;const r=canvas.getBoundingClientRect();pointer.x=((e.clientX-r.left)/r.width)*2-1;pointer.y=-((e.clientY-r.top)/r.height)*2+1;
      raycaster.setFromCamera(pointer,this.world.camera);
      const hits=raycaster.intersectObjects([...this.world.objects.values()].map(a=>a.object),true);
      for(const hit of hits){let o=hit.object;while(o&&!o.userData?.editorId)o=o.parent;if(o?.userData?.editorId){this.select(o.userData.editorId);break;}}
    });
  }

  #cache(){
    const q=(s)=>this.root.querySelector(s);
    this.objectList=q('#editor-object-list');this.timelineRows=q('#timeline-rows');this.ruler=q('#timeline-ruler');
    this.playhead=q('#timeline-playhead');this.scrub=q('#timeline-scrub');this.timeLabel=q('#timeline-time');
    this.durationInput=q('#timeline-duration');this.playBtn=q('#timeline-play');this.loop=q('#timeline-loop');
    this.modeBtns=[...this.root.querySelectorAll('[data-transform-mode]')];
    this.keyEase=q('#key-ease');this.bindingTarget=q('#binding-target');this.bindingStart=q('#binding-start');this.bindingEnd=q('#binding-end');this.bindingBlend=q('#binding-blend');
    this.bindX=q('#bind-x');this.bindY=q('#bind-y');this.bindZ=q('#bind-z');this.bindRot=q('#bind-rotation');this.bindingList=q('#binding-list');
    this.inspector=q('#transform-inspector');
  }

  #bind(){
    this.playBtn.addEventListener('click',()=>{this.timeline.toggle();this.#syncPlayButton();});
    this.root.querySelector('#timeline-stop').addEventListener('click',()=>{this.timeline.pause();this.timeline.setTime(0);this.#syncPlayButton();});
    this.loop.addEventListener('change',()=>this.timeline.loop=this.loop.checked);
    this.durationInput.addEventListener('change',()=>{this.timeline.setDuration(this.durationInput.value);this.renderTimeline();});
    this.scrub.addEventListener('input',()=>this.timeline.setTime(Number(this.scrub.value),true));
    this.root.querySelector('#add-keyframe').addEventListener('click',()=>this.addKeyframe());
    this.root.querySelector('#delete-keyframe').addEventListener('click',()=>{if(this.selectedId){this.timeline.removeKeyframe(this.selectedId,this.timeline.time,.18);this.timeline.evaluate();}});
    this.modeBtns.forEach(b=>b.addEventListener('click',()=>this.setTransformMode(b.dataset.transformMode)));
    this.root.querySelector('#add-binding').addEventListener('click',()=>this.addBinding());
    this.root.querySelector('#timeline-export').addEventListener('click',()=>this.exportJSON());
    this.root.querySelector('#timeline-import').addEventListener('change',(e)=>this.importJSON(e.target.files?.[0]));
    for(const input of this.inspector.querySelectorAll('input[data-transform]')) input.addEventListener('change',()=>this.#applyInspector());
  }

  refreshObjects(){
    const ids=[...this.world.objects.keys()];
    this.objectList.innerHTML=''; this.bindingTarget.innerHTML='';
    for(const id of ids){
      const btn=document.createElement('button');btn.type='button';btn.className='object-chip';btn.textContent=id;btn.dataset.id=id;btn.addEventListener('click',()=>this.select(id));this.objectList.append(btn);
      const opt=document.createElement('option');opt.value=id;opt.textContent=id;this.bindingTarget.append(opt);
    }
    if(!this.selectedId||!this.world.objects.has(this.selectedId)) this.selectedId=ids[0]||null;
    if(this.selectedId) this.select(this.selectedId); else this.transform.detach();
    this.renderTimeline();
  }

  select(id){
    const object=this.world.getEditableObject(id);if(!object)return;
    this.selectedId=id;this.world.setActiveBoat(id);this.transform.attach(object);
    [...this.objectList.children].forEach(b=>b.classList.toggle('selected',b.dataset.id===id));
    [...this.bindingTarget.options].forEach(o=>o.disabled=o.value===id);
    if(this.bindingTarget.value===id){const other=[...this.bindingTarget.options].find(o=>!o.disabled);if(other)this.bindingTarget.value=other.value;}
    this.#updateInspector();this.renderTimeline();
  }

  setTransformMode(mode){
    this.transformMode=mode;this.transform.setMode(mode);
    this.modeBtns.forEach(b=>b.classList.toggle('active',b.dataset.transformMode===mode));
  }

  addKeyframe(){
    if(!this.selectedId)return;
    this.timeline.captureKeyframe(this.selectedId,this.timeline.time,{interpolation:this.keyEase.value});
  }

  addBinding(){
    if(!this.selectedId)return;
    const start=Number(this.bindingStart.value),end=Number(this.bindingEnd.value);
    this.timeline.addBinding({childId:this.selectedId,targetId:this.bindingTarget.value,start,end,blend:Number(this.bindingBlend.value),axes:[this.bindX.checked,this.bindY.checked,this.bindZ.checked],followRotation:this.bindRot.checked});
    this.renderTimeline();
  }

  renderTimeline(){
    const duration=this.timeline.duration;
    this.durationInput.value=duration;this.scrub.max=duration;this.loop.checked=this.timeline.loop;
    this.ruler.innerHTML='';
    const ticks=Math.max(2,Math.min(12,Math.ceil(duration)));
    for(let i=0;i<=ticks;i++){const t=duration*i/ticks;const mark=document.createElement('span');mark.style.left=`${t/duration*100}%`;mark.textContent=`${t.toFixed(ticks>8?0:1)}s`;this.ruler.append(mark);}
    this.timelineRows.innerHTML='';
    for(const [id,actor] of this.world.objects){
      const row=document.createElement('div');row.className='timeline-row';row.classList.toggle('selected',id===this.selectedId);
      const label=document.createElement('button');label.type='button';label.className='track-label';label.textContent=id;label.addEventListener('click',()=>this.select(id));row.append(label);
      const lane=document.createElement('div');lane.className='track-lane';row.append(lane);
      for(const frame of this.timeline.tracks.get(id)||[]){
        const key=document.createElement('button');key.type='button';key.className='timeline-key';key.title=`${frame.time.toFixed(2)} s`;key.style.left=`${frame.time/duration*100}%`;
        key.addEventListener('click',(e)=>{e.stopPropagation();this.select(id);this.timeline.setTime(frame.time,true);});lane.append(key);
      }
      for(const b of this.timeline.bindings.filter(x=>x.childId===id)){
        const bar=document.createElement('button');bar.type='button';bar.className='binding-bar';bar.style.left=`${b.start/duration*100}%`;bar.style.width=`${(b.end-b.start)/duration*100}%`;bar.title=`Suit ${b.targetId} · ${b.start.toFixed(2)}–${b.end.toFixed(2)} s`;bar.textContent=`→ ${b.targetId}`;bar.addEventListener('click',(e)=>{e.stopPropagation();if(confirm(`Supprimer la liaison vers ${b.targetId} ?`))this.timeline.removeBinding(b.id);});lane.append(bar);
      }
      lane.addEventListener('pointerdown',(e)=>{const r=lane.getBoundingClientRect();this.timeline.setTime((e.clientX-r.left)/r.width*duration,true);});
      this.timelineRows.append(row);
    }
    this.#renderBindings();this.#renderPlayhead(this.timeline.time);
  }

  #renderBindings(){
    this.bindingList.innerHTML='';
    for(const b of this.timeline.bindings){
      const el=document.createElement('div');el.className='binding-item';
      el.innerHTML=`<span><b>${this.#escape(b.childId)}</b> → ${this.#escape(b.targetId)}</span><small>${b.start.toFixed(2)}–${b.end.toFixed(2)} s · fondu ${b.blend.toFixed(2)} s</small>`;
      const del=document.createElement('button');del.type='button';del.textContent='×';del.addEventListener('click',()=>this.timeline.removeBinding(b.id));el.append(del);this.bindingList.append(el);
    }
  }

  #renderPlayhead(t){
    const pct=this.timeline.duration?100*t/this.timeline.duration:0;
    this.playhead.style.left=`calc(var(--track-label-width) + (100% - var(--track-label-width)) * ${pct/100})`;
    this.scrub.value=t;this.timeLabel.textContent=`${t.toFixed(2)} s`;
  }

  #updateInspector(){
    const o=this.world.getEditableObject(this.selectedId);if(!o)return;
    const e=new THREE.Euler().setFromQuaternion(o.quaternion,'XYZ');
    const vals={px:o.position.x,py:o.position.y,pz:o.position.z,rx:THREE.MathUtils.radToDeg(e.x),ry:THREE.MathUtils.radToDeg(e.y),rz:THREE.MathUtils.radToDeg(e.z),sx:o.scale.x,sy:o.scale.y,sz:o.scale.z};
    for(const [k,v] of Object.entries(vals)){const input=this.inspector.querySelector(`[data-transform="${k}"]`);if(input&&!input.matches(':focus'))input.value=v.toFixed(k[0]==='r'?1:3);}
  }

  #applyInspector(){
    const o=this.world.getEditableObject(this.selectedId);if(!o)return;
    const n=k=>Number(this.inspector.querySelector(`[data-transform="${k}"]`).value)||0;
    o.position.set(n('px'),n('py'),n('pz'));o.rotation.set(THREE.MathUtils.degToRad(n('rx')),THREE.MathUtils.degToRad(n('ry')),THREE.MathUtils.degToRad(n('rz')));o.scale.set(Math.max(.001,n('sx')),Math.max(.001,n('sy')),Math.max(.001,n('sz')));
  }

  #syncPlayButton(){this.playBtn.textContent=this.timeline.playing?'Pause':'Lecture';}

  exportJSON(){
    const blob=new Blob([JSON.stringify(this.timeline.toJSON(),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='scene-timeline.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }

  async importJSON(file){if(!file)return;try{this.timeline.load(JSON.parse(await file.text()));this.renderTimeline();}catch(err){alert(err.message);}}
  #escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
}
