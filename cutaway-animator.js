/**
 * cutaway-animator.js
 * Controls smooth camera transitions, cut-away interior inspection,
 * and 3D interior staging for AN PHIM World Command Cockpit.
 */

import * as T from 'three';
import { buildInterior, footprintOf, pickFocus, roomPlan } from './interior-builder.js?rev=interior_v3';
import { disposeObject } from './dispose-helper.js';

const BACKDROP = 0x1a2230, SWAP_MS = 220;

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
    this.hiddenCampus = [];
    this.room = null;      // the room that should be on screen: {plan, pos, view}
    this.staged = false;   // true once the campus is hidden and the room is built

    // Cache ambient lights in scene for dusk/focus effect
    this.sunLight = null;
    this.hemiLight = null;
    this.scene.traverse(child => {
      if (child.isDirectionalLight && !this.sunLight) this.sunLight = child;
      if (child.isHemisphereLight && !this.hemiLight) this.hemiLight = child;
    });

    // Going inside reads as loading another place: the view dips to the backdrop colour while the campus is swapped for the room.
    this.veil = document.createElement('div');
    this.veil.style.cssText = `position:fixed;inset:0;z-index:40;pointer-events:none;opacity:0;transition:opacity ${SWAP_MS}ms ease;background:#${BACKDROP.toString(16).padStart(6, '0')}`;
    document.body.appendChild(this.veil);
  }

  inspect(buildingId, targetPos, bInfo = {}) {
    const buildingGroup = this.buildingObjects.get(bInfo.hostId || buildingId);
    if (!buildingGroup) return;

    this.isInspecting = true;
    this.currentInspectedId = buildingId;

    // Save original camera state if not already saved
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

    // The room has the outline of the building itself, measured once per building
    buildingGroup.userData.footprint ??= footprintOf(buildingGroup);
    const plan = roomPlan(buildingGroup.userData.footprint, bInfo.width, bInfo.depth);
    this.room = {
      plan, pos: [posX, posY + 0.02, posZ],
      view: bInfo.view || {type: null, id: buildingId, title: bInfo.name, connected: false, agents: []}
    };

    // While inside: no panning, every mouse button orbits the room
    this.controls.enablePan = false;
    this.controls.mouseButtons.LEFT = T.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = T.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = T.MOUSE.ROTATE;

    this.tweenCameraZoom(new T.Vector3(posX + 16, posY + 16, posZ + 16), new T.Vector3(posX, posY + 1.2, posZ), plan.span, 750);
    this.swap();
  }

  /** Rebuilds the room from a new view (data refresh) without touching the camera. */
  buildInterior(view) {
    if (!this.room) return;
    this.room.view = view;
    if (!this.staged) return;
    if (this.currentInterior) disposeObject(this.currentInterior);
    this.currentInterior = buildInterior(view, this.room.plan);
    this.currentInterior.position.set(...this.room.pos);
    this.scene.add(this.currentInterior);
  }

  /** What the pointer ray hits inside the room: undefined (nothing), null (room, nothing clickable) or {section, id}. */
  pick(raycaster) {
    return this.currentInterior ? pickFocus(this.currentInterior, raycaster) : undefined;
  }

  /** Dips to the backdrop, then shows what `this.room` asks for: the room alone, or the campus again. */
  swap() {
    clearTimeout(this.swapTimer);
    this.veil.style.opacity = '1';
    this.swapTimer = setTimeout(() => {
      this.stage();
      this.veil.style.opacity = '0';
      window.requestRender?.();
    }, SWAP_MS);
  }

  stage() {
    this.cleanupInterior();
    if (!this.room) return;
    this.hideCampus();
    this.staged = true;
    this.buildInterior(this.room.view);

    const [x, y, z] = this.room.pos;
    this.interiorLight = new T.PointLight(0xfff7ed, 3.0, 40);
    this.interiorLight.position.set(x, y + 5, z);
    this.scene.add(this.interiorLight);
    if (this.sunLight) this.sunLight.intensity = 1.5;
    if (this.hemiLight) this.hemiLight.intensity = 1.25;
  }

  /** Hides everything of the campus (terrain, roads, buildings, scenery); only lights stay, on a plain backdrop. */
  hideCampus() {
    const hasLight = o => o.isLight || o.children.some(hasLight);
    const hide = o => {
      if (o.isLight || o.isCamera || !o.visible) return;
      if (hasLight(o)) return o.children.forEach(hide);
      o.visible = false;
      this.hiddenCampus.push(o);
    };
    this.scene.children.forEach(hide);
    this.campusBackdrop = {background: this.scene.background, fog: this.scene.fog};
    this.scene.background = new T.Color(BACKDROP);
    this.scene.fog = null;
  }

  cleanupInterior() {
    this.staged = false;
    if (this.currentInterior) {
      disposeObject(this.currentInterior);
      this.currentInterior = null;
    }
    if (this.interiorLight) {
      this.scene.remove(this.interiorLight);
      this.interiorLight = null;
    }
    for (const o of this.hiddenCampus) o.visible = true;
    this.hiddenCampus = [];
    if (this.campusBackdrop) {
      this.scene.background = this.campusBackdrop.background;
      this.scene.fog = this.campusBackdrop.fog;
      this.campusBackdrop = null;
    }
    if (this.sunLight) this.sunLight.intensity = 1.85;
    if (this.hemiLight) this.hemiLight.intensity = 0.85;
  }

  exit() {
    if (!this.isInspecting) return;
    this.isInspecting = false;
    this.room = null;
    this.swap();

    // Restore free campus navigation controls
    this.controls.enablePan = true;
    this.controls.mouseButtons.LEFT = -1;
    this.controls.mouseButtons.MIDDLE = T.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = T.MOUSE.PAN;

    // Restore camera position, lookAt target, and Orthographic Span
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

  /** Moves the people in the room; true while a room is on screen, so the caller keeps drawing frames. */
  update(now = performance.now()) {
    if (!this.currentInterior) return false;
    this.currentInterior.userData.update(now / 1000, this.camera);
    return true;
  }
}
