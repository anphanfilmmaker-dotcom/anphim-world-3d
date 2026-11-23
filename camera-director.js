/**
 * camera-director.js
 * Single owner of camera motion on top of OrbitControls: preset/focus
 * transitions, arrow-key panning, wheel zoom, limits, and the one
 * controls.update() per frame. Zoom is the orthographic `span` owned by
 * main.js (getSpan/setSpan); camera.zoom stays at 1.
 */

import * as T from 'three';

const DAMPING_AT_60HZ = 0.1;
const SPAN_MIN = 6, SPAN_MAX = 460;
// The detailed ground runs from (-190, -170) to (285, 248); keep the orbit target near it.
const TARGET_MIN = new T.Vector3(-200, -30, -180), TARGET_MAX = new T.Vector3(295, 120, 258);
const ZOOM_SMOOTH_S = 0.09, KEY_SMOOTH_S = 0.1;
const WHEEL_STEP = 0.95; // same step per notch as OrbitControls
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

// Starts from rest, moves early, then a long ease-out into the final framing.
export const easeCamera = t => {
  const s = t * t * (3 - 2 * t);
  return 1 - Math.pow(1 - s, 3);
};

const toVec = v => (Array.isArray(v) ? new T.Vector3(...v) : v.clone());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createCameraDirector({
  camera, controls, domElement, getSpan, setSpan,
  keyboardEnabled = () => true,
  leftDragRotates = () => true,
  onUserMove = () => {}
}) {
  // Event handlers inside OrbitControls and other modules call controls.update().
  // Those calls only re-aim the camera at the target, so code that renders right
  // after moving it sees the right view; damping advances once per frame in update().
  const applyControls = controls.update.bind(controls);
  controls.update = () => { camera.lookAt(controls.target); return false; };

  const lastPos = camera.position.clone(), lastTarget = controls.target.clone();
  const keys = new Set(), keyVel = new T.Vector3(), anchor = new T.Vector2();
  const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _sph = new T.Spherical();
  let tween = null, lastNow = 0, lastSpan = getSpan(), spanGoal = lastSpan;

  function dropInertia() {
    _a.copy(camera.position); _b.copy(controls.target);
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    applyControls();
    controls.enableDamping = damping;
    camera.position.copy(_a); controls.target.copy(_b);
  }

  function stop(reason) {
    if (!tween) return;
    const t = tween;
    tween = null;
    spanGoal = getSpan();
    if (t.onCancel) t.onCancel(reason);
  }

  function remember() {
    lastPos.copy(camera.position); lastTarget.copy(controls.target); lastSpan = getSpan();
  }

  /**
   * Move the camera to { position, target, span }. A new move replaces the one
   * in flight; dragging, scrolling or arrow keys cancel it.
   */
  function flyTo(dest, { duration = null, immediate = false, onComplete = null, onCancel = null } = {}) {
    stop('replaced');
    dropInertia();
    keyVel.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    const toTarget = toVec(dest.target), toPos = toVec(dest.position);
    const toSpan = clamp(dest.span ?? getSpan(), SPAN_MIN, SPAN_MAX);
    if (camera.zoom !== 1) { setSpan(getSpan() / camera.zoom); camera.zoom = 1; camera.updateProjectionMatrix(); }
    remember();

    if (immediate) {
      camera.position.copy(toPos); controls.target.copy(toTarget);
      setSpan(toSpan); spanGoal = toSpan;
      applyControls();
      remember();
      if (onComplete) onComplete();
      return;
    }

    const from = new T.Spherical().setFromVector3(_a.copy(camera.position).sub(controls.target));
    const to = new T.Spherical().setFromVector3(_a.copy(toPos).sub(toTarget));
    to.phi = clamp(to.phi, controls.minPolarAngle, controls.maxPolarAngle);
    to.radius = clamp(to.radius, controls.minDistance, controls.maxDistance);
    to.makeSafe();
    const turn = T.MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, Math.PI * 2) - Math.PI;
    const fromSpan = getSpan(), fromTarget = controls.target.clone();
    if (duration === null) {
      const amount = Math.max(
        fromTarget.distanceTo(toTarget) / 150,
        Math.abs(turn) / Math.PI,
        Math.abs(to.phi - from.phi) / (Math.PI / 2),
        Math.abs(Math.log(toSpan / fromSpan)) / Math.log(4)
      );
      duration = 800 + 400 * Math.min(amount, 1);
    }
    tween = { t0: null, duration, from, to, turn, fromTarget, toTarget, fromSpan, toSpan, onComplete, onCancel };
  }

  function stepTween(now) {
    const t = tween;
    if (t.t0 === null) t.t0 = now;
    const k = Math.min((now - t.t0) / t.duration, 1), e = easeCamera(k);
    controls.target.lerpVectors(t.fromTarget, t.toTarget, e);
    _sph.set(
      t.from.radius + (t.to.radius - t.from.radius) * e,
      t.from.phi + (t.to.phi - t.from.phi) * e,
      t.from.theta + t.turn * e
    );
    camera.position.setFromSpherical(_sph).add(controls.target);
    setSpan(k < 1 ? t.fromSpan * Math.pow(t.toSpan / t.fromSpan, e) : t.toSpan);
    spanGoal = getSpan();
    if (k >= 1) {
      tween = null;
      if (t.onComplete) t.onComplete();
    }
  }

  function stepKeys(dt) {
    let x = 0, z = 0;
    if (keyboardEnabled()) {
      if (keys.has('ArrowUp')) z += 1;
      if (keys.has('ArrowDown')) z -= 1;
      if (keys.has('ArrowRight')) x += 1;
      if (keys.has('ArrowLeft')) x -= 1;
    }
    if (x || z) {
      stop('user');
      camera.getWorldDirection(_a);
      _a.y = 0;
      if (_a.lengthSq() < 0.0001) _a.set(0, 0, -1); else _a.normalize();
      _b.crossVectors(_a, camera.up).normalize();
      // 1.5 spans per second, the old per-frame step at 60 Hz
      const speed = getSpan() * 1.5 * (keys.has('Shift') ? 2.5 : 1);
      _c.set(0, 0, 0).addScaledVector(_a, z).addScaledVector(_b, x).normalize().multiplyScalar(speed);
      onUserMove('free-roam');
    } else {
      _c.set(0, 0, 0);
    }
    keyVel.lerp(_c, 1 - Math.exp(-dt / KEY_SMOOTH_S));
    if (keyVel.lengthSq() < 1e-6) { keyVel.set(0, 0, 0); return; }
    camera.position.addScaledVector(keyVel, dt);
    controls.target.addScaledVector(keyVel, dt);
  }

  function stepZoom(dt) {
    const span = getSpan();
    if (span === spanGoal) return;
    let next = span * Math.pow(spanGoal / span, 1 - Math.exp(-dt / ZOOM_SMOOTH_S));
    if (Math.abs(Math.log(spanGoal / next)) < 1e-4) next = spanGoal;
    // keep the point under the cursor where it is
    const half = (span - next) / 2, aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
    _a.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(anchor.x * half * aspect);
    _a.addScaledVector(_b.setFromMatrixColumn(camera.matrix, 1), anchor.y * half);
    camera.position.add(_a); controls.target.add(_a);
    setSpan(next);
  }

  /** Call once per frame. Returns true while the camera is moving. */
  function update(now) {
    const dt = clamp((now - lastNow) / 1000, 0, 0.1);
    lastNow = now;

    // Someone moved the camera directly (editor jump, showcase): that wins.
    const moved = !camera.position.equals(lastPos) || !controls.target.equals(lastTarget) || getSpan() !== lastSpan;
    if (moved) { stop('external'); spanGoal = getSpan(); }
    // Touch pinch still goes through OrbitControls and camera.zoom; fold it into span.
    if (camera.zoom !== 1) {
      spanGoal = clamp(getSpan() / camera.zoom, SPAN_MIN, SPAN_MAX);
      camera.zoom = 1;
      setSpan(spanGoal);
    }

    controls.mouseButtons.LEFT = leftDragRotates() ? T.MOUSE.ROTATE : -1;
    stepKeys(dt);
    if (tween) stepTween(now); else stepZoom(dt);

    controls.dampingFactor = 1 - Math.pow(1 - DAMPING_AT_60HZ, dt * 60);
    applyControls();
    _a.copy(controls.target).clamp(TARGET_MIN, TARGET_MAX);
    if (!_a.equals(controls.target)) {
      camera.position.add(_a).sub(controls.target);
      controls.target.copy(_a);
    }

    const changed = moved || !camera.position.equals(lastPos) || !controls.target.equals(lastTarget) || getSpan() !== lastSpan;
    remember();
    return changed || tween !== null;
  }

  controls.addEventListener('start', () => stop('user'));

  // Wheel zoom is eased here instead of OrbitControls' instant camera.zoom step.
  window.addEventListener('wheel', e => {
    if (e.target !== domElement || !controls.enabled || !controls.enableZoom) return;
    e.preventDefault();
    e.stopPropagation();
    stop('user');
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16; else if (e.deltaMode === 2) delta *= 100;
    if (e.ctrlKey) delta *= 10;
    const rect = domElement.getBoundingClientRect();
    anchor.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    spanGoal = clamp(spanGoal * Math.pow(WHEEL_STEP, -delta * 0.01), SPAN_MIN, SPAN_MAX);
    onUserMove('free-orbit');
  }, { capture: true, passive: false });

  window.addEventListener('keydown', e => {
    const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (NAV_KEYS.includes(e.code)) keys.add(e.code);
    if (e.key === 'Shift') keys.add('Shift');
  });
  window.addEventListener('keyup', e => {
    keys.delete(e.code);
    if (e.key === 'Shift') keys.delete('Shift');
  });
  window.addEventListener('blur', () => keys.clear());

  return { flyTo, update, cancel: () => stop('user'), isMoving: () => tween !== null };
}
