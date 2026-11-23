/**
 * What stands inside the seven facility buildings: Kho Drive, Hermes Robot Lab, Database, Oracle Cloud,
 * Google Cloud, Telegram and Kho dự trữ. buildInterior() (interior-builder.js) hands over its own tools
 * and the storey being drawn; every object here comes from the view of dataConnector.getBuildingView().
 * Nothing carries text: a clicked object only names the panel row it stands for (userData.focus).
 *
 * Everything is life size, in metres, on the real floor of the real building. The layout frame has the
 * storey's largest free rectangle at its centre (plan.hx, plan.hz); the other rooms of the storey (a wing,
 * a tower base) come from plan.storey.areas and are furnished as zones of their own.
 */
export function facilityRooms(k) {
  const {T, view, plan, g, M, mat, glow, box, cyl, group, anim, desk, agentAt, sheet, plant, FLOOR_Y} = k;
  const floor = plan.floor || 0, floors = plan.floors || 1, top = floor === floors - 1, H = plan.height || 3.2;
  const S = {
    rack: mat(0x2b3440, {roughness: 0.45, metalness: 0.3}), face: mat(0x11161d, {roughness: 0.35}), frame: mat(0x6b7785, {roughness: 0.5, metalness: 0.4}),
    board: mat(0xb9a17c, {roughness: 0.8}), full: mat(0x7a5230, {roughness: 0.75}), bare: mat(0xe9e1d2, {roughness: 0.9, transparent: true, opacity: 0.45}),
    glass: mat(0xbfe6f2, {roughness: 0.1, transparent: true, opacity: 0.3}), vault: mat(0x59626e, {roughness: 0.4, metalness: 0.6}), dim: mat(0x3a424d, {roughness: 0.8}),
    robot: mat(0xf2f4f7, {roughness: 0.4, metalness: 0.2}), joint: mat(0xf7941d, {roughness: 0.5})
  };


  // ---- zones: the rooms of this storey, in layout coordinates ----
  const zone = (x, z, hx, hz) => ({x, z, hx, hz});
  const main = zone(0, 0, plan.hx, plan.hz);
  const rect = plan.storey?.rect, turn = plan.turn || 0, cos = Math.cos(turn), sin = Math.sin(turn);
  const odd = Math.round(turn / (Math.PI / 2)) % 2 !== 0;
  const point = (px, pz) => [(px - rect.cx) * cos - (pz - rect.cz) * sin, (px - rect.cx) * sin + (pz - rect.cz) * cos];
  const toZone = a => zone(...point(a.cx, a.cz), odd ? a.hz : a.hx, odd ? a.hx : a.hz);
  const holds = (a, b) => Math.abs(b.x - a.x) < a.hx + 0.3 && Math.abs(b.z - a.z) < a.hz + 0.3;
  const others = rect ? (plan.storey.areas || []).map(toZone).filter(z => !holds(z, main)) : [];
  const above = rect && plan.top ? plan.top.map(toZone) : [];
  /** True for the part of the building that goes all the way up; a wing stops below the top storey. */
  const stacked = z => !above.length || above.some(u => holds(z, u) || holds(u, z));
  const [gx, gz] = rect && plan.gate ? point(...plan.gate) : [plan.doorX || 0, main.hz + 1];

  /**
   * A zone seen from the building's gate: n points from the gate side into the room, t runs along the gate side.
   * at(u, v): u metres along the gate side from the middle, v metres in from the gate side. back(u, v): v from the far wall.
   */
  function frame(z, n) {
    if (!n) {
      const ox = (gx - z.x) / z.hx, oz = (gz - z.z) / z.hz;
      n = Math.abs(oz) >= Math.abs(ox) ? [0, oz >= 0 ? -1 : 1] : [ox >= 0 ? -1 : 1, 0];
    }
    const t = [-n[1], n[0]], hu = n[0] ? z.hz : z.hx, hv = n[0] ? z.hx : z.hz;
    const at = (u, v) => [z.x + t[0] * u + n[0] * (v - hv), z.z + t[1] * u + n[1] * (v - hv)];
    const door = Math.max(-hu + 0.8, Math.min(hu - 0.8, (gx - z.x) * t[0] + (gz - z.z) * t[1]));
    return {z, n, t, hu, hv, at, back: (u, v) => at(u, 2 * hv - v), door,
      out: Math.atan2(-n[0], -n[1]),   // turned to face the gate
      in: Math.atan2(n[0], n[1]),      // turned to face into the room
      side: s => Math.atan2(-t[0] * s, -t[1] * s)};   // against the wall at u = s * hu, facing the room
  }
  /** Half of a zone, split along the gate side: i = -1 or 1. */
  const half = (f, i) => {
    const [x, z] = f.at(i * f.hu / 2, f.hv);
    return frame(f.n[0] ? zone(x, z, f.z.hx, f.z.hz / 2) : zone(x, z, f.z.hx / 2, f.z.hz), f.n);
  };

  /** One lamp material per state: green running, yellow slow, red blinking stopped, dark when there is no data. */
  const lamps = {};
  const lamp = key => lamps[key] ||= (() => {
    const color = {online: 0x34e0b0, slow: 0xffc531, down: 0xff3b30}[key];
    if (!color) return mat(0x27303a, {roughness: 0.5});
    const m = glow(color, 1.2);
    if (key === 'down') anim.push(t => { m.emissiveIntensity = Math.sin(t * 7) > 0 ? 1.7 : 0.08; });
    return m;
  })();


  /** A machine cabinet with a column of lamps on its front (+z of the cabinet) and one on top. */
  function rack(x, z, rot, key, focus, w = 0.7, h = 2.0, d = 0.9) {
    h = Math.min(h, H - 0.25);
    const o = group(x, z, rot, focus);
    box(o, w, h, d, S.rack, 0, h / 2, 0);
    box(o, w * 0.86, h * 0.9, 0.04, S.face, 0, h / 2, d / 2 + 0.01);
    const n = Math.max(2, Math.round(h / 0.42));
    for (let i = 0; i < n; i++) box(o, w * 0.6, 0.07, 0.05, lamp(key), 0, 0.3 + i * (h - 0.5) / (n - 1), d / 2 + 0.04);
    box(o, w * 0.5, 0.05, d * 0.5, lamp(key), 0, h + 0.03, 0);
    return o;
  }

  /**
   * Things in rows across a zone, facing the gate, first row against the far wall: make(item, x, z, rot, i).
   * w, d: footprint of one; pitch along the row, gap between rows; clear: floor kept free on the gate side.
   */
  function rows(f, items, make, {w = 0.7, d = 0.9, pitch = w + 0.25, gap = d + 1.0, clear = 0, from = 0} = {}) {
    const per = Math.max(1, Math.floor((2 * f.hu - 0.3 - w) / pitch) + 1);
    const room = Math.max(1, Math.floor((2 * f.hv - 0.3 - d - clear - from) / gap) + 1);
    const list = items.slice(0, per * room);
    list.forEach((item, i) => {
      const r = Math.floor(i / per), inRow = Math.min(per, list.length - r * per);
      make(item, ...f.back((i % per - (inRow - 1) / 2) * pitch, 0.15 + d / 2 + from + r * gap), f.out, i);
    });
    return list.length;
  }

  /** One cabinet per building that relies on this system; clicking it opens that building's row in the panel. */
  const serving = (f, list, o) => rows(f, list, (s, x, z, rot) => rack(x, z, rot, view.system.key, {section: 'serve', id: s.id}), o);
  /** Cabinets that stand for the system itself. */
  const machines = (f, n, o) => rows(f, Array.from({length: n}), (_, x, z, rot) => rack(x, z, rot, view.system.key, {section: 'kpi'}), o);

  /** The machines of one service (Hermes on Oracle, Drive or Gmail on Google). */
  function service(s, f, kind) {
    const focus = {section: 'service', id: s.id}, key = s.state.key;
    if (kind === 'store') rows(f, [0, 1, 2, 3], (_, x, z, rot) => {
      // disk shelves: wide and low, three drawers each
      const o = group(x, z, rot, focus);
      box(o, 1.3, 1.3, 0.7, S.rack, 0, 0.65, 0);
      for (let i = 0; i < 3; i++) { box(o, 1.14, 0.3, 0.04, S.face, 0, 0.28 + i * 0.4, 0.36); box(o, 0.24, 0.06, 0.05, lamp(key), 0.38, 0.28 + i * 0.4, 0.39); }
      box(o, 0.8, 0.05, 0.35, lamp(key), 0, 1.33, 0);
    }, {w: 1.3, d: 0.7, pitch: 1.6});
    else if (kind === 'mail') rows(f, [0, 1, 2, 3], (_, x, z, rot) => {
      // sorting cabinets: a grid of open slots over a machine base
      const o = group(x, z, rot, focus);
      box(o, 1.1, 0.6, 0.6, S.rack, 0, 0.3, 0);
      box(o, 1.1, 1.1, 0.45, S.frame, 0, 1.15, -0.07);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) box(o, 0.2, 0.27, 0.04, S.face, -0.375 + c * 0.25, 0.8 + r * 0.35, 0.16);
      box(o, 0.75, 0.06, 0.05, lamp(key), 0, 0.42, 0.31);
      box(o, 0.7, 0.05, 0.25, lamp(key), 0, 1.73, -0.07);
    }, {w: 1.1, d: 0.6, pitch: 1.4});
    else rows(f, [0, 1, 2], (_, x, z, rot) => rack(x, z, rot, key, focus));
  }

  /** Shelving with one box per project: dark when the project has a Drive folder, pale and see-through when it has none. */
  const PER = 4, TIERS = Math.max(2, Math.min(4, Math.floor((H - 0.5) / 0.5))), SHELF_W = PER * 0.44 + 0.16;
  function shelf(projects, x, z, rot) {
    const o = group(x, z, rot), h = TIERS * 0.5 + 0.15;
    for (const sx of [-SHELF_W / 2, SHELF_W / 2]) box(o, 0.06, h, 0.5, S.frame, sx, h / 2, 0);
    for (let t = 0; t <= TIERS; t++) box(o, SHELF_W, 0.04, 0.5, S.board, 0, 0.1 + t * 0.5, 0);
    projects.forEach((p, i) => box(o, 0.36, 0.34, 0.4, p.hasDrive ? S.full : S.bare, -SHELF_W / 2 + 0.3 + (i % PER) * 0.44, 0.29 + Math.floor(i / PER) * 0.5, 0, {section: 'project', id: p.id}));
  }
  /** One shelf per client while there is floor for it; the smallest clients share a shelf when there is not. */
  function shelves(f, groups, clear) {
    const cap = PER * TIERS, o = {w: SHELF_W, d: 0.5, pitch: SHELF_W + 0.2, gap: 1.3, clear};
    const lists = groups.flatMap(list => Array.from({length: Math.ceil(list.length / cap)}, (_, i) => list.slice(i * cap, (i + 1) * cap)));
    const fit = Math.max(1, Math.floor((2 * f.hu - 0.3 - o.w) / o.pitch) + 1) * Math.max(1, Math.floor((2 * f.hv - 0.3 - o.d - clear) / o.gap) + 1);
    lists.sort((a, b) => b.length - a.length);
    while (lists.length > fit && lists.at(-1).length + lists.at(-2).length <= cap) {
      lists.splice(-2, 2, [...lists.at(-2), ...lists.at(-1)]);
      lists.sort((a, b) => b.length - a.length);
    }
    rows(f, lists, (list, x, z, rot) => shelf(list, x, z, rot), o);
  }

  /** Stand by the gate: one glowing sheet per open mission waiting for An in this building. */
  function stand(f, missions, u) {
    if (!missions.length) return;
    const o = group(...f.at(u, 0.5), f.in, {section: 'missions'});
    box(o, 1.0, 0.8, 0.5, M.woodDark, 0, 0.4, 0);
    missions.slice(0, 6).forEach((m, i) => sheet(o, -0.3 + (i % 3) * 0.3, 0.82 + Math.floor(i / 3) * 0.03, i < 3 ? -0.03 : 0.05, M.paper, {section: 'mission', id: m.id}));
  }
  /** Which side of the gate has more wall left: -1 or 1. */
  const roomy = f => f.door > 0 ? -1 : 1;

  /** Rings rising from a transmitter while the bot is up. */
  function waves(o, y) {
    const rings = [0, 1, 2].map(() => {
      const m = new T.Mesh(new T.TorusGeometry(0.3, 0.025, 6, 28), mat(0x34e0b0, {emissive: 0x34e0b0, emissiveIntensity: 1, transparent: true}));
      m.rotation.x = Math.PI / 2;
      o.add(m);
      return m;
    });
    anim.push(t => rings.forEach((m, i) => {
      const u = (t * 0.45 + i / 3) % 1;
      m.position.y = y + u * 1.3; m.scale.setScalar(0.5 + u * 2.4); m.material.opacity = 1 - u;
    }));
  }

  /** Hermes: stands still and dark when stopped, goes round `stops` ({at, wait, carry}) when running. */
  function robot(stops, running) {
    const o = group(stops[0].at[0], stops[0].at[1]);
    cyl(o, 0.3, 0.16, S.dim, 0, 0.08, 0, 14);
    box(o, 0.5, 0.62, 0.36, S.robot, 0, 0.55, 0);
    box(o, 0.36, 0.3, 0.3, S.robot, 0, 1.05, 0);
    const eye = box(o, 0.28, 0.09, 0.04, running ? glow(0x34e0b0, 1.3) : S.dim, 0, 1.07, 0.16);
    cyl(o, 0.015, 0.22, S.joint, 0.1, 1.31, 0, 6);
    const arms = [-0.31, 0.31].map(x => {
      const pivot = new T.Group();
      pivot.position.set(x, 0.78, 0);
      box(pivot, 0.1, 0.44, 0.1, S.joint, 0, -0.2, 0);
      o.add(pivot);
      return pivot;
    });
    const paper = box(o, 0.34, 0.03, 0.26, M.paper, 0, 0.62, 0.36);
    paper.visible = false;
    if (!running) return o;
    let total = 0, carry = false;
    const path = stops.map((s, i) => {
      const to = stops[(i + 1) % stops.length].at;
      if (s.carry != null) carry = s.carry;
      const leg = {s, to, start: total, wait: s.wait || 0, walk: Math.hypot(to[0] - s.at[0], to[1] - s.at[1]) / 1.1, carry};
      total += leg.wait + leg.walk;
      return leg;
    });
    anim.push(t => {
      const tt = t % (total || 1);
      let leg = path[0];
      for (const l of path) if (l.start <= tt) leg = l;
      const u = tt - leg.start, moving = u >= leg.wait && leg.walk > 0, f = moving ? (u - leg.wait) / leg.walk : 0;
      o.position.x = leg.s.at[0] + (leg.to[0] - leg.s.at[0]) * f; o.position.z = leg.s.at[1] + (leg.to[1] - leg.s.at[1]) * f;
      const face = moving ? leg.to : leg.s.look;
      if (face) o.rotation.y = Math.atan2(face[0] - o.position.x, face[1] - o.position.z);
      for (const [i, a] of arms.entries()) a.rotation.x = leg.carry ? -1.2 : moving ? 0 : -0.9 + Math.sin(t * 7 + i * 2) * 0.25;
      paper.visible = leg.carry;
      eye.material.emissiveIntensity = 1.1 + Math.sin(t * 4) * 0.3;
    });
    return o;
  }


  return {
    // Main block: one shelf per client with the projects still running, the garage door is where folders come in.
    // Upper block: the finished projects. Low wing: the lookup desk.
    drive() {
      const d = view.drive, f = frame(main), split = floors > 1;
      const mine = d.projects.filter(p => !split || (floor ? p.finished : !p.finished));
      const groups = d.groups.map(c => mine.filter(p => (p.client || 'Khác') === c.client)).filter(list => list.length);
      if (floor) return shelves(f, groups, 0.9);
      shelves(f, groups, 1.7);
      const bench = group(...f.at(f.door + roomy(f) * 1.5, 0.6), f.in);
      box(bench, 1.4, 0.7, 0.6, M.woodDark, 0, 0.35, 0);
      const w = others[0] ? frame(others[0]) : null;
      const [x, z] = w ? w.back(0, 1.0) : f.at(-roomy(f) * (f.hu - 1.1), 1.0), rot = w ? w.out : f.side(-roomy(f));
      if (view.agents.length) agentAt(view.agents[0], x, z, rot, [], 0);
      else desk(x, z, rot, {on: false, focus: {section: 'projects'}});
      stand(f, view.missions, f.door - roomy(f) * 1.3);
    },

    // The workshop scans mail; the papers by the gate are expenses the scan could not finish, the papers on
    // the writing desk upstairs are posts waiting for approval. The lamp under the dome is lit while Hermes runs.
    hermes() {
      const h = view.hermes, f = frame(main), wait = h.pendingPosts || [], s = roomy(f);
      const writing = (x, z, rot) => {
        const wd = group(x, z, rot, {section: 'posts'});
        box(wd, 1.8, 0.75, 0.8, M.wood, 0, 0.375, 0);
        box(wd, 0.7, 0.42, 0.05, h.running ? M.screenOn : M.screenOff, 0, 1.05, -0.28);
        wait.slice(0, 6).forEach((p, i) => sheet(wd, -0.6 + (i % 3) * 0.42, 0.77 + Math.floor(i / 3) * 0.03, i < 3 ? 0.12 : 0.2, M.paper, {section: 'post', id: p.id}));
      };
      const beacon = (x, z) => {
        const o = group(x, z, 0, {section: 'kpi'});
        cyl(o, 0.3, 0.4, S.frame, 0, 0.2, 0, 8);
        const dome = new T.Mesh(new T.SphereGeometry(0.36, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), h.running ? glow(0x9be7ff, 1.1) : S.glass);
        dome.position.y = 0.4;
        o.add(dome);
      };
      if (floor) {
        writing(...f.back(0, 0.9), f.out);
        return beacon(...f.at(-s * (f.hu - 0.6), 0.6));
      }
      const table = group(...f.back(-s * 0.5, 0.75), f.out, {section: 'scan'});
      box(table, 2.2, 0.8, 0.9, M.wood, 0, 0.4, 0);
      [0x4fa3ff, 0x4cc27a, 0xf7941d].forEach((c, i) => box(table, 0.5, 0.25, 0.6, mat(c), -0.7 + i * 0.7, 0.925, 0));
      const dock = group(...f.back(s * (f.hu - 0.5), 0.5), f.out);
      box(dock, 0.8, 1.2, 0.4, S.rack, 0, 0.6, 0);
      box(dock, 0.4, 0.07, 0.05, lamp(h.state.key), 0, 0.9, 0.22);
      const trayAt = f.at(f.door + s * 1.4, 0.5), tray = group(...trayAt, f.in, {section: 'expenses'});
      box(tray, 1.2, 0.8, 0.5, M.woodDark, 0, 0.4, 0);
      h.inputs.slice(0, 6).forEach((x, i) => sheet(tray, -0.38 + (i % 3) * 0.38, 0.82 + Math.floor(i / 3) * 0.03, i < 3 ? -0.03 : 0.05, M.paper, {section: 'expense', id: x.id}));
      const a = f.back(-s * 0.5, 1.75), b = f.back(-s * 1.1, 1.75), c = f.back(-s * -0.1, 1.75), look = u => f.back(u, 0.75);
      const drop = f.at(f.door + s * 1.4, 1.25);
      robot(h.inputs.length ? [{at: a, look: look(-s * 0.5), wait: 4, carry: false}, {at: drop, look: trayAt, wait: 1.5, carry: true}, {at: drop, look: trayAt, wait: 0.6, carry: false}]
        : [{at: b, look: look(-s * 1.1), wait: 3}, {at: c, look: look(-s * -0.1), wait: 3}], h.running);
      if (floors === 1) { writing(...f.at(-s * (f.hu - 0.55), f.hv), f.side(-s)); beacon(...f.at(-s * (f.hu - 0.6), 0.6)); }
      stand(f, view.missions.filter(m => !h.inputs.some(x => x.id === m.id)), f.door - s * 1.4);
    },

    // Lobby with the agent in charge and the backup machines; the cabinets upstairs are the buildings that read from the database.
    database() {
      const f = frame(main), s = roomy(f);
      if (floor) {
        const n = Math.max(1, floors - 1), per = Math.ceil(view.serves.length / n);
        return serving(f, view.serves.slice((floor - 1) * per, floor * per), {pitch: 1.3});
      }
      const counter = group(...f.at(f.door + s * 1.9, 1.5), f.in);
      box(counter, 2.0, 1.0, 0.6, M.white, 0, 0.5, 0);
      box(counter, 2.14, 0.05, 0.7, S.frame, 0, 1.03, 0);
      const key = view.backupOk == null ? null : view.backupOk ? 'online' : 'slow';
      for (const i of [0, 1]) rack(...f.back(-s * (f.hu - 0.6 - i * 0.9), 0.6), f.out, key, {section: 'backup'}, 0.8, 1.6, 0.8);
      view.agents.slice(0, Math.max(1, Math.floor((2 * f.hu - 2.6) / 2.3))).forEach((a, i) => agentAt(a, ...f.back(s * (f.hu - 1.2 - i * 2.3), 0.75), f.out, [], i));
      if (floors === 1) serving(f, view.serves, {from: 2.4, clear: 1.6});
      stand(f, view.missions, f.door - s * 1.3);
    },

    // Columned hall with a cabinet per building Oracle carries; upstairs the two services it hosts, side by side.
    oracle() {
      const f = frame(main), [a, b] = view.services;
      if (floor || floors === 1) {
        const wall = box(g, 0.05, Math.min(1.6, H - 0.3), f.hv * (floors === 1 ? 0.8 : 1.2), S.glass, ...(([x, z]) => [x, FLOOR_Y + Math.min(1.6, H - 0.3) / 2, z])(f.back(0, f.hv * (floors === 1 ? 0.4 : 0.6) + 0.1)));
        wall.rotation.y = f.out;
        service(a, half(f, -1));
        service(b, half(f, 1));
      }
      if (!floor) {
        const h = Math.min(3.2, H - 0.1);
        for (let u = -f.hu + 1; u <= f.hu - 0.9; u += 2.2) cyl(g, 0.2, h, M.white, f.at(u, 1.6)[0], FLOOR_Y + h / 2, f.at(u, 1.6)[1], 14);
        serving(f, view.serves, {pitch: 1.4, from: floors === 1 ? 2.4 : 0, clear: 2.4});
      }
    },

    // The wing: Drive machines on its first storey, Gmail on its second. The main block: Google's own machines,
    // with a cabinet by the gate for each building it serves.
    google() {
      const [drive, gmail] = view.services, all = [main, ...others];
      const wing = all.find(z => !stacked(z)), block = all.find(z => z !== wing) || main, f = frame(block);
      if (wing) service(floor ? gmail : drive, frame(wing), floor ? 'mail' : 'store');
      else if (floors === 1) { service(drive, half(f, -1), 'store'); service(gmail, half(f, 1), 'mail'); return serving(f, view.serves, {from: 2.2, clear: 1.2}); }
      const here = floor ? [] : view.serves;
      rows(f, [...here, ...Array.from({length: 6})], (s, x, z, rot) => rack(x, z, rot, view.system.key, s ? {section: 'serve', id: s.id} : {section: 'kpi'}), {clear: 1.0});
    },

    // Control room: screens lit and rings rising while the bot takes commands; the cabinets are the buildings
    // that get its messages. The dish tower next door holds the relay.
    telegram() {
      const key = view.system.key, up = key === 'online' || key === 'slow', f = frame(main), s = roomy(f);
      const relay = z => {
        const r = frame(z), o = rack(...r.at(0, r.hv), r.out, key, {section: 'bot'}, 0.6, 1.2, 0.5);
        if (up) waves(o, Math.min(1.4, H - 0.3));
      };
      if (floor) return relay(main);
      const d = group(...f.at(f.door + s * 0.9, 1.5), f.in, {section: 'bot'});
      box(d, 2.2, 0.75, 0.8, M.wood, 0, 0.375, 0);
      for (const x of [-0.55, 0.55]) box(d, 0.8, 0.48, 0.05, up ? M.screenOn : M.screenOff, x, 1.07, -0.25);
      for (const x of [-0.55, 0.55]) box(d, 0.45, 0.08, 0.45, M.chair, x, 0.44, 0.85);
      cyl(d, 0.04, 1.3, S.frame, 1.25, 0.65, 0, 8);
      box(d, 0.12, 0.12, 0.12, lamp(key), 1.25, 1.36, 0);
      if (!others.length && up) waves(d, 1.5);
      serving(f, view.serves, {pitch: 1.2, clear: 2.6});
      if (others[0]) relay(others[0]);
      stand(f, view.missions, f.door - s * 1.3);
    },

    // No data source: the vault is shut, the shelves are bare, nothing glows and nobody is here.
    reserve() {
      const f = frame(main), r = Math.min(1.2, (H - 0.5) / 2), y = r + 0.25;
      const door = group(...f.at(f.door, 0.12), f.in, {section: 'vault'});
      const disc = (rad, d, m, z) => { const c = cyl(door, rad, d, m, 0, y, z, 32); c.rotation.x = Math.PI / 2; return c; };
      disc(r + 0.2, 0.14, S.dim, -0.02);
      disc(r, 0.26, S.vault, 0.1);
      disc(r * 0.24, 0.18, S.dim, 0.3);
      for (let i = 0; i < 4; i++) { const spoke = box(door, r * 1.2, 0.07, 0.07, S.frame, 0, y, 0.37); spoke.rotation.z = i * Math.PI / 4; }
      for (let i = 0; i < 8; i++) box(door, 0.14, 0.14, 0.1, S.dim, Math.cos(i * Math.PI / 4) * r * 0.82, y + Math.sin(i * Math.PI / 4) * r * 0.82, 0.26);
      const bare = (x, z, rot, w) => {
        const o = group(x, z, rot, {section: 'vault'});
        for (const sx of [-w / 2, w / 2]) box(o, 0.07, 2.1, 0.5, S.dim, sx, 1.05, 0);
        for (let t = 0; t < 4; t++) box(o, w, 0.05, 0.5, S.vault, 0, 0.15 + t * 0.62, 0);
      };
      const deep = Math.max(1.2, 2 * f.hv - 2.4), wide = Math.max(1.2, 2 * f.hu - 1.6);
      for (const s of [-1, 1]) bare(...f.back(s * (f.hu - 0.35), 0.9 + deep / 2), f.side(s), deep);
      bare(...f.back(0, 0.35), f.out, wide);
    }
  };
}
