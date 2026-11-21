import * as T from 'three';

/**
 * interior-builder.js
 * Nội thất cắt lớp (cut-away) của Campus V2.5, dựng theo dữ liệu.
 *
 * buildInterior(view) nhận view model từ dataConnector.getBuildingView() và dựng căn phòng của
 * đúng loại tòa (bản phác 2-8). Mọi vật thể bên trong ứng với một dữ liệu: bàn = agent,
 * khay = việc "Cần Input", bảng tường = số liệu của tab dashboard tương ứng. Không có dữ liệu
 * thì để trống và ghi "Chưa kết nối". Vật thể bấm được mang userData.focus = {section, id}.
 */

const C = {
  board: '#0c1512', line: 'rgba(255,255,255,.14)', text: '#eef4f1', mute: '#8fa39d',
  ok: '#5fd68a', warn: '#ffc440', alert: '#ff6a5a', info: '#6cb8ff', accent: '#f7941d', teal: '#4fc9bb'
};
const PRIORITY = {high: ['CAO', C.alert], medium: ['T.BÌNH', C.warn], low: ['THẤP', C.info]};
const FLOOR_Y = 0.14;
const WALL_H = 4.4;
const FONT = '"Segoe UI",system-ui,sans-serif';

const fit = (ctx, text, max) => {
  let s = String(text ?? '');
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
};

const wrap = (ctx, text, max, maxLines = 3) => {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width > max && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = fit(ctx, lines[maxLines - 1] + ' …', max); }
  return lines;
};

const clip = (text, n) => text.length > n ? text.slice(0, n - 1) + '…' : text;

const rounded = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/** Thanh tiến độ trên bảng tường. */
const bar = (ctx, x, y, w, pct, color = C.ok) => {
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  rounded(ctx, x, y, w, 12, 6); ctx.fill();
  if (pct > 0) { ctx.fillStyle = color; rounded(ctx, x, y, Math.max(12, w * Math.min(100, pct) / 100), 12, 6); ctx.fill(); }
};

/** Hàng ô số (4 chỉ số của một tab dashboard). */
const tiles = (ctx, W, y, items) => {
  const gap = 22, tw = (W - 80 - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => {
    const x = 40 + i * (tw + gap);
    ctx.fillStyle = 'rgba(255,255,255,.06)'; rounded(ctx, x, y, tw, 190, 18); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = 'center';
    const value = String(it.value ?? '—');
    let size = 84;
    do ctx.font = `800 ${size}px ${FONT}`; while (ctx.measureText(value).width > tw - 24 && (size -= 4) > 28);
    ctx.fillStyle = it.color || C.text;
    ctx.fillText(fit(ctx, value, tw - 16), x + tw / 2, y + 108);
    ctx.fillStyle = C.mute; ctx.font = `700 22px ${FONT}`;
    ctx.fillText(fit(ctx, it.label.toUpperCase(), tw - 12), x + tw / 2, y + 160);
    ctx.textAlign = 'left';
  });
};

/** Rooms are never smaller than 13 x 10 so every approved layout fits, whatever the building's footprint. */
export const roomSize = (width = 13, depth = 10) => [Math.max(13, width), Math.max(10, depth)];

export function buildInterior(view, width = 13, depth = 10, {mask = t => t} = {}) {
  const g = new T.Group();
  g.name = `interior_${view.id}`;
  const [w, d] = roomSize(width, depth);
  const anim = [];
  const mat = (color, o = {}) => new T.MeshStandardMaterial({color, roughness: 0.7, ...o});
  const lightFloor = view.type === 'project' || view.type === 'ai';
  const M = {
    floor: mat(lightFloor ? 0xe6e9ec : 0xedd6b8, {roughness: 0.65}),
    wall: mat(0xf1ece1, {roughness: 0.9}), base: mat(0xb58a63),
    wood: mat(0xc99862, {roughness: 0.55}), woodDark: mat(0xa9773f, {roughness: 0.6}),
    dark: mat(0x1e293b), pc: mat(0x0f172a, {roughness: 0.4}),
    screenOn: mat(0x0b3b33, {emissive: 0x34e0b0, emissiveIntensity: 1.1, roughness: 0.15}),
    screenOff: mat(0x1f2933, {roughness: 0.4}),
    active: mat(0x1f9d8f), idle: mat(0x9aa7b4), skin: mat(0xf6cfa0, {roughness: 0.8}),
    paper: mat(0xf7941d, {emissive: 0xf7941d, emissiveIntensity: 0.25}),
    cabinet: mat(0x2c8f88, {roughness: 0.6}), cream: mat(0xf3e7cf), safe: mat(0x566270, {roughness: 0.45, metalness: 0.4}),
    padDone: mat(0x7fdc9e), padNow: mat(0xffd84a, {emissive: 0xffc440, emissiveIntensity: 0.35}), padTodo: mat(0xf8fafc, {transparent: true, opacity: 0.55}),
    block: mat(0xf7941d)
  };
  const box = (parent, sx, sy, sz, material, x, y, z) => {
    const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // ---- vỏ phòng: sàn + hai tường sau (camera đứng ở góc +x, +z) ----
  box(g, w + 0.9, 8, d + 0.9, mat(0x5b4a3a, {roughness: 1}), -0.2, -4.0, -0.2);
  box(g, w, FLOOR_Y, d, M.floor, 0, FLOOR_Y / 2, 0);
  box(g, 0.24, WALL_H, d, M.wall, -w / 2 - 0.12, WALL_H / 2, 0);
  box(g, w + 0.24, WALL_H, 0.24, M.wall, -0.12, WALL_H / 2, -d / 2 - 0.12);
  box(g, 0.06, 0.22, d, M.base, -w / 2 + 0.03, FLOOR_Y + 0.11, 0);
  box(g, w, 0.22, 0.06, M.base, 0, FLOOR_Y + 0.11, -d / 2 + 0.03);

  /** Bảng tường: side 'left' (tường x = -w/2) hoặc 'right' (tường z = -d/2). draw(ctx, W, H, y0) vẽ nội dung. */
  function board(side, title, accent, draw, focus) {
    const bw = (side === 'left' ? d : w) - 1.2, bh = 3.3;
    const W = 1280, H = Math.round(W * bh / bw);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = C.board; rounded(ctx, 4, 4, W - 8, H - 8, 26); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 6; ctx.stroke();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = accent; ctx.font = `800 46px ${FONT}`;
    ctx.fillText(fit(ctx, title.toUpperCase(), W - 80), 40, 72);
    if (view.connected === false) {
      ctx.fillStyle = C.mute; ctx.font = `700 40px ${FONT}`;
      ctx.fillText('Chưa kết nối dữ liệu dashboard', 40, 160);
    } else draw(ctx, W, H, 104);
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8;
    const m = new T.Mesh(new T.PlaneGeometry(bw, bh), new T.MeshBasicMaterial({map: tex, toneMapped: false}));
    if (side === 'left') { m.position.set(-w / 2 + 0.02, 2.5, 0); m.rotation.y = Math.PI / 2; }
    else m.position.set(0, 2.5, -d / 2 + 0.02);
    if (focus) m.userData.focus = focus;
    g.add(m);
    return m;
  }

  /** Nhãn nổi (viên thuốc trắng) phía trên một vật thể. */
  function label(x, y, z, title, sub, {tone = C.teal, muted = false, focus} = {}) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    ctx.font = `800 30px ${FONT}`;
    const tw = ctx.measureText(title).width;
    ctx.font = `700 24px ${FONT}`;
    const sw = sub ? ctx.measureText(sub).width : 0;
    cv.width = Math.ceil(Math.max(tw, sw) + 44); cv.height = sub ? 92 : 54;
    ctx.fillStyle = muted ? 'rgba(236,240,243,.94)' : 'rgba(255,255,255,.96)';
    rounded(ctx, 2, 2, cv.width - 4, cv.height - 4, 16); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = muted ? '#5b6770' : '#17212b'; ctx.font = `800 30px ${FONT}`;
    ctx.fillText(title, cv.width / 2, 38);
    if (sub) { ctx.fillStyle = muted ? '#7b8790' : tone; ctx.font = `700 24px ${FONT}`; ctx.fillText(sub, cv.width / 2, 74); }
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({map: tex, depthTest: false, toneMapped: false}));
    s.scale.set(cv.width / 82, cv.height / 82, 1);
    s.position.set(x, y, z);
    s.renderOrder = 10;
    if (focus) s.userData.focus = focus;
    g.add(s);
    return s;
  }

  /** Bàn làm việc V2.5 + màn hình + người. Người và màn hình sáng chỉ khi agent đang chạy. */
  function agentDesk(agent, x, z, compact = false) {
    const dg = new T.Group();
    dg.position.set(x, FLOOR_Y, z);
    dg.rotation.y = Math.PI / 4;
    dg.userData.focus = {section: 'agent', id: agent.id};
    box(dg, 2.3, 0.75, 1.0, M.wood, 0, 0.375, 0);
    box(dg, 2.34, 0.08, 1.04, M.woodDark, 0, 0.79, 0);
    box(dg, 0.08, 0.2, 0.08, M.pc, 0.4, 0.93, -0.1);
    const screen = box(dg, 0.8, 0.5, 0.05, agent.active ? M.screenOn : M.screenOff, 0.4, 1.25, -0.1);
    box(dg, 0.5, 0.03, 0.18, M.pc, 0.4, 0.84, 0.25);
    const body = new T.Mesh(new T.CapsuleGeometry(0.24, 0.62, 4, 12), agent.active ? M.active : M.idle);
    body.position.set(-0.45, 0.6, 0.95); body.castShadow = true;
    const head = new T.Mesh(new T.SphereGeometry(0.21, 16, 16), M.skin);
    head.position.set(-0.45, 1.3, 0.95);
    dg.add(body, head);
    g.add(dg);
    if (agent.active) anim.push(t => {
      head.position.y = 1.3 + Math.sin(t * 2.4 + x) * 0.025;
      screen.material.emissiveIntensity = 0.95 + Math.sin(t * 5 + z) * 0.25;
    });
    const sub = agent.active
      ? [agent.task, agent.loadPct != null ? agent.loadPct + '%' : null].filter(Boolean).join(' · ') || 'đang chạy'
      : 'chưa có dữ liệu';
    label(x, 2.35, z, compact ? agent.name : clip(`${agent.name} · ${agent.role}`, 38), compact ? clip(sub, 30) : sub, {muted: !agent.active, focus: dg.userData.focus});
    return dg;
  }

  /** Bàn khay: mỗi tờ giấy cam là một việc đang chờ anh. */
  function tray(x, z, count, text, focus) {
    const tg = new T.Group();
    tg.position.set(x, FLOOR_Y, z);
    tg.rotation.y = Math.PI / 4;
    tg.userData.focus = focus;
    box(tg, 2.4, 0.7, 1.2, M.wood, 0, 0.35, 0);
    for (let i = 0; i < Math.min(count, 8); i++) {
      const p = box(tg, 0.42, 0.03, 0.56, M.paper, -0.85 + (i % 4) * 0.56, 0.73 + Math.floor(i / 4) * 0.04, i < 4 ? -0.05 : 0.1);
      p.rotation.y = (i % 3 - 1) * 0.18;
      anim.push(t => { p.material.emissiveIntensity = 0.25 + (Math.sin(t * 3) + 1) * 0.18; });
    }
    g.add(tg);
    label(x, 1.55, z, text, null, {muted: !count, focus});
  }

  const agentsHere = (slots, emptyText) => {
    if (!view.agents.length) {
      box(g, 2.3, 0.75, 1.0, M.wood, slots[0][0], FLOOR_Y + 0.375, slots[0][1]).rotation.y = Math.PI / 4;
      label(slots[0][0], 1.6, slots[0][1], emptyText, null, {muted: true, focus: {section: 'agents'}});
    }
    view.agents.slice(0, slots.length).forEach((a, i) => agentDesk(a, slots[i][0], slots[i][1]));
  };
  const input = n => n ? `${n} việc chờ anh` : 'không có việc chờ';

  const rooms = {
    hq() {
      const {open, done} = view.allMissions;
      board('left', `Mission hôm nay · ${open.length} việc`, C.ok, (ctx, W, H, y) => {
        const all = [...open, ...done], cap = Math.floor((H - y - 20) / 62);
        const rows = all.length > cap ? all.slice(0, cap - 1) : all;
        if (all.length > cap) { ctx.fillStyle = C.mute; ctx.font = `600 28px ${FONT}`; ctx.fillText(`+${all.length - rows.length} việc khác: xem bảng bên trái`, 40, y + 46 + rows.length * 62); }
        rows.forEach((m, i) => {
          const yy = y + 46 + i * 62, [pl, pc] = PRIORITY[m.priority] || PRIORITY.low;
          ctx.font = `800 26px ${FONT}`; ctx.fillStyle = m.done ? C.mute : pc; ctx.fillText(m.done ? 'XONG' : pl, 40, yy);
          const right = m.time || m.tag || '';
          ctx.fillStyle = m.tag === 'Cần Input' ? C.accent : C.mute; ctx.textAlign = 'right'; ctx.fillText(right, W - 40, yy); ctx.textAlign = 'left';
          ctx.font = `600 32px ${FONT}`; ctx.fillStyle = m.done ? C.mute : C.text;
          const title = fit(ctx, mask(m.title) + (m.project ? ` (${m.project.name})` : ''), W - 250 - ctx.measureText(right).width);
          ctx.fillText(title, 160, yy);
          if (m.done) { ctx.strokeStyle = C.mute; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(160, yy - 11); ctx.lineTo(160 + ctx.measureText(title).width, yy - 11); ctx.stroke(); }
        });
        if (!rows.length) { ctx.fillStyle = C.mute; ctx.font = `600 34px ${FONT}`; ctx.fillText('Không còn việc nào chờ anh.', 40, y + 50); }
      }, {section: 'missions'});
      const ps = view.projects;
      board('right', view.runningKpi == null ? `${ps.length} dự án đang chạy` : `${ps.length} dự án trong danh sách · chỉ số báo ${view.runningKpi}`, view.runningKpi == null ? C.teal : C.warn, (ctx, W, H, y) => {
        const per = Math.floor((H - y - 16) / 54), cw = (W - 100) / 2;
        const shown = ps.length > per * 2 ? ps.slice(0, per * 2 - 1) : ps;
        if (ps.length > shown.length) { ctx.fillStyle = C.mute; ctx.font = `600 28px ${FONT}`; ctx.fillText(`+${ps.length - shown.length} dự án khác: xem bảng bên phải`, 60 + cw, y + 40 + (per - 1) * 54); }
        shown.forEach((p, i) => {
          const x = 40 + Math.floor(i / per) * (cw + 20), yy = y + 40 + (i % per) * 54;
          ctx.font = `600 28px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(fit(ctx, p.name, cw - 230), x, yy);
          if (p.progress != null) bar(ctx, x + cw - 210, yy - 16, 200, p.progress);
        });
      }, {section: 'projects'});
      tray(-w / 2 + 3.2, -0.6, view.inputCount, `Khay "Cần Input": ${input(view.inputCount)}`, {section: 'missions'});
      agentsHere([[-0.4, 0.6], [-2.6, 2.8]], 'Bàn điều phối: chưa có agent nào được gán');
      // Sa bàn: mỗi khối là một dự án đang chạy, cao theo % mốc đã xong
      const cols = Math.max(1, Math.ceil(Math.sqrt(ps.length))), tw = 3.6;
      const table = new T.Group();
      table.position.set(w / 2 - 3.2, FLOOR_Y, d / 2 - 3.6);
      table.rotation.y = Math.PI / 4;
      box(table, tw, 0.5, tw, mat(0x9ccf8b), 0, 0.25, 0).userData.focus = {section: 'projects'};
      ps.slice(0, 25).forEach((p, i) => {
        const cell = tw / cols, h = 0.25 + (p.progress ?? 0) / 100 * 1.5;
        const b = box(table, cell * 0.6, h, cell * 0.6, M.block, -tw / 2 + cell * (i % cols + 0.5), 0.5 + h / 2, -tw / 2 + cell * (Math.floor(i / cols) + 0.5));
        b.userData.focus = {section: 'project', id: p.id};
      });
      g.add(table);
      label(w / 2 - 3.2, 3.0, d / 2 - 3.6, `Sa bàn ${ps.length} dự án (cao theo % mốc)`, null, {focus: {section: 'projects'}});
    },

    bank() {
      const f = view.finance;
      board('left', 'Theo dõi dòng tiền · ngày', C.ok, (ctx, W, H, y) => {
        if (!f.flow.length) { ctx.fillStyle = C.mute; ctx.font = `600 34px ${FONT}`; ctx.fillText('Chưa có khoản thu chi nào.', 40, y + 50); return; }
        const max = Math.max(...f.flow.map(x => Math.max(x.income, x.expense))) || 1;
        const base = H - 70, top = y + 50, slot = (W - 80) / f.flow.length, bw = Math.min(46, slot / 3);
        ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(40, base); ctx.lineTo(W - 40, base); ctx.stroke();
        f.flow.forEach((p, i) => {
          const cx = 40 + slot * (i + 0.5);
          [[p.income, C.ok, -bw - 3], [p.expense, C.accent, 3]].forEach(([v, color, dx]) => {
            if (!v) return;
            const h = Math.max(6, (base - top) * v / max);
            ctx.fillStyle = color; rounded(ctx, cx + dx, base - h, bw, h, 6); ctx.fill();
          });
          ctx.fillStyle = C.mute; ctx.font = `700 22px ${FONT}`; ctx.textAlign = 'center';
          ctx.fillText(String(p.date).slice(0, 5), cx, base + 34); ctx.textAlign = 'left';
        });
        ctx.font = `700 24px ${FONT}`;
        ctx.fillStyle = C.ok; ctx.fillText('■ Thu', W - 250, 70); ctx.fillStyle = C.accent; ctx.fillText('■ Chi', W - 140, 70);
      }, {section: 'flow'});
      board('right', `Khoản chi gần đây (${f.expenses.length}) · Khoản thu (${f.incomes.length})`, C.accent, (ctx, W, H, y) => {
        const cw = (W - 120) / 2;
        [[f.expenses, C.accent, 'expense'], [f.incomes, C.ok, 'income']].forEach(([list, color, kind], c) => {
          const x = 40 + c * (cw + 40);
          list.slice(0, Math.floor((H - y - 16) / 56)).forEach((e, i) => {
            const yy = y + 44 + i * 56;
            ctx.font = `800 28px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = 'right';
            const amount = mask(e.amountFormatted);
            ctx.fillText(amount, x + cw, yy); ctx.textAlign = 'left';
            ctx.font = `600 28px ${FONT}`; ctx.fillStyle = C.text;
            ctx.fillText(fit(ctx, e.description, cw - ctx.measureText(amount).width - 40), x, yy);
          });
          if (!list.length) { ctx.fillStyle = C.mute; ctx.font = `600 28px ${FONT}`; ctx.fillText(kind === 'expense' ? 'Chưa có khoản chi' : 'Chưa có khoản thu', x, y + 44); }
        });
      }, {section: 'ledger'});
      tray(-w / 2 + 3.2, -0.6, view.inputs.length, `Khay "Cần Input": ${view.inputs.length ? view.inputs.length + ' khoản chi thiếu thông tin' : 'không có khoản nào chờ'}`, {section: 'missions'});
      agentsHere([[0.2, 0.6]], 'Quầy giao dịch: chưa có agent nào được gán');
      const safe = box(g, 1.7, 1.9, 1.5, M.safe, w / 2 - 3.4, FLOOR_Y + 0.95, d / 2 - 2.6);
      safe.rotation.y = Math.PI / 4;
      safe.userData.focus = {section: 'kpi'};
      const dial = new T.Mesh(new T.TorusGeometry(0.26, 0.05, 8, 24), mat(0xe2e8f0, {metalness: 0.6, roughness: 0.3}));
      dial.position.set(0, 0.1, 0.78); safe.add(dial);
      label(w / 2 - 3.4, 2.75, d / 2 - 2.6, `Két: tiền mặt sẵn có ${mask(f.cash ?? '—')}`, null, {focus: {section: 'kpi'}});
    },

    documents() {
      const b = view.board;
      board('left', 'Kho giấy tờ pháp lý', C.ok, (ctx, W, H, y) => {
        tiles(ctx, W, y + 20, [
          {label: 'Thiếu', value: b.missingCount, color: b.missingCount ? C.alert : C.text},
          {label: 'Đầy đủ', value: b.completeCount, color: C.ok},
          {label: 'Chưa ký', value: b.unsignedCount, color: b.unsignedCount ? C.warn : C.text},
          {label: 'HĐ chờ duyệt', value: b.invoicesPending ?? '—', color: C.info}
        ]);
        ctx.fillStyle = C.info; ctx.font = `700 30px ${FONT}`;
        ctx.fillText(b.invoicesPending == null ? 'Hóa đơn chờ duyệt: chưa kết nối' : `Hóa đơn chờ duyệt: ${b.invoicesPending}`, 40, y + 270);
      }, {section: 'kpi'});
      const missing = b.rows.filter(r => r.missing.length);
      board('right', `Kệ hồ sơ: ${missing.length} dự án thiếu giấy tờ`, C.teal, (ctx, W, H, y) => {
        if (!missing.length) { ctx.fillStyle = C.ok; ctx.font = `600 34px ${FONT}`; ctx.fillText('Không dự án nào thiếu giấy tờ.', 40, y + 50); return; }
        const rows = missing.slice(0, Math.floor((H - y - 60) / 48)), x0 = W * 0.42, cw = (W - x0 - 40) / b.papers.length;
        ctx.font = `700 22px ${FONT}`; ctx.fillStyle = C.mute; ctx.textAlign = 'center';
        b.papers.forEach((p, i) => ctx.fillText(p.label.toUpperCase(), x0 + cw * (i + 0.5), y + 26));
        ctx.textAlign = 'left';
        rows.forEach((r, ri) => {
          const yy = y + 44 + ri * 48;
          ctx.font = `600 28px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(fit(ctx, r.project.name, x0 - 60), 40, yy + 28);
          r.slots.forEach((s, i) => {
            rounded(ctx, x0 + cw * i + 8, yy, cw - 16, 36, 8);
            if (s === true) { ctx.fillStyle = C.ok; ctx.fill(); }
            else { ctx.setLineDash(s === false ? [8, 6] : []); ctx.strokeStyle = s === false ? C.alert : C.line; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]); }
          });
        });
      }, {section: 'board'});
      tray(-w / 2 + 3.2, -0.6, b.missingCount, b.missingCount ? `Bàn chờ: ${b.missingCount} hồ sơ còn thiếu` : 'Bàn chờ: không có hồ sơ thiếu', {section: 'missing'});
      agentsHere([[0.2, 0.6]], 'Bàn hồ sơ: chưa có agent nào được gán');
      const n = Math.min(5, Math.ceil(b.completeCount / 6));
      for (let i = 0; i < n; i++) box(g, 0.9, 1.9, 2.4, M.cabinet, w / 2 - 4.4 + i * 1.15, FLOOR_Y + 0.95, d / 2 - 3.9 - i * 0.55).userData.focus = {section: 'board'};
      if (n) label(w / 2 - 3.2, 3.0, d / 2 - 3.2, `Kệ ${b.completeCount} dự án đầy đủ giấy tờ`, null, {focus: {section: 'board'}});
    },

    project() {
      const p = view.project;
      const ms = view.milestones;
      board('left', 'Việc cần làm tiếp theo', C.accent, (ctx, W, H, y) => {
        ctx.font = `600 38px ${FONT}`; ctx.fillStyle = C.text;
        const lines = p.nextaction ? wrap(ctx, p.nextaction, W - 80, 3) : ['Chưa có việc tiếp theo'];
        lines.forEach((l, i) => ctx.fillText(l, 40, y + 56 + i * 50));
        ctx.font = `700 34px ${FONT}`; ctx.fillStyle = C.accent;
        ctx.fillText(`Hạn hoàn thành: ${p.duedate || 'chưa có'}`, 40, y + 250);
        ctx.fillStyle = C.ok;
        ctx.fillText(`${String(p.status || '').toUpperCase()} · ${view.doneCount}/${ms.length} mốc`, 40, y + 306);
      }, {section: 'next'});
      board('right', `Thanh toán · đã nhận ${mask(p.receivedFormatted ?? '—')} / ${mask(p.budgetFormatted ?? '—')}`, C.teal, (ctx, W, H, y) => {
        tiles(ctx, W, y + 20, view.payments.map((v, i) => ({label: 'Đợt ' + (i + 1), value: mask(v ?? '—')})));
        ctx.font = `700 34px ${FONT}`; ctx.fillStyle = C.accent;
        ctx.fillText(view.receivedPct == null ? 'Chưa kết nối số đã thu' : `${view.receivedPct}% đã thu`, 40, y + 270);
      }, {section: 'payments'});
      // Mỗi mốc sản xuất là một khu trên sàn
      const cols = Math.ceil(Math.sqrt(ms.length || 1)), rows = Math.ceil(ms.length / cols);
      const cw = Math.min(3.8, (w - 3.5) / cols), cd = Math.min(3.4, (d - 3.5) / rows);
      const x0 = 0.6 - cols * cw / 2, z0 = 0.6 - rows * cd / 2;
      ms.forEach((m, i) => {
        const x = x0 + cw * (i % cols + 0.5), z = z0 + cd * (Math.floor(i / cols) + 0.5);
        const focus = {section: 'milestone', id: String(i)};
        const pad = box(g, cw - 0.5, 0.05, cd - 0.5, m.state === 'done' ? M.padDone : m.state === 'current' ? M.padNow : M.padTodo, x, FLOOR_Y + 0.03, z);
        pad.userData.focus = focus;
        if (m.state === 'done') box(g, 1.0, 0.8, 1.0, M.cream, x, FLOOR_Y + 0.45, z).userData.focus = focus;
        if (m.state === 'current') {
          const b = box(g, 1.0, 0.8, 1.0, M.block, x, FLOOR_Y + 0.45, z);
          b.userData.focus = focus;
          const wire = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1.25, 1.3, 1.25)), new T.LineBasicMaterial({color: 0xf7941d}));
          wire.position.set(x, FLOOR_Y + 0.7, z); g.add(wire);
          anim.push(t => { b.scale.y = 0.75 + (Math.sin(t * 2.2) + 1) * 0.2; b.position.y = FLOOR_Y + 0.05 + 0.4 * b.scale.y; pad.material.emissiveIntensity = 0.3 + (Math.sin(t * 2.2) + 1) * 0.2; });
        }
        label(x, m.state === 'todo' ? 0.8 : 1.85, z, (m.state === 'done' ? '✓ ' : m.state === 'current' ? '▸ ' : '') + m.name, m.state === 'current' ? 'đang làm' : null,
          {muted: m.state === 'todo', tone: C.accent, focus});
      });
      if (!ms.length) label(0, 1.2, 0, 'Dự án chưa có mốc sản xuất', null, {muted: true});
    },

    schedule() {
      const s = view.schedule;
      const date = s.today.toLocaleDateString('vi-VN');
      board('left', `Hôm nay · ${date}`, C.ok, (ctx, W, H, y) => {
        s.todayEvents.slice(0, Math.floor((H - y - 16) / 62)).forEach((e, i) => {
          const yy = y + 46 + i * 62, color = (PRIORITY[e.priority] || PRIORITY.low)[1];
          ctx.fillStyle = e.done ? C.mute : color; ctx.beginPath(); ctx.arc(54, yy - 10, 11, 0, 7); ctx.fill();
          ctx.font = `700 26px ${FONT}`; ctx.fillStyle = C.mute; ctx.textAlign = 'right'; ctx.fillText(e.time || '', W - 40, yy); ctx.textAlign = 'left';
          ctx.font = `600 32px ${FONT}`; ctx.fillStyle = e.done ? C.mute : C.text;
          const title = fit(ctx, e.title + (e.project ? ` (${e.project.name})` : ''), W - 300);
          ctx.fillText(title, 84, yy);
          if (e.done) { ctx.strokeStyle = C.mute; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(84, yy - 11); ctx.lineTo(84 + ctx.measureText(title).width, yy - 11); ctx.stroke(); }
        });
        if (!s.todayEvents.length) { ctx.fillStyle = C.mute; ctx.font = `600 34px ${FONT}`; ctx.fillText('Hôm nay không có lịch.', 40, y + 50); }
      }, {section: 'today'});
      board('right', `Tháng ${s.month + 1}, ${s.year}${s.hasMonth ? '' : ' · chưa kết nối lịch tháng'}`, C.teal, (ctx, W, H, y) => {
        const lead = (new Date(s.year, s.month, 1).getDay() + 6) % 7, weeks = Math.ceil((lead + s.days.length) / 7);
        const cw = (W - 80) / 7, ch = (H - y - 50) / weeks;
        ctx.font = `700 22px ${FONT}`; ctx.fillStyle = C.mute; ctx.textAlign = 'center';
        ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].forEach((n, i) => ctx.fillText(n, 40 + cw * (i + 0.5), y + 22));
        ctx.textAlign = 'left';
        s.days.forEach((day, i) => {
          const x = 40 + cw * ((lead + i) % 7), yy = y + 34 + ch * Math.floor((lead + i) / 7);
          rounded(ctx, x + 4, yy + 3, cw - 8, ch - 6, 10);
          ctx.fillStyle = day.isToday ? 'rgba(247,148,29,.28)' : 'rgba(255,255,255,.05)'; ctx.fill();
          if (day.isToday) { ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.stroke(); }
          ctx.font = `800 24px ${FONT}`; ctx.fillStyle = day.isToday ? C.accent : C.text; ctx.fillText(day.day, x + 14, yy + 30);
          day.events.slice(0, 4).forEach((e, k) => {
            ctx.fillStyle = e.done ? C.mute : (PRIORITY[e.priority] || PRIORITY.low)[1];
            rounded(ctx, x + 52 + k * 30, yy + 14, 24, 10, 5); ctx.fill();
          });
        });
      }, {section: 'month'});
      // Mỗi việc của hôm nay là một bảng đứng giữa phòng: màu theo mức ưu tiên, xám khi đã xong
      s.todayEvents.slice(0, 6).forEach((e, i) => {
        const x = (i % 3 - 1) * 4.5 * w / 13, z = i < 3 ? -2.4 : 2.0, focus = {section: 'event', id: e.id};
        const color = e.done ? 0x8b98a5 : {high: 0xff6a5a, medium: 0xffc440}[e.priority] || 0x6cb8ff;
        const sg = new T.Group();
        sg.position.set(x, FLOOR_Y, z); sg.rotation.y = Math.PI / 4; sg.userData.focus = focus;
        box(sg, 0.12, 1.0, 0.12, M.dark, 0, 0.5, 0);
        const card = box(sg, 1.5, 0.9, 0.1, mat(color, e.done ? {} : {emissive: color, emissiveIntensity: 0.3}), 0, 1.35, 0);
        box(sg, 0.9, 0.06, 0.6, M.dark, 0, 0.03, 0);
        g.add(sg);
        if (!e.done) anim.push(t => { card.material.emissiveIntensity = 0.3 + (Math.sin(t * 2.4 + i) + 1) * 0.15; });
        label(x, 2.45, z, (e.done ? '✓ ' : '') + (e.time || 'Cả ngày'), clip(e.title, 30), {muted: !!e.done, tone: C.accent, focus});
      });
      if (!s.todayEvents.length) label(0, 1.4, 0, 'Hôm nay không có lịch', null, {muted: true, focus: {section: 'today'}});
      if (view.agents.length) agentsHere([[w / 2 - 2.6, d / 2 - 2.4]], '');
    },

    ai() {
      const agents = view.agents;
      const active = agents.filter(a => a.active), idle = agents.filter(a => !a.active);
      board('left', 'AI Workforce Trace', C.ok, (ctx, W, H, y) => {
        agents.slice(0, Math.floor((H - y - 16) / 62)).forEach((a, i) => {
          const yy = y + 46 + i * 62;
          ctx.font = `700 32px ${FONT}`; ctx.fillStyle = a.active ? C.text : C.mute; ctx.fillText(fit(ctx, a.name, 280), 40, yy);
          bar(ctx, 340, yy - 20, W - 520, a.loadPct ?? 0);
          ctx.textAlign = 'right'; ctx.fillStyle = a.active ? C.ok : C.mute; ctx.fillText(a.loadPct != null ? a.loadPct + '%' : '—', W - 40, yy); ctx.textAlign = 'left';
        });
        if (!agents.length) { ctx.fillStyle = C.mute; ctx.font = `600 34px ${FONT}`; ctx.fillText('Chưa có dữ liệu agent.', 40, y + 50); }
      }, {section: 'agents'});
      board('right', 'Kênh chat với đội ngũ agent', C.teal, (ctx, W, H, y) => {
        ctx.font = `600 32px ${FONT}`; ctx.fillStyle = C.text;
        ctx.fillText(`${agents.length} agent · bấm một agent để mở kênh chat bên dashboard`, 40, y + 50);
        ctx.fillStyle = C.ok; ctx.fillText(fit(ctx, 'Đang hoạt động: ' + (active.map(a => a.name).join(', ') || 'không có'), W - 80), 40, y + 110);
        ctx.fillStyle = C.mute; ctx.fillText(fit(ctx, 'Chưa có dữ liệu tải: ' + (idle.map(a => a.name).join(', ') || 'không có'), W - 80), 40, y + 170);
      }, {section: 'chat'});
      // Up to six desks on a 3 x 2 grid, spaced so the name tags never overlap from the fixed camera corner.
      agents.slice(0, 6).forEach((a, i) => agentDesk(a, (i % 3 - 1) * 4.5 * w / 13, i < 3 ? -2.6 : 1.9, true));
    },

    marketing() {
      const c = view.counts || {};
      const pending = (view.posts || []).filter(p => p.status === 'pending');
      board('left', 'Bài fanpage (AN PHIM)', C.warn, (ctx, W, H, y) => {
        tiles(ctx, W, y + 20, [
          {label: 'Tổng số bài', value: c.totalPosts},
          {label: 'Chờ sếp duyệt', value: c.pendingApproval, color: C.warn},
          {label: 'Đã duyệt', value: c.approvedQueued, color: C.info},
          {label: 'Đã lên', value: c.published, color: C.ok}
        ]);
        ctx.font = `700 32px ${FONT}`; ctx.fillStyle = C.warn;
        ctx.fillText(`Chờ sếp duyệt: ${c.pendingApproval ?? '—'} bài`, 40, y + 270);
      }, {section: 'kpi'});
      board('right', `${c.pendingApproval ?? '—'} bài chờ sếp duyệt`, C.warn, (ctx, W, H, y) => {
        if (!view.posts) { ctx.fillStyle = C.mute; ctx.font = `600 34px ${FONT}`; ctx.fillText('Chưa kết nối danh sách bài viết.', 40, y + 50); return; }
        if (!pending.length) { ctx.fillStyle = C.ok; ctx.font = `600 34px ${FONT}`; ctx.fillText('Không còn bài nào chờ duyệt.', 40, y + 50); return; }
        const n = Math.min(6, pending.length), cw = Math.min(260, (W - 80) / n), ch = H - y - 40;
        pending.slice(0, n).forEach((p, i) => {
          const x = 40 + i * cw;
          rounded(ctx, x + 6, y + 10, cw - 12, ch, 14); ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fill();
          ctx.strokeStyle = C.warn; ctx.lineWidth = 3; ctx.stroke();
          ctx.font = `800 22px ${FONT}`; ctx.fillStyle = C.text; ctx.fillText(fit(ctx, p.page || '', cw - 40), x + 20, y + 46);
          ctx.font = `600 24px ${FONT}`; ctx.fillStyle = C.text;
          wrap(ctx, p.title, cw - 40, 4).forEach((l, k) => ctx.fillText(l, x + 20, y + 92 + k * 32));
          ctx.font = `800 20px ${FONT}`; ctx.fillStyle = C.warn; ctx.fillText('CHỜ DUYỆT', x + 20, y + ch - 14);
        });
      }, {section: 'posts'});
      agentsHere([[-1.6, -0.4], [1.8, 2.2]], 'Phòng nội dung: chưa có agent nào được gán');
    }
  };

  if (rooms[view.type]) rooms[view.type]();
  else label(0, 1.6, 0, view.title || 'Tòa nhà', 'Bên trong tòa này chưa có bản phác được duyệt', {muted: true});
  g.userData.update = t => { for (const fn of anim) fn(t); };
  return g;
}

/** Vật thể bấm được dưới con trỏ trong phòng: trả về userData.focus ({section, id}) hoặc null. */
export function pickFocus(interior, raycaster) {
  let o = raycaster.intersectObject(interior, true)[0]?.object;
  if (!o) return undefined;
  while (o && o !== interior && !o.userData.focus) o = o.parent;
  return o?.userData.focus || null;
}
