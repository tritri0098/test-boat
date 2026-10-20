import * as THREE from 'three';

const WAVE_DEFS = [
  { dir:[0.88,0.47], length:18.0, speed:5.0, phase:0.2, calm:0.12, storm:1.15 },
  { dir:[-0.31,0.95], length:12.3, speed:4.2, phase:1.7, calm:0.07, storm:0.78 },
  { dir:[0.57,-0.82], length:8.2, speed:3.4, phase:4.0, calm:0.04, storm:0.44 },
  { dir:[-0.94,0.33], length:5.2, speed:2.7, phase:2.4, calm:0.02, storm:0.21 },
  { dir:[0.16,0.98], length:2.8, speed:1.9, phase:5.0, calm:0.01, storm:0.10 }
];

export class Ocean {
  constructor() {
    this.uniforms = {
      uTime:{ value:0 },
      uStorm:{ value:0 },
      uSunDir:{ value:new THREE.Vector3(0.5,0.78,0.37).normalize() }
    };

    const geometry = new THREE.PlaneGeometry(100,100,180,180);
    geometry.rotateX(-Math.PI/2);

    const material = new THREE.ShaderMaterial({
      uniforms:this.uniforms,
      side:THREE.DoubleSide,
      vertexShader:`
        uniform float uTime,uStorm;
        varying vec3 vWorld,vNormalW;
        varying float vHeight;
        const float TAU=6.28318530718;
        void W(vec2 p,vec2 d,float L,float sp,float ph,float a0,float a1,inout float h,inout vec2 g){
          float a=mix(a0,a1,uStorm); vec2 D=normalize(d); float k=TAU/L;
          float q=k*dot(D,p)+k*sp*uTime+ph; h+=a*sin(q); g+=a*k*cos(q)*D;
        }
        void main(){
          vec3 pos=position; vec2 p=pos.xz; float h=0.; vec2 g=vec2(0.);
          W(p,vec2(.88,.47),18.,5.,.2,.12,1.15,h,g);
          W(p,vec2(-.31,.95),12.3,4.2,1.7,.07,.78,h,g);
          W(p,vec2(.57,-.82),8.2,3.4,4.,.04,.44,h,g);
          W(p,vec2(-.94,.33),5.2,2.7,2.4,.02,.21,h,g);
          W(p,vec2(.16,.98),2.8,1.9,5.,.01,.10,h,g);
          pos.y=h; vec3 n=normalize(vec3(-g.x,1.,-g.y));
          vec4 wp=modelMatrix*vec4(pos,1.); vWorld=wp.xyz; vNormalW=normalize(mat3(modelMatrix)*n); vHeight=h;
          gl_Position=projectionMatrix*viewMatrix*wp;
        }
      `,
      fragmentShader:`
        uniform float uStorm; uniform vec3 uSunDir;
        varying vec3 vWorld,vNormalW; varying float vHeight;
        void main(){
          vec3 n=normalize(vNormalW),v=normalize(cameraPosition-vWorld),l=normalize(uSunDir),h=normalize(v+l);
          float ndl=max(dot(n,l),0.); float fres=pow(1.-max(dot(n,v),0.),4.);
          float spec=pow(max(dot(n,h),0.),mix(170.,55.,uStorm));
          vec3 calm=mix(vec3(.012,.16,.27),vec3(.045,.43,.63),.22+.54*ndl);
          vec3 rough=mix(vec3(.008,.055,.085),vec3(.045,.22,.29),.22+.54*ndl);
          vec3 col=mix(calm,rough,uStorm);
          col+=fres*mix(vec3(.19,.55,.78),vec3(.19,.27,.32),uStorm)*.7;
          float sparkle=pow(abs(sin(vWorld.x*5.7+vWorld.z*3.9+vHeight*12.)),18.);
          col+=vec3(1.,.86,.58)*spec*(1.2+.65*sparkle)*(1.-uStorm*.55);
          float foam=clamp(smoothstep(.85,1.8,vHeight)*uStorm+smoothstep(.42,.82,1.-n.y)*uStorm*.5,0.,.82);
          col=mix(col,vec3(.86,.92,.93),foam);
          gl_FragColor=vec4(col,1.);
        }
      `
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  update(time, storm) {
    this.uniforms.uTime.value = time;
    this.uniforms.uStorm.value = storm;
  }

  heightAt(x,z,time,storm) {
    let h = 0;
    const TAU = Math.PI * 2;
    for (const w of WAVE_DEFS) {
      const len = Math.hypot(w.dir[0], w.dir[1]);
      const dx = w.dir[0] / len;
      const dz = w.dir[1] / len;
      const a = w.calm + (w.storm - w.calm) * storm;
      const k = TAU / w.length;
      h += a * Math.sin(k * (dx*x + dz*z) + k*w.speed*time + w.phase);
    }
    return h;
  }
}
