import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

function cloneFrame(frame){
  return frame ? {
    ...frame,
    position:[...(frame.position||[0,0,0])],
    quaternion:[...(frame.quaternion||[0,0,0,1])],
    scale:[...(frame.scale||[1,1,1])],
    camera:frame.camera?{...frame.camera}:undefined
  } : null;
}

export class SceneEditor{
  constructor({world,timeline,root}){
    this.world=world;
    this.timeline=timeline;
    this.root=root;
    this.selectedId=null;
    this.transformMode='translate';
    this.selectedKeyframe=null;
    this.keyframeDraft=null;

    this.transform=new TransformControls(world.camera,world.renderer.domElement);
    this.transform.setSize(.85);
    this.transformHelper=this.transform.getHelper();
    world.scene.add(this.transformHelper);

    this.transform.addEventListener('dragging-changed',(e)=>{
      world.cameraController.controls.enabled=!e.value&&world.viewMode==='editor';
      if(e.value)timeline.pause();
      this.#syncPlayButton();
    });

    this.transform.addEventListener('objectChange',()=>{
      if(this.#editingSelectedObject())this.#captureDraftFromObject();
      this.#updateInspector();
      this.#updateCameraInspector();
    });

    this.transform.addEventListener('mouseUp',()=>{
      if(this.#editingSelectedObject())this.#previewDraft();
      else this.timeline.applyBindings(this.timeline.time);
      this.#updateInspector();
      this.#updateCameraInspector();
    });

    this.#cache();
    this.#bind();
    this.#enableViewportPicking();

    timeline.onTime=(t)=>{
      this.#renderPlayhead(t);
      this.#updateInspector();
      this.#updateCameraInspector();
    };
    timeline.onChange=()=>{
      this.#validateSelectedKeyframe();
      this.renderTimeline();
      this.#syncKeyframeEditor();
    };
    world.onObjectsChanged=()=>this.refreshObjects();
    world.onViewModeChanged=(mode)=>this.#syncViewMode(mode);

    this.refreshObjects();
    this.renderTimeline();
    this.#renderPlayhead(0);
    this.#syncViewMode(world.viewMode);
    this.#syncKeyframeEditor();
  }

  #cache(){
    const q=(s)=>this.root.querySelector(s);
    this.objectList=q('#editor-object-list');
    this.timelineRows=q('#timeline-rows');
    this.ruler=q('#timeline-ruler');
    this.playhead=q('#timeline-playhead');
    this.scrub=q('#timeline-scrub');
    this.timeLabel=q('#timeline-time');
    this.durationInput=q('#timeline-duration');
    this.playBtn=q('#timeline-play');
    this.loop=q('#timeline-loop');
    this.modeBtns=[...this.root.querySelectorAll('[data-transform-mode]')];
    this.keyEase=q('#key-ease');
    this.addKeyframeBtn=q('#add-keyframe');
    this.deleteKeyframeBtn=q('#delete-keyframe');

    this.keyframePanel=q('#keyframe-editor');
    this.keyframeTitle=q('#keyframe-editor-title');
    this.keyframeTime=q('#keyframe-time');
    this.keyframeInterpolation=q('#keyframe-interpolation');
    this.updateKeyframeBtn=q('#update-keyframe');
    this.cancelKeyframeBtn=q('#cancel-keyframe-edit');

    this.bindingTarget=q('#binding-target');
    this.bindingStart=q('#binding-start');
    this.bindingEnd=q('#binding-end');
    this.bindingBlend=q('#binding-blend');
    this.bindX=q('#bind-x');
    this.bindY=q('#bind-y');
    this.bindZ=q('#bind-z');
    this.bindRot=q('#bind-rotation');
    this.bindingList=q('#binding-list');

    this.inspector=q('#transform-inspector');
    this.cameraSelect=q('#camera-select');
    this.cameraPanel=q('#camera-lens-panel');
    this.cameraInputs={
      focalLength:q('#camera-focal'),
      zoom:q('#camera-zoom'),
      focusDistance:q('#camera-focus'),
      aperture:q('#camera-aperture'),
      maxBlur:q('#camera-maxblur'),
      dofEnabled:q('#camera-dof')
    };
    this.effectTarget=q('#effect-target');
    this.effectType=q('#effect-type');
    this.effectList=q('#effect-list');
  }

  #bind(){
    this.playBtn.addEventListener('click',()=>{this.timeline.toggle();this.#syncPlayButton();});
    this.root.querySelector('#timeline-stop').addEventListener('click',()=>{
      this.timeline.pause();
      this.clearKeyframeSelection();
      this.timeline.setTime(0);
      this.#syncPlayButton();
    });
    this.loop.addEventListener('change',()=>this.timeline.loop=this.loop.checked);
    this.durationInput.addEventListener('change',()=>{this.timeline.setDuration(this.durationInput.value);this.renderTimeline();});
    this.scrub.addEventListener('input',()=>{
      this.timeline.setTime(Number(this.scrub.value),true);
      this.#syncKeyframeEditor();
    });

    this.addKeyframeBtn.addEventListener('click',()=>{
      if(this.selectedKeyframe)this.updateSelectedKeyframe();
      else this.addKeyframe();
    });
    this.deleteKeyframeBtn.addEventListener('click',()=>this.deleteSelectedOrNearbyKeyframe());
    this.updateKeyframeBtn?.addEventListener('click',()=>this.updateSelectedKeyframe());
    this.cancelKeyframeBtn?.addEventListener('click',()=>this.clearKeyframeSelection());

    this.modeBtns.forEach(b=>b.addEventListener('click',()=>this.setTransformMode(b.dataset.transformMode)));
    this.root.querySelector('#add-binding').addEventListener('click',()=>this.addBinding());
    this.root.querySelector('#timeline-export').addEventListener('click',()=>this.exportJSON());
    this.root.querySelector('#timeline-import').addEventListener('change',(e)=>this.importJSON(e.target.files?.[0]));

    for(const input of this.inspector.querySelectorAll('input[data-transform]'))input.addEventListener('change',()=>this.#applyInspector());

    this.root.querySelector('#view-editor').addEventListener('click',()=>this.world.setViewMode('editor'));
    this.root.querySelector('#view-cinematic').addEventListener('click',()=>this.world.setViewMode('cinematic'));

    this.root.querySelector('#add-camera').addEventListener('click',()=>{
      const actor=this.world.addCinematicCamera({id:`camera-${this.world.cameraManager.cameras.size+1}`});
      this.select(actor.id);
      const frame=this.timeline.captureKeyframe(actor.id,this.timeline.time,{interpolation:this.keyEase.value});
      this.selectKeyframe(actor.id,frame.id);
    });
    this.root.querySelector('#remove-camera').addEventListener('click',()=>{
      const id=this.cameraSelect.value;
      if(!id)return;
      if(this.selectedKeyframe?.objectId===id)this.clearKeyframeSelection();
      this.timeline.removeObjectReferences(id);
      this.world.removeObject(id);
    });
    this.cameraSelect.addEventListener('change',()=>{if(this.cameraSelect.value)this.select(this.cameraSelect.value);});
    this.root.querySelector('#add-camera-cut').addEventListener('click',()=>{const id=this.cameraSelect.value;if(id)this.timeline.addCameraCut(id,this.timeline.time);});
    this.root.querySelector('#remove-camera-cut').addEventListener('click',()=>this.timeline.removeCameraCutNear(this.timeline.time,.3));
    for(const input of Object.values(this.cameraInputs))input.addEventListener('change',()=>this.#applyCameraInspector());

    this.root.querySelector('#add-effect').addEventListener('click',()=>this.addEffect());
    this.root.querySelector('#effect-use-selection').addEventListener('click',()=>{
      const actor=this.world.objects.get(this.selectedId);
      if(actor&&actor.kind!=='camera'){
        this.effectTarget.value=this.selectedId;
        for(const id of ['effect-x','effect-y','effect-z'])this.root.querySelector(`#${id}`).value=0;
      }
    });
    this.effectType.addEventListener('change',()=>{
      const start=Number(this.root.querySelector('#effect-start').value)||this.timeline.time;
      this.root.querySelector('#effect-end').value=(start+(this.effectType.value==='explosion'?1.15:3)).toFixed(2);
    });
  }

  #enableViewportPicking(){
    const canvas=this.world.renderer.domElement;
    const raycaster=new THREE.Raycaster();
    const pointer=new THREE.Vector2();
    let down=null;
    canvas.addEventListener('pointerdown',(e)=>{down={x:e.clientX,y:e.clientY};});
    canvas.addEventListener('pointerup',(e)=>{
      if(this.world.viewMode!=='editor'){down=null;return;}
      if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){down=null;return;}
      down=null;
      const r=canvas.getBoundingClientRect();
      pointer.x=((e.clientX-r.left)/r.width)*2-1;
      pointer.y=-((e.clientY-r.top)/r.height)*2+1;
      raycaster.setFromCamera(pointer,this.world.camera);
      const targets=[...this.world.objects.values()].filter(a=>a.kind!=='camera').map(a=>a.object);
      const hits=raycaster.intersectObjects(targets,true);
      for(const hit of hits){
        let o=hit.object;
        while(o&&!o.userData?.editorId)o=o.parent;
        if(o?.userData?.editorId){this.select(o.userData.editorId);break;}
      }
    });
  }

  refreshObjects(){
    const ids=[...this.world.objects.keys()];
    this.objectList.innerHTML='';
    this.bindingTarget.innerHTML='';
    this.cameraSelect.innerHTML='';
    this.effectTarget.innerHTML='<option value="">Monde / position absolue</option>';

    for(const id of ids){
      const actor=this.world.objects.get(id);
      const btn=document.createElement('button');
      btn.type='button';
      btn.className=`object-chip ${actor.kind==='camera'?'camera-chip':''}`;
      btn.textContent=actor.kind==='camera'?`🎥 ${id}`:id;
      btn.dataset.id=id;
      btn.addEventListener('click',()=>this.select(id));
      this.objectList.append(btn);

      const opt=document.createElement('option');
      opt.value=id;opt.textContent=id;this.bindingTarget.append(opt);
      if(actor.kind==='camera'){
        const co=document.createElement('option');co.value=id;co.textContent=id;this.cameraSelect.append(co);
      }else{
        const eo=document.createElement('option');eo.value=id;eo.textContent=id;this.effectTarget.append(eo);
      }
    }

    if(!this.selectedId||!this.world.objects.has(this.selectedId))this.selectedId=ids[0]||null;
    if(this.selectedKeyframe&&!this.world.objects.has(this.selectedKeyframe.objectId))this.clearKeyframeSelection();
    if(this.selectedId)this.select(this.selectedId,{preserveKeyframe:true});else this.transform.detach();
    this.renderTimeline();
  }

  select(id,{preserveKeyframe=false}={}){
    const object=this.world.getEditableObject(id);
    if(!object)return;
    if(!preserveKeyframe&&this.selectedKeyframe?.objectId!==id)this.clearKeyframeSelection(false);

    this.selectedId=id;
    this.world.setActiveObject(id);
    this.transform.attach(object);
    [...this.objectList.children].forEach(b=>b.classList.toggle('selected',b.dataset.id===id));
    [...this.bindingTarget.options].forEach(o=>o.disabled=o.value===id);
    if(this.bindingTarget.value===id){
      const other=[...this.bindingTarget.options].find(o=>!o.disabled);
      if(other)this.bindingTarget.value=other.value;
    }
    if(object.isPerspectiveCamera)this.cameraSelect.value=id;
    this.#updateInspector();
    this.#updateCameraInspector();
    this.renderTimeline();
  }

  selectKeyframe(objectId,frameId){
    const frame=this.timeline.getKeyframe(objectId,frameId);
    if(!frame)return;
    this.timeline.pause();
    this.#syncPlayButton();
    this.selectedKeyframe={objectId,frameId};
    this.keyframeDraft=cloneFrame(frame);
    this.select(objectId,{preserveKeyframe:true});
    this.timeline.setTime(frame.time,true);
    this.#syncKeyframeEditor();
    this.#updateInspector();
    this.#updateCameraInspector();
    this.renderTimeline();
  }

  clearKeyframeSelection(render=true){
    this.selectedKeyframe=null;
    this.keyframeDraft=null;
    this.#syncKeyframeEditor();
    if(render)this.renderTimeline();
  }

  #validateSelectedKeyframe(){
    if(!this.selectedKeyframe)return;
    const frame=this.timeline.getKeyframe(this.selectedKeyframe.objectId,this.selectedKeyframe.frameId);
    if(!frame){
      this.selectedKeyframe=null;
      this.keyframeDraft=null;
    }
  }

  #editingSelectedObject(){return Boolean(this.selectedKeyframe&&this.selectedKeyframe.objectId===this.selectedId&&this.keyframeDraft);}

  #syncKeyframeEditor(){
    const editing=this.#editingSelectedObject();
    this.addKeyframeBtn.textContent=editing?'✓ Enregistrer cette keyframe':'◆ Nouvelle keyframe';
    this.addKeyframeBtn.classList.toggle('editing-keyframe',editing);
    this.deleteKeyframeBtn.textContent=editing?'Supprimer cette keyframe':'Suppr. keyframe proche';

    if(!editing){
      if(this.keyframePanel){
        this.keyframePanel.classList.add('disabled-panel');
        this.keyframePanel.classList.remove('editing');
        if(this.keyframeTitle)this.keyframeTitle.textContent='Aucune keyframe sélectionnée';
      }
      return;
    }

    const frame=this.timeline.getKeyframe(this.selectedKeyframe.objectId,this.selectedKeyframe.frameId);
    if(!frame)return;
    this.keyEase.value=this.keyframeDraft.interpolation||frame.interpolation||'smooth';
    if(!this.keyframePanel)return;
    this.keyframePanel.classList.remove('disabled-panel');
    this.keyframePanel.classList.add('editing');
    if(this.keyframeTitle)this.keyframeTitle.textContent=`${this.selectedKeyframe.objectId} · ${frame.time.toFixed(3)} s`;
    if(this.keyframeTime)this.keyframeTime.value=Number(this.keyframeDraft.time??frame.time).toFixed(3);
    if(this.keyframeInterpolation)this.keyframeInterpolation.value=this.keyframeDraft.interpolation||frame.interpolation||'smooth';
  }

  #captureDraftFromObject(){
    if(!this.#editingSelectedObject())return;
    const captured=this.timeline.snapshotObject(this.selectedId);
    const old=this.keyframeDraft;
    this.keyframeDraft={
      ...old,
      position:captured.position,
      quaternion:captured.quaternion,
      scale:captured.scale,
      camera:captured.camera??old.camera
    };
  }

  #previewDraft(){
    if(!this.#editingSelectedObject())return;
    this.timeline.previewFrame(this.selectedId,this.keyframeDraft,this.timeline.time);
  }

  setTransformMode(mode){
    this.transformMode=mode;
    this.transform.setMode(mode);
    this.modeBtns.forEach(b=>b.classList.toggle('active',b.dataset.transformMode===mode));
  }

  addKeyframe(){
    if(!this.selectedId)return;
    const frame=this.timeline.captureKeyframe(this.selectedId,this.timeline.time,{interpolation:this.keyEase.value});
    this.selectKeyframe(this.selectedId,frame.id);
  }

  updateSelectedKeyframe(){
    if(!this.#editingSelectedObject())return;
    const frame=this.timeline.getKeyframe(this.selectedKeyframe.objectId,this.selectedKeyframe.frameId);
    if(!frame){this.clearKeyframeSelection();return;}

    const nextTime=this.keyframeTime?Number(this.keyframeTime.value):this.timeline.time;
    const interpolation=this.keyframeInterpolation?.value||this.keyEase.value||'smooth';
    this.keyframeDraft.time=Number.isFinite(nextTime)?nextTime:frame.time;
    this.keyframeDraft.interpolation=interpolation;

    try{
      const updated=this.timeline.updateKeyframe(
        this.selectedKeyframe.objectId,
        this.selectedKeyframe.frameId,
        this.keyframeDraft,
        {evaluate:false}
      );
      this.keyframeDraft=cloneFrame(updated);
      this.timeline.setTime(updated.time,true);
      this.#syncKeyframeEditor();
      this.#updateInspector();
      this.#updateCameraInspector();
    }catch(err){
      alert(err.message);
    }
  }

  deleteSelectedOrNearbyKeyframe(){
    if(this.selectedKeyframe){
      const {objectId,frameId}=this.selectedKeyframe;
      if(this.timeline.removeKeyframeById(objectId,frameId)){
        this.selectedKeyframe=null;
        this.keyframeDraft=null;
        this.timeline.evaluate();
        this.#syncKeyframeEditor();
      }
      return;
    }
    if(this.selectedId&&this.timeline.removeKeyframe(this.selectedId,this.timeline.time,.18))this.timeline.evaluate();
  }

  addBinding(){
    if(!this.selectedId)return;
    this.timeline.addBinding({
      childId:this.selectedId,
      targetId:this.bindingTarget.value,
      start:Number(this.bindingStart.value),
      end:Number(this.bindingEnd.value),
      blend:Number(this.bindingBlend.value),
      axes:[this.bindX.checked,this.bindY.checked,this.bindZ.checked],
      followRotation:this.bindRot.checked
    });
    this.renderTimeline();
  }

  addEffect(){
    const n=(id,fallback=0)=>{const v=Number(this.root.querySelector(`#${id}`).value);return Number.isFinite(v)?v:fallback;};
    this.timeline.addEffect({
      type:this.effectType.value,
      targetId:this.effectTarget.value||null,
      start:n('effect-start',this.timeline.time),
      end:n('effect-end',this.timeline.time+1),
      offset:[n('effect-x'),n('effect-y'),n('effect-z')],
      direction:[n('effect-dx',0),n('effect-dy',0),n('effect-dz',1)],
      size:n('effect-size',1),
      intensity:n('effect-intensity',1)
    });
  }

  renderTimeline(){
    const duration=this.timeline.duration;
    this.durationInput.value=duration;
    this.scrub.max=duration;
    this.loop.checked=this.timeline.loop;
    this.ruler.innerHTML='';

    const ticks=Math.max(2,Math.min(12,Math.ceil(duration)));
    for(let i=0;i<=ticks;i++){
      const t=duration*i/ticks;
      const mark=document.createElement('span');
      mark.style.left=`${t/duration*100}%`;
      mark.textContent=`${t.toFixed(ticks>8?0:1)}s`;
      this.ruler.append(mark);
    }

    this.timelineRows.innerHTML='';
    this.#renderCameraCutRow(duration);
    this.#renderEffectRow(duration);

    for(const [id,actor] of this.world.objects){
      const row=document.createElement('div');
      row.className='timeline-row';
      row.classList.toggle('selected',id===this.selectedId);

      const label=document.createElement('button');
      label.type='button';
      label.className='track-label';
      label.textContent=actor.kind==='camera'?`🎥 ${id}`:id;
      label.addEventListener('click',()=>this.select(id));
      row.append(label);

      const lane=document.createElement('div');
      lane.className='track-lane';
      row.append(lane);

      for(const frame of this.timeline.tracks.get(id)||[]){
        const key=document.createElement('button');
        key.type='button';
        key.className='timeline-key';
        key.classList.toggle('selected-key',this.selectedKeyframe?.objectId===id&&this.selectedKeyframe?.frameId===frame.id);
        key.title=`${frame.time.toFixed(3)} s · cliquer pour modifier`;
        key.style.left=`${frame.time/duration*100}%`;
        key.addEventListener('click',(e)=>{
          e.stopPropagation();
          this.selectKeyframe(id,frame.id);
        });
        lane.append(key);
      }

      for(const b of this.timeline.bindings.filter(x=>x.childId===id)){
        const bar=document.createElement('button');
        bar.type='button';
        bar.className='binding-bar';
        bar.style.left=`${b.start/duration*100}%`;
        bar.style.width=`${(b.end-b.start)/duration*100}%`;
        bar.title=`Suit ${b.targetId} · ${b.start.toFixed(2)}–${b.end.toFixed(2)} s · priorité sur keyframes`;
        bar.textContent=`→ ${b.targetId}`;
        bar.addEventListener('click',(e)=>{
          e.stopPropagation();
          if(confirm(`Supprimer la liaison vers ${b.targetId} ?`))this.timeline.removeBinding(b.id);
        });
        lane.append(bar);
      }

      lane.addEventListener('pointerdown',(e)=>{
        if(e.target!==lane)return;
        const r=lane.getBoundingClientRect();
        this.timeline.setTime((e.clientX-r.left)/r.width*duration,true);
        this.#syncKeyframeEditor();
        this.renderTimeline();
      });
      this.timelineRows.append(row);
    }

    this.#renderBindings();
    this.#renderEffectsList();
    this.#renderPlayhead(this.timeline.time);
    this.#syncKeyframeEditor();
  }

  #renderCameraCutRow(duration){
    const row=document.createElement('div');
    row.className='timeline-row special-row';
    const label=document.createElement('div');
    label.className='track-label static-label';
    label.textContent='🎬 CAM CUT';
    row.append(label);
    const lane=document.createElement('div');
    lane.className='track-lane camera-cut-lane';
    row.append(lane);
    const cuts=[...this.timeline.cameraCuts].sort((a,b)=>a.time-b.time);
    for(let i=0;i<cuts.length;i++){
      const cut=cuts[i],next=cuts[i+1]?.time??duration;
      const bar=document.createElement('button');
      bar.type='button';bar.className='camera-cut-bar';
      bar.style.left=`${cut.time/duration*100}%`;
      bar.style.width=`${Math.max(.7,(next-cut.time)/duration*100)}%`;
      bar.textContent=cut.cameraId;
      bar.title=`${cut.cameraId} à ${cut.time.toFixed(2)} s`;
      bar.addEventListener('click',(e)=>{e.stopPropagation();this.clearKeyframeSelection(false);this.select(cut.cameraId);this.timeline.setTime(cut.time,true);});
      lane.append(bar);
    }
    lane.addEventListener('pointerdown',(e)=>{
      if(e.target!==lane)return;
      this.clearKeyframeSelection(false);
      const r=lane.getBoundingClientRect();
      this.timeline.setTime((e.clientX-r.left)/r.width*duration,true);
      this.renderTimeline();
    });
    this.timelineRows.append(row);
  }

  #renderEffectRow(duration){
    const row=document.createElement('div');
    row.className='timeline-row special-row';
    const label=document.createElement('div');
    label.className='track-label static-label';
    label.textContent='✨ FX';
    row.append(label);
    const lane=document.createElement('div');
    lane.className='track-lane fx-lane';
    row.append(lane);
    for(const fx of this.timeline.effects){
      const bar=document.createElement('button');
      bar.type='button';
      bar.className=`effect-bar ${fx.type==='rocketFlame'?'flame':''}`;
      bar.style.left=`${fx.start/duration*100}%`;
      bar.style.width=`${Math.max(.8,(fx.end-fx.start)/duration*100)}%`;
      bar.textContent=fx.type==='rocketFlame'?'🔥 moteur':'💥 explosion';
      bar.title=`${fx.start.toFixed(2)}–${fx.end.toFixed(2)} s${fx.targetId?` · ${fx.targetId}`:''}`;
      bar.addEventListener('click',(e)=>{e.stopPropagation();this.clearKeyframeSelection(false);this.timeline.setTime(fx.start,true);});
      lane.append(bar);
    }
    lane.addEventListener('pointerdown',(e)=>{
      if(e.target!==lane)return;
      this.clearKeyframeSelection(false);
      const r=lane.getBoundingClientRect();
      this.timeline.setTime((e.clientX-r.left)/r.width*duration,true);
      this.renderTimeline();
    });
    this.timelineRows.append(row);
  }

  #renderBindings(){
    this.bindingList.innerHTML='';
    for(const b of this.timeline.bindings){
      const el=document.createElement('div');
      el.className='binding-item';
      el.innerHTML=`<span><b>${this.#escape(b.childId)}</b> → ${this.#escape(b.targetId)}</span><small>${b.start.toFixed(2)}–${b.end.toFixed(2)} s · fondu ${b.blend.toFixed(2)} s · priorité liaison</small>`;
      const del=document.createElement('button');del.type='button';del.textContent='×';del.addEventListener('click',()=>this.timeline.removeBinding(b.id));el.append(del);
      this.bindingList.append(el);
    }
  }

  #renderEffectsList(){
    this.effectList.innerHTML='';
    for(const fx of this.timeline.effects){
      const el=document.createElement('div');
      el.className='binding-item';
      el.innerHTML=`<span><b>${fx.type==='rocketFlame'?'Flamme moteur':'Explosion'}</b>${fx.targetId?` → ${this.#escape(fx.targetId)}`:' · monde'}</span><small>${fx.start.toFixed(2)}–${fx.end.toFixed(2)} s · taille ${fx.size.toFixed(2)}</small>`;
      const del=document.createElement('button');del.type='button';del.textContent='×';del.addEventListener('click',()=>this.timeline.removeEffect(fx.id));el.append(del);
      this.effectList.append(el);
    }
  }

  #renderPlayhead(t){
    const pct=this.timeline.duration?100*t/this.timeline.duration:0;
    this.playhead.style.left=`calc(var(--track-label-width) + (100% - var(--track-label-width)) * ${pct/100})`;
    this.scrub.value=t;
    this.timeLabel.textContent=`${t.toFixed(2)} s`;
  }

  #updateInspector(){
    const object=this.world.getEditableObject(this.selectedId);
    if(!object)return;

    let position=object.position;
    let quaternion=object.quaternion;
    let scale=object.scale;
    if(this.#editingSelectedObject()){
      position=new THREE.Vector3().fromArray(this.keyframeDraft.position);
      quaternion=new THREE.Quaternion().fromArray(this.keyframeDraft.quaternion);
      scale=new THREE.Vector3().fromArray(this.keyframeDraft.scale);
    }

    const e=new THREE.Euler().setFromQuaternion(quaternion,'XYZ');
    const vals={
      px:position.x,py:position.y,pz:position.z,
      rx:THREE.MathUtils.radToDeg(e.x),ry:THREE.MathUtils.radToDeg(e.y),rz:THREE.MathUtils.radToDeg(e.z),
      sx:scale.x,sy:scale.y,sz:scale.z
    };
    for(const [k,v] of Object.entries(vals)){
      const input=this.inspector.querySelector(`[data-transform="${k}"]`);
      if(input&&!input.matches(':focus'))input.value=v.toFixed(k[0]==='r'?1:3);
    }
  }

  #applyInspector(){
    const object=this.world.getEditableObject(this.selectedId);
    if(!object)return;
    const n=k=>Number(this.inspector.querySelector(`[data-transform="${k}"]`).value)||0;
    const position=[n('px'),n('py'),n('pz')];
    const euler=new THREE.Euler(
      THREE.MathUtils.degToRad(n('rx')),
      THREE.MathUtils.degToRad(n('ry')),
      THREE.MathUtils.degToRad(n('rz'))
    );
    const quaternion=new THREE.Quaternion().setFromEuler(euler).toArray();
    const scale=[Math.max(.001,n('sx')),Math.max(.001,n('sy')),Math.max(.001,n('sz'))];

    if(this.#editingSelectedObject()){
      this.keyframeDraft.position=position;
      this.keyframeDraft.quaternion=quaternion;
      this.keyframeDraft.scale=scale;
      this.#previewDraft();
    }else{
      object.position.fromArray(position);
      object.quaternion.fromArray(quaternion);
      object.scale.fromArray(scale);
      this.timeline.applyBindings(this.timeline.time);
    }
    this.#updateInspector();
  }

  #updateCameraInspector(){
    const object=this.world.getEditableObject(this.selectedId);
    const isCamera=Boolean(object?.isPerspectiveCamera);
    this.cameraPanel.classList.toggle('disabled-panel',!isCamera);
    if(!isCamera)return;

    let settings;
    if(this.#editingSelectedObject()&&this.keyframeDraft.camera){
      settings=this.keyframeDraft.camera;
    }else{
      settings=this.world.cameraManager.getLens(object);
    }
    if(!settings)return;

    for(const key of ['focalLength','zoom','focusDistance','aperture','maxBlur']){
      const input=this.cameraInputs[key];
      if(input&&!input.matches(':focus'))input.value=Number(settings[key]).toFixed(key==='focalLength'?1:key==='aperture'?6:3);
    }
    this.cameraInputs.dofEnabled.checked=settings.dofEnabled;
    this.cameraSelect.value=this.selectedId;
  }

  #applyCameraInspector(){
    const object=this.world.getEditableObject(this.selectedId);
    if(!object?.isPerspectiveCamera)return;
    const settings={
      focalLength:Number(this.cameraInputs.focalLength.value),
      zoom:Number(this.cameraInputs.zoom.value),
      focusDistance:Number(this.cameraInputs.focusDistance.value),
      aperture:Number(this.cameraInputs.aperture.value),
      maxBlur:Number(this.cameraInputs.maxBlur.value),
      dofEnabled:this.cameraInputs.dofEnabled.checked
    };

    if(this.#editingSelectedObject()){
      this.keyframeDraft.camera={...(this.keyframeDraft.camera||{}),...settings};
      this.#previewDraft();
    }else{
      this.world.cameraManager.applyLens(object,settings);
      this.timeline.applyBindings(this.timeline.time);
    }
    this.#updateCameraInspector();
  }

  #syncViewMode(mode){
    const editor=mode==='editor';
    this.transformHelper.visible=editor;
    this.transform.enabled=editor;
    this.world.cameraController.controls.enabled=editor;
    this.root.querySelector('#view-editor').classList.toggle('active',editor);
    this.root.querySelector('#view-cinematic').classList.toggle('active',!editor);
    this.root.querySelector('.scene-hud strong').textContent=editor?'Édition 3D':'Aperçu cinématique';
    this.root.querySelector('.scene-hud span').textContent=editor?'Gizmos + OrbitControls':'Point de vue de la caméra active · coupes timeline';
  }

  #syncPlayButton(){this.playBtn.textContent=this.timeline.playing?'Pause':'Lecture';}

  exportJSON(){
    const blob=new Blob([JSON.stringify(this.timeline.toJSON(),null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='scene-timeline.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }

  async importJSON(file){
    if(!file)return;
    try{
      this.clearKeyframeSelection(false);
      this.timeline.load(JSON.parse(await file.text()));
      this.renderTimeline();
    }catch(err){alert(err.message);}
  }

  #escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
}
