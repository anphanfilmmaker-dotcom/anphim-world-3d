import * as T from 'three';

/**
 * AAA Resource Disposal & Memory Leak Prevention Utility
 * Recursively disposes geometries, materials, and textures while preserving shared/cached assets.
 */
export function disposeObject(root) {
  if (!root) return;

  root.traverse(o => {
    // Preserve shared registry or cached assets if tagged
    if (o.userData && (o.userData.isSharedAsset || o.userData.isCached)) return;

    // 1. Dispose Geometries
    if (o.geometry && !o.geometry.userData?.isCached) {
      o.geometry.dispose();
    }

    // 2. Dispose Materials & Textures
    if (o.material) {
      if (Array.isArray(o.material)) {
        o.material.forEach(m => disposeMaterial(m));
      } else {
        disposeMaterial(o.material);
      }
    }
  });

  if (root.parent) {
    root.parent.remove(root);
  }
}

export function disposeMaterial(mat) {
  if (!mat || mat.userData?.isSharedMaterial || mat.userData?.isCached) return;

  // Dispose all attached textures on the material
  for (const key of Object.keys(mat)) {
    const prop = mat[key];
    if (prop && typeof prop === 'object' && prop.isTexture && !prop.userData?.isSharedTexture) {
      prop.dispose();
    }
  }

  mat.dispose();
}
