/**
 * cutaway-animator.js
 * Going inside a building: the camera zooms in, the campus around fades to a faint
 * sketch, and the building opens into its room.
 */

import * as T from 'three';
import { FullScreenQuad } from './vendor/postprocessing/Pass.js';
import { buildInterior, footprintOf, pickFocus, roomPlan } from './interior-builder.js?rev=interior_v3';
import { disposeObject } from './dispose-helper.js';

const ROOM_LAYER = 1;
const FLY_IN_MS = 1200;   // camera zoom into the building
const SKETCH_MS = 900;    // campus fading to (or back from) the sketch
const OPEN_AT_MS = 380;   // the building opens into its room this long after the click
const RISE_MS = 480, SINK_MS = 200;
const ROOM_SUN = 1.5, ROOM_SKY = 1.7;
const smooth = k => k * k * (3 - 2 * k), easeOut = k => 1 - Math.pow(1 - k, 3);
const toward = (v, goal, step) => v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step);

/**
 * Draws the campus picture as a faint sketch: a pale paper tone, a light grey wash where the
 * campus is dark, and thin lines along its edges, fading out away from the room.
 * `uSketch` 0 shows the campus exactly as it is normally drawn, 1 the sketch.
 */
const SKETCH_SHADER = {
  uniforms: {
    tCampus: {value: null}, uTexel: {value: new T.Vector2()}, uSketch: {value: 0},
    uCenter: {value: new T.Vector2(0.5, 0.5)}, uAspect: {value: 1},
    uPaper: {value: new T.Vector3(0.84, 0.865, 0.875)}, uInk: {value: new T.Vector3(0.43, 0.49, 0.53)}
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tCampus;
    uniform vec2 uTexel, uCenter;
    uniform float uSketch, uAspect;
    uniform vec3 uPaper, uInk;
    varying vec2 vUv;
    float tone(vec2 uv) { return dot(texture2D(tCampus, uv).rgb, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      // tCampus is the frame as it was shown on screen, so its colours are final already
      vec3 shown = texture2D(tCampus, vUv).rgb;

      vec2 d = uTexel * 1.5;
      float a = tone(vUv + d * vec2(-1.0, -1.0)), b = tone(vUv + d * vec2(0.0, -1.0)), c = tone(vUv + d * vec2(1.0, -1.0));
      float e = tone(vUv + d * vec2(-1.0, 0.0)), f = tone(vUv + d * vec2(1.0, 0.0));
      float g = tone(vUv + d * vec2(-1.0, 1.0)), h = tone(vUv + d * vec2(0.0, 1.0)), i = tone(vUv + d * vec2(1.0, 1.0));
      float edge = length(vec2(c + 2.0 * f + i - a - 2.0 * e - g, g + 2.0 * h + i - a - 2.0 * b - c));
      float line = smoothstep(0.10, 0.45, edge);
      float wash = 1.0 - dot(shown, vec3(0.2126, 0.7152, 0.0722));

      vec2 away = (vUv - uCenter) * vec2(uAspect, 1.0);
      float near = 1.0 - smoothstep(0.25, 0.95, length(away));
      vec3 sketch = mix(uPaper, uInk, clamp(wash * 0.30 + line * 0.55, 0.0, 1.0) * mix(0.45, 1.0, near));
      gl_FragColor = vec4(mix(shown, sketch, uSketch), 1.0);
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
    this.currentInterior = null;
    this.room = null;      // the room that should be on screen: {plan, pos, view, host, hostId}
    this.staged = false;   // true once the building has opened into its room
    this.sketch = 0;       // 0 = campus as it is, 1 = campus as a faint sketch
    this.grown = 0;        // 0 = room flat on the ground, 1 = room standing
    this.openAt = null;    // when the building opens into the room that `this.room` asks for
    this.hiddenHost = [];
    this.lastNow = null;

    // Cache ambient lights in scene for dusk/focus effect
    this.sunLight = null;
    this.hemiLight = null;
    this.scene.traverse(child => {
      if (child.isDirectionalLight && !this.sunLight) this.sunLight = child;
      if (child.isHemisphereLight && !this.hemiLight) this.hemiLight = child;
    });

    this.campusTexture = null; // the campus as last drawn on screen, kept to sketch over
    this.campusShot = null;    // camera and size it was drawn for
    this.size = new T.Vector2();
    this.center = new T.Vector3();
    this.sketchQuad = new FullScreenQuad(new T.ShaderMaterial({...SKETCH_SHADER, uniforms: T.UniformsUtils.clone(SKETCH_SHADER.uniforms), depthTest: false, depthWrite: false, toneMapped: false}));
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
    buildingGroup.userData.roomOutline ??= footprintOf(buildingGroup);
    const plan = roomPlan(buildingGroup.userData.roomOutline, bInfo.width, bInfo.depth);
    const view = bInfo.view || {type: null, id: buildingId, title: bInfo.name, connected: false, agents: []};
    const room = {plan, pos: [posX, posY + 0.02, posZ], view, host: buildingGroup, hostId: bInfo.hostId || buildingId};

    // While inside: no panning, every mouse button orbits the room
    this.controls.enablePan = false;
    this.controls.mouseButtons.LEFT = T.MOUSE.ROTATE;
    this.controls.mouseButtons.MIDDLE = T.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT = T.MOUSE.ROTATE;

    this.tweenCameraZoom(new T.Vector3(posX + 16, posY + 16, posZ + 16), new T.Vector3(posX, posY + 1.2, posZ), plan.span, FLY_IN_MS);

    // Coming from another room, that room goes at once and the camera travels over the sketched campus
    this.unstage();
    this.room = room;
    this.openAt = performance.now() + OPEN_AT_MS;
    window.requestRender?.();
  }

  /** Rebuilds the room from a new view (data refresh) without touching the camera. */
  buildInterior(view) {
    if (!this.room) return;
    this.room.view = view;
    if (!this.staged) return;
    if (this.currentInterior) disposeObject(this.currentInterior);
    this.currentInterior = buildInterior(view, this.room.plan);
    this.currentInterior.position.set(...this.room.pos);
    // The room is drawn in its own pass, on top of the sketched campus
    this.currentInterior.traverse(o => o.layers.set(ROOM_LAYER));
    this.currentInterior.scale.y = Math.max(0.001, easeOut(this.grown));
    this.scene.add(this.currentInterior);
    this.hideHost();
  }

  /** What the pointer ray hits inside the room: undefined (nothing), null (room, nothing clickable) or {section, id}. */
  pick(raycaster) {
    if (!this.currentInterior) return undefined;
    raycaster.layers.enable(ROOM_LAYER);
    const focus = pickFocus(this.currentInterior, raycaster);
    raycaster.layers.disable(ROOM_LAYER);
    return focus;
  }

  /** The building opens: its shell goes and the room rises in its place. */
  stage() {
    this.unstage();
    if (!this.room) return;
    this.staged = true;
    this.grown = 0;
    this.buildInterior(this.room.view);
  }

  /** The room stands where the building is, so the building and what is built around it step aside. */
  hideHost() {
    for (const o of this.hiddenHost) o.visible = true;
    this.hiddenHost = [];
    const {host, hostId} = this.room;
    this.scene.traverse(o => {
      // Lights reach the room's pass too, so both passes are lit by the same set
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
    if (this.currentInterior) {
      disposeObject(this.currentInterior);
      this.currentInterior = null;
    }
    for (const o of this.hiddenHost) o.visible = true;
    this.hiddenHost = [];
  }

  exit() {
    if (!this.isInspecting) return;
    this.isInspecting = false;
    this.room = null;
    this.openAt = null;
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

  /** Advances the transition and moves the people in the room; true while there is something to draw every frame. */
  update(now = performance.now()) {
    const dt = now - (this.lastNow ?? now);
    this.lastNow = now;
    this.sketch = toward(this.sketch, this.isInspecting ? 1 : 0, dt / SKETCH_MS);
    if (this.openAt !== null && now >= this.openAt) this.stage();
    if (this.currentInterior) {
      this.grown = toward(this.grown, this.room ? 1 : 0, dt / (this.room ? RISE_MS : SINK_MS));
      if (!this.room && this.grown === 0) this.unstage();
      else {
        this.currentInterior.scale.y = Math.max(0.001, easeOut(this.grown));
        this.currentInterior.userData.update(now / 1000, this.camera);
      }
    }
    return this.sketch > 0 || !!this.currentInterior || this.openAt !== null;
  }

  /**
   * Draws the frame while a building is open or opening: the campus as a sketch, then the room on top.
   * Returns false when the campus is to be drawn the normal way.
   */
  render(renderer, drawCampus) {
    if (this.sketch <= 0 && !this.currentInterior) return false;
    const {camera} = this, size = renderer.getDrawingBufferSize(this.size);
    if (this.campusTexture?.image.width !== size.x || this.campusTexture.image.height !== size.y) {
      this.campusTexture?.dispose();
      this.campusTexture = new T.FramebufferTexture(size.x, size.y);
      this.campusTexture.minFilter = this.campusTexture.magFilter = T.LinearFilter;
      this.campusShot = null;
    }

    // The campus is drawn the normal way and that frame is kept; once the sketch has settled
    // and the camera rests, the kept frame still holds and the campus is not drawn again
    const shot = `${camera.matrixWorld.elements}|${camera.projectionMatrix.elements}|${this.hiddenHost.length}|${this.room?.hostId}`;
    if (this.sketch < 1 || shot !== this.campusShot) {
      drawCampus();
      renderer.setRenderTarget(null);
      renderer.copyFramebufferToTexture(this.campusTexture);
      this.campusShot = this.sketch < 1 ? null : shot;
    }

    const u = this.sketchQuad.material.uniforms;
    u.tCampus.value = this.campusTexture;
    u.uTexel.value.set(1 / size.x, 1 / size.y);
    u.uSketch.value = smooth(this.sketch);
    u.uAspect.value = size.x / size.y;
    if (this.room) {
      const c = this.center.set(...this.room.pos).project(camera);
      u.uCenter.value.set(c.x * 0.5 + 0.5, c.y * 0.5 + 0.5);
    }
    this.sketchQuad.render(renderer);

    if (this.currentInterior) {
      const {scene} = this, {autoClear} = renderer, {background, fog} = scene, mask = camera.layers.mask;
      const sun = this.sunLight?.intensity, sky = this.hemiLight?.intensity;
      renderer.autoClear = false;
      scene.background = scene.fog = null;
      camera.layers.set(ROOM_LAYER);
      if (this.sunLight) this.sunLight.intensity = ROOM_SUN;
      if (this.hemiLight) this.hemiLight.intensity = ROOM_SKY;
      renderer.clearDepth();
      renderer.render(scene, camera);
      if (this.sunLight) this.sunLight.intensity = sun;
      if (this.hemiLight) this.hemiLight.intensity = sky;
      camera.layers.mask = mask;
      scene.background = background;
      scene.fog = fog;
      renderer.autoClear = autoClear;
    }
    return true;
  }
}
