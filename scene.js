import * as T from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { towers, clamp, stateAt } from './model.js';
import { G, hash, solveDescent, descentAt, collapseSeconds, timelineForOther, impactDamage } from './dynamics.js';

const BOX = new T.BoxGeometry(1, 1, 1), PANEL = new T.PlaneGeometry(1, 1);
const UP = new T.Vector3(0, 1, 0), tmp = new T.Object3D(), vector = new T.Vector3();
const tempMatrix = new T.Matrix4(), color = new T.Color();
const mechanical = new Set([7, 8, 41, 42, 75, 76, 108, 109]);
const positions = [new T.Vector3(-55, 0, -55), new T.Vector3(55, 0, 55)];

function material(color, roughness = .65, metalness = .05, extra = {}) {
  return new T.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
function addBox(parent, mat, x, y, z, sx, sy, sz) {
  const m = new T.Mesh(BOX, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function addBeam(parent, mat, a, b, width, depth = width) {
  const m = new T.Mesh(BOX, mat); m.position.copy(a).add(b).multiplyScalar(.5);
  vector.copy(b).sub(a); m.quaternion.setFromUnitVectors(UP, vector.clone().normalize());
  m.scale.set(width, vector.length(), depth); parent.add(m); return m;
}
function instanced(parent, geometry, mat, count) {
  const m = new T.InstancedMesh(geometry, mat, count);
  m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.frustumCulled = false;
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function setInstance(mesh, i, x, y, z, sx, sy, sz, rotation = 0, floorMatrix = null) {
  tmp.position.set(x, y, z); tmp.rotation.set(0, rotation, 0); tmp.scale.set(sx, sy, sz); tmp.updateMatrix();
  if (floorMatrix) tempMatrix.multiplyMatrices(floorMatrix, tmp.matrix);
  mesh.setMatrixAt(i, floorMatrix ? tempMatrix : tmp.matrix);
}

function batchBoxes(parent, mat) {
  const children = parent.children.filter(o => o.isMesh && o.geometry === BOX);
  if (!children.length) return;
  const mesh = instanced(parent, BOX, mat, children.length);
  children.forEach((child, i) => { child.updateMatrix(); mesh.setMatrixAt(i, child.matrix); parent.remove(child); });
  mesh.instanceMatrix.needsUpdate = true;
}

function facadeMaterial() {
  const mat = material(0xffffff, .36, .32, { side: T.DoubleSide });
  mat.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 panelUV;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\npanelUV = uv;');
    shader.fragmentShader = 'varying vec2 panelUV;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float spandrel = step(0.73, panelUV.y);
      float edge = step(0.985, panelUV.x) + step(panelUV.x, 0.015);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5 + vec3(.23), clamp(spandrel + edge, 0., 1.));
    `);
  };
  return mat;
}

// Reusable instanced camera-facing smoke/fire quads. All noise is deterministic.
// These are optical effects, not a combustion or fluid-dynamics simulation.
class CloudLayer {
  constructor(parent, count, mode) {
    this.count = count;
    const geo = new T.InstancedBufferGeometry();
    geo.index = PANEL.index; geo.attributes.position = PANEL.attributes.position; geo.attributes.uv = PANEL.attributes.uv;
    for (const [name, n] of [['aCenter', 3], ['aSize', 2], ['aAlpha', 1], ['aSeed', 1]]) {
      geo.setAttribute(name, new T.InstancedBufferAttribute(new Float32Array(count * n), n).setUsage(T.DynamicDrawUsage));
    }
    geo.instanceCount = count;
    const mat = new T.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMode: { value: mode } }, transparent: true, depthWrite: false,
      vertexShader: `attribute vec3 aCenter; attribute vec2 aSize; attribute float aAlpha; attribute float aSeed;
        varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vDepth;
        void main(){vUv=uv;vAlpha=aAlpha;vSeed=aSeed;vec4 center=modelViewMatrix*vec4(aCenter,1.);
        float ang=aSeed*6.283;vec2 q=position.xy*aSize; q=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*q;
        center.xy+=q;vDepth=-center.z;gl_Position=projectionMatrix*center;}`,
      fragmentShader: `precision highp float; varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vDepth;
        uniform float uTime; uniform float uMode;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){float v=0.;v+=noise(p)*.5;p=p*2.03+17.;v+=noise(p)*.25;p=p*2.01+7.;v+=noise(p)*.125;return v;}
        void main(){vec2 p=vUv*2.-1.;float r=length(p);if(r>1.)discard;
        float n=fbm(p*3.6+vSeed*71.+vec2(uTime*.045,-uTime*.07));
        float billow=1.-smoothstep(.43,.98,r+(n-.42)*.35);
        float density=billow*(.4+n*.95);float light=clamp(.62+p.y*.19-p.x*.13+n*.25,0.,1.);
        vec3 tint=mix(vec3(.105,.115,.12),vec3(.41,.43,.44),light);
        if(uMode>1.5)tint=mix(vec3(.40,.38,.34),vec3(.71,.69,.63),light);
        if(uMode>.5&&uMode<1.5){float heat=clamp((1.-r)*1.3+n*.4,0.,1.);tint=mix(vec3(.32,.065,.01),vec3(1.,.36,.025),smoothstep(.1,.55,heat));tint=mix(tint,vec3(1.,.84,.29),smoothstep(.63,1.,heat));}
        float alpha=clamp(density*vAlpha,0.,.92);if(alpha<.005)discard;
        tint=mix(tint,vec3(.64,.74,.79),smoothstep(650.,2000.,vDepth)*.4);
        gl_FragColor=vec4(tint,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`
    });
    this.mesh = new T.Mesh(geo, mat); this.mesh.frustumCulled = false;
    this.mesh.renderOrder = mode === 1 ? 3 : 4; parent.add(this.mesh);
    for (let i = 0; i < count; i++) geo.attributes.aSeed.setX(i, hash(i * 7.3 + mode));
  }
  set(i, x, y, z, size, alpha, stretch = 1) {
    const a = this.mesh.geometry.attributes;
    a.aCenter.setXYZ(i, x, y, z); a.aSize.setXY(i, size, size * stretch); a.aAlpha.setX(i, alpha);
  }
  flush(clock) {
    this.mesh.material.uniforms.uTime.value = clock;
    for (const name of ['aCenter', 'aSize', 'aAlpha']) this.mesh.geometry.attributes[name].needsUpdate = true;
  }
}

export class Tower {
  constructor(scene, index, mats) {
    this.index = index; this.d = towers[index]; this.h = this.d.height / 110;
    this.group = new T.Group(); this.group.position.copy(positions[index]); scene.add(this.group);
    this.solution = solveDescent(index); this.previous = -999; this.lastCut = false;
    this.frame = instanced(this.group, BOX, mats.aluminum, 110 * 236);
    this.facade = instanced(this.group, PANEL, mats.facade, 110 * 232);
    this.core = instanced(this.group, BOX, mats.core, 110 * 47);
    this.floors = instanced(this.group, BOX, mats.concrete, 110 * 4);
    this.fragments = instanced(this.group, BOX, mats.debris, 850);
    this.rubble = instanced(this.group, BOX, mats.debris, 350);
    this.base = new T.Group(); this.group.add(this.base);
    for (let face = 0; face < 4; face++) {
      const v = (lateral, y) => face % 2 ? new T.Vector3(face === 1 ? 31.6 : -31.6, y, lateral) : new T.Vector3(lateral, y, face === 0 ? -31.6 : 31.6);
      for (let k = 1; k < 59; k += 3) {
        const p = -30.5 + k * 61 / 58;
        addBeam(this.base, mats.aluminum, v(p, .4), v(p, this.h * 6), .9, .7);
        for (let branch = -1; branch <= 1; branch++) addBeam(this.base, mats.aluminum, v(p, this.h * 6), v(p + branch * 1.05, this.h * 8), .4, .4);
      }
    }
    batchBoxes(this.base, mats.aluminum);
    this.roof = new T.Group(); this.group.add(this.roof);
    addBox(this.roof, mats.concrete, 0, .2, 0, 63.5, .6, 63.5);
    for (let side = 0; side < 4; side++) addBox(this.roof, mats.aluminum, side % 2 ? (side === 1 ? 31.5 : -31.5) : 0, 1, side % 2 ? 0 : (side === 0 ? -31.5 : 31.5), side % 2 ? .3 : 63, 1.8, side % 2 ? 63 : .3);
    if (!index) {
      addBox(this.roof, mats.concrete, 0, 2, 0, 15, 4, 15);
      const mast = new T.Mesh(new T.CylinderGeometry(.28, 1.3, 109, 12), mats.aluminum); mast.position.y = 55; mast.castShadow = true; this.roof.add(mast);
      for (let n = 0; n < 7; n++) addBox(this.roof, mats.aluminum, 0, 10 + n * 10, 0, 3 - n * .25, .5, 3 - n * .25);
    } else addBox(this.roof, mats.concrete, 0, 1, 0, 26, 2, 19);
    this.smoke = new CloudLayer(this.group, 210, 0);
    this.fire = new CloudLayer(this.group, 75, 1);
    this.dust = new CloudLayer(this.group, 210, 2);
    this.fireLight = new T.PointLight(0xff822a, 0, 110, 1.8); this.group.add(this.fireLight);
    this.transforms = Array.from({ length: 110 }, () => new T.Matrix4());
    this.update(0, false, true); this.effects(0, true);
  }

  floorPose(f, t, core = false) {
    const s = stateAt(t, this.index), d = this.d, sec = collapseSeconds(t), y0 = (f + .5) * this.h;
    const result = { x: 0, y: y0, z: 0, rx: 0, rz: 0, alive: true };
    if (!s.collapse) return result;
    const motion = descentAt(this.solution, sec), release = this.solution.release[f];
    // Residual core sections persisted after the main exterior descent; detailed timing
    // and geometry here remain prescribed illustrations, not a core buckling model.
    if (core && f < (this.index ? 40 : 60)) {
      const delay = 19 + hash(f) * 2;
      if (sec < delay) return result;
      const age = sec - delay;
      result.y = Math.max(2 + hash(f) * 4, y0 - .5 * G * age * age);
      result.x = Math.sin(f * 3.1) * age * 1.5;
      result.rz = Math.sin(f) * age * .03;
      result.alive = age < 9;
      return result;
    }
    if (f >= d.pivot) {
      const tilt = Math.min(sec * sec * .035, this.index ? .35 : .14);
      const dy = y0 - this.solution.start;
      result.y = motion.y + dy * Math.cos(tilt);
      result.x = this.index ? Math.sin(tilt) * dy * .6 : 0;
      result.z = Math.sin(tilt) * dy;
      result.rx = tilt; result.rz = this.index ? -tilt * .6 : 0;
      result.alive = sec < 3 + hash(f) * 2.5;
    } else if (sec > release) {
      const age = sec - release;
      result.y = y0 - .5 * G * age * age;
      result.x = Math.sin(f * 5.3) * age * 2;
      result.z = Math.cos(f * 6.1) * age * 2;
      result.rz = Math.sin(f) * age * .07;
      result.alive = age < .65 + hash(f) * .7;
    }
    result.y = Math.max(2, result.y);
    return result;
  }

  update(t, cut, force = false) {
    const changedCut = cut !== this.lastCut;
    const rewind = t < this.previous;
    if (!force && t === this.previous && !changedCut) return;
    if (!force && !rewind && !changedCut && t > 18 && t < 65 && this.previous > 18 && this.previous < 65) { this.previous = t; return; }
    const s = stateAt(t, this.index), sec = collapseSeconds(t), d = this.d;
    for (let f = 0; f < 110; f++) {
      if (!force && !rewind && !changedCut && t <= 100 && this.previous > -1 && (f < d.low - 3 || f > d.high + 2)) continue;
      const pose = this.floorPose(f, t), cp = this.floorPose(f, t, true);
      tmp.position.set(pose.x, pose.y, pose.z); tmp.rotation.set(pose.rx, 0, pose.rz); tmp.scale.set(1, 1, 1); tmp.updateMatrix();
      const m = this.transforms[f]; m.copy(tmp.matrix);
      const heated = f + 1 >= d.low - 1 && f + 1 <= d.high + 1;
      const fY = (f + .5) * this.h;
      for (let face = 0; face < 4; face++) {
        const hidden = cut && (face === 1 || face === 2);
        const bow = heated ? Math.sin(clamp((f - d.low + 3) / (d.high - d.low + 5)) * Math.PI) * s.deform * .9 : 0;
        for (let k = 0; k < 59; k++) {
          const p = -30.5 + k * 61 / 58, i = f * 236 + face * 59 + k;
          let x = face % 2 ? (face === 1 ? 31.5 : -31.5) : p;
          let z = face % 2 ? p : (face === 0 ? -31.5 : 31.5);
          if (!this.index && face === 2) z -= bow;
          if (this.index && face === 1) x -= bow;
          const broken = s.hit && heated && impactDamage(this.index, face, p, fY, this.h);
          setInstance(this.frame, i, x, 0, z, .36, pose.alive && !hidden && !broken && f >= 8 ? this.h : 0, .38, 0, m);
          color.set(heated && s.hit ? 0xa29c90 : 0xf0ede6);
          this.frame.setColorAt(i, color);
        }
        for (let k = 0; k < 58; k++) {
          const p = -30.5 + (k + .5) * 61 / 58, i = f * 232 + face * 58 + k;
          const x = face % 2 ? (face === 1 ? 31.4 : -31.4) : p;
          const z = face % 2 ? p : (face === 0 ? -31.4 : 31.4);
          const broken = s.hit && heated && impactDamage(this.index, face, p, fY, this.h);
          const random = hash(f * 709 + face * 61 + k), fireWindow = s.hit && heated && random > .82;
          const visible = pose.alive && !hidden && !broken;
          setInstance(this.facade, i, x, 0, z, 1.045, visible ? this.h : 0, 1, face % 2 ? Math.PI / 2 : 0, m);
          if (mechanical.has(f + 1)) color.set(0x5e6464);
          else if (heated && s.hit) color.setHSL(.055, .08, .035 + random * .07);
          else color.setHSL(.565, .15, .23 + random * .075);
          if (fireWindow && !broken) color.set(0x433025);
          this.facade.setColorAt(i, color);
        }
      }
      const coreMatrix = new T.Matrix4();
      tmp.position.set(cp.x, cp.y, cp.z); tmp.rotation.set(cp.rx, 0, cp.rz); tmp.scale.set(1, 1, 1); tmp.updateMatrix(); coreMatrix.copy(tmp.matrix);
      for (let k = 0; k < 47; k++) {
        const row = Math.floor(k / 7), col = k % 7;
        let x = -12 + col * 4, z = -19.5 + row * 6.5;
        if (this.index) [x, z] = [z, x];
        const missing = s.hit && heated && Math.abs(x - (this.index ? 7 : 0)) < 4 && Math.abs(z) < 9;
        setInstance(this.core, f * 47 + k, x, 0, z, .68 + (110 - f) / 250, cp.alive && !missing ? this.h : 0, .9, 0, coreMatrix);
      }
      // Floors are split into strips so cutaway and fragmentation retain an opening
      // at the core rather than showing a stack of solid unbroken concrete boxes.
      for (let k = 0; k < 4; k++) {
        const x = k < 2 ? (k ? 22.25 : -22.25) : 0;
        const z = k > 1 ? (k === 2 ? -26 : 26) : 0;
        const hidden = cut && (k === 1 || k === 3);
        setInstance(this.floors, f * 4 + k, x, this.h / 2 - .2, z, k < 2 ? 18.5 : 26, pose.alive && !hidden ? .16 : 0, k < 2 ? 63 : 11, 0, m);
      }
    }
    for (const mesh of [this.frame, this.facade, this.core, this.floors]) {
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.core.visible = cut || s.collapse > 0;
    this.floors.visible = cut || s.collapse > 0;
    this.base.visible = sec < 10 && !cut;
    const roof = this.floorPose(109, t);
    this.roof.visible = roof.alive && !cut;
    this.roof.position.set(roof.x, roof.y + this.h / 2, roof.z);
    this.roof.rotation.set(roof.rx, 0, roof.rz);
    this.updateFragments(t);
    this.previous = t; this.lastCut = cut;
  }

  updateFragments(t) {
    const s = stateAt(t, this.index), sec = collapseSeconds(t), d = this.d;
    this.fragments.visible = s.hit;
    for (let i = 0; i < 850; i++) {
      const seed = hash(i + this.index * 231), face = i % 4;
      const impactPiece = i < 100, f = impactPiece ? d.low + i % (d.high - d.low + 1) : Math.floor(hash(i * 3.6) * 109);
      const initialY = (f + .5) * this.h;
      const release = f >= d.pivot ? 1.8 + seed * 2.4 : this.solution.release[f];
      const age = impactPiece ? (t - 8) * 1.8 : sec - release;
      const active = s.hit && age >= 0 && age < (impactPiece ? 14 : 26);
      const angle = face * Math.PI / 2 + seed * .7, speed = impactPiece ? 11 + seed * 32 : 4 + seed * 13;
      const lateral = (hash(i * 11.3) - .5) * 60;
      let x = face % 2 ? (face === 1 ? 32 : -32) : lateral;
      let z = face % 2 ? lateral : (face === 0 ? -32 : 32);
      const outwardX = face % 2 ? (face === 1 ? 1 : -1) : (seed - .5) * .5;
      const outwardZ = face % 2 ? (seed - .5) * .5 : (face === 0 ? -1 : 1);
      const safeAge = Math.max(0, age), dragDistance = (1 - Math.exp(-.11 * safeAge)) / .11;
      x += outwardX * speed * dragDistance; z += outwardZ * speed * dragDistance;
      const launchV = impactPiece ? 3 + seed * 7 : -(descentAt(this.solution, Math.max(0, release)).v * .5);
      const y = Math.max(.4 + seed * 3, initialY + launchV * safeAge - .5 * G * safeAge * safeAge);
      tmp.position.set(x, y, z);
      tmp.rotation.set(seed * 6 + safeAge * (seed - .5), angle + safeAge * .3, seed * 2 + safeAge * .22);
      const scale = active ? 1 : 0;
      // Mostly slender exterior panels and small irregular slab fragments.
      tmp.scale.set((i % 5 ? .3 + seed : 2 + seed * 4) * scale, (2 + seed * (impactPiece ? 3 : 9)) * scale, (.18 + seed * .45) * scale);
      tmp.updateMatrix(); this.fragments.setMatrixAt(i, tmp.matrix);
    }
    this.fragments.instanceMatrix.needsUpdate = true;
    const pile = clamp((sec - 9) / 9);
    this.rubble.visible = pile > 0;
    if (pile) for (let i = 0; i < 350; i++) {
      const r = Math.sqrt(hash(i)) * 48, a = i * 2.399;
      tmp.position.set(Math.sin(a) * r, (.8 + (1 - r / 50) * hash(i * 5.8) * 11) * pile, Math.cos(a) * r);
      tmp.rotation.set(hash(i * 3) * 2, a, hash(i * 7) * 2);
      tmp.scale.set((2 + hash(i * 4) * 6) * pile, (.4 + hash(i * 2) * 2) * pile, (3 + hash(i * 6) * 5) * pile);
      tmp.updateMatrix(); this.rubble.setMatrixAt(i, tmp.matrix);
    }
    this.rubble.instanceMatrix.needsUpdate = true;
  }

  effects(t, visible = true) {
    const s = stateAt(t, this.index), sec = collapseSeconds(t), d = this.d, fireY = (d.low + d.high) / 2 * this.h;
    const effectClock = t < 100 ? Math.max(0, t - 8) * 1.6 : 147.2 + sec;
    const impactAge = Math.max(0, t - 8) * 1.8;
    this.smoke.mesh.visible = visible && s.hit && sec < 11;
    this.fire.mesh.visible = visible && s.hit && sec < 2;
    this.dust.mesh.visible = visible && sec > .4;
    this.fireLight.intensity = visible && impactAge < 6 && s.hit ? 600 * Math.exp(-impactAge * .6) : 0;
    this.fireLight.position.set(this.index ? 16 : 0, fireY, this.index ? 42 : -42);
    for (let i = 0; i < this.smoke.count; i++) {
      const seed = hash(i * 3.9), life = 16 + seed * 10;
      const age = (effectClock + seed * life) % life;
      const phase = age / life, face = i % 4, lateral = (hash(i * 5.9) - .5) * 45;
      const startX = face % 2 ? (face === 1 ? 32 : -32) : lateral;
      const startZ = face % 2 ? lateral : (face === 0 ? -32 : 32);
      const x = startX + age * 5.8 + Math.sin(i + age * .16) * age * .8;
      const z = startZ - age * 1.8 + Math.cos(i * 3 + age * .12) * age * .6;
      const y = fireY + (i % 7 - 3) * this.h * .7 + age * 4.9 + Math.sin(age * .3 + i) * 3;
      const build = clamp(impactAge / 8), alpha = Math.min(phase * 9, (1 - phase) * 2, 1) * .65 * build * (1 - clamp(sec / 12));
      this.smoke.set(i, x, y, z, 14 + age * 2.8, alpha);
    }
    for (let i = 0; i < this.fire.count; i++) {
      const seed = hash(i * 17.6), a = i * 2.399;
      if (i < 30) {
        const envelope = Math.sin(clamp(impactAge / 5.5) * Math.PI), size = (10 + seed * 20) * envelope;
        const out = 33 + impactAge * (5 + seed * 6);
        this.fire.set(i, (this.index ? 8 : 0) + Math.sin(a) * size * .5, fireY + Math.cos(a) * size * .35 + impactAge * 3, this.d.sign * out, size, impactAge < 5.5 ? envelope * .8 : 0);
      } else {
        const face = i % 4, lateral = (hash(i * 9.8) - .5) * 57;
        const x = face % 2 ? (face === 1 ? 31.8 : -31.8) : lateral;
        const z = face % 2 ? lateral : (face === 0 ? -31.8 : 31.8);
        const local = d.low + (i % (d.high - d.low + 1));
        const flicker = .65 + .35 * Math.sin(effectClock * 5 + i * 7.1);
        this.fire.set(i, x, local * this.h + seed * 2, z, 2 + seed * 3, (.2 + seed * .2) * flicker * clamp(impactAge / 5), 1.8);
      }
    }
    const front = descentAt(this.solution, sec).y;
    for (let i = 0; i < this.dust.count; i++) {
      const seed = hash(i * 13.4), a = i * 2.399;
      const lowCloud = i >= 95;
      const age = lowCloud ? Math.max(0, sec - 9 - seed * 2.5) : Math.max(0, sec - seed * 4);
      const radius = lowCloud ? 25 + age * (8 + seed * 5) : 29 + age * (3 + seed * 2);
      const x = Math.sin(a) * radius + age * 1.5, z = Math.cos(a) * radius;
      const y = lowCloud ? 3 + seed * Math.min(48, age * 5) : Math.max(5, front + (seed - .35) * 40);
      const alpha = age > 0 ? clamp(age / 2) * .76 * (1 - clamp((age - 19) / 16)) : 0;
      this.dust.set(i, x, y, z, (lowCloud ? 18 : 14) + age * (lowCloud ? 4 : 3), alpha);
    }
    this.smoke.flush(effectClock); this.fire.flush(effectClock); this.dust.flush(sec);
  }
}

function makeAircraft(mats) {
  const group = new T.Group();
  // Approximate 767-200 envelope, 48.5 m long and 47.6 m wingspan.
  const profile = [[-24.25, .08], [-22, .65], [-18, 1.7], [-13, 2.5], [12, 2.5], [17, 2.2], [21, 1.65], [23.3, .75], [24.25, .02]];
  const fuselageGeo = new T.LatheGeometry(profile.map(([z,r]) => new T.Vector2(r,z)), 28); fuselageGeo.rotateX(Math.PI / 2);
  // Lathe axis after rotation points along z; nose is negative z in local space.
  const body = new T.Mesh(fuselageGeo, mats.aircraft); group.add(body);
  const wingMaterial = mats.aircraft;
  function surface(coords, depth = .22) {
    const shape = new T.Shape(); coords.forEach(([x,z],i)=>i?shape.lineTo(x,z):shape.moveTo(x,z));shape.closePath();
    const geo = new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false}); geo.rotateX(Math.PI/2);
    const wing = new T.Mesh(geo,wingMaterial); group.add(wing); return wing;
  }
  surface([[-2,-6],[-23.8,8],[-23.8,10],[-8,6],[-2,5]]);
  surface([[2,-6],[23.8,8],[23.8,10],[8,6],[2,5]]);
  surface([[-1,15],[-9,22],[-8,24],[-1,21]],.18);
  surface([[1,15],[9,22],[8,24],[1,21]],.18);
  const tailGeo = new T.BufferGeometry();
  tailGeo.setAttribute('position',new T.Float32BufferAttribute([0,1,15, 0,10.5,23, 0,1,24],3)); tailGeo.computeVertexNormals();
  const tail = new T.Mesh(tailGeo,mats.tail); group.add(tail);
  for(const side of [-1,1]){
    const shell = new T.Mesh(new T.CylinderGeometry(1.45,1.55,5.5,20,1,true),mats.aircraft);shell.rotation.x=Math.PI/2;shell.position.set(side*9,-2.3,0);group.add(shell);
    const engine = new T.Mesh(new T.CircleGeometry(1.35,20),mats.dark);engine.position.set(side*9,-2.3,-2.8);engine.rotation.y=Math.PI;group.add(engine);
    addBox(group,mats.aircraft,side*8.5,-1.1,.5,.4,2,3);
  }
  const windows=instanced(group,PANEL,mats.dark,110);
  for(let i=0;i<110;i++) {const side=i<55?-1:1,k=i%55;setInstance(windows,i,side*2.49,.8,-13+k*.54,.23,.34,1,Math.PI/2);}
  const cockpit=addBox(group,mats.dark,0,1.35,-20.1,2.3,.68,.45);cockpit.rotation.x=.3;
  group.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  // Clip the moving aircraft at the entry face as it penetrates. Fragment and flame
  // systems take over; the aircraft no longer shrinks into a point.
  return group;
}

export class WTCScene {
  constructor(container) {
    this.container=container; this.selected=0;this.view='exterior';this.lastT=-1;this.paused=true;
    this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, window.innerWidth<760?1.35:1.7));
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.localClippingEnabled=true;
    container.appendChild(this.renderer.domElement);this.scene=new T.Scene();this.scene.fog=new T.FogExp2(0xb8cbd5,.00048);
    this.camera=new T.PerspectiveCamera(43,1,.5,5000);
    this.target=new T.Vector3();this.azimuth=2.5;this.elevation=.12;this.distance=800;
    this.mats={aluminum:material(0xdfddd5,.4,.55),facade:facadeMaterial(),core:material(0x5c7b83,.65,.2),concrete:material(0x9a9992,.9),debris:material(0x8d8980,.82,.15),aircraft:material(0xe3e3de,.35,.45),tail:material(0x576875,.4,.4,{side:T.DoubleSide}),dark:material(0x17232a,.5),stone:material(0xb2b3aa,.94)};
    this.buildEnvironment();
    this.towers=[new Tower(this.scene,0,this.mats),new Tower(this.scene,1,this.mats)];
    this.plane=makeAircraft(this.mats);this.scene.add(this.plane);
    this.clip=new T.Plane();this.plane.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.material.clippingPlanes=[this.clip];}});
    this.createDetail();this.setView('exterior');
    this.resizeObserver=new ResizeObserver(()=>{const w=container.clientWidth,h=container.clientHeight;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();});this.resizeObserver.observe(container);
    this.setupInput();
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();document.getElementById('webglError').hidden=false;});
    this.renderer.domElement.addEventListener('webglcontextrestored',()=>location.reload());
  }

  buildEnvironment() {
    const skyMat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,uniforms:{},vertexShader:'varying vec3 vDirection;void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 vDirection;void main(){vec3 p=normalize(vDirection);float k=pow(max(0.,p.y),.45);vec3 c=mix(vec3(.74,.83,.87),vec3(.23,.46,.69),k);float sun=pow(max(0.,dot(p,normalize(vec3(.65,.6,.35)))),1400.);gl_FragColor=vec4(c+vec3(1.,.85,.6)*sun*2.,1.);}`});
    const sky=new T.Mesh(new T.SphereGeometry(2400,24,16),skyMat);this.scene.add(sky);this.sky=sky;
    const envScene=new T.Scene();envScene.add(new T.Mesh(new T.SphereGeometry(200,24,16),skyMat.clone()));
    const pmrem=new T.PMREMGenerator(this.renderer);this.envTarget=pmrem.fromScene(envScene,.05,.1,500);this.scene.environment=this.envTarget.texture;pmrem.dispose();
    this.scene.add(new T.HemisphereLight(0xc1ddf2,0x72776a,1.7));
    const sun=new T.DirectionalLight(0xfff3d9,2.8);sun.position.set(330,460,200);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-500;sun.shadow.camera.right=500;sun.shadow.camera.top=650;sun.shadow.camera.bottom=-500;sun.shadow.camera.near=10;sun.shadow.camera.far=1300;sun.shadow.normalBias=.9;sun.shadow.bias=-.0002;this.scene.add(sun);
    const ground=addBox(this.scene,material(0x8d9393,.96),0,-2,0,2800,2,2800);ground.castShadow=false;
    const plaza=addBox(this.scene,this.mats.stone,5,-.7,5,270,.8,270);plaza.castShadow=false;
    const seams=new T.GridHelper(270,54,0x929890,0xa3a79f);seams.position.set(5,-.23,5);this.scene.add(seams);
    // Surrounding massing gives scale; it is deliberately not a surveyed city model.
    const blocks=new T.Group();this.scene.add(blocks);this.context=blocks;
    const blockMat=material(0x9ca8ae,.83), windowMat=material(0x586f7b,.45,.2);
    const shells=[], windows=[];
    for(let i=0;i<78;i++){
      const x=(i%10-4.5)*104,z=(Math.floor(i/10)-3.5)*109;
      if(Math.abs(x)<165&&Math.abs(z)<165)continue;
      const height=22+hash(i*2.3)*130,w=48+hash(i*4.3)*20,depth=47+hash(i*7.1)*23;
      shells.push([x,height/2-1,z,w,height,depth]);
      for(let f=1;f<height/4;f++){
        windows.push([x,f*4,z+depth/2+.05,w-3,1.6,.15]);
        windows.push([x+w/2+.05,f*4,z,.15,1.6,depth-3]);
      }
      shells.push([x+3,height+2,z-2,w*.4,4,depth*.35]);
    }
    for(const [items,mat] of [[shells,blockMat],[windows,windowMat]]){
      const mesh=instanced(blocks,BOX,mat,items.length);
      items.forEach((data,i)=>setInstance(mesh,i,...data));
      mesh.instanceMatrix.needsUpdate=true;
      if(mat===windowMat)mesh.castShadow=false;
    }
    this.environmentObjects=[ground,plaza,seams];
  }

  createDetail() {
    this.detail=new T.Group();this.detail.visible=false;this.scene.add(this.detail);
    const mat=material(0x778b93,.55,.35);
    addBox(this.detail,mat,-96,0,0,6,58,9);
    this.detailColumn=instanced(this.detail,BOX,mat,30);
    this.detailTruss=instanced(this.detail,BOX,mat,120);
    this.detailFloor=instanced(this.detail,BOX,this.mats.concrete,30);
    this.detailPull=new T.ArrowHelper(new T.Vector3(-1,0,0),new T.Vector3(83,-14,0),26,0xad5524,4,2);this.detail.add(this.detailPull);
    for(let i=0;i<5;i++)this.detail.add(new T.ArrowHelper(new T.Vector3(0,-1,0),new T.Vector3(-65+i*32,25,0),14,0x3f5f72,3,1.6));
    // Connection seats remain attached in the exaggerated explanatory view.
    this.seat=addBox(this.detail,mat,87,-1,0,8,1,5);
  }

  updateDetail(t) {
    const s=stateAt(t,this.selected),sag=s.deform*13,bow=s.deform*7;
    const beam=(mesh,i,a,b,w,depth=w)=>{tmp.position.copy(a).add(b).multiplyScalar(.5);vector.copy(b).sub(a);tmp.quaternion.setFromUnitVectors(UP,vector.clone().normalize());tmp.scale.set(w,vector.length(),depth);tmp.updateMatrix();mesh.setMatrixAt(i,tmp.matrix);};
    for(let i=0;i<30;i++){
      const u=i/30,v=(i+1)/30,x0=-90+(180-bow)*u,x1=-90+(180-bow)*v;
      const y0=-Math.sin(Math.PI*u)*sag,y1=-Math.sin(Math.PI*v)*sag;
      for(const z of [-5,5]){
        const offset=z<0?0:60;
        beam(this.detailTruss,offset+i*2,new T.Vector3(x0,y0,z),new T.Vector3(x1,y1,z),.65);
        beam(this.detailTruss,offset+i*2+1,new T.Vector3(x0,y0-(i%2?6:0),z),new T.Vector3(x1,y1-(i%2?0:6),z),.4);
      }
      // Slab follows the same sagged line; its shape is visibly supported by the truss.
      const a=new T.Vector3(x0,y0+.55,0),b=new T.Vector3(x1,y1+.55,0);
      tmp.position.copy(a).add(b).multiplyScalar(.5);tmp.rotation.set(0,0,Math.atan2(y1-y0,x1-x0));tmp.scale.set(x1-x0+.05,.65,17);tmp.updateMatrix();this.detailFloor.setMatrixAt(i,tmp.matrix);
      const y=-29+i*58/30,y2=y+58/30;
      beam(this.detailColumn,i,new T.Vector3(90-bow*Math.cos(y/58*Math.PI),y,0),new T.Vector3(90-bow*Math.cos(y2/58*Math.PI),y2,0),2,5);
    }
    this.seat.position.x=87-bow;this.detailPull.position.x=83-bow;this.detailPull.visible=s.deform>.05;
    for(const mesh of [this.detailTruss,this.detailFloor,this.detailColumn])mesh.instanceMatrix.needsUpdate=true;
  }

  select(index) {this.selected=index;this.lastT=-1;this.resetCamera();}
  setView(view) {
    this.view=view;this.detail.visible=view==='detail';for(const o of this.environmentObjects)o.visible=view!=='detail';this.context.visible=view!=='detail';this.sky.visible=view!=='detail';
    this.scene.background=view==='detail'?new T.Color(0xd7e0e4):null;
    this.scene.fog=view==='detail'?null:new T.FogExp2(0xb8cbd5,.00048);
    for(const tower of this.towers)tower.group.visible=view!=='detail';this.lastT=-1;this.resetCamera();
  }
  resetCamera() {
    if(this.view==='detail'){this.azimuth=.14;this.elevation=.17;this.distance=window.innerWidth<760?350:275;this.target.set(0,0,0);}
    else {this.azimuth=this.selected? .68:2.52;this.elevation=.08;this.distance=window.innerWidth<760?850:760;this.target.copy(positions[this.selected]);this.target.y=245;}
    this.focusMode=false;this.cameraUpdate();
  }
  focusDamage(){if(this.view==='detail')return;this.target.copy(positions[this.selected]);this.target.y=(towers[this.selected].low+towers[this.selected].high)/2*towers[this.selected].height/110;this.distance=window.innerWidth<760?255:190;this.focusMode=true;this.cameraUpdate();}
  zoom(factor){this.distance=clamp(this.distance*factor,this.view==='detail'?90:110,1800);this.cameraUpdate();}
  cameraUpdate(){this.camera.position.set(this.target.x+Math.sin(this.azimuth)*Math.cos(this.elevation)*this.distance,this.target.y+Math.sin(this.elevation)*this.distance,this.target.z+Math.cos(this.azimuth)*Math.cos(this.elevation)*this.distance);this.camera.lookAt(this.target);const compass=document.querySelector('.orientation span');if(compass)compass.style.transform=`rotate(${this.azimuth}rad)`;}
  setupInput(){const el=this.renderer.domElement,pointers=new Map();let pinch=0;
    el.addEventListener('pointerdown',e=>{pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});el.setPointerCapture(e.pointerId);});
    el.addEventListener('pointermove',e=>{const old=pointers.get(e.pointerId);if(!old)return;const dx=e.clientX-old.x,dy=e.clientY-old.y;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const[a,b]=[...pointers.values()],p=Math.hypot(a.x-b.x,a.y-b.y);if(pinch&&p>1)this.distance=clamp(this.distance*pinch/p,110,1800);pinch=p;}else if(e.shiftKey||e.buttons===2){const right=new T.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0);this.target.addScaledVector(right,-dx*this.distance*.001);this.target.y+=dy*this.distance*.001;}else{this.azimuth-=dx*.005;this.elevation=clamp(this.elevation+dy*.0035,-.17,1.35);}this.cameraUpdate();});
    for(const name of['pointerup','pointercancel','lostpointercapture'])el.addEventListener(name,e=>{pointers.delete(e.pointerId);pinch=0;});
    el.addEventListener('wheel',e=>{e.preventDefault();this.zoom(Math.exp(e.deltaY*.001));},{passive:false});el.addEventListener('contextmenu',e=>e.preventDefault());
  }

  update(t) {
    const detail=this.view==='detail';
    if(t!==this.lastT){
      for(let i=0;i<2;i++){const local=i===this.selected?t:timelineForOther(t,this.selected);this.towers[i].update(local,this.view==='cutaway'&&i===this.selected,this.lastT<0);this.towers[i].effects(local,!detail);}
      if(detail)this.updateDetail(t);
      const d=towers[this.selected],point=positions[this.selected],impactY=(d.low+d.high)/2*d.height/110;
      const speed=(this.selected?542:443)*.44704;
      // t=0..8 is 2.6 seconds of approach; t=8..9 is penetration in slow motion.
      const distanceToEntry=t<8?(8-t)/8*2.6*speed:-(t-8)*72;
      this.plane.visible=!detail&&t<9.05;
      this.plane.position.set(point.x+(this.selected?7:0),impactY+Math.max(0,8-t)*.75,point.z+d.sign*(31.5+24.25+distanceToEntry));
      this.plane.rotation.set(this.selected?-.035:.035,this.selected?0:Math.PI,this.selected?-.48:-.15);
      // Keep only the incoming halfspace; the tower's entry plane consumes the mesh.
      this.clip.normal.set(0,0,d.sign);this.clip.constant=-d.sign*(point.z+d.sign*31.5);
      this.lastT=t;
    }
    if(this.focusMode&&t>100){this.target.y=Math.max(35,descentAt(this.towers[this.selected].solution,collapseSeconds(t)).y);this.cameraUpdate();}
    this.renderer.render(this.scene,this.camera);
  }
}
