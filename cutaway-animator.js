/**
 * cutaway-animator.js
 * Going inside a building, the way The Sims goes to a lot: the camera zooms in, the campus gives way to a
 * plain lot with a few trees, and the building itself opens from the roof down to the storey being looked at.
 * What is seen inside is the same building at the same size: its walls, its gate, its storeys.
 */

import * as T from 'three';
import { FullScreenQuad } from './vendor/postprocessing/Pass.js';
import { buildFloor, buildInterior, buildLot, fitRoom, footprintOf, roomPlan, FLOOR_Y } from './interior-builder.js?rev=interior_v4';
import { buildShell, planOf, sectionOf, STUB_H } from './building-section.js?rev=section_v1';
import { disposeObject } from './dispose-helper.js';

const ROOM_LAYER = 1;
const FLY_IN_MS = 1200;   // camera zoom into the building
const FADE_MS = 900;      // campus giving way to the lot (or coming back)
const OPEN_AT_MS = 380;   // the building starts to open this long after the click
const OPEN_MS = 750, CLOSE_MS = 260;   // roof coming off, and going back on
const FLOOR_MS = 500;     // camera following a change of storey
const ROOM_SUN = 1.5, ROOM_SKY = 1.7;
const smooth = k => k * k * (3 - 2 * k), easeOut = k => 1 - Math.pow(1 - k, 3);
const toward = (v, goal, step) => v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step);
/** Height a building is cut at to show a storey: just under the floor above. */
const cutAt = (section, floor) => Math.min(section.floors[floor].top - 0.06, section.floors[floor].y + 3.6);

/** Shows the campus frame (`uAway` 0) dissolving into the plain backdrop of the lot (`uAway` 1). */
const BACKDROP_SHADER = {
  uniforms: {
    tCampus: {value: null}, uAway: {value: 0},
    uTop: {value: new T.Vector3(0.87, 0.91, 0.94)}, uBottom: {value: new T.Vector3(0.91, 0.94, 0.90)}
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tCampus;
    uniform float uAway;
    uniform vec3 uTop, uBottom;
    varying vec2 vUv;
    void main() {
      // tCampus is the frame as it was shown on screen, so its colours are final already
      gl_FragColor = vec4(mix(texture2D(tCampus, vUv).rgb, mix(uBottom, uTop, vUv.y), uAway), 1.0);
    }`
};

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
    this.room = null;            // the room that should be on screen: {host, hostId, view, section, floor, pos, plan}
    this.closing = null;         // the room still on screen while its building closes again
    this.staged = false;         // true once the building has started to open
    this.shell = null;           // the building cut open (building-section buildShell); null for a room of its own
    this.lot = null;             // ground and trees around the open building
    this.currentInterior = null; // floor, furniture and people of the storey on screen
    this.fade = 0;               // 0 = campus, 1 = lot
    this.grown = 0;              // 0 = building closed, 1 = open down to the storey
    this.level = this.ceiling = this.roof = 0;   // heights of the cut: storey floor, storey top, building top
    this.openAt = null;          // when the building opens into the room that `this.room` asks for
    this.hiddenHost = [];
    this.lastNow = null;
    this.onFloors = null;        // called with (count, current) when the storeys on offer change

    this.sunLight = null;
    this.hemiLight = null;
    this.scene.traverse(child => {
      if (child.isDirectionalLight && !this.sunLight) this.sunLight = child;
      if (child.isHemisphereLight && !this.hemiLight) this.hemiLight = child;
    });

    this.campusTexture = null; // the campus as last drawn on screen, kept to dissolve from
    this.size = new T.Vector2();
    this.forward = new T.Vector3();
    this.far = [0, 0];         // which wall along each of the building's axes is the far one: -1 or 1
    this.backdrop = new FullScreenQuad(new T.ShaderMaterial({...BACKDROP_SHADER, uniforms: T.UniformsUtils.clone(BACKDROP_SHADER.uniforms), depthTest: false, depthWrite: false, toneMapped: false}));
  }

  /** Storeys of the open building that can be looked at. */
  get floors() {
    return this.storeys.length || 1;
  }

  /** The storeys that have a floor to stand on, as indexes into section.floors (a roof terrace or a bare frame is skipped). */
  get storeys() {
    const {room} = this;
    return !room || room.plan ? [] : room.section.floors.map((_, i) => i).filter(i => planOf(room.section, i));
  }

  inspect(buildingId, targetPos, bInfo = {}) {
    const host = this.buildingObjects.get(bInfo.hostId || buildingId);
    if (!host) return;

    this.isInspecting = true;
    this.currentInspectedId = buildingId;

    if (!this.originalCameraState) {
      this.originalCameraState = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        span: this.getSpan ? this.getSpan() : 95
      };
    }

    // Coming from another room, that room goes at once; the building is measured as it stands on the campus
    this.unstage();
    const section = sectionOf(host);
    const view = bInfo.view || {type: null, id: buildingId, title: bInfo.name, connected: false, agents: []};
    const room = {host, hostId: bInfo.hostId || buildingId, view, section, floor: 0, pos: [targetPos[0] || 0, (targetPos[1] || 0) + 0.02, targetPos[2] || 0], plan: null};
    if (!planOf(section, 0)) {
      // Nothing to stand in (a signboard): a room of its own, in the outline of the building
      host.userData.roomOutline ??= footprintOf(host);
      room.plan = roomPlan(host.userData.roomOutline, bInfo.width, bInfo.depth);
    }

    // While inside: no panning, every mouse button orbits the room
    this.controls.enablePan = false;
    this.controls.mouseButtons.LEFT = T.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = T.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = T.MOUSE.ROTATE;

    this.room = room;
    this.frame(new T.Vector3(16, 16, 16), FLY_IN_MS);
    this.openAt = performance.now() + OPEN_AT_MS;
    this.onFloors?.(this.floors, 0);
    window.requestRender?.();
  }

  /** World position of a point given in the open building's plan coordinates. */
  place(x, y, z, out = new T.Vector3()) {
    const {pos, rot} = this.room.section;
    return out.set(pos.x + x * Math.cos(rot) + z * Math.sin(rot), y, pos.z - x * Math.sin(rot) + z * Math.cos(rot));
  }

  /** Flies the camera to look at the storey on screen from `offset`. */
  frame(offset, duration) {
    const {room} = this;
    if (room.plan) {
      const at = new T.Vector3(room.pos[0], room.pos[1] + 1.2, room.pos[2]);
      this.tweenCameraZoom(at.clone().add(offset), at, room.plan.span, duration);
      return;
    }
    // Every storey is seen at the size of the ground floor: going up moves the camera, it does not zoom
    const {inner} = planOf(room.section, room.floor), ground = planOf(room.section, 0).inner;
    const at = this.place((inner.x0 + inner.x1) / 2, room.section.floors[room.floor].y + 1.2, (inner.z0 + inner.z1) / 2);
    const span = Math.max(9, (ground.x1 - ground.x0 + ground.z1 - ground.z0) / Math.SQRT2 * 1.3);
    this.tweenCameraZoom(at.clone().add(offset), at, span, duration);
  }

  /** Shows another storey of the open building. */
  setFloor(n) {
    const {room} = this, floor = this.storeys[n];
    if (!room || floor === undefined || floor === room.floor) return;
    room.floor = floor;
    this.buildInterior(room.view);
    this.frame(this.camera.position.clone().sub(this.controls.target), FLOOR_MS);
    this.onFloors?.(this.floors, n);
    window.requestRender?.();
  }

  /** Rebuilds what stands on the storey from a new view (data refresh) without touching the camera or the building. */
  buildInterior(view) {
    const {room} = this;
    if (!room) return;
    room.view = view;
    if (!this.staged) return;
    if (this.currentInterior) disposeObject(this.currentInterior);
    if (room.plan) {
      this.currentInterior = buildInterior(view, room.plan);
      this.currentInterior.position.set(...room.pos);
    } else {
      const {section, floor} = room, plan = planOf(section, floor);
      // The seven facility buildings are furnished life size (facility-interiors.js)
      const fit = fitRoom(plan.rect, section.gate, view.facility ? 1 : floor && fitRoom(planOf(section, 0).rect, section.gate).scale);
      const level = section.floors[floor].y;
      const house = this.currentInterior = new T.Group();
      house.position.set(section.pos.x, 0, section.pos.z);
      house.rotation.y = section.rot;
      const ground = buildFloor(plan.geometry, view.type);
      ground.position.y = level + 0.03;
      const things = buildInterior(view, {hx: fit.hx, hz: fit.hz, doorX: fit.doorX, floor: this.storeys.indexOf(floor), floors: this.floors,
        storey: plan, turn: fit.turn, height: section.floors[floor].top - section.floors[floor].y, gate: section.gate, top: planOf(section, this.storeys.at(-1)).areas});
      things.position.set(plan.rect.cx, level + 0.04 - FLOOR_Y * fit.scale, plan.rect.cz);
      things.rotation.y = fit.turn;
      things.scale.setScalar(fit.scale);
      house.add(ground, things);
      house.userData.update = things.userData.update;
    }
    // The house is drawn in its own pass, on top of the backdrop
    this.currentInterior.traverse(o => o.layers.set(ROOM_LAYER));
    this.scene.add(this.currentInterior);
    this.pose(performance.now());
  }

  /** What the pointer ray hits in the house: undefined (nothing), null (the house, nothing clickable) or {section, id}. */
  pick(raycaster) {
    if (!this.currentInterior) return undefined;
    raycaster.layers.enable(ROOM_LAYER);
    const hits = raycaster.intersectObjects(this.shell ? [this.currentInterior, this.shell.group] : [this.currentInterior], true);
    raycaster.layers.disable(ROOM_LAYER);
    // The part of the building that is cut away is not there to be clicked
    const hit = hits.find(h => !h.object.userData.clip || h.object.userData.clip.every(p => p.distanceToPoint(h.point) >= 0));
    if (!hit) return undefined;
    let o = hit.object;
    while (o && !o.userData.focus) o = o.parent;
    return o?.userData.focus || null;
  }

  /** The building opens: it is taken off the campus and stands on its lot, cut open. */
  stage() {
    this.unstage();
    const {room} = this;
    if (!room) return;
    this.staged = true;
    this.grown = 0;
    const {section} = room, {box} = section;
    if (!room.plan) {
      this.shell = buildShell(room.host, ROOM_LAYER);
      this.scene.add(this.shell.group);
      this.roof = box.y1 + 0.1;
      this.level = section.floors[0].y;
      this.ceiling = cutAt(section, 0);
    }
    const radius = room.plan ? room.plan.span * 0.62 : Math.hypot(box.x1 - box.x0, box.z1 - box.z0) / 2 + 5;
    this.lot = buildLot(radius, room.plan ? [0, radius / 2] : section.gate, room.hostId);
    if (room.plan) this.lot.position.set(...room.pos);
    else this.lot.position.set(section.pos.x, section.pos.y + 0.02, section.pos.z);
    this.lot.rotation.y = room.plan ? 0 : section.rot;
    this.lot.traverse(o => o.layers.set(ROOM_LAYER));
    this.scene.add(this.lot);
    this.buildInterior(room.view);
    this.hideHost();
  }

  /** The house stands where the building is, so the building and what is built around it step aside. */
  hideHost() {
    for (const o of this.hiddenHost) o.visible = true;
    this.hiddenHost = [];
    const {host, hostId} = this.room;
    this.scene.traverse(o => {
      // Lights reach the house's pass too, so both passes are lit by the same set
      if (o.isLight) o.layers.enable(ROOM_LAYER);
      if ((o === host || o.userData.buildingId === hostId) && o.visible) {
        o.visible = false;
        this.hiddenHost.push(o);
      }
    });
  }

  unstage() {
    this.staged = false;
    this.openAt = null;
    this.shell?.dispose();
    this.shell = null;
    for (const key of ['lot', 'currentInterior']) {
      if (this[key]) disposeObject(this[key]);
      this[key] = null;
    }
    for (const o of this.hiddenHost) o.visible = true;
    this.hiddenHost = [];
    this.closing = null;
  }

  exit() {
    if (!this.isInspecting) return;
    this.isInspecting = false;
    if (this.staged) this.closing = this.room;
    this.room = null;
    this.openAt = null;
    this.onFloors?.(1, 0);
    window.requestRender?.();

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
        null,
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
      this.director.flyTo({ position: endPos, target: endTarget, span: endSpan }, { duration, onComplete, onCancel });
      return;
    }
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startSpan = this.getSpan ? this.getSpan() : 95;
    const startTime = performance.now();
    duration ??= 900;

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

  /** Advances the transition and moves the people in the house; true while there is something to draw every frame. */
  update(now = performance.now()) {
    const dt = now - (this.lastNow ?? now);
    this.lastNow = now;
    this.fade = toward(this.fade, this.isInspecting ? 1 : 0, dt / FADE_MS);
    if (this.openAt !== null && now >= this.openAt) this.stage();
    if (this.staged) {
      this.grown = toward(this.grown, this.room ? 1 : 0, dt / (this.room ? OPEN_MS : CLOSE_MS));
      if (!this.room && this.grown === 0) this.unstage();
      else this.pose(now, dt);
    }
    return this.fade > 0 || this.staged || this.openAt !== null;
  }

  /** Puts the cut, the lot and the people where they are at this moment. */
  pose(now, dt = 0) {
    const room = this.room || this.closing, open = easeOut(this.grown);
    if (this.shell) {
      const {section, floor} = room, {planes} = this.shell;
      // The cut follows the storey on show, and comes down from the roof while the building opens
      const k = 1 - Math.exp(-dt / 110);
      this.level += (section.floors[floor].y - this.level) * (dt ? k : 1);
      this.ceiling += (cutAt(section, floor) - this.ceiling) * (dt ? k : 1);
      planes.stub.constant = this.roof + (this.level + STUB_H - this.roof) * open;
      planes.cut.constant = this.roof + (this.ceiling - this.roof) * open;

      // Walls stay up to the cut only on the two far sides of the storey, also while the camera is rotated
      const {inner} = planOf(section, floor), {pos, rot} = section;
      const axes = [[Math.cos(rot), -Math.sin(rot), inner.x0, inner.x1, planes.farX], [Math.sin(rot), Math.cos(rot), inner.z0, inner.z1, planes.farZ]];
      this.forward.copy(this.controls.target).sub(this.camera.position);
      const reach = Math.hypot(this.forward.x, this.forward.z) || 1;
      axes.forEach(([ax, az, lo, hi, plane], i) => {
        const facing = (this.forward.x * ax + this.forward.z * az) / reach;
        if (!this.far[i] || Math.abs(facing) > 0.08) this.far[i] = facing >= 0 ? 1 : -1;
        const s = this.far[i], origin = pos.x * ax + pos.z * az;
        plane.normal.set(ax * s, 0, az * s);
        plane.constant = -s * origin - (s > 0 ? hi - 0.15 : -(lo + 0.15));
      });
    } else if (this.currentInterior) {
      this.currentInterior.scale.y = Math.max(0.001, open);
    }
    this.lot?.userData.update(this.camera, smooth(this.fade));
    this.currentInterior?.userData.update(now / 1000, this.camera);
  }

  /**
   * Draws the frame while a building is open or opening: the campus dissolving into the backdrop, then the
   * lot and the house on top. Returns false when the campus is to be drawn the normal way.
   */
  render(renderer, drawCampus) {
    if (this.fade <= 0 && !this.staged) return false;
    const {camera} = this, size = renderer.getDrawingBufferSize(this.size);
    if (this.fade < 1) {
      // The campus is drawn the normal way and that frame is kept to dissolve from
      if (this.campusTexture?.image.width !== size.x || this.campusTexture.image.height !== size.y) {
        this.campusTexture?.dispose();
        this.campusTexture = new T.FramebufferTexture(size.x, size.y);
        this.campusTexture.minFilter = this.campusTexture.magFilter = T.LinearFilter;
      }
      drawCampus();
      renderer.setRenderTarget(null);
      renderer.copyFramebufferToTexture(this.campusTexture);
    }
    const u = this.backdrop.material.uniforms;
    u.tCampus.value = this.campusTexture;
    u.uAway.value = smooth(this.fade);
    this.backdrop.render(renderer);

    if (this.staged) {
      const {scene} = this, {autoClear} = renderer, {background, fog} = scene, mask = camera.layers.mask;
      const sun = this.sunLight?.intensity, sky = this.hemiLight?.intensity;
      renderer.autoClear = false;
      scene.background = scene.fog = null;
      camera.layers.set(ROOM_LAYER);
      this.dayNight?.roomLight(true);
      if (this.sunLight) this.sunLight.intensity = ROOM_SUN;
      if (this.hemiLight) this.hemiLight.intensity = ROOM_SKY;
      renderer.clearDepth();
      renderer.render(scene, camera);
      if (this.sunLight) this.sunLight.intensity = sun;
      if (this.hemiLight) this.hemiLight.intensity = sky;
      this.dayNight?.roomLight(false);
      camera.layers.mask = mask;
      scene.background = background;
      scene.fog = fog;
      renderer.autoClear = autoClear;
    }
    return true;
  }
}
