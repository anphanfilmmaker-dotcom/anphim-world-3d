import * as THREE from 'three';

export function createAdapter(P) {
  const C = k => new THREE.Color(P.colors[k]);

  function paletteMaterial(original, kind) {
    const m = original.clone();
    if (m.map) m.color.set(0xffffff);
    m.roughness = kind === 'building' ? P.materialTargets.plaster.roughness : P.materialTargets.road.roughness;
    m.metalness = kind === 'building' ? 0.05 : 0.0;

    m.onBeforeCompile = shader => {
      shader.uniforms.palGlassRoughness = { value: P.materialTargets.glass.roughness };
      shader.uniforms.palGlassMetalness = { value: P.materialTargets.glass.metalness };
      for (const key of ['plaster', 'stone', 'glass', 'frame', 'terracotta', 'brass', 'asphalt', 'roadMarking', 'canopyMid', 'canopyLight', 'canopyDark', 'soil', 'lawn']) {
        shader.uniforms['pal_' + key] = { value: C(key) };
      }

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nuniform float palGlassRoughness;\nuniform float palGlassMetalness;\n' +
        ['plaster', 'stone', 'glass', 'frame', 'terracotta', 'brass', 'asphalt', 'roadMarking', 'canopyMid', 'canopyLight', 'canopyDark', 'soil', 'lawn'].map(k => 'uniform vec3 pal_' + k + ';').join('\n')
      );

      const code = kind === 'building' ? `
        vec3 src = diffuseColor.rgb;
        float lum = dot(src, vec3(.2126, .7152, .0722));
        if (src.b > src.r * 1.65 && src.b > src.g * 1.25 && src.r < .55) {
          // Architectural PBR Glass: crisp specular sheen & reflection
          diffuseColor.rgb = pal_glass * (.85 + .25 * lum);
          roughnessFactor = palGlassRoughness;
          metalnessFactor = palGlassMetalness;
        } else if (lum < .065) {
          // Window frames & metal mullions
          diffuseColor.rgb = pal_frame;
          roughnessFactor = 0.45;
          metalnessFactor = 0.25;
        } else if (src.r > src.g * 1.6 && src.r > src.b * 1.8 && lum > .2) {
          // Terracotta / Brass accents
          diffuseColor.rgb = mix(pal_terracotta, pal_brass, .45) * (.83 + .22 * lum);
          roughnessFactor = 0.35;
          metalnessFactor = 0.40;
        } else {
          // Smooth architectural plaster & limestone
          diffuseColor.rgb = mix(pal_stone, pal_plaster, smoothstep(.12, .65, lum));
          roughnessFactor = 0.68;
          metalnessFactor = 0.0;
        }
      ` : (kind === 'tree' || kind === 'garden' || kind === 'shrub') ? `
        vec3 src = diffuseColor.rgb;
        if (src.g > src.r * 0.92) {
          float lum = dot(src, vec3(.2126, .7152, .0722));
          diffuseColor.rgb = mix(pal_canopyDark, pal_canopyLight, smoothstep(.10, .75, lum));
          roughnessFactor = 0.88;
        } else if (src.r > src.g * 1.25) {
          // Hoa / chi tiết màu nóng trong bồn hoa
          diffuseColor.rgb = mix(pal_terracotta, pal_brass, 0.35) * 1.25;
          roughnessFactor = 0.72;
        } else {
          diffuseColor.rgb = pal_soil;
          roughnessFactor = 0.95;
        }
      ` : `
        vec3 src = diffuseColor.rgb;
        float lum = dot(src, vec3(.2126, .7152, .0722));
        if (src.g > src.r * 1.15 && src.g > src.b * 1.1) {
          diffuseColor.rgb = pal_lawn;
          roughnessFactor = 0.90;
        } else if (lum > .65) {
          diffuseColor.rgb = pal_roadMarking;
          roughnessFactor = 0.40;
        } else if (lum > .32) {
          diffuseColor.rgb = pal_stone;
          roughnessFactor = 0.82;
        } else {
          diffuseColor.rgb = pal_asphalt * (.9 + lum * .5);
          roughnessFactor = 0.88;
        }
      `;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\n' + code
      );
    };

    m.customProgramCacheKey = () => kind + '-world-palette-v3-pbr';
    return m;
  }

  return paletteMaterial;
}
