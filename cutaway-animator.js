/**
 * cutaway-animator.js
 * Controls smooth camera transitions, cut-away interior inspection,
 * and 3D interior staging for AN PHIM World Command Cockpit.
 */

import * as T from 'three';
import { buildInterior } from './interior-builder.js?rev=interior_v2';
import { disposeObject } from './dispose-helper.js';

export class CutawayAnimator {
  constructor(scene, camera, controls, buildingObjects, setSpanFn, getSpanFn, director = null) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.buildingObjects = buildingObjects;
    this.setSpan = setSpanFn;
    this.getSpan = getSpanFn;
    this.director = director;

    this.currentInspectedId = null;
    this.isInspecting = false;
    this.originalCameraState = null;
    this.currentInterior = null;
    this.interiorLight = null;
    this.hiddenBuilding = null;

    // Cache ambient lights in scene for dusk/focus effect
    this.sunLight = null;
    this.hemiLight = null;
    this.scene.traverse(child => {
      if (child.isDirectionalLight && !this.sunLight) this.sunLight = child;
      if (child.isHemisphereLight && !this.hemiLight) this.hemiLight = child;
    });
  }

  inspect(buildingId, targetPos, bInfo = {}) {
    const buildingGroup = this.buildingObjects.get(buildingId);
    if (!buildingGroup) return;

    // Clean up previous interior if any
    this.cleanupInterior();

    this.isInspecting = true;
    this.currentInspectedId = buildingId;

    // 1. Save original camera state
    if (!this.originalCameraState) {
      this.originalCameraState = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        span: this.getSpan ? this.getSpan() : 95
      };
    }

    const posX = targetPos[0] || 0;
    const posY = targetPos[1] || 0;
    const posZ = targetPos[2] || 0;

    // 2. Smooth Tween Camera & Orthographic Span (Zoom deeply from 95/115 -> 22)
    const targetCamPos = new T.Vector3(posX + 14, posY + 16, posZ + 18);
    const targetLookAt = new T.Vector3(posX, posY + 1.2, posZ);
    const targetSpan = 22; // Deep close-up zoom

    // Lock controls to Orbit-only around inspected building (zero panning/drifting)
    this.controls.enablePan = false;
    this.controls.mouseButtons.LEFT = T.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = T.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = T.MOUSE.ROTATE;

    this.tweenCameraZoom(targetCamPos, targetLookAt, targetSpan, 750);

    // 3. Hide outer building shell to expose interior cutaway cleanly
    this.hiddenBuilding = buildingGroup;
    this.hiddenBuilding.visible = false;

    // Hide any floating rooftop elements (e.g. rooftop planter boxes) during cutaway
    this.hiddenRoofObjects = [];
    this.scene.traverse(o => {
      if (o.name === 'rooftop-gardens' || o.userData?.isRooftop) {
        if (o.visible) {
          o.visible = false;
          this.hiddenRoofObjects.push(o);
        }
      }
    });

    // 4. Build and stage 3D Interior (parquet floor, low cutaway walls, desks, glowing PCs, agents, plants)
    const bW = bInfo.width || (buildingId.includes('hq') ? 16 : 9);
    const bD = bInfo.depth || (buildingId.includes('hq') ? 12 : 8);
    this.currentInterior = buildInterior(buildingId, bW, bD);
    this.currentInterior.position.set(posX, posY + 0.02, posZ);
    this.scene.add(this.currentInterior);

    // 5. Warm interior illumination & dusk ambient focus
    this.interiorLight = new T.PointLight(0xfff7ed, 4.0, 32);
    this.interiorLight.position.set(posX, posY + 4.5, posZ);
    this.scene.add(this.interiorLight);

    if (this.sunLight) this.sunLight.intensity = 0.55;
    if (this.hemiLight) this.hemiLight.intensity = 0.40;
  }

  cleanupInterior() {
    if (this.currentInterior) {
      disposeObject(this.currentInterior);
      this.currentInterior = null;
    }
    if (this.interiorLight) {
      this.scene.remove(this.interiorLight);
      this.interiorLight = null;
    }
    if (this.hiddenBuilding) {
      this.hiddenBuilding.visible = true;
      this.hiddenBuilding = null;
    }
    if (this.hiddenRoofObjects && this.hiddenRoofObjects.length > 0) {
      this.hiddenRoofObjects.forEach(o => { o.visible = true; });
      this.hiddenRoofObjects = [];
    }
    if (this.sunLight) this.sunLight.intensity = 1.85;
    if (this.hemiLight) this.hemiLight.intensity = 0.85;
  }

  exit() {
    if (!this.isInspecting) return;
    this.isInspecting = false;

    // 1. Clean up interior staging & restore building visibility & campus lighting
    this.cleanupInterior();

    // Restore free campus navigation controls
    this.controls.enablePan = true;
    this.controls.mouseButtons.LEFT = -1;
    this.controls.mouseButtons.MIDDLE = T.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = T.MOUSE.PAN;

    // 2. Restore camera position, lookAt target, and Orthographic Span
    if (this.originalCameraState) {
      this.tweenCameraZoom(
        this.originalCameraState.position,
        this.originalCameraState.target,
        this.originalCameraState.span,
        750,
        () => {
          this.originalCameraState = null;
        },
        reason => {
          // Interrupted by the user: stay where they are. A new inspect keeps the saved state.
          if (reason !== 'replaced') this.originalCameraState = null;
        }
      );
    }

    this.currentInspectedId = null;
  }

  tweenCameraZoom(endPos, endTarget, endSpan, duration, onComplete, onCancel) {
    if (this.director) {
      this.director.flyTo({ position: endPos, target: endTarget, span: endSpan }, { onComplete, onCancel });
      return;
    }
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startSpan = this.getSpan ? this.getSpan() : 95;
    const startTime = performance.now();

    const anim = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      const ease = 1 - Math.pow(1 - progress, 3); // Ease out cubic

      this.camera.position.lerpVectors(startPos, endPos, ease);
      this.controls.target.lerpVectors(startTarget, endTarget, ease);
      this.controls.update();

      if (this.setSpan) {
        const curSpan = startSpan + (endSpan - startSpan) * ease;
        this.setSpan(curSpan);
      }

      if (progress < 1.0) {
        requestAnimationFrame(anim);
      } else if (onComplete) {
        onComplete();
      }
    };
    requestAnimationFrame(anim);
  }

  update() {
    // Selection ring removed per CEO request
  }
}
