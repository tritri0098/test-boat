export const SCENE_CHANNEL='test-boat-live-scene-v1';

const cloneTransform=(snapshot)=>({
  position:[...(snapshot.position||[0,0,0])],
  quaternion:[...(snapshot.quaternion||[0,0,0,1])],
  scale:[...(snapshot.scale||[1,1,1])]
});

export class EditorViewBridge{
  constructor({world,timeline}){
    this.world=world;this.timeline=timeline;this.assets=new Map();
    this.channel='BroadcastChannel' in window?new BroadcastChannel(SCENE_CHANNEL):null;
    this.detachedWindow=null;this.fullSyncTimer=null;
    this.channel?.addEventListener('message',(event)=>{
      if(event.data?.type==='request-full-state')this.sendFullState();
    });
    this.clockTimer=setInterval(()=>this.sendClock(),100);
  }

  registerProcedural(id){this.assets.set(id,{source:'procedural'});this.scheduleFullSync();}
  registerLocal(id,files,{preferredName=null,floating=true}={}){this.assets.set(id,{source:'local',files:Array.from(files),preferredName,floating:Boolean(floating)});this.scheduleFullSync();}
  unregister(id){this.assets.delete(id);this.scheduleFullSync();}

  openDetached(){
    const url=new URL('./viewer.html',window.location.href);
    this.detachedWindow=window.open(url.href,'test-boat-detached-view');
    if(!this.detachedWindow)throw new Error("Le navigateur a bloqué l'ouverture du nouvel onglet.");
    setTimeout(()=>this.sendFullState(),150);
    return this.detachedWindow;
  }

  scheduleFullSync(){
    clearTimeout(this.fullSyncTimer);
    this.fullSyncTimer=setTimeout(()=>this.sendFullState(),80);
  }

  sendTimeline(){
    if(!this.channel)return;
    this.channel.postMessage({type:'timeline',timeline:this.timeline.toJSON(),time:this.timeline.time,playing:this.timeline.playing});
  }

  sendClock(){
    if(!this.channel)return;
    this.channel.postMessage({
      type:'clock',time:this.timeline.time,playing:this.timeline.playing,
      activeCamera:this.world.cameraManager.activeId,
      weather:{...this.world.weather.state}
    });
  }

  sendFullState(){
    if(!this.channel)return;
    const objects=[];
    for(const [id,actor] of this.world.objects){
      const object=actor.object;
      const base=this.timeline.snapshotEditableObject(id,this.timeline.time);
      if(actor.kind==='camera'){
        objects.push({kind:'camera',id,transform:cloneTransform(base),lens:this.world.cameraManager.getLens(object)});
        continue;
      }
      const asset=this.assets.get(id);
      if(asset?.source==='local'){
        objects.push({kind:actor.kind,id,source:'local',files:asset.files,preferredName:asset.preferredName,floating:asset.floating,transform:cloneTransform(base)});
      }else{
        objects.push({kind:actor.kind,id,source:'procedural',floating:true,transform:cloneTransform(base)});
      }
    }
    this.channel.postMessage({
      type:'full-state',
      objects,timeline:this.timeline.toJSON(),time:this.timeline.time,playing:this.timeline.playing,
      activeCamera:this.world.cameraManager.activeId,weather:{...this.world.weather.state}
    });
  }

  dispose(){clearInterval(this.clockTimer);clearTimeout(this.fullSyncTimer);this.channel?.close();}
}
