/**
 * cutaway-animator.js
 * Controls smooth camera transitions, cut-away interior inspection,
 * and 3D interior staging for AN PHIM World Command Cockpit.
 */

import * as T from 'three';
import { buildInterior, pickFocus, roomSize } from './interior-builder.js?rev=interior_v2';
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
    const buildingGroup = this.buildingObjects.get(bInfo.hostId || buildingId);
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
    const targetCamPos = new T.Vector3(posX + 16, posY + 16, posZ + 16);
    const targetLookAt = new T.Vector3(posX, posY + 1.2, posZ);
    const targetSpan = roomSize(bInfo.width)[0] * 1.3; // the room fills the space between the two panels

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

    // 4. Build the room from the building's data (bInfo.view comes from dataConnector.getBuildingView)
    this.interiorSize = [bInfo.width || 13, bInfo.depth || 10];
    this.interiorPos = [posX, posY + 0.02, posZ];
    this.buildInterior(bInfo.view || {type: null, id: buildingId, title: bInfo.name, connected: false, agents: []}, bInfo.mask);

    this.hideClutter(posX, posZ);

    this.interiorLight = new T.PointLight(0xfff7ed, 4.0, 32);
    this.interiorLight.position.set(posX, posY + 4.5, posZ);
    this.scene.add(this.interiorLight);

    if (this.sunLight) this.sunLight.intensity = 0.55;
    if (this.hemiLight) this.hemiLight.intensity = 0.40;
  }

  /** (Re)builds the room in place from a view model, e.g. after a data refresh; the camera does not move. */
  buildInterior(view, mask) {
    if (this.currentInterior) disposeObject(this.currentInterior);
    this.currentInterior = buildInterior(view, this.interiorSize[0], this.interiorSize[1], {mask});
    this.currentInterior.position.set(...this.interiorPos);
    this.scene.add(this.currentInterior);
  }

  /** What the pointer ray hits inside the room: undefined (nothing), null (room, nothing clickable) or {section, id}. */
  pick(raycaster) {
    return this.currentInterior ? pickFocus(this.currentInterior, raycaster) : undefined;
  }

  /** Hides scenery (trees, shrubs, lamps) standing in the room or between it and the camera; the terrain, roads and buildings stay. */
  hideClutter(x, z) {
    const [w, d] = roomSize(...this.interiorSize);
    const inFront = p => { const dx = p.x - x, dz = p.z - z; return dx > -w / 2 - 1 && dx < w / 2 + 6 && dz > -d / 2 - 1 && dz < d / 2 + 6; };
    const m = new T.Matrix4(), p = new T.Vector3(), size = new T.Vector3(), box = new T.Box3(), zero = new T.Matrix4().makeScale(0, 0, 0);
    this.hiddenInstances = [];
    this.hiddenClutter = [];
    const visit = o => {
      if (o === this.currentInterior || o.userData?.isBuildingRoot || !o.visible) return;
      if (o.isInstancedMesh) {
        let touched = false;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          if (!inFront(p.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld))) continue;
          this.hiddenInstances.push([o, i, m.clone()]);
          o.setMatrixAt(i, zero);
          touched = true;
        }
        if (touched) o.instanceMatrix.needsUpdate = true;
      } else if (o.isMesh && o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).getSize(size);
        // Small enough to be a tree, a shrub, a lamp or a ground plate; larger meshes are terrain, roads and water.
        const small = size.x < 12 && size.z < 12;
        const over = (pad, front) => box.max.x > x - w / 2 - pad && box.min.x < x + w / 2 + front && box.max.z > z - d / 2 - pad && box.min.z < z + d / 2 + front;
        if (small && (over(0, 0) || (size.y > 0.9 && over(0.5, 6)))) {
          o.visible = false;
          this.hiddenClutter.push(o);
        }
      }
      for (const child of o.children) visit(child);
    };
    visit(this.scene);
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
    for (const [o, i, m] of this.hiddenInstances || []) {
      o.setMatrixAt(i, m);
      o.instanceMatrix.needsUpdate = true;
    }
    this.hiddenInstances = [];
    for (const o of this.hiddenClutter || []) o.visible = true;
    this.hiddenClutter = [];
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

  update(now = performance.now()) {
    this.currentInterior?.userData.update?.(now / 1000);
  }
}
