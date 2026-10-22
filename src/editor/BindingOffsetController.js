import * as THREE from 'three';

/**
 * SceneEditor edits the real Object3D. When an object is constrained, that Object3D
 * already contains the parent's motion. This adapter makes the gizmo/Transform panel
 * feel unchanged by converting the displayed/final pose back to the object's base
 * pose (its local animation/offset), then asking SceneTimeline to reapply constraints.
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

  #usable(){
    const id=this.editor.selectedId;
    return Boolean(id&&!this.editor.selectedKeyframe&&this.timeline.hasActiveBinding(id,this.timeline.time));
  }

  #onObjectChange(){
    if(!this.#usable())return;
    this.pendingBase=this.timeline.snapshotEditableObject(this.editor.selectedId,this.timeline.time);
    this.updateInspector();
  }

  #onMouseUp(){
    if(!this.#usable()||!this.pendingBase)return;
    const id=this.editor.selectedId,base=this.pendingBase;this.pendingBase=null;
    if(!(this.timeline.tracks.get(id)?.length))this.timeline.setManualBase(id,base,{evaluate:false});
    this.timeline.previewBaseSnapshot(id,base,this.timeline.time);
    this.updateInspector();
  }

  #afterInspectorChange(){
    if(!this.#usable())return;
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
    if(!this.#usable()||!this.inspector)return;
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
