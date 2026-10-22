import * as THREE from 'three';

/**
 * SceneEditor manipulates the rendered Object3D. For a constrained child that
 * rendered pose already contains its parent's motion. This adapter presents and
 * edits the child's own/base transform instead, so Transform stays an offset layer.
 */
export class BindingOffsetController{
  constructor({editor,timeline}){
    this.editor=editor;this.timeline=timeline;this.pendingBase=null;
    this.inspector=editor.inspector;

    editor.transform.addEventListener('objectChange',()=>this.#onObjectChange());
    editor.transform.addEventListener('mouseUp',()=>this.#onMouseUp());

    for(const input of this.inspector?.querySelectorAll('input[data-transform]')||[]){
      input.addEventListener('change',()=>queueMicrotask(()=>this.#afterInspectorChange()));
    }
  }

  #isBound(){
    const id=this.editor.selectedId;
    return Boolean(id&&this.timeline.hasActiveBinding(id,this.timeline.time));
  }

  #editingKeyframe(){
    return Boolean(this.editor.selectedKeyframe&&this.editor.selectedKeyframe.objectId===this.editor.selectedId&&this.editor.keyframeDraft);
  }

  #onObjectChange(){
    if(!this.#isBound())return;
    const id=this.editor.selectedId;
    const base=this.timeline.snapshotEditableObject(id,this.timeline.time);

    if(this.#editingKeyframe()){
      const old=this.editor.keyframeDraft;
      this.editor.keyframeDraft={
        ...old,
        position:base.position,
        quaternion:base.quaternion,
        scale:base.scale,
        camera:old.camera
      };
      return;
    }

    this.pendingBase=base;
    this.updateInspector();
  }

  #onMouseUp(){
    if(!this.#isBound())return;

    if(this.#editingKeyframe()){
      // SceneEditor's mouseUp handler runs first and previews keyframeDraft. Since
      // objectChange above has already converted the draft back to child/base space,
      // previewing here once more simply guarantees one clean constraint application.
      this.timeline.previewBaseSnapshot(this.editor.selectedId,this.editor.keyframeDraft,this.timeline.time);
      return;
    }

    if(!this.pendingBase)return;
    const id=this.editor.selectedId,base=this.pendingBase;this.pendingBase=null;
    if(!(this.timeline.tracks.get(id)?.length))this.timeline.setManualBase(id,base,{evaluate:false});
    this.timeline.previewBaseSnapshot(id,base,this.timeline.time);
    this.updateInspector();
  }

  #afterInspectorChange(){
    if(!this.#isBound()||this.#editingKeyframe())return;
    const id=this.editor.selectedId;
    const previous=this.timeline.snapshotEditableObject(id,this.timeline.time);
    const n=(key,fallback=0)=>{const v=Number(this.inspector.querySelector(`[data-transform="${key}"]`)?.value);return Number.isFinite(v)?v:fallback;};
    const euler=new THREE.Euler(
      THREE.MathUtils.degToRad(n('rx')),
      THREE.MathUtils.degToRad(n('ry')),
      THREE.MathUtils.degToRad(n('rz')),
      'XYZ'
    );
    const base={
      ...previous,
      position:[n('px'),n('py'),n('pz')],
      quaternion:new THREE.Quaternion().setFromEuler(euler).toArray(),
      scale:[Math.max(.001,n('sx',1)),Math.max(.001,n('sy',1)),Math.max(.001,n('sz',1))]
    };
    if(!(this.timeline.tracks.get(id)?.length))this.timeline.setManualBase(id,base,{evaluate:false});
    this.timeline.previewBaseSnapshot(id,base,this.timeline.time);
    this.updateInspector();
  }

  updateInspector(){
    if(!this.#isBound()||!this.inspector||this.#editingKeyframe())return;
    const base=this.pendingBase||this.timeline.snapshotEditableObject(this.editor.selectedId,this.timeline.time);
    const e=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(base.quaternion),'XYZ');
    const values={
      px:base.position[0],py:base.position[1],pz:base.position[2],
      rx:THREE.MathUtils.radToDeg(e.x),ry:THREE.MathUtils.radToDeg(e.y),rz:THREE.MathUtils.radToDeg(e.z),
      sx:base.scale[0],sy:base.scale[1],sz:base.scale[2]
    };
    for(const [key,value] of Object.entries(values)){
      const input=this.inspector.querySelector(`[data-transform="${key}"]`);
      if(input&&!input.matches(':focus'))input.value=Number(value).toFixed(key[0]==='r'?1:3);
    }
  }
}
