import * as THREE from 'three';

const DEFAULTS={
  maxInstances:2200,
  rebuildInterval:.75,
  windDirection:new THREE.Vector2(.94,.34).normalize(),
  layers:[
    {id:'cumulus',cellSize:6000,radiusCells:6,baseAltitude:[900,1900],horizontalRadius:[350,1250],thickness:[220,700],baseDensity:.08,coverDensity:.48,stormDensity:.18,puffs:[7,15]},
    {id:'mid',cellSize:10000,radiusCells:5,baseAltitude:[3000,5200],horizontalRadius:[700,2200],thickness:[220,650],baseDensity:.025,coverDensity:.22,stormDensity:.14,puffs:[5,11]},
    {id:'storm',cellSize:13000,radiusCells:4,baseAltitude:[650,1250],horizontalRadius:[1200,3500],thickness:[1800,5600],baseDensity:0,coverDensity:.02,stormDensity:.34,puffs:[12,28]}
  ]
};

function hash32(x,z,salt=0){
  let h=(Math.imul(x|0,374761393)+Math.imul(z|0,668265263)+Math.imul(salt|0,1442695041))|0;
  h=h^(h>>>13);h=Math.imul(h,1274126177);return (h^(h>>>16))>>>0;
}

function rngFrom(seed){
  let a=seed>>>0;
  return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}

const mix=(a,b,t)=>a+(b-a)*t;

export class CloudField{
  constructor(scene,ocean,options={}){
    this.scene=scene;this.ocean=ocean;this.options={...DEFAULTS,...options};
    this.group=new THREE.Group();this.group.name='world-cloud-field';scene.add(this.group);

    this.geometry=new THREE.SphereGeometry(1,12,8);
    this.material=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,depthTest:true,side:THREE.FrontSide,
      blending:THREE.NormalBlending,
      uniforms:{
        uOpacity:{value:.86},uStorm:{value:0},uSunDir:{value:new THREE.Vector3(.5,.78,.37).normalize()},
        uFogColor:{value:new THREE.Color(0xbad8e3)},uFogDensity:{value:.000014}
      },
      vertexShader:`
        varying vec3 vWorld,vNormalW,vLocal,vColor;
        void main(){
          vec4 p=vec4(position,1.0);
          vec3 n=normal;
          #ifdef USE_INSTANCING
            p=instanceMatrix*p;
            n=mat3(instanceMatrix)*n;
          #endif
          vec4 world=modelMatrix*p;
          vWorld=world.xyz;
          vNormalW=normalize(mat3(modelMatrix)*n);
          vLocal=position;
          #ifdef USE_INSTANCING_COLOR
            vColor=instanceColor;
          #else
            vColor=vec3(1.0);
          #endif
          gl_Position=projectionMatrix*viewMatrix*world;
        }
      `,
      fragmentShader:`
        uniform float uOpacity,uStorm,uFogDensity;
        uniform vec3 uSunDir,uFogColor;
        varying vec3 vWorld,vNormalW,vLocal,vColor;

        float noise3(vec3 p){
          float a=sin(dot(p,vec3(1.71,2.31,1.17)));
          float b=sin(dot(p,vec3(3.13,-1.27,2.07))+1.73);
          float c=sin(dot(p,vec3(-2.11,1.93,3.07))+4.21);
          return .5+.5*(a+b+c)/3.;
        }

        void main(){
          vec3 n=normalize(vNormalW);
          vec3 viewDir=normalize(cameraPosition-vWorld);
          float facing=max(dot(n,viewDir),0.0);
          float edge=smoothstep(.02,.48,facing);
          float fine=noise3(vLocal*8.0+vWorld*.00055);
          float coarse=noise3(vLocal*3.0+vWorld*.00018);
          float breakup=mix(.72,1.0,.55*fine+.45*coarse);
          float underside=smoothstep(-.72,.38,vLocal.y);
          float sunlight=.34+.66*max(dot(n,normalize(uSunDir)),0.0);
          float silver=pow(max(dot(reflect(-normalize(uSunDir),n),viewDir),0.0),8.0);

          vec3 base=vColor;
          base*=mix(.58,1.04,underside);
          base*=mix(.68,1.0,sunlight);
          base+=vec3(1.0,.95,.86)*silver*.14*(1.0-uStorm*.6);

          float alpha=uOpacity*edge*breakup;
          alpha*=smoothstep(.38,.7,coarse+.18);
          if(alpha<.025)discard;

          float dist=length(cameraPosition-vWorld);
          float fog=1.-exp(-uFogDensity*uFogDensity*dist*dist);
          vec3 color=mix(base,uFogColor,clamp(fog,0.,1.));
          gl_FragColor=vec4(color,alpha);
        }
      `
    });

    this.mesh=new THREE.InstancedMesh(this.geometry,this.material,this.options.maxInstances);
    this.mesh.name='cloud-puffs';this.mesh.frustumCulled=false;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.group.add(this.mesh);

    this.airOffset=new THREE.Vector2();
    this._matrix=new THREE.Matrix4();this._position=new THREE.Vector3();this._scale=new THREE.Vector3();this._quaternion=new THREE.Quaternion();
    this._normal=new THREE.Vector3();this._up=new THREE.Vector3(0,1,0);this._yawQ=new THREE.Quaternion();
    this._lastBuildTime=-Infinity;this._lastCell='';this._lastCover=-1;this._lastStorm=-1;
    this.stats={clouds:0,puffs:0,lowAltitude:[900,1900],midAltitude:[3000,5200],stormTop:0};
  }

  update(dt,{time=0,cloud=0,storm=0,wind=0,camera,viewportHeight=720}={}){
    if(!camera)return;
    const windSpeed=Math.max(0,Number(wind)||0);
    this.airOffset.addScaledVector(this.options.windDirection,windSpeed*Math.max(0,dt));
    this.group.position.set(this.airOffset.x,0,this.airOffset.y);

    this.material.uniforms.uOpacity.value=mix(.66,.93,Math.max(cloud,storm*.82));
    this.material.uniforms.uStorm.value=storm;
    if(this.scene.fog){this.material.uniforms.uFogColor.value.copy(this.scene.fog.color);this.material.uniforms.uFogDensity.value=this.scene.fog.density;}

    const localCameraX=camera.position.x-this.airOffset.x,localCameraZ=camera.position.z-this.airOffset.y;
    const coarseCell=5000,cellKey=`${Math.floor(localCameraX/coarseCell)},${Math.floor(localCameraZ/coarseCell)}`;
    const needsBuild=(time-this._lastBuildTime>=this.options.rebuildInterval)||cellKey!==this._lastCell||Math.abs(cloud-this._lastCover)>.035||Math.abs(storm-this._lastStorm)>.035;
    if(!needsBuild)return;

    this._lastBuildTime=time;this._lastCell=cellKey;this._lastCover=cloud;this._lastStorm=storm;
    this.#rebuild(camera,viewportHeight,cloud,storm,localCameraX,localCameraZ);
  }

  #rebuild(camera,viewportHeight,cover,storm,cameraAirX,cameraAirZ){
    let instance=0,cloudCount=0,stormTop=0;
    const effectiveFov=THREE.MathUtils.degToRad(camera.getEffectiveFOV?.()??camera.fov??50);
    const pixelsPerWorldAtUnit=Math.max(1,viewportHeight)/(2*Math.tan(effectiveFov*.5));

    outer:
    for(let layerIndex=0;layerIndex<this.options.layers.length;layerIndex++){
      const layer=this.options.layers[layerIndex];
      const centerX=Math.floor(cameraAirX/layer.cellSize),centerZ=Math.floor(cameraAirZ/layer.cellSize);
      const density=Math.min(.88,layer.baseDensity+layer.coverDensity*cover+layer.stormDensity*storm);

      for(let iz=centerZ-layer.radiusCells;iz<=centerZ+layer.radiusCells;iz++){
        for(let ix=centerX-layer.radiusCells;ix<=centerX+layer.radiusCells;ix++){
          const cellDx=(ix+.5)*layer.cellSize-cameraAirX,cellDz=(iz+.5)*layer.cellSize-cameraAirZ;
          if(Math.hypot(cellDx,cellDz)>layer.radiusCells*layer.cellSize*1.08)continue;

          const rand=rngFrom(hash32(ix,iz,layerIndex+17));
          if(rand()>density)continue;

          const cx=(ix+rand())*layer.cellSize,cz=(iz+rand())*layer.cellSize;
          const worldX=cx+this.airOffset.x,worldZ=cz+this.airOffset.y;
          const altitude=mix(layer.baseAltitude[0],layer.baseAltitude[1],rand());
          const radius=mix(layer.horizontalRadius[0],layer.horizontalRadius[1],Math.pow(rand(),.72));
          const thickness=mix(layer.thickness[0],layer.thickness[1],rand());
          const worldY=this.ocean.curvatureHeightAt(worldX,worldZ)+altitude;
          const distance=Math.max(50,Math.hypot(worldX-camera.position.x,worldY-camera.position.y,worldZ-camera.position.z));
          const projectedRadius=radius*pixelsPerWorldAtUnit/distance;
          const lodFactor=projectedRadius>150?1:projectedRadius>60?.72:projectedRadius>24?.48:.28;
          const puffCount=Math.max(3,Math.round(mix(layer.puffs[0],layer.puffs[1],rand())*lodFactor));
          cloudCount++;

          const isStorm=layer.id==='storm';
          for(let p=0;p<puffCount;p++){
            if(instance>=this.options.maxInstances)break outer;
            const angle=rand()*Math.PI*2,radial=Math.sqrt(rand());
            const xOff=Math.cos(angle)*radius*radial,zOff=Math.sin(angle)*radius*radial;
            let yOff;
            if(isStorm){const tower=Math.pow(rand(),.65);yOff=tower*thickness;stormTop=Math.max(stormTop,altitude+yOff);}
            else yOff=(Math.pow(rand(),.7)-.22)*thickness;

            const px=cx+xOff,pz=cz+zOff,pxWorld=px+this.airOffset.x,pzWorld=pz+this.airOffset.y;
            const py=this.ocean.curvatureHeightAt(pxWorld,pzWorld)+altitude+yOff;
            const horizontalScale=radius*mix(.16,.34,rand())*(isStorm?mix(.8,1.25,rand()):1);
            const verticalScale=isStorm?Math.max(90,thickness*mix(.055,.13,rand())):Math.max(55,thickness*mix(.22,.5,rand()));

            this._position.set(px,py,pz);
            this.#localNormal(pxWorld,pzWorld,this._normal);
            this._quaternion.setFromUnitVectors(this._up,this._normal);
            this._yawQ.setFromAxisAngle(this._normal,rand()*Math.PI*2);this._quaternion.premultiply(this._yawQ);
            this._scale.set(horizontalScale,verticalScale,horizontalScale*mix(.72,1.12,rand()));
            this._matrix.compose(this._position,this._quaternion,this._scale);this.mesh.setMatrixAt(instance,this._matrix);

            const heightT=isStorm?Math.min(1,yOff/Math.max(1,thickness)):Math.min(1,Math.max(0,yOff/thickness+.25));
            const baseColor=isStorm?new THREE.Color(.39,.43,.47):new THREE.Color(.80,.85,.88),topColor=isStorm?new THREE.Color(.76,.79,.81):new THREE.Color(1,1,1);
            baseColor.lerp(topColor,heightT);this.mesh.setColorAt(instance,baseColor);instance++;
          }
        }
      }
    }

    this.mesh.count=instance;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
    this.stats={clouds:cloudCount,puffs:instance,lowAltitude:[900,1900],midAltitude:[3000,5200],stormTop};
  }

  #localNormal(x,z,target){const R=this.ocean.options.earthRadius,radialY=Math.sqrt(Math.max(1,R*R-x*x-z*z));return target.set(x,radialY,z).normalize();}

  dispose(){this.scene.remove(this.group);this.geometry.dispose();this.material.dispose();this.mesh.dispose?.();}
}
