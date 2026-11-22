// Lưới gạch lát cho sân cam (theo ảnh tham chiếu): hoạ tiết thủ tục theo toạ độ world nên khớp liền mạch
// giữa terrain và các mesh sân, không cần UV hay file texture.
// Bật/tắt và chỉnh qua campus-palette.json → "paving" ({tiles, tileSize, courtStrength, walkStrength}).
export function applyCampusPaving(P, courtMaterial, walkMaterial) {
  const cfg = P?.paving;
  if (!cfg?.tiles) return;
  applyPavingTiles(courtMaterial, cfg.tileSize, cfg.courtStrength);
  applyPavingTiles(walkMaterial, cfg.tileSize, cfg.walkStrength);
}

export function applyPavingTiles(material, tile = 1.5, strength = .2) {
  if (!material || material.userData.pavingTiles || !(strength > 0) || !(tile > 0)) return material;
  material.userData.pavingTiles = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPavingXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPavingXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPavingXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 pv = vPavingXZ / ${tile.toFixed(3)};
          vec2 edge = abs(fract(pv) - 0.5);
          float aa = fwidth(pv.x) + fwidth(pv.y);
          float joint = smoothstep(0.46 - aa, 0.46 + aa, max(edge.x, edge.y)) * clamp(1.0 - aa * 3.0, 0.0, 1.0);
          vec2 id = floor(pv);
          float shade = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= (1.0 - ${strength.toFixed(3)} * joint) * (0.965 + 0.07 * shade);
        }`);
  };
  material.customProgramCacheKey = () => 'paving-tiles-' + tile + '-' + strength;
  material.needsUpdate = true;
  return material;
}
