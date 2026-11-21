import * as T from 'three';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { VerticalTiltShiftShader } from './vendor/shaders/VerticalTiltShiftShader.js';
import { HorizontalTiltShiftShader } from './vendor/shaders/HorizontalTiltShiftShader.js';
import { VignetteShader } from './vendor/shaders/VignetteShader.js';

/**
 * Custom Color Grading & Vibrance Shader
 * Adds rich game-like saturation, warm sunlight tint, and micro-contrast.
 */
const StylizedColorGradingShader = {
  name: 'StylizedColorGradingShader',
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.25 },   // 1.0 = normal, 1.25 = rich game colors
    contrast: { value: 1.12 },     // 1.0 = normal, 1.12 = crisp punchy shadows
    brightness: { value: 0.02 },   // Subtle lift
    warmth: { value: 0.03 }        // Subtle golden sunlight tone
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    uniform float warmth;
    varying vec2 vUv;

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec3 rgb = col.rgb;

      // Brightness & Contrast
      rgb = (rgb - 0.5) * contrast + 0.5 + brightness;

      // Saturation
      float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      rgb = mix(vec3(lum), rgb, saturation);

      // Warm sunlight lift (adds a touch of warm amber to midtones & highlights)
      rgb.r += warmth * (rgb.r * 0.8 + 0.2);
      rgb.b -= warmth * 0.5 * (rgb.b * 0.8 + 0.2);

      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), col.a);
    }
  `
};

/**
 * Creates and manages the High-End Game Studio Post-Processing Pipeline.
 */
export function createGamePostProcessing(renderer, scene, camera) {
  let enabled = false;
  let bloomEnabled = false;
  let tiltShiftEnabled = false;
  let vignetteEnabled = false;
  let colorGradeEnabled = false;

  const w = window.innerWidth;
  const h = window.innerHeight;

  // 1. Composer Setup
  const renderTarget = new T.WebGLRenderTarget(w, h, {
    type: T.HalfFloatType,
    format: T.RGBAFormat,
    colorSpace: T.SRGBColorSpace,
    samples: 4 // Multi-sampling anti-aliasing
  });

  const composer = new EffectComposer(renderer, renderTarget);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(w, h);

  // 2. Base Scene Pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // 3. Unreal Bloom Pass (Glowing neon, emissive windows, Data Highway lights)
  const bloomPass = new UnrealBloomPass(
    new T.Vector2(w, h),
    0.48,  // Strength (subtle, beautiful glow)
    0.35,  // Radius
    0.78   // Threshold (only bright highlights & emissives glow)
  );
  bloomPass.enabled = bloomEnabled;
  composer.addPass(bloomPass);

  // 4. Tilt-Shift Passes (Miniature diorama / toy-world blur)
  const vTiltShiftPass = new ShaderPass(VerticalTiltShiftShader);
  vTiltShiftPass.uniforms['v'].value = 1.8 / h;
  vTiltShiftPass.uniforms['r'].value = 0.50; // Focus on center horizon
  vTiltShiftPass.enabled = tiltShiftEnabled;
  composer.addPass(vTiltShiftPass);

  const hTiltShiftPass = new ShaderPass(HorizontalTiltShiftShader);
  hTiltShiftPass.uniforms['h'].value = 1.0 / w;
  hTiltShiftPass.uniforms['r'].value = 0.50;
  hTiltShiftPass.enabled = tiltShiftEnabled;
  composer.addPass(hTiltShiftPass);

  // 5. Stylized Color Grading & Vibrance
  const colorGradingPass = new ShaderPass(StylizedColorGradingShader);
  colorGradingPass.enabled = colorGradeEnabled;
  composer.addPass(colorGradingPass);

  // 6. Vignette Pass (Cinematic framing)
  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.uniforms['offset'].value = 1.15;
  vignettePass.uniforms['darkness'].value = 1.10;
  vignettePass.enabled = vignetteEnabled;
  composer.addPass(vignettePass);

  // 7. Output Pass (Tone Mapping + Color Space conversion)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  function resize(newW, newH) {
    composer.setSize(newW, newH);
    bloomPass.resolution.set(newW, newH);
    vTiltShiftPass.uniforms['v'].value = 1.8 / newH;
    hTiltShiftPass.uniforms['h'].value = 1.0 / newW;
  }

  function render() {
    if (enabled) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  function setEnabled(val) {
    enabled = Boolean(val);
  }

  function setBloom(val) {
    bloomEnabled = Boolean(val);
    bloomPass.enabled = bloomEnabled;
  }

  function setTiltShift(val) {
    tiltShiftEnabled = Boolean(val);
    vTiltShiftPass.enabled = tiltShiftEnabled;
    hTiltShiftPass.enabled = tiltShiftEnabled;
  }

  function setVignette(val) {
    vignetteEnabled = Boolean(val);
    vignettePass.enabled = vignetteEnabled;
  }

  function setColorGrade(val) {
    colorGradeEnabled = Boolean(val);
    colorGradingPass.enabled = colorGradeEnabled;
  }

  // Create an on-screen HUD controller pill
  function buildHUDControls() {
    const existing = document.querySelector('#game-shader-dock');
    if (existing) existing.remove();

    const dock = document.createElement('div');
    dock.id = 'game-shader-dock';
    dock.style.cssText = `
      position: fixed;
      top: 68px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 40;
      display: flex;
      align-items: center;
      gap: 10px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 30px;
      padding: 6px 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      color: #f1f5f9;
      font-size: 11px;
      user-select: none;
    `;

    dock.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:#38bdf8;padding-right:6px;border-right:1px solid rgba(255,255,255,0.15);">
        <span>🎮</span> <span>GAME SHADERS</span>
      </div>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-weight:600;color:#facc15;">
        <input type="checkbox" id="chk-shader-master" style="accent-color:#eab308;cursor:pointer;">
        Master
      </label>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:#e2e8f0;">
        <input type="checkbox" id="chk-shader-bloom" style="accent-color:#38bdf8;cursor:pointer;">
        Bloom
      </label>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:#e2e8f0;">
        <input type="checkbox" id="chk-shader-tilt" style="accent-color:#38bdf8;cursor:pointer;">
        Tilt-Shift
      </label>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;color:#e2e8f0;">
        <input type="checkbox" id="chk-shader-grade" style="accent-color:#38bdf8;cursor:pointer;">
        Color+Vignette
      </label>
    `;

    document.body.appendChild(dock);

    const chkMaster = dock.querySelector('#chk-shader-master');
    const chkBloom = dock.querySelector('#chk-shader-bloom');
    const chkTilt = dock.querySelector('#chk-shader-tilt');
    const chkGrade = dock.querySelector('#chk-shader-grade');

    chkMaster.onchange = () => {
      setEnabled(chkMaster.checked);
      if (chkMaster.checked && !chkBloom.checked && !chkTilt.checked && !chkGrade.checked) {
        chkBloom.checked = true;
        chkTilt.checked = true;
        chkGrade.checked = true;
        setBloom(true);
        setTiltShift(true);
        setColorGrade(true);
        setVignette(true);
      }
    };
    chkBloom.onchange = () => setBloom(chkBloom.checked);
    chkTilt.onchange = () => setTiltShift(chkTilt.checked);
    chkGrade.onchange = () => {
      setColorGrade(chkGrade.checked);
      setVignette(chkGrade.checked);
    };
  }

  return {
    composer,
    bloomPass,
    vTiltShiftPass,
    hTiltShiftPass,
    colorGradingPass,
    vignettePass,
    outputPass,
    resize,
    render,
    setEnabled,
    setBloom,
    setTiltShift,
    setVignette,
    setColorGrade,
    buildHUDControls
  };
}
