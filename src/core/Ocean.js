import * as THREE from 'three';

const STANDARD_WAVES=[
  {dir:[.88,.47],length:24,speed:6.1,phase:.2,weight:.43},
  {dir:[-.31,.95],length:14.5,speed:4.8,phase:1.7,weight:.28},
  {dir:[.57,-.82],length:8.5,speed:3.7,phase:4,weight:.16},
  {dir:[-.94,.33],length:4.7,speed:2.8,phase:2.4,weight:.09},
  {dir:[.16,.98],length:2.5,speed:2.0,phase:5,weight:.04}
];

// Longer, physically plausible components for the high-detail geometric mode.
// Weights sum to 1: waveHeight therefore represents approximate trough-to-crest
// height, with the theoretical sum of crest amplitudes equal to waveHeight / 2.
const GERSTNER_WAVES=[
  {dir:[.92,.39],length:120,speed:13.7,phase:.15,weight:.36},
  {dir:[.73,.68],length:72,speed:10.6,phase:2.05,weight:.24},
  {dir:[-.22,.98],length:42,speed:8.1,phase:4.1,weight:.17},
  {dir:[.54,-.84],length:24,speed:6.1,phase:1.25,weight:.11},
  {dir:[-.91,.41],length:13,speed:4.5,phase:3.4,weight:.07},
  {dir:[.12,.99],length:6.5,speed:3.2,phase:5.2,weight:.05}
];

const PROFILES={
  standard:{segments:12,minTileSize:8,targetTilePixels:190,maxLeaves:6500,lodIntervalMs:70,skirtDepth:10,geometric:false},
  geometric:{segments:24,minTileSize:4,targetTilePixels:115,maxLeaves:8500,lodIntervalMs:50,skirtDepth:24,geometric:true}
};

const DEFAULTS={
  rootSize:2097152,
  rootStride:262144,
  waveBounds:16,
  earthRadius:6371000,
  mode:'standard',
  waveHeight:.35,
  maxWaveHeight:15
};

function makeTileGeometry(segments,skirtDepth){
  const positions=[],indices=[],row=segments+1;
  for(let z=0;z<=segments;z++)for(let x=0;x<=segments;x++)positions.push(x/segments-.5,0,z/segments-.5);
  for(let z=0;z<segments;z++)for(let x=0;x<segments;x++){const a=z*row+x,b=a+1,c=a+row,d=c+1;indices.push(a,c,b,b,c,d);}

  const addSkirt=(edge)=>{
    const bottom=[];
    for(const topIndex of edge){const p=topIndex*3;bottom.push(positions.length/3);positions.push(positions[p],-skirtDepth,positions[p+2]);}
    for(let i=0;i<edge.length-1;i++){const a=edge[i],b=edge[i+1],aa=bottom[i],bb=bottom[i+1];indices.push(a,aa,b,b,aa,bb);}
  };
  const north=[],south=[],west=[],east=[];
  for(let i=0;i<=segments;i++){north.push(i);south.push(segments*row+i);west.push(i*row);east.push(i*row+segments);}
  addSkirt(north);addSkirt(south);addSkirt(west);addSkirt(east);

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}

export class Ocean{
  constructor(options={}){
    this.options={...DEFAULTS,...options};
    this.mode=this.options.mode in PROFILES?this.options.mode:'standard';
    this.waveHeight=THREE.MathUtils.clamp(Number(this.options.waveHeight)||0,0,this.options.maxWaveHeight);
    this.group=new THREE.Group();this.group.name='world-ocean';this.mesh=this.group;
    this.levels=new Map();this.materials=new Map();this.geometry=null;
    this.matrixDummy=new THREE.Object3D();this.frustum=new THREE.Frustum();this.projectionView=new THREE.Matrix4();
    this.lastLodUpdate=-Infinity;this.viewportHeight=720;
    this.stats={visibleTiles:0,maxDepth:0,finestTileSize:this.options.rootSize,rootCenter:[0,0],mode:this.mode,waveHeight:this.waveHeight};
    this.#createGeometry();
  }

  get profile(){return PROFILES[this.mode];}

  setMode(mode){
    const normalized=mode==='geometric'?'geometric':'standard';
    if(normalized===this.mode)return this.mode;
    this.mode=normalized;this.#clearRenderResources();this.#createGeometry();this.lastLodUpdate=-Infinity;
    return this.mode;
  }

  setWaveHeight(meters){
    this.waveHeight=THREE.MathUtils.clamp(Number(meters)||0,0,this.options.maxWaveHeight);
    for(const material of this.materials.values())material.uniforms.uWaveHeight.value=this.waveHeight;
    return this.waveHeight;
  }

  update(time,storm,camera=null,fog=null,viewportHeight=null){
    if(viewportHeight)this.viewportHeight=Math.max(1,viewportHeight);
    for(const material of this.materials.values()){
      material.uniforms.uTime.value=time;material.uniforms.uStorm.value=storm;material.uniforms.uWaveHeight.value=this.waveHeight;
      if(fog){material.uniforms.uFogColor.value.copy(fog.color);material.uniforms.uFogDensity.value=fog.density;}
    }
    if(!camera)return;
    const now=performance.now();
    if(now-this.lastLodUpdate>=this.profile.lodIntervalMs){this.lastLodUpdate=now;this.#rebuildLod(camera);}
  }

  #createGeometry(){this.geometry=makeTileGeometry(this.profile.segments,this.profile.skirtDepth);}

  #clearRenderResources(){
    for(const level of this.levels.values()){this.group.remove(level.mesh);level.mesh.dispose?.();}
    for(const material of this.materials.values())material.dispose();
    this.levels.clear();this.materials.clear();this.geometry?.dispose?.();
  }

  #rebuildLod(camera){
    camera.updateMatrixWorld(true);this.projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projectionView);
    const rootSize=this.options.rootSize,stride=this.options.rootStride,rootX=Math.round(camera.position.x/stride)*stride,rootZ=Math.round(camera.position.z/stride)*stride;
    const maxDepth=Math.floor(Math.log2(rootSize/this.profile.minTileSize));
    const effectiveFov=THREE.MathUtils.degToRad(camera.getEffectiveFOV?.()??camera.fov??50),pixelsPerWorldAtUnit=this.viewportHeight/(2*Math.tan(effectiveFov*.5));
    const buckets=new Map(),stack=[{x:rootX,z:rootZ,size:rootSize,depth:0}];let leaves=0,deepest=0,finest=rootSize,nodes=0;const maxNodes=this.profile.maxLeaves*8;

    while(stack.length){
      const node=stack.pop();nodes++;const bounds=this.#nodeBounds(node);if(!this.frustum.intersectsBox(bounds))continue;
      const distance=Math.max(.5,bounds.distanceToPoint(camera.position)),projected=node.size*pixelsPerWorldAtUnit/distance;
      const canSplit=node.depth<maxDepth&&node.size*.5>=this.profile.minTileSize,budgetOk=leaves+stack.length<this.profile.maxLeaves&&nodes<maxNodes;
      if(projected>this.profile.targetTilePixels&&canSplit&&budgetOk){
        const childSize=node.size*.5,o=childSize*.5,d=node.depth+1;
        stack.push({x:node.x-o,z:node.z-o,size:childSize,depth:d},{x:node.x+o,z:node.z-o,size:childSize,depth:d},{x:node.x-o,z:node.z+o,size:childSize,depth:d},{x:node.x+o,z:node.z+o,size:childSize,depth:d});
      }else{
        if(!buckets.has(node.depth))buckets.set(node.depth,[]);buckets.get(node.depth).push(node);leaves++;deepest=Math.max(deepest,node.depth);finest=Math.min(finest,node.size);
      }
    }

    for(const [depth,level] of this.levels)if(!buckets.has(depth))level.mesh.count=0;
    for(const [depth,nodesAtDepth] of buckets){
      const tileSize=rootSize/Math.pow(2,depth),level=this.#ensureLevel(depth,tileSize,nodesAtDepth.length),mesh=level.mesh;mesh.count=nodesAtDepth.length;
      for(let i=0;i<nodesAtDepth.length;i++){const node=nodesAtDepth[i];this.matrixDummy.position.set(node.x,0,node.z);this.matrixDummy.rotation.set(0,0,0);this.matrixDummy.scale.set(node.size,1,node.size);this.matrixDummy.updateMatrix();mesh.setMatrixAt(i,this.matrixDummy.matrix);}
      mesh.instanceMatrix.needsUpdate=true;
    }
    this.stats={visibleTiles:leaves,maxDepth:deepest,finestTileSize:finest,rootCenter:[rootX,rootZ],mode:this.mode,waveHeight:this.waveHeight};
  }

  #ensureLevel(depth,tileSize,count){
    let level=this.levels.get(depth);if(level&&level.capacity>=count)return level;
    if(level){this.group.remove(level.mesh);level.mesh.dispose?.();}
    const capacity=Math.max(16,Math.pow(2,Math.ceil(Math.log2(Math.max(1,count))))),material=this.#materialForDepth(depth,tileSize),mesh=new THREE.InstancedMesh(this.geometry,material,capacity);
    mesh.name=`ocean-${this.mode}-lod-${depth}`;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(mesh);level={mesh,capacity,tileSize};this.levels.set(depth,level);return level;
  }

  #materialForDepth(depth,tileSize){
    if(this.materials.has(depth))return this.materials.get(depth);
    const cellSize=tileSize/this.profile.segments;
    const uniforms={uTime:{value:0},uStorm:{value:0},uWaveHeight:{value:this.waveHeight},uGeometric:{value:this.profile.geometric?1:0},uSunDir:{value:new THREE.Vector3(.5,.78,.37).normalize()},uFogColor:{value:new THREE.Color(0xbad8e3)},uFogDensity:{value:.000014},uCellSize:{value:cellSize},uEarthRadius:{value:this.options.earthRadius}};

    const material=new THREE.ShaderMaterial({uniforms,side:THREE.DoubleSide,
      vertexShader:`
        uniform float uTime,uStorm,uWaveHeight,uGeometric,uCellSize,uEarthRadius;
        varying vec3 vWorld,vNormalW;varying float vHeight;
        const float TAU=6.28318530718;
        void SW(vec2 p,vec2 d,float L,float sp,float ph,float weight,inout float h,inout vec2 g){
          float detail=smoothstep(uCellSize*1.35,uCellSize*4.0,L);
          float a=.5*uWaveHeight*weight*detail;vec2 D=normalize(d);float k=TAU/L;float q=k*dot(D,p)+k*sp*uTime+ph;
          h+=a*sin(q);g+=a*k*cos(q)*D;
        }
        void GW(vec2 p,vec2 d,float L,float sp,float ph,float weight,inout float h,inout vec2 g,inout vec2 horizontal){
          float detail=smoothstep(uCellSize*1.25,uCellSize*3.6,L);
          float a=.5*uWaveHeight*weight*detail;vec2 D=normalize(d);float k=TAU/L;float q=k*dot(D,p)+k*sp*uTime+ph;
          float steep=min(.82,.18+uStorm*.48);
          h+=a*sin(q);g+=a*k*cos(q)*D;horizontal+=D*(a*steep*cos(q));
        }
        void main(){
          vec4 local=vec4(position,1.0);
          #ifdef USE_INSTANCING
            local=instanceMatrix*local;
          #endif
          vec4 world=modelMatrix*local;vec2 p=world.xz;float h=0.;vec2 g=vec2(0.),horizontal=vec2(0.);
          if(uGeometric>.5){
            GW(p,vec2(.92,.39),120.,13.7,.15,.36,h,g,horizontal);
            GW(p,vec2(.73,.68),72.,10.6,2.05,.24,h,g,horizontal);
            GW(p,vec2(-.22,.98),42.,8.1,4.1,.17,h,g,horizontal);
            GW(p,vec2(.54,-.84),24.,6.1,1.25,.11,h,g,horizontal);
            GW(p,vec2(-.91,.41),13.,4.5,3.4,.07,h,g,horizontal);
            GW(p,vec2(.12,.99),6.5,3.2,5.2,.05,h,g,horizontal);
            world.xz+=horizontal;
          }else{
            SW(p,vec2(.88,.47),24.,6.1,.2,.43,h,g);
            SW(p,vec2(-.31,.95),14.5,4.8,1.7,.28,h,g);
            SW(p,vec2(.57,-.82),8.5,3.7,4.,.16,h,g);
            SW(p,vec2(-.94,.33),4.7,2.8,2.4,.09,h,g);
            SW(p,vec2(.16,.98),2.5,2.,5.,.04,h,g);
          }
          float r2=dot(world.xz,world.xz),radialY=sqrt(max(uEarthRadius*uEarthRadius-r2,1.0)),sphereY=radialY-uEarthRadius;world.y+=sphereY+h;
          vec3 sphereNormal=normalize(vec3(world.x,radialY,world.z));vec3 n=normalize(sphereNormal+vec3(-g.x,0.,-g.y));
          vWorld=world.xyz;vNormalW=n;vHeight=h;gl_Position=projectionMatrix*viewMatrix*world;
        }
      `,
      fragmentShader:`
        uniform float uStorm,uFogDensity,uWaveHeight;uniform vec3 uSunDir,uFogColor;varying vec3 vWorld,vNormalW;varying float vHeight;
        void main(){
          vec3 n=normalize(vNormalW),v=normalize(cameraPosition-vWorld),l=normalize(uSunDir),h=normalize(v+l);float ndl=max(dot(n,l),0.);float fres=pow(1.-max(dot(n,v),0.),4.);float spec=pow(max(dot(n,h),0.),mix(170.,42.,uStorm));
          vec3 calm=mix(vec3(.012,.16,.27),vec3(.045,.43,.63),.22+.54*ndl),rough=mix(vec3(.008,.055,.085),vec3(.045,.22,.29),.22+.54*ndl),col=mix(calm,rough,uStorm);
          col+=fres*mix(vec3(.19,.55,.78),vec3(.19,.27,.32),uStorm)*.7;float sparkle=pow(abs(sin(vWorld.x*5.7+vWorld.z*3.9+vHeight*12.)),18.);col+=vec3(1.,.86,.58)*spec*(1.2+.65*sparkle)*(1.-uStorm*.55);
          float foamThreshold=max(.25,uWaveHeight*.18),foam=clamp(smoothstep(foamThreshold,foamThreshold*1.8,max(vHeight,0.))*uStorm+smoothstep(.42,.82,1.-n.y)*(.25+.65*uStorm),0.,.88);col=mix(col,vec3(.86,.92,.93),foam);
          float dist=length(cameraPosition-vWorld),fog=1.-exp(-uFogDensity*uFogDensity*dist*dist);col=mix(col,uFogColor,clamp(fog,0.,1.));gl_FragColor=vec4(col,1.);
        }
      `});
    this.materials.set(depth,material);return material;
  }

  #nodeBounds(node){
    const h=node.size*.5,x0=node.x-h,x1=node.x+h,z0=node.z-h,z1=node.z+h,closestX=x0>0?x0:(x1<0?x1:0),closestZ=z0>0?z0:(z1<0?z1:0);
    const heights=[this.curvatureHeightAt(x0,z0),this.curvatureHeightAt(x1,z0),this.curvatureHeightAt(x0,z1),this.curvatureHeightAt(x1,z1),this.curvatureHeightAt(closestX,closestZ)];
    const waveMargin=Math.max(this.options.waveBounds,this.waveHeight*.7+this.profile.skirtDepth);
    return new THREE.Box3(new THREE.Vector3(x0,Math.min(...heights)-waveMargin,z0),new THREE.Vector3(x1,Math.max(...heights)+waveMargin,z1));
  }

  curvatureHeightAt(x,z){const R=this.options.earthRadius,r2=x*x+z*z;if(r2>=R*R)return -R;return Math.sqrt(R*R-r2)-R;}

  #standardWaveHeight(x,z,time){
    let h=0;const TAU=Math.PI*2;
    for(const w of STANDARD_WAVES){const len=Math.hypot(w.dir[0],w.dir[1]),dx=w.dir[0]/len,dz=w.dir[1]/len,a=.5*this.waveHeight*w.weight,k=TAU/w.length;h+=a*Math.sin(k*(dx*x+dz*z)+k*w.speed*time+w.phase);}
    return h;
  }

  #gerstnerAtParam(x,z,time,storm){
    let h=0,dxOut=0,dzOut=0;const TAU=Math.PI*2,steep=Math.min(.82,.18+storm*.48);
    for(const w of GERSTNER_WAVES){
      const len=Math.hypot(w.dir[0],w.dir[1]),dx=w.dir[0]/len,dz=w.dir[1]/len,a=.5*this.waveHeight*w.weight,k=TAU/w.length,q=k*(dx*x+dz*z)+k*w.speed*time+w.phase,c=Math.cos(q);
      h+=a*Math.sin(q);dxOut+=dx*a*steep*c;dzOut+=dz*a*steep*c;
    }
    return {height:h,dx:dxOut,dz:dzOut};
  }

  waveHeightAt(x,z,time,storm=0){
    if(this.mode!=='geometric')return this.#standardWaveHeight(x,z,time);
    // Gerstner waves move vertices horizontally. Invert that mapping iteratively so
    // buoyancy and sea-height constraints sample the visible surface at world X/Z.
    let px=x,pz=z,sample=null;
    for(let i=0;i<4;i++){sample=this.#gerstnerAtParam(px,pz,time,storm);px-=((px+sample.dx)-x)*.9;pz-=((pz+sample.dz)-z)*.9;}
    return (sample??this.#gerstnerAtParam(px,pz,time,storm)).height;
  }

  heightAt(x,z,time,storm=0){return this.curvatureHeightAt(x,z)+this.waveHeightAt(x,z,time,storm);}

  dispose(){this.#clearRenderResources();}
}
