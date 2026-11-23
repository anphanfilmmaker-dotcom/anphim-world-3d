/**
 * building-panels.js
 * Inside a building (approved sketches 2-8): the left panel shows what needs the owner
 * (key numbers, pending work, agents working there), the right panel is for looking things up
 * (lists, the selected item, buttons that open the matching Workspace dashboard page).
 * View only. Every value comes from dataConnector.getBuildingView(); the 3D room is built from
 * the same view model. Mounted inside the cockpit frame so both share one look.
 */

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const PRIORITY = {
  high: {label: 'CAO', tone: 'alert'},
  medium: {label: 'T.BÌNH', tone: 'warn'},
  low: {label: 'THẤP', tone: 'info'}
};
const STATUS_TONE = {'Đang làm': 'ok', 'Chờ feedback': 'warn', 'Cần revise': 'alert', 'Tạm dừng': 'alert', 'Hoàn thành': 'done'};
const POST_STATUS = {
  pending: {label: 'CHỜ DUYỆT', tone: 'warn', filter: 'Chờ duyệt'},
  approved: {label: 'ĐÃ DUYỆT', tone: 'info', filter: 'Đã duyệt'},
  published: {label: 'ĐÃ ĐĂNG', tone: 'ok', filter: 'Đã đăng'}
};
const NONE = '<span class="bp-none">Chưa kết nối</span>';

const STYLE = `
#cockpit-frame-root{
.bp-side{opacity:0;pointer-events:none}
.bp-left{left:var(--cf-pad);transform:translateX(-24px)}
.bp-right{right:var(--cf-pad);transform:translateX(24px)}
&.bp-open .bp-side{opacity:1;pointer-events:auto;transform:none}
&.bp-open>.cf-left,&.bp-open>.cf-right,&.cf-building .bp-side{opacity:0;pointer-events:none}
&.bp-open>.cf-left *{pointer-events:none}
&:not(.bp-open) .bp-side *{pointer-events:none}
.bp-side .cf-panel{flex:0 1 auto;overflow:hidden}
.bp-title{margin:0;font-size:17px;font-weight:900;line-height:1.2;text-transform:uppercase;letter-spacing:.02em}
.bp-subtitle{color:var(--cf-mute);font-size:11px;margin:2px 0 4px}
.bp-sec{margin:12px 0 7px;display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:10.5px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--cf-teal)}
.bp-sec small{font-size:10.5px;letter-spacing:0;text-transform:none;color:var(--cf-mute);font-weight:700}
.bp-tiles{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.bp-tiles.bp-3{grid-template-columns:1fr 1fr 1fr}
.bp-tile{padding:7px 9px;border-radius:10px;background:var(--cf-bg2);border:1px solid var(--cf-line);min-width:0;container-type:inline-size}
.bp-tile small{display:block;font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--cf-mute)}
.bp-tile b{display:block;font-size:min(15px,calc(100cqw / var(--bp-len,1)));font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.bp-tile[data-tone=warn] small,.bp-tile[data-tone=warn] b{color:var(--cf-warn)}
.bp-tile[data-tone=alert] small,.bp-tile[data-tone=alert] b{color:var(--cf-alert)}
.bp-none{color:var(--cf-mute);font-weight:700;font-size:11px}
.bp-box{padding:8px 10px;border-radius:10px;background:var(--cf-bg2);border:1px solid var(--cf-line);font-size:12px;line-height:1.35}
.bp-box[data-tone=warn]{border-color:rgba(247,148,29,.7)}
.bp-rowbtn{display:block;width:100%;padding:7px 9px;margin-bottom:5px;border-radius:10px;background:var(--cf-bg2);border:1px solid var(--cf-line);font-size:12px}
button.bp-rowbtn:hover,.bp-rowbtn[aria-pressed=true]{border-color:rgba(247,148,29,.7)}
.bp-rowbtn small{display:block;color:var(--cf-mute);font-size:10.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bp-amt{font-weight:900;white-space:nowrap;font-variant-numeric:tabular-nums}
.bp-amt[data-tone=out]{color:var(--cf-accent)}
.bp-amt[data-tone=in]{color:var(--cf-ok)}
.bp-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px}
.bp-chip,.bp-chips select{height:25px;padding:0 9px;border-radius:99px;background:var(--cf-bg2);border:1px solid var(--cf-line);font:inherit;font-size:11px;color:var(--cf-text);max-width:100%}
.bp-chips select option{color:#111}
.bp-storeys{margin:8px 0 0}
.bp-chip[aria-pressed=true]{background:var(--cf-accent);color:#1b2428;border-color:transparent}
.bp-table{width:100%;border-collapse:collapse;font-size:11px}
.bp-table th{font-size:9px;color:var(--cf-mute);font-weight:800;padding:2px 0;text-align:center}
.bp-table th:first-child,.bp-table td:first-child{text-align:left;max-width:128px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800}
.bp-table td{text-align:center;padding:3px 0;border-top:1px solid rgba(255,255,255,.06)}
.bp-table tr{cursor:pointer}
.bp-table tr[aria-selected=true] td{background:rgba(247,148,29,.16)}
.bp-yes{color:var(--cf-ok)}.bp-no{color:var(--cf-alert)}.bp-unk{color:var(--cf-mute)}
.bp-ms{display:flex;align-items:center;gap:7px;padding:3px 0;font-size:12px}
.bp-ms i{width:9px;height:9px;border-radius:50%;border:2px solid var(--cf-mute);flex:none}
.bp-ms[data-state=done]{color:var(--cf-mute);text-decoration:line-through}
.bp-ms[data-state=done] i{background:var(--cf-ok);border-color:var(--cf-ok)}
.bp-ms[data-state=current]{color:var(--cf-warn);font-weight:800}
.bp-ms[data-state=current] i{border-color:var(--cf-warn)}
.bp-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center;font-size:10.5px}
.bp-cal span{color:var(--cf-mute);font-size:9px;font-weight:800}
.bp-cal button{padding:3px 0 2px;border-radius:7px;background:var(--cf-bg2);border:1px solid transparent;text-align:center;min-height:30px}
.bp-cal button[data-today=true]{border-color:var(--cf-accent);color:var(--cf-accent);font-weight:900}
.bp-cal button[aria-pressed=true]{background:rgba(247,148,29,.25)}
.bp-cal em{display:flex;justify-content:center;gap:2px;height:5px;margin-top:2px}
.bp-cal em i{width:5px;height:5px;border-radius:50%;background:var(--cf-info)}
.bp-cal em i[data-tone=alert]{background:var(--cf-alert)}.bp-cal em i[data-tone=warn]{background:var(--cf-warn)}.bp-cal em i[data-tone=idle]{background:var(--cf-mute)}
.bp-posts{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.bp-post{padding:8px;border-radius:10px;background:var(--cf-bg2);border:1px solid var(--cf-line);font-size:11px;min-width:0}
.bp-post b{display:block;font-size:10.5px;margin-bottom:4px}
.bp-post .bp-img{height:54px;border-radius:7px;margin:6px 0;background:rgba(255,255,255,.08) center/cover;display:grid;place-items:center;color:var(--cf-mute);font-size:9.5px}
.bp-post p{margin:0 0 6px;font-weight:600;line-height:1.3}
.bp-post .cf-btn{height:26px;padding:0 8px;border-radius:8px;background:rgba(255,255,255,.08);border:1px solid var(--cf-line);font-size:10.5px;white-space:normal;justify-content:center}
.bp-flash{animation:bp-flash 1.4s ease-out}
@keyframes bp-flash{0%,40%{box-shadow:0 0 0 2px var(--cf-accent);background:rgba(247,148,29,.22)}100%{box-shadow:0 0 0 2px transparent}}
}
body.bp-open #cockpit-hud-root{display:none!important}
`;

// A clicked object whose own entry is not listed (filtered out, past the cap) focuses the list it belongs to.
const FOCUS_LIST = {agent: 'agents', project: 'projects', mission: 'missions', entry: 'ledger', post: 'posts', event: 'month'};

export class BuildingPanels {
  /**
   * @param {object} o
   * @param {object} o.dataConnector  the shared dataConnector
   * @param {object} o.frame          the CockpitFrame (shared look, money masking, dashboard links, building jumps)
   */
  constructor({dataConnector, frame}) {
    this.data = dataConnector;
    this.frame = frame;
    this.building = null;
    this.state = {};
    this.storeys = {count: 1, current: 0};   // storeys of the open building (setStoreys); onStorey(n) is called to show one
    this.onStorey = null;
    const style = document.createElement('style');
    style.id = 'building-panels-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
    const side = (cls, label) => {
      const el = document.createElement('div');
      el.className = `cf-side bp-side ${cls}`;
      el.setAttribute('role', 'complementary');
      el.setAttribute('aria-label', label);
      el.innerHTML = '<div class="cf-panel"><div class="cf-scroll"></div></div>';
      frame.root.appendChild(el);
      return el.querySelector('.cf-scroll');
    };
    this.left = side('bp-left', 'Tình trạng và việc cần anh');
    this.right = side('bp-right', 'Chi tiết để tra cứu');
    for (const el of [this.left, this.right]) {
      el.addEventListener('click', e => this.onClick(e));
      el.addEventListener('change', e => this.onChange(e));
    }
    this.setOpen(false);
  }

  /** Opens the panels for a building; returns false (panels closed) when it has no approved interior. */
  show(building) {
    if (building?.id !== this.building?.id) this.state = {};
    this.building = building;
    return this.render();
  }

  /** The storeys the open building offers, and the one on screen; more than one shows the storey buttons. */
  setStoreys(count, current) {
    this.storeys = {count, current};
    if (this.building) this.render();
  }

  hide() {
    this.building = null;
    this.setOpen(false);
  }

  /** Closed panels stay in the page for the slide animation, so they must not take clicks or focus. */
  setOpen(open) {
    this.frame.root.classList.toggle('bp-open', open);
    document.body.classList.toggle('bp-open', open);
    for (const el of [this.left, this.right]) el.closest('.bp-side').inert = !open;
  }

  render() {
    const v = this.building && this.data.getBuildingView(this.building);
    this.setOpen(!!v);
    if (!v) return false;
    this.view = v;
    const keep = [this.left.scrollTop, this.right.scrollTop];
    const {count, current} = this.storeys;
    const storeys = count > 1 ? `<div class="bp-chips bp-storeys" role="group" aria-label="Tầng đang xem">${Array.from({length: count}, (_, i) =>
      `<button class="bp-chip" data-storey="${i}" aria-pressed="${i === current}">Tầng ${i + 1}</button>`).join('')}</div>` : '';
    const head = `<h2 class="bp-title">${esc(v.title)}</h2><div class="bp-subtitle">${esc(v.subtitle)}</div>${storeys}`;
    if (!v.connected) {
      this.left.innerHTML = head + `<div class="cf-empty">Tòa này chưa có dữ liệu từ dashboard.</div>`;
      this.right.innerHTML = this.sec('Chi tiết') + `<div class="cf-empty">Chưa kết nối.</div>` + this.actions(this.open(v.page, 'Mở dashboard'));
      return true;
    }
    const [l, r] = this[v.type](v);
    this.left.innerHTML = head + l;
    this.right.innerHTML = `<div class="cf-h"><span>Chi tiết</span><small>bấm một dòng để mở đúng chỗ</small></div>` + r;
    this.left.scrollTop = keep[0];
    this.right.scrollTop = keep[1];
    return true;
  }

  /** Scrolls to and flashes the panel section an object clicked in the 3D room stands for. */
  focus(f) {
    if (!f) return;
    const root = this.frame.root;
    const el = (f.id != null && root.querySelector(`.bp-side [data-focus="${f.section}:${CSS.escape(String(f.id))}"]`))
      || root.querySelector(`.bp-side [data-focus="${f.section}"]`)
      || (FOCUS_LIST[f.section] && root.querySelector(`.bp-side [data-focus="${FOCUS_LIST[f.section]}"]`));
    if (!el) return;
    el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    el.classList.remove('bp-flash');
    void el.offsetWidth;
    el.classList.add('bp-flash');
    if (el.matches('tr[data-set]')) el.click();
  }

  // ---- pieces --------------------------------------------------------------------

  sec(title, note, focus) {
    return `<div class="bp-sec"${focus ? ` data-focus="${focus}"` : ''}><span>${esc(title)}</span>${note != null ? `<small>${esc(note)}</small>` : ''}</div>`;
  }

  tiles(items, cols = 2) {
    return `<div class="bp-tiles${cols === 3 ? ' bp-3' : ''}" data-focus="kpi">${items.map(t =>
      // --bp-len: text length in ems (bold digits are about 0.7em wide), so a long amount shrinks to fit instead of being cut off
      `<div class="bp-tile" data-tone="${t.tone || ''}"><small>${esc(t.label)}</small><b style="--bp-len:${(String(t.value ?? '').length * 0.7).toFixed(1)}">${t.value == null ? NONE : t.money ? esc(this.frame.money(t.value)) : esc(t.value)}</b></div>`).join('')}</div>`;
  }

  open(page, text, primary) {
    return page ? this.frame.link(page, text, 'cf-btn' + (primary ? ' cf-primary' : '')) : '';
  }

  actions(...buttons) {
    return `<div class="cf-actions">${buttons.join('')}</div>`;
  }

  mission(m, here) {
    const pr = PRIORITY[m.priority] || PRIORITY.low;
    const b = this.frame.target(m);
    const away = b && b.id !== this.building.id;
    const go = away ? '→ Đến tòa ' + esc(this.frame.label(b)) : here || '';
    return `<button class="cf-mission" data-tone="${pr.tone}" ${away ? `data-enter="${esc(b.id)}"` : 'disabled'} data-focus="mission:${esc(m.id)}">
      <span class="cf-row"><span class="cf-tag" data-tone="${pr.tone}">${pr.label}</span><span class="cf-proj cf-fill">${esc(m.project?.name || '')}</span>
        ${m.tag ? `<span class="cf-tag" data-tone="${m.tag === 'Cần Input' ? 'warn' : 'done'}">${esc(m.tag)}</span>` : ''}${m.time ? `<span class="cf-time">${esc(m.time)}</span>` : ''}</span>
      <span class="cf-title">${this.frame.text(m.title)}</span>${go ? `<span class="cf-go">${go}</span>` : ''}</button>`;
  }

  missions(list, title, empty, here) {
    return this.sec(title, list.length + ' việc', 'missions') + (list.map(m => this.mission(m, here)).join('') || `<div class="cf-empty">${empty}</div>`);
  }

  agents(list, empty) {
    return this.sec('Đang làm việc tại đây', null, 'agents') + (list.map(a => this.agent(a)).join('') || `<div class="cf-empty">${empty}</div>`);
  }

  agent(a) {
    return `<div class="cf-agent" data-focus="agent:${esc(a.id)}">
      <div class="cf-row"><b>${esc(a.name)}</b>${a.active ? '<span class="cf-tag" data-tone="ok">ACTIVE</span>' : ''}<span class="cf-fill"></span><span class="cf-time">${a.loadPct != null ? esc(a.loadPct) + '%' : 'chưa có dữ liệu'}</span></div>
      <p>${esc([a.role, a.task].filter(Boolean).join(' · '))}</p>
      <div class="cf-bar" data-tone="ok"><i style="width:${Math.max(0, Math.min(100, Number(a.loadPct) || 0))}%"></i></div></div>`;
  }

  // ---- one method per building type: returns [leftHtml, rightHtml] ------------------

  hq(v) {
    const {open, done} = v.allMissions;
    const left = this.sec('Tình trạng & việc cần anh') +
      this.tiles([{label: 'Việc cần hoàn thành', value: open.length, tone: open.length ? 'warn' : ''}, {label: 'Đã xong hôm nay', value: done.length}]) +
      this.missions(open, 'Nhiệm vụ', 'Không còn việc nào chờ anh.') +
      done.map(m => `<div class="cf-done">${this.frame.text(m.title)}${m.project ? ' (' + esc(m.project.name) + ')' : ''}</div>`).join('') +
      this.agents(v.agents, 'Chưa có agent nào được gán cho tòa AN PHIM.');
    const mismatch = v.runningKpi == null ? '' : `<div class="bp-box" data-tone="warn" style="margin-bottom:6px">Số liệu lệch nhau: chỉ số dashboard báo <b>${esc(v.runningKpi)}</b> dự án đang chạy, danh sách dự án có <b>${v.projects.length}</b> dự án ở trạng thái Đang làm.</div>`;
    const right = this.sec('Tổng quan dự án', v.projects.length + (v.runningKpi == null ? ' đang chạy' : ' trong danh sách'), 'projects') + mismatch + v.projects.map(p => {
      const b = this.frame.buildings.find(x => x.kind === 'project' && this.data.getProject(x.projectId)?.id === p.id);
      return `<button class="bp-rowbtn" data-focus="project:${esc(p.id)}" ${b ? `data-enter="${esc(b.id)}" title="→ Đến tòa ${esc(p.name)}"` : 'disabled title="Dự án này chưa có tòa trên campus"'}>
        <span class="cf-row"><b class="cf-fill">${esc(p.name)}</b><span class="bp-amt">${esc(this.frame.money(p.budgetFormatted))}</span></span>
        ${p.progress != null ? `<div class="cf-bar" data-tone="ok" style="margin:5px 0"><i style="width:${p.progress}%"></i></div>` : ''}
        <small>${esc(p.client)} · ${this.frame.text(p.nextaction || p.status)}</small></button>`;
    }).join('') + this.actions(this.open(v.page, 'Mở Tổng quan bên dashboard', true), this.open(v.schedulePage, 'Mở Lịch'));
    return [left, right];
  }

  bank(v) {
    const f = v.finance, st = this.state;
    const tab = st.tab || 'expenses';
    const left = this.sec('Tình trạng & việc cần anh') + this.tiles([
      {label: 'Tiền mặt sẵn có', value: f.cash, money: true}, {label: 'Khoản thu dự kiến', value: f.receivable, money: true},
      {label: 'Tổng chi tiêu', value: f.totalExpense, money: true, tone: 'warn'}, {label: 'Ước tính lợi nhuận', value: f.profit, money: true}]) +
      this.missions(v.missions, 'Cần anh xử lý', 'Không có khoản nào chờ anh.', 'Bổ sung bên trang Tài chính của dashboard') +
      this.agents(v.agents, 'Chưa có agent nào được gán cho Ngân hàng.') +
      this.sec('Phân bổ chi phí', 'theo danh mục', 'flow') + (f.categories.map(c => `<div class="cf-agent">
        <div class="cf-row"><b class="cf-fill">${esc(c.name)}</b><span class="cf-time">${esc(this.frame.money(c.amountFormatted))} · ${c.pct}%</span></div>
        <div class="cf-bar"><i style="width:${c.pct}%"></i></div></div>`).join('') || '<div class="cf-empty">Chưa có khoản chi nào.</div>');
    const all = tab === 'expenses' ? f.expenses : f.incomes;
    const filters = [['month', 'Tất cả tháng', e => String(e.date || '').slice(3)], ['project', 'Tất cả dự án', e => this.data.getProject(e.projectId)?.name],
      ['category', 'Tất cả danh mục', e => e.category], ['method', 'PT thanh toán', e => e.method]];
    const rows = all.filter(e => filters.every(([k, , get]) => !st[k] || get(e) === st[k]));
    const total = this.data.formatMoney(rows.reduce((s, e) => s + (Number(e.amount) || 0), 0));
    const right = `<div class="bp-chips" data-focus="ledger">
        <button class="bp-chip" data-set="tab" data-val="expenses" aria-pressed="${tab === 'expenses'}">Khoản chi (${f.expenses.length})</button>
        <button class="bp-chip" data-set="tab" data-val="incomes" aria-pressed="${tab === 'incomes'}">Khoản thu (${f.incomes.length})</button></div>
      <div class="bp-chips">${filters.map(([k, label, get]) => {
        const values = [...new Set(all.map(get).filter(Boolean))];
        return values.length ? `<select data-filter="${k}" aria-label="${label}"><option value="">${label}</option>${values.map(x => `<option${st[k] === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>` : '';
      }).join('')}</div>
      <div class="bp-subtitle">${tab === 'expenses' ? 'Tổng chi lọc' : 'Tổng thu lọc'}: <b>${esc(this.frame.money(total))}</b></div>
      ${rows.map(e => `<div class="bp-rowbtn" data-focus="entry:${esc(e.id)}"><span class="cf-row"><b class="cf-fill">${esc(e.description)}</b><span class="bp-amt" data-tone="${tab === 'expenses' ? 'out' : 'in'}">${esc(this.frame.money(e.amountFormatted))}</span></span>
        <small>${esc([e.date, e.category, e.method, this.data.getProject(e.projectId)?.name].filter(Boolean).join(' · '))}</small></div>`).join('') || '<div class="cf-empty">Không có khoản nào khớp bộ lọc.</div>'}
      ${this.sec('Theo dõi dòng tiền', 'Ngày · Tháng · Năm')}<div class="bp-subtitle">Biểu đồ thu chi theo ngày hiện trên màn hình tường; xem theo tháng hoặc năm bên dashboard.</div>
      ${this.actions(this.open(v.page, 'Mở Tài chính bên dashboard', true))}`;
    return [left, right];
  }

  documents(v) {
    const b = v.board;
    const sel = b.rows.find(r => r.project.id === this.state.project) || b.rows[0];
    const left = this.sec('Tình trạng & việc cần anh') + this.tiles([
      {label: 'Dự án thiếu giấy tờ', value: b.missingCount, tone: b.missingCount ? 'warn' : ''}, {label: 'Đầy đủ giấy tờ', value: b.completeCount},
      {label: 'Dự án chưa ký', value: b.unsignedCount, tone: b.unsignedCount ? 'alert' : ''}, {label: 'Hóa đơn chờ duyệt', value: b.invoicesPending}]) +
      this.missions(v.missions, 'Cần anh xử lý', 'Không có hồ sơ nào chờ anh.', 'Duyệt bên trang Giấy tờ của dashboard') +
      this.agents(v.agents, 'Chưa có agent nào được gán cho tòa Giấy tờ.');
    const mark = s => s === true ? '<span class="bp-yes">✓</span>' : s === false ? '<span class="bp-no">✗</span>' : '<span class="bp-unk">–</span>';
    const own = sel && this.frame.buildings.find(x => x.kind === 'project' && this.data.getProject(x.projectId) === sel.project);
    const right = this.sec('Bảng theo dõi hồ sơ', `${b.missingCount} thiếu · ${b.completeCount} đầy đủ`, 'board') +
      `<table class="bp-table" data-focus="missing"><tr><th>DỰ ÁN</th>${b.papers.map(p => `<th title="${esc(p.label)}">${esc(p.short)}</th>`).join('')}</tr>
        ${b.rows.map(r => `<tr data-set="project" data-val="${esc(r.project.id)}" aria-selected="${r === sel}" title="${esc(r.project.name)}"><td>${esc(r.project.name)}</td>${r.slots.map(s => `<td>${mark(s)}</td>`).join('')}</tr>`).join('')}</table>
      <div class="bp-subtitle">BG = Báo giá · HĐ = Hợp đồng · R1–R3 = VAT R1–R3 · ✗ = còn thiếu</div>` +
      (sel ? this.sec('Đang chọn: ' + sel.project.name, `${sel.project.client} · ${sel.known ? sel.have + '/' + b.papers.length + ' giấy tờ' : 'chưa kết nối'}`) +
        `<div class="bp-box" data-tone="${sel.missing.length ? 'warn' : ''}">${sel.missing.length ? 'Thiếu: ' + esc(sel.missing.join(', ')) : sel.complete ? 'Đầy đủ giấy tờ' : sel.known ? `Có ${sel.have}/${b.papers.length} giấy tờ, phần còn lại chưa có dữ liệu` : 'Chưa có dữ liệu giấy tờ của dự án này'}</div>
        <div class="bp-box" style="margin-top:6px">${sel.project.note ? this.frame.text(sel.project.note) : '<span class="bp-none">Chưa có ghi chú</span>'}</div>` : '') +
      this.actions(this.open(v.page, 'Mở Giấy tờ bên dashboard', true),
        sel?.project.driveUrl ? `<a class="cf-btn" href="${esc(sel.project.driveUrl)}" target="_blank" rel="noopener">Mở Drive của dự án ↗</a>` : '<span class="cf-btn" aria-disabled="true" title="Dự án chưa có link Drive trong dữ liệu">Mở Drive của dự án ↗</span>',
        own ? `<button class="cf-btn" data-enter="${esc(own.id)}">→ Đến tòa ${esc(sel.project.name)}</button>` : '');
    return [left, right];
  }

  project(v) {
    const p = v.project, ms = v.milestones;
    const docs = this.frame.byId.get('bld:facility:documents');
    const left = `<div class="bp-chips">${[p.client, p.type].filter(Boolean).map(x => `<span class="cf-tag" data-tone="done">${esc(String(x).toUpperCase())}</span>`).join('')}
        <span class="cf-tag" data-tone="${STATUS_TONE[p.status] || 'info'}">${esc(String(p.status || '').toUpperCase())}</span></div>` +
      this.tiles([{label: 'Tổng ngân sách', value: p.budgetFormatted, money: true}, {label: 'Đã nhận', value: p.receivedFormatted, money: true, tone: 'warn'},
        {label: 'Deadline', value: p.duedate}, {label: 'Mốc đã xong', value: ms.length ? `${v.doneCount}/${ms.length} · ${v.progress}%` : null}]) +
      this.sec('Việc cần làm tiếp theo', null, 'next') + `<div class="bp-box" data-tone="warn">${p.nextaction ? this.frame.text(p.nextaction) : '<span class="bp-none">Chưa có việc tiếp theo</span>'}</div>` +
      (v.missions.length ? this.missions(v.missions, 'Cần anh xử lý', '') : '') +
      this.sec('Giấy tờ', !v.papers?.known ? 'chưa kết nối' : v.papers.missing.length ? 'Thiếu ' + v.papers.missing.length : v.papers.complete ? 'Đầy đủ' : 'chưa đủ dữ liệu', 'papers') +
      `<button class="bp-rowbtn" ${docs ? `data-enter="${esc(docs.id)}"` : 'disabled'}><span class="cf-row"><span class="cf-fill">${v.papers?.missing.length ? 'Thiếu: ' + esc(v.papers.missing.join(', ')) : 'Báo giá · Hợp đồng · VAT R1–R3 · BBTL'}</span><span class="cf-go">→ Giấy tờ</span></span></button>` +
      this.sec('Ghi chú') + `<div class="bp-subtitle">${p.note ? this.frame.text(p.note) : 'Chưa có ghi chú.'}</div>`;
    const right = this.sec('Thanh toán', `đã nhận ${this.frame.money(p.receivedFormatted ?? '—')} / ${this.frame.money(p.budgetFormatted ?? '—')}`, 'payments') +
      `<div class="bp-box">${v.payments.map((x, i) => `<span class="cf-row"><span class="cf-fill">Đợt ${i + 1}</span><b class="bp-amt">${x == null ? NONE : esc(this.frame.money(x))}</b></span>`).join('')}</div>` +
      this.sec('Production milestones', ms.length ? `${v.doneCount}/${ms.length} mốc · ${v.progress}%` : 'chưa có mốc') +
      (ms.length ? `<div class="cf-bar" data-tone="ok" style="margin:0 0 6px"><i style="width:${v.progress}%"></i></div>` : '') +
      ms.map((m, i) => `<div class="bp-ms" data-state="${m.state}" data-focus="milestone:${i}"><i></i><span class="cf-fill">${esc(m.name)}</span><span class="cf-time">${esc(m.date || '')}</span></div>`).join('') +
      this.actions(this.open(v.page, 'Mở dự án bên dashboard', true),
        p.driveUrl ? `<a class="cf-btn" href="${esc(p.driveUrl)}" target="_blank" rel="noopener">Mở Drive ↗</a>` : '<span class="cf-btn" aria-disabled="true" title="Dự án chưa có link Drive trong dữ liệu">Mở Drive ↗</span>');
    return [left, right];
  }

  schedule(v) {
    const st = this.state, t = v.schedule;
    const s = st.ym ? this.data.getSchedule(st.ym[0], st.ym[1]) : t;
    const event = e => {
      const pr = PRIORITY[e.priority] || PRIORITY.low;
      const b = e.project && this.frame.buildings.find(x => x.kind === 'project' && this.data.getProject(x.projectId) === e.project);
      if (e.done) return `<div class="cf-done" data-focus="event:${esc(e.id)}">${esc(e.title)}${e.project ? ' (' + esc(e.project.name) + ')' : ''}</div>`;
      return `<button class="cf-mission" data-tone="${pr.tone}" ${b ? `data-enter="${esc(b.id)}"` : 'disabled'} data-focus="event:${esc(e.id)}">
        <span class="cf-row"><span class="cf-tag" data-tone="${pr.tone}">${pr.label}</span><span class="cf-proj cf-fill">${esc(e.project?.name || '')}</span><span class="cf-time">${esc(e.time || (e.dateEnd ? e.date.slice(0, 5) + '–' + e.dateEnd.slice(0, 5) : ''))}</span></span>
        <span class="cf-title">${esc(e.title)}</span>${b ? '<span class="cf-go">→ Đến tòa dự án</span>' : ''}</button>`;
    };
    const done = t.todayEvents.filter(e => e.done).length;
    const left = this.sec('Tình trạng & việc cần anh') + this.tiles([{label: 'Việc hôm nay', value: t.todayEvents.length}, {label: 'Đã xong', value: done}]) +
      this.sec('Hôm nay · ' + t.today.toLocaleDateString('vi-VN'), `${t.todayEvents.length} việc · đã xong ${done}`, 'today') +
      (t.todayEvents.map(event).join('') || '<div class="cf-empty">Hôm nay không có lịch.</div>') +
      this.agents(v.agents, 'Chưa có agent nào được gán cho tòa Lịch.');
    const lead = (new Date(s.year, s.month, 1).getDay() + 6) % 7;
    const picked = st.day && s.days.find(d => d.day === st.day);
    const right = `<div class="bp-chips" data-focus="month">
        <button class="bp-chip" data-month="-1" aria-label="Tháng trước">‹</button><span class="bp-chip" style="display:grid;place-items:center">Tháng ${s.month + 1}, ${s.year}</span>
        <button class="bp-chip" data-month="1" aria-label="Tháng sau">›</button><button class="bp-chip" data-month="0">Hôm nay</button></div>
      ${s.hasMonth ? '' : '<div class="bp-subtitle">Chưa kết nối lịch cả tháng: chỉ có việc của hôm nay.</div>'}
      <div class="bp-cal">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(n => `<span>${n}</span>`).join('')}${'<i></i>'.repeat(lead)}${s.days.map(d =>
        `<button data-set="day" data-val="${d.day}" data-today="${d.isToday}" aria-pressed="${st.day === d.day}">${d.day}<em>${d.events.slice(0, 4).map(e => `<i data-tone="${e.done ? 'idle' : (PRIORITY[e.priority] || PRIORITY.low).tone}"></i>`).join('')}</em></button>`).join('')}</div>` +
      (picked ? this.sec(`Ngày ${picked.day}/${s.month + 1}`, picked.events.length + ' việc') + (picked.events.map(event).join('') || '<div class="cf-empty">Không có lịch.</div>')
        : this.sec('Sắp tới', '7 ngày tới') + (t.upcoming.map(e => `<div class="bp-rowbtn" data-focus="event:${esc(e.id)}"><span class="cf-row"><span class="cf-fill">${esc(e.title)}${e.project ? ' (' + esc(e.project.name) + ')' : ''}</span><span class="cf-time">${esc(String(e.date).slice(0, 5))}</span></span></div>`).join('') || '<div class="cf-empty">Không có lịch trong 7 ngày tới.</div>')) +
      this.actions(this.open(v.page, 'Mở Lịch làm việc bên dashboard', true), this.open(v.page, 'Tạo lịch mới'));
    return [left, right];
  }

  ai(v) {
    const active = v.agents.filter(a => a.active).sort((a, b) => (b.loadPct || 0) - (a.loadPct || 0));
    const idle = v.agents.filter(a => !a.active);
    const left = this.sec('Tình trạng & việc cần anh') + this.tiles([{label: 'Agent', value: v.agents.length}, {label: 'Đang hoạt động', value: active.length},
      {label: 'Chưa có dữ liệu', value: idle.length, tone: idle.length ? 'warn' : ''}], 3) +
      this.sec('Đang hoạt động', 'xếp theo mức tải', 'agents') + (active.map(a => this.agent(a)).join('') || '<div class="cf-empty">Không có agent nào đang chạy.</div>');
    const right = this.sec('Chưa có dữ liệu tải', idle.length + ' agent') +
      (idle.map(a => `<div class="cf-agent" data-focus="agent:${esc(a.id)}"><div class="cf-row"><b class="cf-fill">${esc(a.name)}</b><span class="cf-time">Chưa có dữ liệu</span></div>
        <p>${esc(a.role)}</p><p>Việc đang làm hiện ở đây khi có dữ liệu</p><div class="cf-bar"><i style="width:0"></i></div></div>`).join('') || '<div class="cf-empty">Mọi agent đều có dữ liệu.</div>') +
      this.sec('Kênh chat với đội ngũ agent', null, 'chat') + '<div class="bp-subtitle">Bấm một agent ở bàn hoặc trong danh sách, rồi mở kênh chat với agent đó bên dashboard.</div>' +
      this.actions(this.open(v.chatPage, 'Mở kênh chat bên dashboard', true));
    return [left, right];
  }

  marketing(v) {
    const c = v.counts, posts = v.posts, f = this.state.status || 'pending';
    const left = this.sec('Tình trạng & việc cần anh') + this.tiles([{label: 'Tổng số bài', value: c.totalPosts}, {label: 'Chờ sếp duyệt', value: c.pendingApproval, tone: c.pendingApproval ? 'warn' : ''},
      {label: 'Đã duyệt (chờ đăng)', value: c.approvedQueued}, {label: 'Đã lên fanpage', value: c.published}]) +
      this.sec('Cần anh xử lý', (c.pendingApproval ?? 0) + ' bài', 'missions') + (c.pendingApproval ? `<div class="bp-box" data-tone="warn"><div class="cf-row"><span class="cf-tag" data-tone="warn">CHỜ DUYỆT</span><span class="cf-proj cf-fill">Fanpage AN PHIM</span><span class="cf-tag" data-tone="warn">Cần Input</span></div>
        <div class="cf-title">${esc(c.pendingApproval)} bài đang chờ sếp duyệt</div><span class="cf-go">Duyệt bên trang Marketing của dashboard</span></div>` : '<div class="cf-empty">Không có bài nào chờ duyệt.</div>') +
      this.agents(v.agents, 'Chưa có agent nào được gán cho Marketing.') +
      this.sec('Nguồn') + [['Chờ duyệt', c.pendingApproval], ['Đã duyệt, chờ đăng', c.approvedQueued], ['Đã lên fanpage', c.published]].map(([k, n]) =>
        `<div class="bp-rowbtn"><span class="cf-row"><span class="cf-fill">${k}</span><b>${esc(n ?? '—')}</b></span></div>`).join('');
    const right = this.sec('Bài viết fanpage (AN PHIM)', posts ? posts.length + ' bài' : 'chưa kết nối', 'posts') + (!posts ? '<div class="cf-empty">Chưa kết nối danh sách bài viết.</div>' :
      `<div class="bp-chips">${Object.entries(POST_STATUS).map(([k, s]) => `<button class="bp-chip" data-set="status" data-val="${k}" aria-pressed="${f === k}">${s.filter} (${posts.filter(p => p.status === k).length})</button>`).join('')}</div>
      <div class="bp-posts">${posts.filter(p => p.status === f).map(p => {
        const s = POST_STATUS[p.status];
        return `<div class="bp-post" data-focus="post:${esc(p.id)}"><b>${esc(p.page || '')}</b><span class="cf-tag" data-tone="${s.tone}">${s.label}</span>
          <div class="bp-img" ${p.image ? `style="background-image:url('${esc(p.image)}')"` : ''}>${p.image ? '' : 'Chưa có ảnh'}</div><p>${esc(p.title)}</p>
          ${p.status === 'pending' ? this.open(v.page, 'Duyệt bên dashboard') : p.status === 'approved' ? '<span class="cf-time">Chờ đăng</span>' : p.url ? `<a class="cf-btn" href="${esc(p.url)}" target="_blank" rel="noopener">Xem trên Facebook ↗</a>` : `<span class="cf-time">Đã đăng ${esc(p.date || '')}</span>`}</div>`;
      }).join('') || '<div class="cf-empty">Không có bài nào.</div>'}</div>`) + this.actions(this.open(v.page, 'Mở Marketing bên dashboard', true));
    return [left, right];
  }

  // ---- events --------------------------------------------------------------------

  onClick(e) {
    const storey = e.target.closest('[data-storey]');
    if (storey) return this.onStorey?.(+storey.dataset.storey);
    const month = e.target.closest('[data-month]');
    if (month) {
      const step = +month.dataset.month, t = this.data.getToday();
      const [y, m] = this.state.ym || [t.getFullYear(), t.getMonth()];
      const d = new Date(y, m + step, 1);
      this.state.ym = step ? [d.getFullYear(), d.getMonth()] : null;
      this.state.day = null;
      return this.render();
    }
    const set = e.target.closest('[data-set]');
    if (!set) return;
    const {set: key, val} = set.dataset;
    const value = key === 'day' ? +val : val;
    this.state[key] = key === 'day' && this.state.day === value ? null : value;
    if (key === 'tab') for (const k of ['month', 'project', 'category', 'method']) delete this.state[k];
    this.render();
  }

  onChange(e) {
    const key = e.target.dataset?.filter;
    if (!key) return;
    this.state[key] = e.target.value || null;
    this.render();
  }
}
