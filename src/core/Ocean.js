import * as THREE from 'three';

const WAVE_DEFS=[
  {dir:[.88,.47],length:18,speed:5,phase:.2,calm:.12,storm:1.15},
  {dir:[-.31,.95],length:12.3,speed:4.2,phase:1.7,calm:.07,storm:.78},
  {dir:[.57,-.82],length:8.2,speed:3.4,phase:4,calm:.04,storm:.44},
  {dir:[-.94,.33],length:5.2,speed:2.7,phase:2.4,calm:.02,storm:.21},
  {dir:[.16,.98],length:2.8,speed:1.9,phase:5,calm:.01,storm:.10}
];

const DEFAULTS={
  // The ocean is streamed as a world-space quadtree. The root is deliberately
  // enormous; only visible leaves are sent to the GPU.
  rootSize:524288,       // 524 km square world sector
  rootStride:65536,      // sector centre moves only every 65 km
  minTileSize:8,         // finest world-space tile: 8 m
  segments:12,           // 12x12 cells per tile => ~0.67 m near-camera spacing
  targetTilePixels:190,  // screen-space error target; smaller = more detail
  maxLeaves:6500,
  lodIntervalMs:70,
  waveBounds:8,
  skirtDepth:8
};

function makeTileGeometry(segments,skirtDepth){
  const positions=[];
  const indices=[];
  const row=segments+1;

  for(let z=0;z<=segments;z++){
    for(let x=0;x<=segments;x++){
      positions.push(x/segments-.5,0,z/segments-.5);
    }
  }

  for(let z=0;z<segments;z++){
    for(let x=0;x<segments;x++){
      const a=z*row+x,b=a+1,c=a+row,d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }

  const addSkirt=(edge)=>{
    const bottom=[];
    for(const topIndex of edge){
      const p=topIndex*3;
      bottom.push(positions.length/3);
      positions.push(positions[p],-skirtDepth,positions[p+2]);
    }
    for(let i=0;i<edge.length-1;i++){
      const a=edge[i],b=edge[i+1],aa=bottom[i],bb=bottom[i+1];
      indices.push(a,aa,b,b,aa,bb);
    }
  };

  const north=[],south=[],west=[],east=[];
  for(let i=0;i<=segments;i++){
    north.push(i);
    south.push(segments*row+i);
    west.push(i*row);
    east.push(i*row+segments);
  }
  addSkirt(north);addSkirt(south);addSkirt(west);addSkirt(east);

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export class Ocean{
  constructor(options={}){
    this.options={...DEFAULTS,...options};
    this.group=new THREE.Group();
    this.group.name='world-ocean';
    // Compatibility with the previous OceanWorld API.
    this.mesh=this.group;

    this.geometry=makeTileGeometry(this.options.segments,this.options.skirtDepth);
    this.levels=new Map();
    this.materials=new Map();
    this.matrixDummy=new THREE.Object3D();
    this.frustum=new THREE.Frustum();
    this.projectionView=new THREE.Matrix4();
    this.lastLodUpdate=-Infinity;
    this.viewportHeight=720;
    this.stats={visibleTiles:0,maxDepth:0,finestTileSize:this.options.rootSize,rootCenter:[0,0]};
  }

  update(time,storm,camera=null,fog=null,viewportHeight=null){
    if(viewportHeight)this.viewportHeight=Math.max(1,viewportHeight);

    for(const material of this.materials.values()){
      material.uniforms.uTime.value=time;
      material.uniforms.uStorm.value=storm;
      if(fog){
        material.uniforms.uFogColor.value.copy(fog.color);
        material.uniforms.uFogDensity.value=fog.density;
      }
    }

    if(!camera)return;
    const now=performance.now();
    if(now-this.lastLodUpdate>=this.options.lodIntervalMs){
      this.lastLodUpdate=now;
      this.#rebuildLod(camera);
    }
  }

  #rebuildLod(camera){
    camera.updateMatrixWorld(true);
    this.projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);

    const rootSize=this.options.rootSize;
    const stride=this.options.rootStride;
    const rootX=Math.round(camera.position.x/stride)*stride;
    const rootZ=Math.round(camera.position.z/stride)*stride;
    const maxDepth=Math.floor(Math.log2(rootSize/this.options.minTileSize));
    const effectiveFov=THREE.MathUtils.degToRad(camera.getEffectiveFOV?.()??camera.fov??50);
    const pixelsPerWorldAtUnit=this.viewportHeight/(2*Math.tan(effectiveFov*.5));

    const buckets=new Map();
    const stack=[{x:rootX,z:rootZ,size:rootSize,depth:0}];
    let leaves=0,deepest=0,finest=rootSize,nodes=0;
    const maxNodes=this.options.maxLeaves*8;

    while(stack.length){
      const node=stack.pop();
      nodes++;
      if(!this.#nodeVisible(node))continue;

      const distance=this.#distanceToNode(camera.position,node);
      const projected=node.size*pixelsPerWorldAtUnit/Math.max(distance,.5);
      const canSplit=node.depth<maxDepth&&node.size*.5>=this.options.minTileSize;
      const budgetOk=leaves+stack.length<this.options.maxLeaves&&nodes<maxNodes;

      if(projected>this.options.targetTilePixels&&canSplit&&budgetOk){
        const childSize=node.size*.5;
        const o=childSize*.5;
        const d=node.depth+1;
        stack.push(
          {x:node.x-o,z:node.z-o,size:childSize,depth:d},
          {x:node.x+o,z:node.z-o,size:childSize,depth:d},
          {x:node.x-o,z:node.z+o,size:childSize,depth:d},
          {x:node.x+o,z:node.z+o,size:childSize,depth:d}
        );
      }else{
        if(!buckets.has(node.depth))buckets.set(node.depth,[]);
        buckets.get(node.depth).push(node);
        leaves++;
        deepest=Math.max(deepest,node.depth);
        finest=Math.min(finest,node.size);
      }
    }

    for(const [depth,level] of this.levels){
      if(!buckets.has(depth))level.mesh.count=0;
    }

    for(const [depth,nodesAtDepth] of buckets){
      const tileSize=rootSize/Math.pow(2,depth);
      const level=this.#ensureLevel(depth,tileSize,nodesAtDepth.length);
      const mesh=level.mesh;
      mesh.count=nodesAtDepth.length;
      for(let i=0;i<nodesAtDepth.length;i++){
        const node=nodesAtDepth[i];
        this.matrixDummy.position.set(node.x,0,node.z);
        this.matrixDummy.rotation.set(0,0,0);
        this.matrixDummy.scale.set(node.size,1,node.size);
        this.matrixDummy.updateMatrix();
        mesh.setMatrixAt(i,this.matrixDummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate=true;
    }

    this.stats={visibleTiles:leaves,maxDepth:deepest,finestTileSize:finest,rootCenter:[rootX,rootZ]};
  }

  #ensureLevel(depth,tileSize,count){
    let level=this.levels.get(depth);
    if(level&&level.capacity>=count)return level;

    if(level){
      this.group.remove(level.mesh);
      level.mesh.dispose?.();
    }

    const capacity=Math.max(16,Math.pow(2,Math.ceil(Math.log2(Math.max(1,count)))));
    const material=this.#materialForDepth(depth,tileSize);
    const mesh=new THREE.InstancedMesh(this.geometry,material,capacity);
    mesh.name=`ocean-lod-${depth}`;
    mesh.frustumCulled=false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    level={mesh,capacity,tileSize};
    this.levels.set(depth,level);
    return level;
  }

  #materialForDepth(depth,tileSize){
    if(this.materials.has(depth))return this.materials.get(depth);
    const cellSize=tileSize/this.options.segments;
    const uniforms={
      uTime:{value:0},uStorm:{value:0},uSunDir:{value:new THREE.Vector3(.5,.78,.37).normalize()},
      uFogColor:{value:new THREE.Color(0xbad8e3)},uFogDensity:{value:.000014},uCellSize:{value:cellSize}
    };

    const material=new THREE.ShaderMaterial({
      uniforms,side:THREE.DoubleSide,
      vertexShader:`
        uniform float uTime,uStorm,uCellSize;
        varying vec3 vWorld,vNormalW;varying float vHeight;
        const float TAU=6.28318530718;
        void W(vec2 p,vec2 d,float L,float sp,float ph,float a0,float a1,inout float h,inout vec2 g){
          float detail=smoothstep(uCellSize*1.45,uCellSize*4.0,L);
          float a=mix(a0,a1,uStorm)*detail;
          vec2 D=normalize(d);float k=TAU/L;float q=k*dot(D,p)+k*sp*uTime+ph;
          h+=a*sin(q);g+=a*k*cos(q)*D;
        }
        void main(){
          vec4 local=vec4(position,1.0);
          #ifdef USE_INSTANCING
            local=instanceMatrix*local;
          #endif
          vec4 world=modelMatrix*local;
          vec2 p=world.xz;float h=0.;vec2 g=vec2(0.);
          W(p,vec2(.88,.47),18.,5.,.2,.12,1.15,h,g);
          W(p,vec2(-.31,.95),12.3,4.2,1.7,.07,.78,h,g);
          W(p,vec2(.57,-.82),8.2,3.4,4.,.04,.44,h,g);
          W(p,vec2(-.94,.33),5.2,2.7,2.4,.02,.21,h,g);
          W(p,vec2(.16,.98),2.8,1.9,5.,.01,.10,h,g);
          world.y+=h;
          vec3 n=normalize(vec3(-g.x,1.,-g.y));
          vWorld=world.xyz;vNormalW=n;vHeight=h;
          gl_Position=projectionMatrix*viewMatrix*world;
        }
      `,
      fragmentShader:`
        uniform float uStorm,uFogDensity;uniform vec3 uSunDir,uFogColor;
        varying vec3 vWorld,vNormalW;varying float vHeight;
        void main(){
          vec3 n=normalize(vNormalW),v=normalize(cameraPosition-vWorld),l=normalize(uSunDir),h=normalize(v+l);
          float ndl=max(dot(n,l),0.);float fres=pow(1.-max(dot(n,v),0.),4.);float spec=pow(max(dot(n,h),0.),mix(170.,55.,uStorm));
          vec3 calm=mix(vec3(.012,.16,.27),vec3(.045,.43,.63),.22+.54*ndl);
          vec3 rough=mix(vec3(.008,.055,.085),vec3(.045,.22,.29),.22+.54*ndl);vec3 col=mix(calm,rough,uStorm);
          col+=fres*mix(vec3(.19,.55,.78),vec3(.19,.27,.32),uStorm)*.7;
          float sparkle=pow(abs(sin(vWorld.x*5.7+vWorld.z*3.9+vHeight*12.)),18.);
          col+=vec3(1.,.86,.58)*spec*(1.2+.65*sparkle)*(1.-uStorm*.55);
          float foam=clamp(smoothstep(.85,1.8,vHeight)*uStorm+smoothstep(.42,.82,1.-n.y)*uStorm*.5,0.,.82);
          col=mix(col,vec3(.86,.92,.93),foam);
          float dist=length(cameraPosition-vWorld);
          float fog=1.-exp(-uFogDensity*uFogDensity*dist*dist);
          col=mix(col,uFogColor,clamp(fog,0.,1.));
          gl_FragColor=vec4(col,1.);
        }
      `
    });
    this.materials.set(depth,material);
    return material;
  }

  #nodeVisible(node){
    const h=node.size*.5;
    const box=new THREE.Box3(
      new THREE.Vector3(node.x-h,-this.options.waveBounds,node.z-h),
      new THREE.Vector3(node.x+h,this.options.waveBounds,node.z+h)
    );
    return this.frustum.intersectsBox(box);
  }

  #distanceToNode(camera,node){
    const h=node.size*.5;
    const dx=Math.max(Math.abs(camera.x-node.x)-h,0);
    const dz=Math.max(Math.abs(camera.z-node.z)-h,0);
    const dy=Math.max(Math.abs(camera.y)-this.options.waveBounds,0);
    return Math.hypot(dx,dy,dz);
  }

  heightAt(x,z,time,storm){
    let h=0;const TAU=Math.PI*2;
    for(const w of WAVE_DEFS){
      const len=Math.hypot(w.dir[0],w.dir[1]),dx=w.dir[0]/len,dz=w.dir[1]/len;
      const a=w.calm+(w.storm-w.calm)*storm,k=TAU/w.length;
      h+=a*Math.sin(k*(dx*x+dz*z)+k*w.speed*time+w.phase);
    }
    return h;
  }

  dispose(){
    for(const level of this.levels.values()){this.group.remove(level.mesh);level.mesh.dispose?.();}
    for(const material of this.materials.values())material.dispose();
    this.geometry.dispose();
    this.levels.clear();this.materials.clear();
  }
}
