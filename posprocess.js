import * as THREE from 'three';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { HalftonePass } from 'three/addons/postprocessing/HalftonePass.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { app, markSceneDirty, setHelperVisibility } from './scene.js';
import { renderState, PostProcessShader, syncPostShader, TONE_MAPPING_MAP, COLOR_SPACE_MAP } from './shader.js';
import { getActiveRenderPass, getRenderPassState } from './render-passes.js';
import { buildGodRaysPasses } from './godrays.js';
import { buildSSRPasses } from './reflections.js';
import { getPrismaQuality } from './prisma-render.js';
import { enforceLightShadows } from './light-shadows.js';

// ─────────────────────────────────────────────────────────────────────────────
// GLOBALS
// ─────────────────────────────────────────────────────────────────────────────

let composer = null;
let renderPass = null;
let bloomPass = null;
let gradePass = null;
let outputPass = null; // final pass: applies renderer.toneMapping/toneMappingExposure exactly once, on the fully composited HDR image — see ensureComposer() for why this replaced baking tone mapping into RenderPass's materials directly.

// Per-object selective bloom
let objBloomPass = null;
let objBloomComposer = null;  // second composer: renders only selected mesh + bloom
let selectiveMixPass = null;  // final pass in main composer: adds selective bloom texture

let ssaoPass = null;
let gtaoPass = null;
let taaPass = null;
let filmPass = null;
let halftonePass = null;
let pixelatedPass = null;
let bokehPass = null;
let outlinePass = null;

let initialized = false;

let lastW = 0;
let lastH = 0;
let lastPR = 0;
const _rendererSizeVec = new THREE.Vector2();

// Visualization override
let _visOverrideMat = null;


// ─────────────────────────────────────────────────────────────────────────────
// RENDER PASS / AOV PREVIEW
// The previous Render Pass module only stored UI values. This bridge makes the
// selected pass an actual renderer output in the viewport.
// ─────────────────────────────────────────────────────────────────────────────
let _aovMotionPositions = new Map();
let _aovIndexByUUID = new Map();
let _aovTempMaterials = [];
let _aovNormalMat = null;
let _aovDepthMat = null;
let _aovShadowMat = null;

let _finalPassTargets = [null, null];
let _finalPassLayerTarget = null;
let _finalPassCompositeMat = null;
let _finalPassScene = null;
let _finalPassCamera = null;
let _finalPassQuad = null;

function _ensureFinalPassTargets() {
  if (!app.renderer) return false;
  const size = new THREE.Vector2();
  app.renderer.getDrawingBufferSize(size);
  const w = Math.max(1, Math.floor(size.x));
  const h = Math.max(1, Math.floor(size.y));
  const same = _finalPassTargets[0]?.width === w && _finalPassTargets[0]?.height === h;
  if (same && _finalPassLayerTarget) return true;
  for (const t of _finalPassTargets) { try { t?.dispose(); } catch {} }
  try { _finalPassLayerTarget?.dispose(); } catch {}
  const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
  _finalPassTargets = [new THREE.WebGLRenderTarget(w,h,opts), new THREE.WebGLRenderTarget(w,h,opts)];
  _finalPassLayerTarget = new THREE.WebGLRenderTarget(w,h,opts);
  if (!_finalPassScene) {
    _finalPassScene = new THREE.Scene();
    _finalPassCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    _finalPassQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.MeshBasicMaterial());
    _finalPassScene.add(_finalPassQuad);
  }
  if (!_finalPassCompositeMat) {
    _finalPassCompositeMat = new THREE.ShaderMaterial({
      uniforms: { tBase:{value:null}, tLayer:{value:null}, uOpacity:{value:1}, uMode:{value:0}, uExposure:{value:1}, uContrast:{value:1}, uSaturation:{value:1}, uClamp:{value:1} },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`,
      fragmentShader: `
        uniform sampler2D tBase, tLayer;
        uniform float uOpacity, uMode, uExposure, uContrast, uSaturation, uClamp;
        varying vec2 vUv;
        vec3 grade(vec3 c){
          c *= pow(2.0, uExposure-1.0);
          c = (c-0.5)*uContrast + 0.5;
          float lum=dot(c,vec3(0.2126,0.7152,0.0722));
          c=mix(vec3(lum),c,uSaturation);
          return clamp(c,0.0,max(0.0001,uClamp));
        }
        void main(){
          vec4 b=texture2D(tBase,vUv), l=texture2D(tLayer,vUv);
          float a=clamp(uOpacity,0.0,1.0);
          vec3 layer=grade(max(l.rgb,vec3(0.0)));
          vec3 c;
          if(uMode<0.5){
            c=mix(b.rgb,layer,a); // diagnostic/data layer
          }else if(uMode<1.5){
            c=b.rgb * mix(vec3(1.0),layer,a); // AO/shadow multiply
          }else if(uMode<2.5){
            c=b.rgb + layer*a; // emission/specular/reflection energy
          }else if(uMode<3.5){
            c=1.0-(1.0-b.rgb)*(1.0-layer*a); // screen-style beauty/diffuse
          }else{
            // Neutral-normal overlay: 0.5 is neutral, so the layer does not
            // merely replace the render; it perturbs it around its midpoint.
            vec3 n=layer*2.0-1.0; c=b.rgb + n*a*0.5;
          }
          gl_FragColor=vec4(max(c,vec3(0.0)),b.a);
        }`
    });
    _finalPassQuad.material = _finalPassCompositeMat;
  }
  return true;
}

function _finalPassDescriptors() {
  const all = getRenderPassState()?.passes || {};
  return Object.entries(all).filter(([id, cfg]) => id !== 'final' && cfg?.addToFinal === true);
}

function _renderAovToTarget(passId, target) {
  if (!app.renderer || !target) return false;
  const savedOverride = app.renderer.overrideMaterial;
  const savedBg = app.scene.background;
  const settings = getRenderPassState()?.passes?.[passId] || {};
  const restore = [];
  try {
    app.renderer.setRenderTarget(target);
    app.renderer.setClearColor(0x000000, 0);
    app.renderer.clear(true,true,true);
    app.renderer.overrideMaterial = null;
    setHelperVisibility(false);
    if (passId === 'depth') {
      const m=_aovDepthMaterial();
      m.uniforms.uNear.value=Math.max(0.0001,_aovNum('depth','near',app.camera.near));
      m.uniforms.uFar.value=Math.max(m.uniforms.uNear.value+0.0001,_aovNum('depth','far',app.camera.far));
      m.uniforms.uRange.value=Math.max(0.0001,_aovNum('depth','range',1));
      m.uniforms.uInvert.value=settings.invert?1:0;
      app.renderer.overrideMaterial=m;
    } else if (passId === 'normal') {
      const nm=_aovNormalMaterial();
      nm.uniforms.uInvertX.value=_aovNum('normal','invertX',0);
      nm.uniforms.uInvertY.value=_aovNum('normal','invertY',0);
      nm.uniforms.uStrength.value=Math.max(0,_aovNum('normal','strength',1));
      nm.uniforms.uContrast.value=Math.max(0,_aovNum('normal','contrast',1));
      nm.uniforms.uBackground.value=_aovColor(settings.background,0x000000);
      app.renderer.overrideMaterial=nm;
    } else if (passId === 'objectId' || passId === 'diffuse' || passId === 'emission' || passId === 'specular' || passId === 'reflection' || passId === 'shadow') {
      restore.push(..._prepareAovScene(passId,settings));
    } else if (passId === 'motionVector') {
      app.scene.traverse(o=>{
        if(!o.isMesh) return;
        restore.push([o,o.material]);
        const mat=new THREE.MeshBasicMaterial({color:0x808080});
        _aovTempMaterials.push(mat);
        const now=o.getWorldPosition(new THREE.Vector3());
        const prev=_aovMotionPositions.get(o.uuid)||now.clone();
        const d=now.clone().sub(prev);
        const scale=Math.max(0,_aovNum('motionVector','scale',1));
        const maxV=Math.max(0.0001,_aovNum('motionVector','maxVelocity',1));
        mat.color.setRGB(THREE.MathUtils.clamp(.5+d.x/maxV*scale*.5,0,1),THREE.MathUtils.clamp(.5+d.y/maxV*scale*.5,0,1),THREE.MathUtils.clamp(.5+d.z/maxV*scale*.5,0,1));
        o.material=mat; _aovMotionPositions.set(o.uuid,now);
      });
    } else if (passId === 'ao') {
      if (ssaoPass) {
        const oldPasses = composer.passes.slice();
        const oldOut = outputPass?.renderToScreen;
        setPipeline('baseshot');
        ssaoPass.output = SSAOPass.OUTPUT?.SSAO ?? SSAOPass.OUTPUT?.Default;
        ssaoPass.kernelRadius = Math.max(0.1, _aovNum('ao','radius',1) * 8);
        ssaoPass.minDistance = 0.001 + _aovNum('ao','bias',0.02) * 0.02;
        ssaoPass.maxDistance = Math.max(0.01, _aovNum('ao','distance',5) * 0.02);
        if(outputPass) outputPass.renderToScreen = false;
        composer.passes = [renderPass, ssaoPass].filter(Boolean);
        composer.render();
        const src = composer.readBuffer?.texture || composer.writeBuffer?.texture;
        _copyAovTextureToTarget(src,target);
        composer.passes = oldPasses;
        if(outputPass) outputPass.renderToScreen = oldOut;
        setPipeline(renderState.mode);
        return true;
      }
      app.renderer.overrideMaterial=_aovDepthMaterial();
    } else if (passId === 'beauty') {
      // Beauty is a clean lit rerender into the requested AOV target.
      app.renderer.overrideMaterial=null;
    } else {
      return false;
    }
    if (settings.background && ['normal','objectId'].includes(passId)) app.scene.background=_aovColor(settings.background,0x000000);
    app.renderer.render(app.scene,app.camera);
    return true;
  } finally {
    _restoreAovScene(restore);
    app.renderer.overrideMaterial=savedOverride;
    app.scene.background=savedBg;
    app.renderer.setRenderTarget(null);
    _disposeAovTemps();
    setHelperVisibility(true);
  }
}

function _compositeFinalPassLayer(baseTarget, layerTarget, passId, settings) {
  if (!_finalPassCompositeMat) return baseTarget;
  const strength = Math.max(0, Number(settings.strength ?? 1));
  let opacity = Number(settings.opacity ?? 1);
  if (!Number.isFinite(opacity)) opacity = 1;
  opacity = THREE.MathUtils.clamp(opacity * strength, 0, 1);
  let mode = 2;
  if (passId === 'ao' || passId === 'shadow') mode = 1;
  else if (passId === 'depth' || passId === 'objectId' || passId === 'motionVector') mode = 0;
  else if (passId === 'normal') mode = 4;
  else if (passId === 'diffuse' || passId === 'beauty') mode = 3;

  // Ping-pong between our two final targets. Never sample from the target we
  // are currently rendering into (WebGL feedback loops produce undefined output).
  let dst = _finalPassTargets[0];
  if (baseTarget === _finalPassTargets[0]) dst = _finalPassTargets[1];
  else if (baseTarget === _finalPassTargets[1]) dst = _finalPassTargets[0];

  _finalPassCompositeMat.uniforms.tBase.value=baseTarget.texture;
  _finalPassCompositeMat.uniforms.tLayer.value=layerTarget.texture;
  _finalPassCompositeMat.uniforms.uOpacity.value=opacity;
  _finalPassCompositeMat.uniforms.uMode.value=mode;
  _finalPassCompositeMat.uniforms.uExposure.value=Number.isFinite(Number(settings.exposure))?Number(settings.exposure):1;
  _finalPassCompositeMat.uniforms.uContrast.value=Number.isFinite(Number(settings.contrast))?Math.max(0,Number(settings.contrast)):1;
  _finalPassCompositeMat.uniforms.uSaturation.value=Number.isFinite(Number(settings.saturation))?Math.max(0,Number(settings.saturation)):1;
  _finalPassCompositeMat.uniforms.uClamp.value=Number.isFinite(Number(settings.clamp))?Math.max(0.0001,Number(settings.clamp)):1;
  _finalPassQuad.material=_finalPassCompositeMat;
  app.renderer.setRenderTarget(dst);
  app.renderer.clear(true,true,true);
  app.renderer.render(_finalPassScene,_finalPassCamera);
  return dst;
}

function _presentFinalTarget(target) {
  _finalPassCompositeMat.uniforms.tBase.value=target.texture;
  _finalPassCompositeMat.uniforms.tLayer.value=target.texture;
  _finalPassCompositeMat.uniforms.uOpacity.value=0;
  _finalPassCompositeMat.uniforms.uMode.value=0;
  _finalPassCompositeMat.uniforms.uExposure.value=1;
  _finalPassCompositeMat.uniforms.uContrast.value=1;
  _finalPassCompositeMat.uniforms.uSaturation.value=1;
  _finalPassCompositeMat.uniforms.uClamp.value=1;
  _finalPassQuad.material=_finalPassCompositeMat;
  app.renderer.setRenderTarget(null);
  app.renderer.render(_finalPassScene,_finalPassCamera);
}

let _aovCopyMat = null;

function _copyAovTextureToTarget(texture, target){
  if(!texture || !target) return false;
  if(!_aovCopyMat) _aovCopyMat = new THREE.MeshBasicMaterial({map:texture, toneMapped:false});
  _aovCopyMat.map = texture; _aovCopyMat.needsUpdate = true;
  _finalPassQuad.material = _aovCopyMat;
  app.renderer.setRenderTarget(target);
  app.renderer.clear(true,true,true);
  app.renderer.render(_finalPassScene,_finalPassCamera);
  return true;
}

let _canvasBaseTexture = null;

function _captureCurrentCanvasTexture() {
  if (!app.renderer?.domElement) return null;
  if (!_canvasBaseTexture) {
    _canvasBaseTexture = new THREE.CanvasTexture(app.renderer.domElement);
    _canvasBaseTexture.colorSpace = THREE.SRGBColorSpace;
    _canvasBaseTexture.minFilter = THREE.LinearFilter;
    _canvasBaseTexture.magFilter = THREE.LinearFilter;
    _canvasBaseTexture.generateMipmaps = false;
  }
  _canvasBaseTexture.needsUpdate = true;
  return _canvasBaseTexture;
}

function _compositeFinalPassTexture(baseTexture, layerTarget, passId, settings) {
  if (!_ensureFinalPassTargets() || !baseTexture) return null;
  const strength = Math.max(0, Number(settings.strength ?? 1));
  let opacity = Number(settings.opacity ?? 1);
  if (!Number.isFinite(opacity)) opacity = 1;
  opacity = THREE.MathUtils.clamp(opacity * strength, 0, 1);
  let mode = 2;
  if (passId === 'ao' || passId === 'shadow') mode = 1;
  else if (passId === 'depth' || passId === 'objectId' || passId === 'motionVector') mode = 0;
  else if (passId === 'normal') mode = 4;
  else if (passId === 'diffuse' || passId === 'beauty') mode = 3;
  let dst = _finalPassTargets[0];
  _finalPassCompositeMat.uniforms.tBase.value = baseTexture;
  _finalPassCompositeMat.uniforms.tLayer.value = layerTarget.texture;
  _finalPassCompositeMat.uniforms.uOpacity.value = opacity;
  _finalPassCompositeMat.uniforms.uMode.value = mode;
  _finalPassCompositeMat.uniforms.uExposure.value = Number.isFinite(Number(settings.exposure))?Number(settings.exposure):1;
  _finalPassCompositeMat.uniforms.uContrast.value = Number.isFinite(Number(settings.contrast))?Math.max(0,Number(settings.contrast)):1;
  _finalPassCompositeMat.uniforms.uSaturation.value = Number.isFinite(Number(settings.saturation))?Math.max(0,Number(settings.saturation)):1;
  _finalPassCompositeMat.uniforms.uClamp.value = Number.isFinite(Number(settings.clamp))?Math.max(0.0001,Number(settings.clamp)):1;
  app.renderer.setRenderTarget(dst);
  app.renderer.clear(true,true,true);
  app.renderer.render(_finalPassScene,_finalPassCamera);
  return dst;
}

function _renderFinalWithRenderPasses(baseTexture = null) {
  const selected = _finalPassDescriptors();
  if (!selected.length || !app.renderer) return false;
  if (!_ensureFinalPassTargets()) return false;

  const previousTarget = app.renderer.getRenderTarget();
  let base;

  if (baseTexture) {
    base = baseTexture;
  } else {
    // Render the normal NCM pipeline once, then use the actual composer output
    // as the base image. EffectComposer owns its own render targets, so do not
    // assume setRenderTarget() changes where composer.render() writes.
    setPipeline(renderState.mode === 'baseshot' ? 'baseshot' : 'standard');
    const previousOutput = outputPass?.renderToScreen;
    if (outputPass) outputPass.renderToScreen = false;
    composer.render();
    if (outputPass) outputPass.renderToScreen = previousOutput;
    base = composer.readBuffer?.texture || composer.writeBuffer?.texture || null;
  }

  if (!base) {
    app.renderer.setRenderTarget(previousTarget);
    return false;
  }

  let baseTarget = null;
  for (const [passId, settings] of selected) {
    if (!_renderAovToTarget(passId, _finalPassLayerTarget)) continue;
    if (baseTarget) {
      const rendered = _compositeFinalPassLayer(baseTarget, _finalPassLayerTarget, passId, settings);
      baseTarget = rendered;
    } else {
      baseTarget = _compositeFinalPassTexture(base, _finalPassLayerTarget, passId, settings);
    }
  }
  if (!baseTarget) {
    app.renderer.setRenderTarget(previousTarget);
    return false;
  }
  _presentFinalTarget(baseTarget);
  app.renderer.setRenderTarget(previousTarget);
  return true;
}

function _aovNum(passId, key, fallback) {
  const v = Number(getRenderPassState()?.passes?.[passId]?.[key]);
  return Number.isFinite(v) ? v : fallback;
}

function _aovColor(hex, fallback = 0xffffff) {
  try { return new THREE.Color(hex); } catch { return new THREE.Color(fallback); }
}

function _disposeAovTemps() {
  for (const m of _aovTempMaterials) { try { m.dispose(); } catch {} }
  _aovTempMaterials.length = 0;
  if (_aovNormalMat) { _aovNormalMat.dispose(); _aovNormalMat = null; }
  if (_aovDepthMat) { _aovDepthMat.dispose(); _aovDepthMat = null; }
  if (_aovShadowMat) { _aovShadowMat.dispose(); _aovShadowMat = null; }
}

function _aovDepthMaterial() {
  if (_aovDepthMat) return _aovDepthMat;
  _aovDepthMat = new THREE.ShaderMaterial({
    uniforms: {
      uNear: { value: app.camera?.near ?? 0.1 },
      uFar:  { value: app.camera?.far ?? 4000 },
      uInvert: { value: 0 },
      uRange: { value: 1 }
    },
    vertexShader: `
      varying float vViewDepth;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vViewDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uNear, uFar, uInvert, uRange;
      varying float vViewDepth;
      void main(){
        float d = clamp((vViewDepth-uNear)/max(uFar-uNear,0.0001),0.0,1.0);
        d = 1.0-d;
        d = clamp(d * max(uRange,0.0001),0.0,1.0);
        if(uInvert > 0.5) d = 1.0-d;
        gl_FragColor = vec4(vec3(d),1.0);
      }`
  });
  return _aovDepthMat;
}

function _aovNormalMaterial() {
  if (_aovNormalMat) return _aovNormalMat;
  _aovNormalMat = new THREE.ShaderMaterial({
    uniforms:{uSpace:{value:0},uInvertX:{value:0},uInvertY:{value:0},uStrength:{value:1},uContrast:{value:1},uBackground:{value:new THREE.Color(0x000000)}},
    vertexShader:`varying vec3 vN; void main(){vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}` ,
    fragmentShader:`uniform float uSpace,uInvertX,uInvertY,uStrength,uContrast; uniform vec3 uBackground; varying vec3 vN; void main(){vec3 n=normalize(vN); n.x=mix(n.x,-n.x,uInvertX); n.y=mix(n.y,-n.y,uInvertY); n=n*uStrength; vec3 c=clamp(n*.5+.5,0.,1.); c=(c-.5)*uContrast+.5; gl_FragColor=vec4(mix(uBackground,c,step(.001,length(n))),1.);}` ,
    side:THREE.DoubleSide
  });
  return _aovNormalMat;
}

function _aovShadowMaterial() {
  if (_aovShadowMat) return _aovShadowMat;
  _aovShadowMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0
  });
  return _aovShadowMat;
}

function _cloneForAov(original, passId, settings, objectIndex) {
  if (Array.isArray(original)) return original.map((m, i) => _cloneForAov(m, passId, settings, objectIndex * 17 + i));
  if (!original?.isMaterial) return _aovShadowMaterial();

  let m;
  try { m = original.clone(); } catch { m = new THREE.MeshStandardMaterial({ color: 0xffffff }); }
  _aovTempMaterials.push(m);

  const strength = Math.max(0, Number(settings.strength ?? 1));
  const contrast = Math.max(0, Number(settings.contrast ?? 1));
  const exposure = Number(settings.exposure ?? 1);
  const roughness = Math.max(0, Math.min(1, Number(settings.roughness ?? 0.5)));

  if (passId === 'diffuse' || passId === 'beauty') {
    if ('metalness' in m) m.metalness = 0;
    if ('roughness' in m) m.roughness = Math.max(0, Math.min(1, Number(settings.roughness ?? 1)));
    if ('emissive' in m) m.emissive.set(0x000000);
    if ('emissiveIntensity' in m) m.emissiveIntensity = 0;
  } else if (passId === 'emission') {
    if ('color' in m) m.color.set(0x000000);
    if ('emissive' in m) m.emissive.set((original.emissive?.getHex?.() ?? 0xffffff));
    if ('emissiveIntensity' in m) m.emissiveIntensity = Math.max(0, Number(original.emissiveIntensity ?? 1)) * strength * Math.max(0, exposure);
    if ('transparent' in m) m.transparent = false;
  } else if (passId === 'specular') {
    if ('color' in m) m.color.set(0x020202);
    if ('emissive' in m) m.emissive.set(0x000000);
    if ('metalness' in m) m.metalness = Math.max(0, Math.min(1, Number(original.metalness ?? 0) + strength * 0.15));
    if ('roughness' in m) m.roughness = Math.max(0.02, Math.min(1, roughness * (1 / Math.max(contrast,0.01))));
  } else if (passId === 'reflection') {
    if ('color' in m) m.color.set(_aovColor(settings.tint, 0xffffff));
    if ('metalness' in m) m.metalness = 1;
    if ('roughness' in m) m.roughness = roughness;
    if ('emissive' in m) m.emissive.set(0x000000);
  } else if (passId === 'shadow') {
    if ('color' in m) m.color.set(_aovColor(settings.tint, 0x000000));
    if ('metalness' in m) m.metalness = 0;
    if ('roughness' in m) m.roughness = 1;
  } else if (passId === 'objectId') {
    const h = ((objectIndex + 1) * 2654435761) >>> 0;
    const c = new THREE.Color(((h >>> 16) & 255) / 255, ((h >>> 8) & 255) / 255, (h & 255) / 255);
    if ('color' in m) m.color.copy(c);
    if ('emissive' in m) m.emissive.copy(c);
    if ('emissiveIntensity' in m) m.emissiveIntensity = 1;
    if ('map' in m) m.map = null;
    if ('roughness' in m) m.roughness = 1;
    if ('metalness' in m) m.metalness = 0;
  }
  return m;
}

function _prepareAovScene(passId, settings) {
  const restore = [];
  _aovIndexByUUID.clear();
  let objectIndex = 0;
  app.scene.traverse((o) => {
    if (!o.isMesh) return;
    _aovIndexByUUID.set(o.uuid, objectIndex++);
    if (passId === 'objectId' || passId === 'diffuse' || passId === 'emission' || passId === 'specular' || passId === 'reflection' || passId === 'shadow') {
      restore.push([o, o.material]);
      o.material = _cloneForAov(o.material, passId, settings, _aovIndexByUUID.get(o.uuid));
    }
  });
  return restore;
}

function _restoreAovScene(restore) {
  for (const [o, material] of restore) o.material = material;
}

function _renderAovPreview(passId) {
  if (!app.renderer || !app.scene || !app.camera) return false;
  const savedOverride = app.renderer.overrideMaterial;
  const savedBg = app.scene.background;
  const settings = getRenderPassState()?.passes?.[passId] || {};
  const restore = [];

  try {
    app.renderer.setRenderTarget(null);
    app.renderer.clear();
    app.renderer.overrideMaterial = null;
    setHelperVisibility(false);

    if (passId === 'depth') {
      const m = _aovDepthMaterial();
      m.uniforms.uNear.value = Math.max(0.0001, _aovNum('depth','near', app.camera.near));
      m.uniforms.uFar.value = Math.max(m.uniforms.uNear.value + 0.0001, _aovNum('depth','far', app.camera.far));
      m.uniforms.uRange.value = Math.max(0.0001, _aovNum('depth','range',1));
      m.uniforms.uInvert.value = settings.invert ? 1 : 0;
      app.renderer.overrideMaterial = m;
    } else if (passId === 'normal') {
      app.renderer.overrideMaterial = _aovNormalMaterial();
    } else if (passId === 'ao' && ssaoPass) {
      setPipeline('baseshot');
      ssaoPass.output = SSAOPass.OUTPUT?.SSAO ?? SSAOPass.OUTPUT?.Default;
      ssaoPass.kernelRadius = Math.max(0.1, _aovNum('ao','radius',1) * 8);
      ssaoPass.minDistance = 0.001 + _aovNum('ao','bias',0.02) * 0.02;
      ssaoPass.maxDistance = Math.max(0.01, _aovNum('ao','distance',5) * 0.02);
      composer.passes = [renderPass, ssaoPass, outputPass].filter(Boolean);
      composer.render();
      setPipeline(renderState.mode);
      return true;
    } else if (passId === 'shadow') {
      app.renderer.overrideMaterial = _aovShadowMaterial();
      const c = _aovColor(settings.tint, 0x000000);
      _aovShadowMat.color.copy(c);
      _aovShadowMat.color.lerp(new THREE.Color(0xffffff), Math.max(0, Math.min(1, _aovNum('shadow','strength',1))));
    } else if (passId === 'motionVector') {
      let idx = 0;
      app.scene.traverse((o) => {
        if (!o.isMesh) return;
        restore.push([o, o.material]);
        o.material = new THREE.MeshBasicMaterial({ color: 0x808080 });
        _aovTempMaterials.push(o.material);
        const now = o.getWorldPosition(new THREE.Vector3());
        const prev = _aovMotionPositions.get(o.uuid) || now.clone();
        const d = now.clone().sub(prev);
        const scale = Math.max(0, _aovNum('motionVector','scale',1));
        const maxV = Math.max(0.0001, _aovNum('motionVector','maxVelocity',1));
        const r = THREE.MathUtils.clamp(0.5 + d.x / maxV * scale * 0.5, 0, 1);
        const g = THREE.MathUtils.clamp(0.5 + d.y / maxV * scale * 0.5, 0, 1);
        const b = THREE.MathUtils.clamp(0.5 + d.z / maxV * scale * 0.5, 0, 1);
        o.material.color.setRGB(r,g,b);
        _aovMotionPositions.set(o.uuid, now);
        idx++;
      });
    } else if (passId === 'objectId' || passId === 'diffuse' || passId === 'emission' || passId === 'specular' || passId === 'reflection') {
      restore.push(..._prepareAovScene(passId, settings));
    } else if (passId === 'beauty') {
      setPipeline('baseshot');
      composer.render();
      setPipeline(renderState.mode);
      return true;
    } else if (passId === 'final') {
      return false;
    }

    if (settings.background && ['normal','objectId'].includes(passId)) {
      app.scene.background = _aovColor(settings.background, 0x000000);
    }
    app.renderer.render(app.scene, app.camera);
    return true;
  } finally {
    _restoreAovScene(restore);
    app.renderer.overrideMaterial = savedOverride;
    app.scene.background = savedBg;
    _disposeAovTemps();
    setHelperVisibility(true);
  }
}

// Layers
export const activeLayers = new Set();

// Configs
export const layerConfig = {
  outline: { strength: 4, glow: 0.35, thickness: 0.2 },
  film: { noise: 0.35, scanlines: 0.5, grayscale: false },
  bokeh: { focus: 1.0, aperture: 0.0025, maxblur: 0.01 },
  pixelated: { pixelSize: 4 }
};

// Selection outline — the highlight drawn around whatever object is
// currently selected (distinct from the toggleable "Outline" layer effect
// above, which shares the same OutlinePass but is opt-in via the Efeitos
// tab). Controlled from Configurações → Viewport.
export const outlineConfig = {
  enabled: true,
  color: '#ffb14a'   // --accent-orange — same as GIZMO_COLOR_SELECTED in cameras.js
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function int(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTIVE BLOOM SHADER (additive mix of per-object bloom over main frame)
// ─────────────────────────────────────────────────────────────────────────────

const SelectiveBloomMixShader = {
  uniforms: {
    tDiffuse:     { value: null },
    bloomTexture: { value: null },
    bloomActive:  { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTexture;
    uniform float bloomActive;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (bloomActive > 0.5) {
        vec3 bloom = texture2D(bloomTexture, vUv).rgb;
        vec3 sum = base.rgb + bloom;
        // Soft highlight roll-off instead of a hard clip: a plain base+bloom
        // sum clips abruptly wherever it crosses 1.0, which reads as a harsh
        // ring around the glow instead of a smooth falloff. Blending toward
        // a mild Reinhard curve only in the region that would've clipped
        // keeps the core of a genuinely bright light punchy while letting
        // its edge fade out instead of hitting a wall.
        vec3 soft = sum / (1.0 + max(sum - 1.0, 0.0));
        gl_FragColor = vec4(soft, base.a);
      } else {
        gl_FragColor = base;
      }
    }
  `
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSER
// ─────────────────────────────────────────────────────────────────────────────

function ensureComposer() {
  if (!app.renderer || !app.scene || !app.camera) return false;
  if (composer) return true;

  const w = window.innerWidth;
  const h = window.innerHeight;

  // Half-float render targets instead of the default 8-bit ones: bloom's
  // bright-pass extraction and blur both clip/band hard on 8-bit color, which
  // is the main reason self-bloom on a small/bright emissive object tends to
  // look chunky or crushed at the edges instead of a smooth falloff. HDR
  // targets fix that at essentially no extra cost for a viewport-sized buffer.
  const makeHDRTarget = (rw, rh) => new THREE.WebGLRenderTarget(rw, rh, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });

  composer = new EffectComposer(app.renderer, makeHDRTarget(w, h));

  renderPass = new RenderPass(app.scene, app.camera);
  // Base bloom, per request — Roblox's own docs make the same point (their
  // "no bloom" comparison shot is just Threshold cranked to 4, and their
  // own tutorials warn that Threshold 0 = "everything glows, looks
  // terrible"): a high threshold + low strength keeps bloom reserved for
  // genuinely bright/emissive things instead of haloing every particle.
  bloomPass  = new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.4, 1.8);
  gradePass  = new ShaderPass(PostProcessShader);

  // Tone mapping lives HERE, at the very end of the chain, instead of being
  // baked into each material's shader during renderPass above. Doing it
  // early meant the curve was applied to the base image alone, then bloom's
  // own HDR light got added on TOP of that already-compressed result — so
  // switching curves barely changed anything, and bloom highlights could
  // blow straight past the curve's rolloff instead of being shaped by it.
  // OutputPass reads renderer.toneMapping/toneMappingExposure live, so the
  // exact same setToneMappingValue()/setToneMappingExposureValue() setters
  // keep working — only WHERE the curve gets applied has changed.
  outputPass = new OutputPass();

  // ── Per-object selective bloom ("self bloom") ────────────────────────────
  // objBloomComposer renders the scene with non-selected meshes hidden,
  // applies bloom, and stores the result in its read buffer.
  // selectiveMixPass in the main composer blends that result additively.
  // Also HDR — same banding/clipping reasoning, and it matters more here
  // since this is the pass that's actually doing each object's own glow.
  objBloomPass     = new UnrealBloomPass(new THREE.Vector2(w, h), 1.2, 0.55, 0.35);
  objBloomPass.enabled = false;

  objBloomComposer = new EffectComposer(app.renderer, makeHDRTarget(w, h));
  objBloomComposer.renderToScreen = false;
  objBloomComposer.addPass(new RenderPass(app.scene, app.camera));
  objBloomComposer.addPass(objBloomPass);

  selectiveMixPass = new ShaderPass(SelectiveBloomMixShader);
  selectiveMixPass.uniforms.bloomActive.value = 0;

  // Optional passes
  try {
    ssaoPass = new SSAOPass(app.scene, app.camera, w, h);
    ssaoPass.kernelRadius = 8;
    ssaoPass.minDistance = 0.001;
    ssaoPass.maxDistance = 0.12;
    ssaoPass.output = SSAOPass.OUTPUT.Default;
  } catch {
    ssaoPass = null;
  }

  try {
    gtaoPass = new GTAOPass(app.scene, app.camera, w, h);
    if (GTAOPass.OUTPUT?.Default !== undefined) gtaoPass.output = GTAOPass.OUTPUT.Default;
  } catch {
    gtaoPass = null;
  }

  try {
    taaPass = new TAARenderPass(app.scene, app.camera);
    taaPass.unbiased = false;
    taaPass.sampleLevel = 1;
  } catch {
    taaPass = null;
  }

  try {
    filmPass = new FilmPass();
    if (filmPass.uniforms?.nIntensity) filmPass.uniforms.nIntensity.value = layerConfig.film.noise;
    if (filmPass.uniforms?.sIntensity) filmPass.uniforms.sIntensity.value = layerConfig.film.scanlines;
    if (filmPass.uniforms?.grayscale) filmPass.uniforms.grayscale.value = 0;
  } catch {
    filmPass = null;
  }

  try {
    halftonePass = new HalftonePass(w, h, {
      shape: 1,
      radius: 4,
      rotateR: Math.PI / 12,
      rotateG: Math.PI / 6,
      rotateB: Math.PI / 4,
      scatter: 0,
      blending: 1,
      blendingMode: 1,
      greyscale: false,
      disable: false
    });
  } catch {
    halftonePass = null;
  }

  try {
    pixelatedPass = new RenderPixelatedPass(layerConfig.pixelated.pixelSize, app.scene, app.camera);
  } catch {
    pixelatedPass = null;
  }

  try {
    bokehPass = new BokehPass(app.scene, app.camera, {
      focus: layerConfig.bokeh.focus,
      aperture: layerConfig.bokeh.aperture,
      maxblur: layerConfig.bokeh.maxblur,
      width: w,
      height: h
    });
  } catch {
    bokehPass = null;
  }

  try {
    outlinePass = new OutlinePass(new THREE.Vector2(w, h), app.scene, app.camera);
    outlinePass.edgeStrength  = layerConfig.outline.strength;
    outlinePass.edgeGlow      = layerConfig.outline.glow;
    outlinePass.edgeThickness = layerConfig.outline.thickness;
    outlinePass.pulsePeriod   = 0;
    outlinePass.visibleEdgeColor.set(outlineConfig.color);
    outlinePass.hiddenEdgeColor.set('#000000');
    outlinePass.overlayMaterial.blending = THREE.AdditiveBlending;
    outlinePass.selectedObjects = [];
  } catch {
    outlinePass = null;
  }

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);
  composer.addPass(selectiveMixPass);  // additive selective bloom (disabled until obj selected)
  composer.addPass(outputPass);        // tone mapping, applied exactly once, always last

  return true;
}

function buildLayerPasses() {
  const passes = [];

  // God rays + SSR first: the glow/reflections they add are still eligible
  // for bloom below, and every AO/outline/etc. layer after sees the result.
  passes.push(...buildGodRaysPasses());
  passes.push(...buildSSRPasses());

  if (activeLayers.has('ao') && ssaoPass) passes.push(ssaoPass);
  if (activeLayers.has('gtao') && gtaoPass) passes.push(gtaoPass);
  if (activeLayers.has('outline') && outlinePass) passes.push(outlinePass);
  if (activeLayers.has('taa') && taaPass) passes.push(taaPass);
  if (activeLayers.has('bokeh') && bokehPass) passes.push(bokehPass);
  if (activeLayers.has('halftone') && halftonePass) passes.push(halftonePass);
  if (activeLayers.has('pixelated') && pixelatedPass) passes.push(pixelatedPass);
  if (activeLayers.has('film') && filmPass) passes.push(filmPass);

  return passes;
}

function setPipeline(mode) {
  if (!composer) return;

  if (renderPass) {
    renderPass.scene = app.scene;
    renderPass.camera = app.camera;
  }

  if (ssaoPass) {
    ssaoPass.scene = app.scene;
    ssaoPass.camera = app.camera;
  }

  if (taaPass) {
    taaPass.scene = app.scene;
    taaPass.camera = app.camera;
  }

  const layers = buildLayerPasses();
  // EffectComposer only writes to the screen on the LAST pass in this
  // array that's actually enabled that frame — if that happens to be a
  // pass whose `.enabled` can be toggled off (gradePass/bloomPass follow
  // user settings), a frame can render entirely into internal buffers and
  // never reach the canvas, which looks like a black/frozen viewport.
  // selectiveMixPass is never disabled anywhere and its shader is a plain
  // passthrough when bloomActive is 0; outputPass (tone mapping) is never
  // disabled either. Appending both as the true final passes in every
  // branch below guarantees something always reaches the screen AND that
  // tone mapping is applied exactly once, at the very end, everywhere.
  const tail = [selectiveMixPass, outputPass].filter(Boolean);

  if (mode === 'standard') {
    composer.passes = [renderPass, ...layers, bloomPass, outlinePass, gradePass, ...tail];
    return;
  }

  if (mode === 'visualization') {
    composer.passes = [renderPass, ...layers, gradePass, ...tail];
    return;
  }

  if (mode === 'baseshot') {
    composer.passes = [renderPass, ...layers, ...tail];
    return;
  }

  composer.passes = [renderPass, ...layers, bloomPass, gradePass, ...tail];
}

// ─────────────────────────────────────────────────────────────────────────────
// VISUALIZATION OVERRIDE
// ─────────────────────────────────────────────────────────────────────────────

function buildVisMaterial(visMode) {
  switch (visMode) {
    case 'normals':
      return new THREE.MeshNormalMaterial({ side: THREE.FrontSide });

    case 'wireframe':
      return new THREE.MeshBasicMaterial({ color: 0x4fc3f7, wireframe: true });

    case 'clay':
      return new THREE.MeshStandardMaterial({ color: 0xccaa88, roughness: 0.85, metalness: 0 });

    case 'depth':
      return new THREE.ShaderMaterial({
        uniforms: { cameraNear: { value: 0.1 }, cameraFar: { value: 4000 } },
        vertexShader: `
          varying float vD;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vD = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform float cameraNear, cameraFar;
          varying float vD;
          void main() {
            float d = 1.0 - clamp((vD - cameraNear) / (cameraFar - cameraNear), 0.0, 1.0);
            gl_FragColor = vec4(vec3(d), 1.0);
          }
        `
      });

    default:
      return null;
  }
}

export function setVisualizationMode(visMode) {
  if (_visOverrideMat) {
    _visOverrideMat.dispose();
    _visOverrideMat = null;
  }
  if (visMode) _visOverrideMat = buildVisMaterial(visMode);
  markSceneDirty();
}

// ─────────────────────────────────────────────────────────────────────────────
// FOOTER "LIGHT" BUTTON — gates the whole post-processing composer (bloom,
// AO, outline, grade, God Rays, everything setPipeline() assembles). Off
// (default) renders the raw lit scene straight to the canvas — cheap, no
// extra passes — which is what most of the time spent orbiting/editing
// actually needs. On runs the full composer chain, for previewing the
// graded/bloomed/god-rayed shot before exporting.
//
// It still does NOT touch materials (that broke the Material panel —
// editing color there was really editing a shared override, or losing
// track of the real material) and does NOT drive the GPU path tracer (that
// library's one-time BVH/shader build is synchronous and, on anything but
// a trivial scene, blocks the main thread long enough to look like the
// whole tab froze — no per-frame scheduling trick fixes that, only not
// calling it here). If you want the real GPU path tracer, it's still
// available on its own in the Avançado tab ("Render Físico (GPU)") — a
// slow first activation there is expected and isolated from this button.
// ─────────────────────────────────────────────────────────────────────────────
let lightPreviewActive = false;

// ── Render em tempo real (estilo Prisma 3D) ───────────────────────────────
// A lâmpada liga o pipeline completo (PBR + luzes + sombras + SSR + pós-
// processamento) DIRETO, a cada frame. Não há acumulação, contagem de
// amostras nem reinício ao mexer a câmera: o que você vê é o render.
// O anti-aliasing vem de MSAA nos render targets do composer (ver
// _applyMsaa), configurável em prisma-render.js.

export function isLightPreviewActive() {
  return lightPreviewActive;
}

export function setLightPreviewActive(active) {
  lightPreviewActive = !!active;
  document.getElementById('renderLightToggleBtn')?.classList.toggle('active', lightPreviewActive);
  if (lightPreviewActive) {
    ensureComposer();
    _applyMsaa();
  }
  markSceneDirty();
}

// MSAA nos render targets HDR do composer. Sem isso, com o pós-processamento
// ligado as bordas ficariam serrilhadas (o antialias do canvas só vale para
// o render direto). Recalcula quando a qualidade ou o tamanho mudam.
function _resolveMsaaSamples(w, h) {
  const r = app.renderer;
  if (!r) return 0;
  const ext = r.extensions;
  const hdrOk = !!(ext?.has?.('EXT_color_buffer_float') || ext?.has?.('EXT_color_buffer_half_float'));
  if (!hdrOk) return 0;
  let s = Math.min(getPrismaQuality().msaa | 0, r.capabilities?.maxSamples ?? 0);
  const px = w * h;
  if (px > 8.5e6) s = 0;            // acima de ~4K: memória demais
  else if (px > 3.8e6) s = Math.min(s, 4);
  return Math.max(0, s);
}

function _applyMsaa() {
  if (!composer) return;
  const rt1 = composer.renderTarget1;
  const rt2 = composer.renderTarget2;
  if (!rt1 || !rt2) return;
  const s = _resolveMsaaSamples(rt1.width, rt1.height);
  if (rt1.samples === s && rt2.samples === s) return;
  rt1.samples = s;
  rt2.samples = s;
  // dispose() faz o three recriar os buffers com o novo número de samples.
  rt1.dispose();
  rt2.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
// SIZE + SHADER SYNC
// ─────────────────────────────────────────────────────────────────────────────

function syncPassSizes() {
  if (!app.renderer) return;

  // Tamanho/pixel ratio REAIS do renderer (durante o export de vídeo o
  // renderer vira rW×rH com pixel ratio 1; o composer precisa acompanhar
  // para o render final sair na resolução escolhida, e não na do viewport).
  const pr = app.renderer.getPixelRatio();
  app.renderer.getSize(_rendererSizeVec);
  const w = Math.max(1, Math.round(_rendererSizeVec.x)) || window.innerWidth;
  const h = Math.max(1, Math.round(_rendererSizeVec.y)) || window.innerHeight;

  if (w !== lastW || h !== lastH || pr !== lastPR) {
    lastW = w;
    lastH = h;
    lastPR = pr;

    composer?.setPixelRatio?.(pr);
    composer?.setSize(w, h);
    objBloomComposer?.setSize(w, h);
    bloomPass?.setSize?.(w, h);
    objBloomPass?.setSize?.(w, h);
    ssaoPass?.setSize?.(w, h);
    gtaoPass?.setSize?.(w, h);

    if (bokehPass?.uniforms?.aspect) bokehPass.uniforms.aspect.value = w / h;

    if (halftonePass?.uniforms?.width && halftonePass?.uniforms?.height) {
      halftonePass.uniforms.width.value = w;
      halftonePass.uniforms.height.value = h;
    }
  }

  if (gradePass) syncPostShader(gradePass);
}

function updateComposerValues() {
  if (!bloomPass || !gradePass) return;

  bloomPass.enabled = !!renderState.bloom?.enabled;
  bloomPass.threshold = num(renderState.bloom?.threshold, bloomPass.threshold);
  bloomPass.strength = num(renderState.bloom?.strength, bloomPass.strength);
  bloomPass.radius = num(renderState.bloom?.radius, bloomPass.radius);

  gradePass.enabled = !!renderState.post?.enabled;
  syncPostShader(gradePass);

  // Tone mapping + color space: apply whatever renderState.post already
  // says (defaults are 'Linear'/'Linear', matching the UI's default
  // selection) onto the live renderer — needed because scene.js boots the
  // renderer at NoToneMapping/SRGBColorSpace regardless (OutputPass applies
  // the real curve; see there for why), so without this the very first
  // frame — and every reload — would silently stay on whatever scene.js's
  // own hardcoded renderer defaults are instead of the UI's actual default,
  // showing sRGB as "active" in the UI while the renderer stayed on
  // whatever it was actually booted with.
  if (app.renderer) {
    app.renderer.toneMapping = TONE_MAPPING_MAP[renderState.post?.toneMapping] ?? THREE.LinearToneMapping;
    app.renderer.toneMappingExposure = num(renderState.post?.toneMappingExposure, 1);
    app.renderer.outputColorSpace = COLOR_SPACE_MAP[renderState.post?.colorSpace] ?? THREE.LinearSRGBColorSpace;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export function initPostProcess() {
  if (initialized) return;
  initialized = true;

  ensureComposer();
  updateComposerValues();
  syncPassSizes();
}

export function setRenderModeValue(mode) {
  // Path tracing / ray tracing foram removidos: qualquer valor antigo (ex.:
  // vindo de um projeto salvo) cai no render padrão em tempo real.
  if (mode === 'raytracing' || mode === 'pathtracing') mode = 'standard';
  renderState.mode = mode;

  if (mode !== 'visualization') {
    if (app.renderer) app.renderer.overrideMaterial = null;
    if (_visOverrideMat) {
      _visOverrideMat.dispose();
      _visOverrideMat = null;
    }
  }

  ensureComposer();
  setPipeline(mode);
}

export function setPostProcessValue(value) {
  renderState.post = renderState.post || {};
  renderState.post.enabled = !!value;
  updateComposerValues();
}

export function setBloomValue(value) {
  renderState.bloom = renderState.bloom || {};
  renderState.bloom.enabled = !!value;
  updateComposerValues();
}

// ─── Per-object bloom ────────────────────────────────────────────────────────
// ─── Per-object persistent bloom ─────────────────────────────────────────────
// Each object stores bloom in obj.userData.bloom = {enabled, threshold, strength, radius}.
// _renderSelectiveBloom() scans ALL scene objects every frame so bloom persists
// even after deselecting.

export function setObjBloomField(obj, key, value) {
  if (!obj) return;
  obj.userData.bloom = obj.userData.bloom || {};
  obj.userData.bloom[key] = value;
  markSceneDirty();
}

export function getObjBloom(obj) {
  const b = obj?.userData?.bloom || {};
  return {
    enabled:   !!b.enabled,
    threshold: b.threshold ?? 0.5,
    strength:  b.strength  ?? 1.2,
    radius:    b.radius    ?? 0.4,
  };
}

function _collectBloomedMeshes() {
  const bloomed = new Set();
  app.scene.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    let node = o;
    while (node) {
      if (node.userData?.bloom?.enabled) { bloomed.add(o); return; }
      node = node.parent;
    }
  });
  return bloomed;
}

function _renderSelectiveBloom() {
  if (!objBloomPass || !objBloomComposer || !selectiveMixPass) return;

  const bloomed = _collectBloomedMeshes();

  if (bloomed.size === 0) {
    selectiveMixPass.uniforms.bloomActive.value = 0;
    objBloomPass.enabled = false;
    return;
  }

  // Merge params for the ONE shared UnrealBloomPass run below: lowest
  // threshold (so nothing configured to glow gets cut) and the largest
  // radius/strength in the scene.
  let threshold = Infinity, maxStrength = 0, radius = 0;
  app.scene.traverse((o) => {
    if (!o.userData?.bloom?.enabled) return;
    const b = o.userData.bloom;
    threshold = Math.min(threshold, b.threshold ?? 0.5);
    maxStrength = Math.max(maxStrength, b.strength ?? 1.2);
    radius = Math.max(radius, b.radius ?? 0.4);
  });
  objBloomPass.threshold = threshold === Infinity ? 0.5 : threshold;
  objBloomPass.strength  = maxStrength;
  objBloomPass.radius    = radius;

  // Hide every mesh NOT in the bloomed set. Also — this is the actual
  // quality fix — scale each bloomed mesh's OWN emissive/color brightness
  // relative to its own configured Strength vs. the strongest one in the
  // scene before this shared pass runs. Previously every glowing object ran
  // through the pass at the single strongest Strength value, so a subtle
  // 0.3-strength glow and an intense 3.0-strength glow came out looking
  // identically bright — this restores each object's own setting relative
  // to the others instead of flattening them all to the loudest one.
  const hidden = [];
  const restore = [];
  app.scene.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh) || !o.visible) return;
    if (!bloomed.has(o)) { o.visible = false; hidden.push(o); return; }

    const rel = maxStrength > 0 ? (o.userData.bloom.strength ?? 1.2) / maxStrength : 1;
    if (rel < 0.999) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (!m) return;
        if ('emissiveIntensity' in m) {
          restore.push([m, 'emissiveIntensity', m.emissiveIntensity]);
          m.emissiveIntensity *= rel;
        } else if (m.color) {
          restore.push([m, 'color', m.color.clone()]);
          m.color.multiplyScalar(rel);
        }
      });
    }
  });

  objBloomPass.enabled = true;
  objBloomComposer.render();
  objBloomPass.enabled = false;

  for (const o of hidden) o.visible = true;
  for (const [m, key, v] of restore) m[key] = v;

  selectiveMixPass.uniforms.bloomTexture.value = objBloomComposer.readBuffer.texture;
  selectiveMixPass.uniforms.bloomActive.value  = 1;
}

export function syncRenderTargets() {
  ensureComposer();
  syncPassSizes();
  _applyMsaa();
  updateComposerValues();
}

export async function renderFrame(options = {}) {
  const forceFinal = !!options.forceFinal || window._ncmForceFinalRender === true;
  if (!app.renderer || !app.scene || !app.camera) return;

  enforceLightShadows();   // sombras removidas → mantém todas as luzes sem sombra
  syncRenderTargets();

  const activeRenderPass = getActiveRenderPass();
  if (activeRenderPass && activeRenderPass !== 'final' && !forceFinal) {
    app.renderer.overrideMaterial = null;
    _renderAovPreview(activeRenderPass);
    return;
  }

  const mode = renderState.mode;

  // Render Pass final compositor is independent from the last preview viewed.
  // Export/render calls pass forceFinal=true, so a selected preview cannot
  // hijack the output. In the live viewport, the explicit AOV preview remains.
  // become actual contributors to the final image. The normal viewport remains
  // unchanged when no pass is selected for final composition.
  if (_finalPassDescriptors().length) {
    if (_renderFinalWithRenderPasses()) {
      return;
    }
  }

  // Visualization override
  if (activeLayers.has('visualization') && _visOverrideMat) {
    if (_visOverrideMat.uniforms?.cameraNear) {
      _visOverrideMat.uniforms.cameraNear.value = app.camera.near;
      _visOverrideMat.uniforms.cameraFar.value = app.camera.far;
    }
    app.renderer.overrideMaterial = _visOverrideMat;
  } else {
    app.renderer.overrideMaterial = null;
  }

  // STANDARD
  if (mode === 'standard') {
    // Render final (PNG/vídeo) nunca mostra grade, eixos nem gizmos —
    // igual ao Prisma 3D. O loop ao vivo religa os helpers no próximo frame.
    setHelperVisibility(!forceFinal);
    // Lamp off: skip the whole post-processing composer, straight raw
    // render — no bloom/AO/outline/grade/God Rays. Cheap orbit/edit default.
    // Render final (export de vídeo) sempre usa o pipeline completo,
    // independente do estado da lâmpada.
    if (!lightPreviewActive && !forceFinal) {
      app.renderer.setRenderTarget(null);
      app.renderer.render(app.scene, app.camera);
      return;
    }
    setPipeline('standard');
    _renderSelectiveBloom();

    // Tempo real: um frame completo por tick, sem acumulação.
    composer.render();
    return;
  }

  // VISUALIZATION
  if (mode === 'visualization') {
    setHelperVisibility(!forceFinal);
    setPipeline('visualization');
    composer.render();
    return;
  }

  // fallback
  setHelperVisibility(!forceFinal);
  if (!lightPreviewActive && !forceFinal) {
    app.renderer.setRenderTarget(null);
    app.renderer.render(app.scene, app.camera);
    return;
  }
  setPipeline('standard');
  composer.render();
}

// Rebuilds the composer's pass list so newly added/removed lights pick up
// (or drop) their God Rays pass. NOT needed just to toggle a light's
// "Emitir God Rays" checkbox on/off — each pass checks that itself every
// frame — only when a qualifying light is actually created or deleted.
export function refreshGodRaysPipeline() {
  setPipeline(renderState.mode);
}

// Same idea, for the SSR reflections pipeline: only needed when the global
// SSR toggle flips — see reflections.js for why quality-setting tweaks
// don't need this.
export function refreshReflectionsPipeline() {
  setPipeline(renderState.mode);
}

export function toggleLayer(layer, force) {
  const on = force !== undefined ? force : !activeLayers.has(layer);

  if (on) activeLayers.add(layer);
  else activeLayers.delete(layer);

  if (!on && layer === 'visualization') {
    if (_visOverrideMat) {
      _visOverrideMat.dispose();
      _visOverrideMat = null;
    }
    if (app.renderer) app.renderer.overrideMaterial = null;
  }

  ensureComposer();
  setPipeline(renderState.mode);
  markSceneDirty();
}

export function setLayerConfig(layer, key, value) {
  if (!layerConfig[layer]) return;
  layerConfig[layer][key] = value;

  if (layer === 'outline' && outlinePass) {
    if (key === 'strength') outlinePass.edgeStrength = value;
    if (key === 'glow') outlinePass.edgeGlow = value;
    if (key === 'thickness') outlinePass.edgeThickness = value;
  }

  if (layer === 'film' && filmPass?.uniforms) {
    if (key === 'noise' && filmPass.uniforms.nIntensity) filmPass.uniforms.nIntensity.value = value;
    if (key === 'scanlines' && filmPass.uniforms.sIntensity) filmPass.uniforms.sIntensity.value = value;
    if (key === 'grayscale' && filmPass.uniforms.grayscale) filmPass.uniforms.grayscale.value = value ? 1 : 0;
  }

  if (layer === 'bokeh' && bokehPass) {
    if (key === 'focus') bokehPass.uniforms.focus.value = value;
    if (key === 'aperture') bokehPass.uniforms.aperture.value = value;
    if (key === 'maxblur') bokehPass.uniforms.maxblur.value = value;
  }

  if (layer === 'pixelated' && pixelatedPass && key === 'pixelSize') {
    if (typeof pixelatedPass.setPixelSize === 'function') pixelatedPass.setPixelSize(value);
  }

  markSceneDirty();
}

export function updateOutlineSelected(object) {
  if (!outlinePass) return;
  if (!outlineConfig.enabled || !object) { outlinePass.selectedObjects = []; return; }
  const meshes = [];
  object.traverse(o => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); });
  outlinePass.selectedObjects = meshes.length ? meshes : [object];
  markSceneDirty();
}

/** Toggles the selection outline on/off — Configurações → Viewport. */
export function setOutlineEnabled(enabled) {
  outlineConfig.enabled = !!enabled;
  updateOutlineSelected(app.selected || null);
}

/** Changes the selection outline color — Configurações → Viewport. */
export function setOutlineColor(hex) {
  outlineConfig.color = hex;
  if (outlinePass) outlinePass.visibleEdgeColor.set(hex);
  markSceneDirty();
}

export function downloadCurrentFrame() {
  if (!app.renderer) return;
  const url = app.renderer.domElement.toDataURL('image/png');
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `render-${Date.now()}.png`
  });
  document.body.appendChild(link);
  link.click();
  link.remove();
}