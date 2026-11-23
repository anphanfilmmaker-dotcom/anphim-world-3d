/**
 * data-connector.js
 * Centralized data bridge for AN PHIM World 3D Game Command Cockpit.
 * Ingests live Supabase metrics with local synchronous caching.
 *
 * Every panel and every 3D state reads through this class. Swapping the
 * snapshot for the production API only changes load() / _transformRawDb().
 */

const projectNumber = id => {
  const m = String(id).match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
};

const PRIORITY_ORDER = {high: 0, medium: 1, low: 2};

const SYSTEM_STATUS = {
  online: {label: 'Đang chạy', tone: 'ok'},
  slow: {label: 'Chậm', tone: 'warn'},
  down: {label: 'Ngừng chạy', tone: 'alert'}
};

/** Project status text -> the exterior state drawn on its building. */
const PROJECT_MODE = {
  'dang lam': 'building',
  'cho feedback': 'feedback',
  'can revise': 'revise',
  'tam dung': 'paused',
  'hoan thanh': 'done'
};

const plain = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').trim().toLowerCase();

/** "dd/mm/yyyy" or ISO -> Date at local midnight, or null. */
const parseDay = s => {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // Date-only ISO strings parse as UTC, which is the day before in zones west of it.
  const d = m ? new Date(+m[3], +m[2] - 1, +m[1]) : iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const DOC_OK = /^(signed|approved|done|ok|da ky|da duyet|hoan thanh|du)$/;

const PROJECT_TONE = {
  'Đang làm': 'ok',
  'Chờ feedback': 'warn',
  'Cần revise': 'alert',
  'Tạm dừng': 'alert',
  'Hoàn thành': 'done'
};

// Buildings with an approved interior (sketches 2-8), by full topology id. Project buildings go by kind.
const INTERIOR_TYPES = {
  'bld:facility:hq': 'hq',
  'bld:facility:bank': 'bank',
  'bld:facility:documents': 'documents',
  'bld:facility:schedule': 'schedule',
  'bld:facility:ai': 'ai',
  'bld:facility:marketing': 'marketing',
  'bld:facility:drive': 'drive',
  'bld:facility:hermes': 'hermes',
  'bld:facility:supabase': 'database',
  'bld:facility:oracle': 'oracle',
  'bld:facility:google': 'google',
  'bld:facility:telegram': 'telegram',
  'bld:facility:reserve': 'reserve'
};

// The four infrastructure buildings share one panel; the key is the system's id in the data.
const SYSTEM_TYPES = {database: 'supabase', oracle: 'oracle', google: 'google', telegram: 'telegram'};
const NOT_OK = /chua|khong|loi|that bai|fail|error/;

// The six papers the Giấy tờ page tracks per project, in table order.
const PAPERS = [
  {key: 'quote', short: 'BG', label: 'Báo giá'},
  {key: 'contract', short: 'HĐ', label: 'Hợp đồng'},
  {key: 'vat1', short: 'R1', label: 'VAT R1'},
  {key: 'vat2', short: 'R2', label: 'VAT R2'},
  {key: 'vat3', short: 'R3', label: 'VAT R3'},
  {key: 'handover', short: 'BBTL', label: 'BBTL'}
];

/** "dd/mm/yyyy" -> local-midnight timestamp (NaN when unreadable). */
const dateKey = text => {
  const m = String(text || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : NaN;
};

export class DataConnector {
  constructor() {
    this.cache = null;
    this.lastFetched = null;
    this.ttl = 30000; // 30s cache TTL
    this.source = 'offline'; // 'snapshot' | 'api' | 'offline'
    this.listeners = new Set();
  }

  async load() {
    if (this.cache && (Date.now() - this.lastFetched < this.ttl)) {
      return this.cache;
    }

    try {
      // 1. First try static live snapshot generated directly from Supabase
      const res = await fetch('./live_campus_data.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        console.log('[DataConnector] Loaded live Supabase snapshot successfully.');
        return this._store(data, 'snapshot');
      }
    } catch (err) {
      console.warn('[DataConnector] Failed to fetch live snapshot, falling back:', err);
    }

    // 2. Fallback to express API if running
    try {
      const res = await fetch('/api/db');
      if (res.ok) {
        const raw = await res.json();
        return this._store(this._transformRawDb(raw), 'api');
      }
    } catch (err) {
      console.warn('[DataConnector] API fallback unavailable:', err);
    }

    return this.cache || this._getDefaults();
  }

  /** Calls fn() whenever a load brings in data that differs from the cache. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Where the numbers on screen come from, for the "DB" light. */
  getDataStatus() {
    return {source: this.cache ? this.source : 'offline', updatedAt: this.cache?.updatedAt || null};
  }

  getKPI() {
    return this.cache?.kpi || this._getDefaults().kpi;
  }

  getRecentExpenses() {
    return this.cache?.recentExpenses || [];
  }

  getAllExpenses() {
    return this.cache?.allExpenses || [];
  }

  getAllIncomes() {
    return this.cache?.allIncomes || [];
  }

  getDailyBriefing() {
    return this.cache?.dailyBriefing || {
      tramanh: {
        activeProjectsSummary: "Đang có 8 dự án đang chạy tiến độ.",
        pendingActionsSummary: "1 việc cần Sếp ra quyết định.",
        highlights: []
      },
      hermes: {
        systemStatus: "Hoạt động bình thường (24/7)",
        mailScanStatus: "0 email lạ chưa phân loại",
        dbLatency: "42ms (Supabase PostgreSQL)",
        backupStatus: "Đã sao lưu tự động"
      }
    };
  }

  getProjects() {
    return this.cache?.projects || [];
  }

  getProject(id) {
    if (id == null) return null;
    const n = projectNumber(id);
    return this.getProjects().find(p => p.id === id || (n !== null && projectNumber(p.id) === n)) || null;
  }

  /**
   * Clients, one district each: {id, name, aliases, kind}. kind 'internal' is AN PHIM
   * itself, whose projects stay in the main campus. A client that only appears as text on a
   * project is listed too, after the declared ones, so a new client needs no code change.
   */
  getClients() {
    const out = (this.cache?.clients || []).map(c => ({aliases: [], kind: 'client', ...c}));
    const known = c => out.some(x => [x.id, x.name, ...x.aliases].some(n => plain(n) === plain(c)));
    for (const p of this.getProjects()) {
      if (p.client && !known(p.client)) {
        const base = plain(p.client).replace(/[^a-z0-9]+/g, '-');
        let id = base;
        for (let n = 2; out.some(x => x.id === id); n++) id = base + '-' + n;
        out.push({id, name: p.client, aliases: [], kind: 'client'});
      }
    }
    return out;
  }

  /** A client by id, name or alias ("Winterland87" finds K87K). */
  getClient(key) {
    const k = plain(key);
    if (!k) return null;
    return this.getClients().find(c => [c.id, c.name, ...c.aliases].some(n => plain(n) === k)) || null;
  }

  getProjectClient(project) {
    return this.getClient(project?.client);
  }

  /** A client's projects in data order, which is the order they take lots in the district. */
  getClientProjects(key) {
    const client = this.getClient(key);
    if (!client) return [];
    return this.getProjects().filter(p => this.getProjectClient(p)?.id === client.id);
  }

  /** Share of production milestones done, 0-100, or null when the project has none. */
  getProjectProgress(project) {
    const ms = project?.milestones || [];
    if (!ms.length) return null;
    return Math.round(ms.filter(m => m.completed).length / ms.length * 100);
  }

  /**
   * What the outside of a project's building shows.
   * mode: 'building' | 'feedback' | 'revise' | 'paused' | 'done' | null (unknown status);
   * progress: milestone percentage or null; overdueDays: days past the deadline (0 when on time or done).
   */
  getProjectState(project, now = new Date()) {
    if (!project) return null;
    const ms = project.milestones || [];
    const mode = PROJECT_MODE[plain(project.status)] || null;
    const due = parseDay(project.duedate || project.dueDate);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const late = due && mode !== 'done' ? Math.round((today - due) / 86400000) : 0;
    return {
      projectId: project.id,
      status: project.status || '',
      mode,
      progress: this.getProjectProgress(project),
      milestonesDone: ms.filter(m => m.completed).length,
      milestonesTotal: ms.length,
      overdueDays: Math.max(0, late),
      missingDocs: (project.documents || []).filter(d => !DOC_OK.test(plain(d.status))).length
    };
  }

  /** Actions the owner must take: {open, done}, open sorted by priority then time. */
  getMissions() {
    const all = (this.cache?.missions || []).map(m => ({...m, project: this.getProject(m.projectId)}));
    const open = all.filter(m => !m.done).sort((a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
      String(a.time || '99').localeCompare(String(b.time || '99')));
    return {open, done: all.filter(m => m.done)};
  }

  /** Open missions per building id. */
  getMissionCounts() {
    const counts = new Map();
    for (const m of this.getMissions().open) {
      if (m.buildingId) counts.set(m.buildingId, (counts.get(m.buildingId) || 0) + 1);
    }
    return counts;
  }

  getNotifications() {
    return this.cache?.notifications || [];
  }

  getAgents() {
    return this.cache?.aiWorkforce || [];
  }

  getSystems() {
    return this.cache?.systems || [];
  }

  getScheduleToday() {
    return this.cache?.scheduleToday || [];
  }

  getMarketing() {
    return this.cache?.marketing || null;
  }

  // ---- building interiors ------------------------------------------------------

  /** Money in the dashboard's format ("3.200.000 đ"), or null when the amount is unknown. */
  formatMoney(amount) {
    return typeof amount === 'number' && isFinite(amount) ? Math.round(amount).toLocaleString('vi-VN') + ' đ' : null;
  }

  /** The day the data describes, as a Date at local midnight: the snapshot's updatedAt, else now. */
  getToday() {
    const d = this.cache?.updatedAt ? new Date(this.cache.updatedAt) : new Date();
    const day = isNaN(d) ? new Date() : d;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate());
  }

  /**
   * Which approved interior a building gets, from its full id / legacyId / kind in the topology:
   * 'hq' | 'bank' | 'project' | 'documents' | 'schedule' | 'ai' | 'marketing', or null when the
   * building has no approved interior yet.
   */
  getBuildingType(building) {
    if (!building) return null;
    if (building.kind === 'project') return 'project';
    return INTERIOR_TYPES[building.id] || null;
  }

  /** Agents assigned to a building (agent.buildingIds, or the single agent.buildingId). */
  getAgentsAt(buildingId) {
    return this.getAgents().filter(a => (a.buildingIds || [a.buildingId]).includes(buildingId));
  }

  /** Running projects, by the dashboard's rule: "Dự án đang chạy" counts status "Đang làm" only. */
  getRunningProjects() {
    return this.getProjects().filter(p => PROJECT_MODE[plain(p.status)] === 'building');
  }

  /**
   * Finance page: totals, the newest expenses and incomes, spending per category and the daily
   * cash flow. Totals that the data does not carry are null, never computed from thin air.
   */
  getFinance() {
    const kpi = this.getKPI();
    const byDate = (a, b) => dateKey(b.date) - dateKey(a.date);
    const expenses = [...this.getAllExpenses()].sort(byDate);
    const incomes = [...this.getAllIncomes()].sort(byDate);
    const sum = list => list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const totalExpense = expenses.length ? sum(expenses) : null;
    const cats = new Map();
    for (const e of expenses) cats.set(e.category || 'Khác', (cats.get(e.category || 'Khác') || 0) + (Number(e.amount) || 0));
    const categories = [...cats].map(([name, amount]) => ({
      name, amount, amountFormatted: this.formatMoney(amount), pct: totalExpense ? Math.round(amount / totalExpense * 100) : 0
    })).sort((a, b) => b.amount - a.amount);
    const days = new Map();
    const day = d => days.get(d) || days.set(d, {date: d, income: 0, expense: 0}).get(d);
    for (const e of expenses) if (e.date) day(e.date).expense += Number(e.amount) || 0;
    for (const i of incomes) if (i.date) day(i.date).income += Number(i.amount) || 0;
    return {
      cash: kpi.cashAvailableFormatted ?? null,
      receivable: kpi.receivableFormatted ?? null,
      totalExpense: this.formatMoney(totalExpense),
      profit: kpi.estimatedProfitFormatted ?? null,
      expenses, incomes, categories,
      flow: [...days.values()].sort((a, b) => dateKey(a.date) - dateKey(b.date))
    };
  }

  /**
   * Documents page: one row per project with the six papers the dashboard tracks.
   * slots[i] is true (have), false (missing) or null (the data does not say). A row is complete
   * only when all six are true, so a paper the data does not mention never counts as held.
   */
  getDocumentBoard() {
    const rows = this.getProjects().map(p => {
      const slots = PAPERS.map(d => typeof p.paperwork?.[d.key] === 'boolean' ? p.paperwork[d.key] : null);
      const known = slots.some(s => s !== null);
      return {
        project: p, slots, known,
        complete: slots.every(s => s === true),
        have: slots.filter(s => s === true).length,
        missing: PAPERS.filter((d, i) => slots[i] === false).map(d => d.label),
        signed: p.paperwork?.contract ?? null
      };
    });
    const known = rows.filter(r => r.known);
    const invoices = this.cache?.kpi?.invoicesPendingCount;
    return {
      papers: PAPERS,
      rows: [...rows].sort((a, b) => b.missing.length - a.missing.length),
      connected: known.length > 0,
      missingCount: known.filter(r => r.missing.length).length,
      completeCount: known.filter(r => r.complete).length,
      unsignedCount: known.filter(r => r.signed === false).length,
      invoicesPending: invoices ?? null
    };
  }

  /** Every calendar event: the month schedule when the data has one, else today's list. */
  getScheduleEvents() {
    const today = this.getToday();
    const fallback = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const raw = this.cache?.schedule || this.getScheduleToday().map(e => ({...e, date: fallback(today)}));
    return raw.map(e => ({...e, project: this.getProject(e.projectId)}));
  }

  /** Calendar page: today's events, the next 7 days and the events of one month (default: this month). */
  getSchedule(year, month) {
    const today = this.getToday();
    const todayKey = today.getTime();
    const y = year ?? today.getFullYear();
    const m = month ?? today.getMonth();
    const events = this.getScheduleEvents();
    const covers = (e, key) => {
      const start = dateKey(e.date);
      const end = e.dateEnd ? dateKey(e.dateEnd) : start;
      return key >= start && key <= end;
    };
    const order = (a, b) => dateKey(a.date) - dateKey(b.date) || String(a.time || '99').localeCompare(String(b.time || '99'));
    const days = [];
    const count = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= count; d++) {
      const key = new Date(y, m, d).getTime();
      days.push({day: d, key, isToday: key === todayKey, events: events.filter(e => covers(e, key)).sort(order)});
    }
    return {
      today, year: y, month: m, days,
      hasMonth: !!this.cache?.schedule,
      todayEvents: events.filter(e => covers(e, todayKey)).sort(order),
      upcoming: events.filter(e => dateKey(e.date) > todayKey && dateKey(e.date) <= todayKey + 7 * 864e5).sort(order)
    };
  }

  /** Fanpage posts with status 'pending' | 'approved' | 'published'; null when the data has no post list. */
  getMarketingPosts() {
    return this.cache?.marketing?.posts || null;
  }

  /** The campus hands over system-graph.json (which building relies on which system) once it has read it. */
  setSystemGraph(graph) {
    this.systemGraph = graph || null;
  }

  /** Buildings linked to a system building in system-graph.json: [{id, label}], the system itself left out. */
  getSystemLinks(buildingId) {
    const infra = new Set(this.getSystems().map(x => x.buildingId));
    const links = new Map();
    for (const e of this.systemGraph?.edges || []) {
      // Between two systems the edge runs from the one that hosts to the one that is hosted; any other building on an edge uses the system
      const other = e.source === buildingId ? e.target : e.target === buildingId && !infra.has(e.source) ? e.source : null;
      if (other && !links.has(other)) links.set(other, {id: other, label: e.label || ''});
    }
    return [...links.values()];
  }

  /** State of one system from the data: {key: 'online' | 'slow' | 'down' | null, label, tone, detail, lastCheck}; key null = no data. */
  getSystemState(id) {
    const sys = this.getSystems().find(x => x.id === id);
    const st = sys && SYSTEM_STATUS[sys.status];
    return {key: st ? sys.status : null, label: st ? st.label : 'Chưa kết nối', tone: st ? st.tone : 'idle', name: sys?.name || null,
      detail: sys?.detail || null, lastCheck: sys?.lastCheck || null, adminUrl: sys?.adminUrl || null};
  }

  /**
   * Hermes: the robot runs on the Oracle server, so it is running when that server is; `hermes.status` in the
   * data wins when it is there. inputs = expenses the mail scan could not complete, posts = what Hermes wrote.
   */
  getHermes() {
    const h = this.cache?.dailyBriefing?.hermes || null;
    const host = this.getSystemState('oracle');
    const own = h && SYSTEM_STATUS[h.status];
    const state = own ? {key: h.status, label: own.label, tone: own.tone} : {key: h ? host.key : null, label: h ? host.label : 'Chưa kết nối', tone: h ? host.tone : 'idle'};
    const expenses = this.getAllExpenses();
    const inputs = this.getMissions().open.filter(m => m.source === 'hermes-mail-scan').map(m => {
      const expense = expenses.find(e => e.id === m.expenseId) || null;
      return {id: m.id, mission: m, expense, project: this.getProject(expense?.projectId || m.projectId)};
    });
    const posts = (this.getMarketingPosts() || []).filter(p => plain(p.author) === 'hermes');
    return {
      state, running: state.key === 'online' || state.key === 'slow', statusText: h?.systemStatus || null, mailScan: h?.mailScanStatus || null,
      inputs, posts: this.getMarketingPosts() ? posts : null, pendingPosts: this.getMarketingPosts() ? posts.filter(p => p.status === 'pending') : null,
      backup: h?.backupStatus || null, backupOk: h?.backupStatus ? !NOT_OK.test(plain(h.backupStatus)) : null, dbLatency: h?.dbLatency || null, host
    };
  }

  /** Kho Drive: every project by client, with whether it has a Drive folder (project.driveUrl). */
  getDriveBoard() {
    const projects = this.getProjects().map(p => ({
      ...p, hasDrive: !!p.driveUrl, mode: PROJECT_MODE[plain(p.status)] || null, finished: PROJECT_MODE[plain(p.status)] === 'done', files: p.documents || []
    }));
    const groups = new Map();
    for (const p of projects) (groups.get(p.client || 'Khác') || groups.set(p.client || 'Khác', []).get(p.client || 'Khác')).push(p);
    return {
      projects, total: projects.length, withDrive: projects.filter(p => p.hasDrive).length, missing: projects.filter(p => !p.hasDrive).length,
      storage: this.cache?.drive?.storageUsed ?? null,
      groups: [...groups].map(([client, list]) => ({client, projects: list})).sort((a, b) => b.projects.length - a.projects.length),
      statuses: [...new Set(projects.map(p => p.status).filter(Boolean))]
    };
  }

  /**
   * Everything one building's interior shows, used by both the side panels and the 3D room so the
   * two can never disagree. `building` is the topology entry. Returns null for a building with no
   * approved interior. Shape: {type, id, title, subtitle, page, connected, missions, agents, ...type data}.
   */
  getBuildingView(building) {
    const type = this.getBuildingType(building);
    if (!type) return null;
    const missions = this.getMissions();
    const mine = missions.open.filter(m => m.buildingId === building.id);
    const agent = a => ({...a, active: a.status === 'active'});
    const view = {
      type, id: building.id, title: building.name, subtitle: '', connected: !!this.cache,
      page: this.getBuildingPage(building),
      missions: mine,
      agents: this.getAgentsAt(building.id).map(agent)
    };

    if (type === 'hq') {
      view.title = 'AN PHIM (HQ)';
      view.subtitle = 'Trung tâm điều phối · theo tab Tổng quan';
      view.allMissions = missions;
      view.inputCount = missions.open.filter(m => m.tag === 'Cần Input').length;
      view.projects = this.getRunningProjects().map(p => ({...p, progress: this.getProjectProgress(p)}));
      // The top bar shows the dashboard's own "Dự án đang chạy" KPI; the list below is counted from the
      // project list. When the two disagree the room and the panel say so instead of showing two numbers.
      const kpiCount = Number(this.cache?.kpi?.activeProjectsCount);
      view.runningKpi = Number.isFinite(kpiCount) && kpiCount !== view.projects.length ? kpiCount : null;
      view.schedulePage = this.getWorkspacePage('schedule');
    } else if (type === 'bank') {
      view.subtitle = 'Thu chi và dòng tiền · theo tab Tài chính';
      view.finance = this.getFinance();
      view.inputs = mine.filter(m => m.tag === 'Cần Input');
    } else if (type === 'documents') {
      view.subtitle = 'Hồ sơ pháp lý từng dự án · theo tab Giấy tờ';
      view.board = this.getDocumentBoard();
      view.connected = view.connected && view.board.connected;
    } else if (type === 'schedule') {
      view.title = 'Lịch làm việc';
      view.subtitle = 'Lịch theo dự án · theo tab Lịch làm việc';
      view.schedule = this.getSchedule();
    } else if (type === 'ai') {
      view.subtitle = 'Agent và việc đang làm · theo AI Workforce Trace';
      view.agents = this.getAgents().map(agent);
      view.chatPage = this.getWorkspacePage('marketing');
    } else if (type === 'marketing') {
      view.subtitle = 'Bài fanpage · theo tab Marketing';
      view.counts = this.getMarketing();
      view.posts = this.getMarketingPosts();
      view.connected = view.connected && !!view.counts;
    } else if (type === 'drive') {
      view.facility = true;
      view.subtitle = 'Thư mục Drive từng dự án · theo tab Giấy tờ';
      view.drive = this.getDriveBoard();
    } else if (type === 'hermes') {
      view.facility = true;
      view.subtitle = 'Robot quét mail và soạn bài · theo tab Tổng quan';
      view.hermes = this.getHermes();
      view.bankId = 'bld:facility:bank';
      view.marketingId = 'bld:facility:marketing';
      view.hostId = 'bld:facility:oracle';
    } else if (SYSTEM_TYPES[type]) {
      const key = SYSTEM_TYPES[type];
      view.facility = true;
      view.system = this.getSystemState(key);
      view.subtitle = view.system.name ? 'Hạ tầng · ' + view.system.name : 'Hạ tầng';
      view.serves = this.getSystemLinks(building.id);
      view.working = view.agents.some(a => a.active);
      if (type === 'database') {
        const h = this.getHermes(), st = this.getDataStatus();
        view.source = st.source;
        view.updatedAt = st.updatedAt;
        view.latency = h.dbLatency;
        view.backup = h.backup;
        view.backupOk = h.backupOk;
      } else if (type === 'oracle') {
        view.services = [
          {id: 'hermes', name: 'Hermes', buildingId: 'bld:facility:hermes', state: this.getHermes().state},
          {id: 'telegram', name: 'Telegram Bot', buildingId: 'bld:facility:telegram', state: this.getSystemState('telegram')}
        ];
      } else if (type === 'google') {
        // The data has one status for Drive and Gmail together
        view.services = [{id: 'drive', name: 'Drive', buildingId: 'bld:facility:drive', state: view.system}, {id: 'gmail', name: 'Gmail', state: view.system}];
      } else {
        view.lastMessage = this.cache?.telegram?.lastMessage ?? null;
        view.lastCommand = this.cache?.telegram?.lastCommand ?? null;
      }
    } else if (type === 'reserve') {
      // No data source for savings yet: the panels say so and the vault stays shut
      view.facility = true;
      view.connected = false;
      view.subtitle = 'Quỹ dự trữ và tiền tiết kiệm';
      view.bankId = 'bld:facility:bank';
      view.financePage = this.getWorkspacePage('finance');
    } else if (type === 'project') {
      const p = this.getProject(building.projectId || building.id);
      view.project = p;
      view.connected = !!p;
      if (p) {
        const ms = p.milestones || [];
        const current = ms.findIndex(m => !m.completed);
        view.title = p.name;
        view.subtitle = 'Tòa dự án · theo tab Dự án';
        view.page = this.getWorkspacePage('projects');
        view.milestones = ms.map((m, i) => ({...m, state: m.completed ? 'done' : i === current ? 'current' : 'todo'}));
        view.doneCount = ms.filter(m => m.completed).length;
        view.progress = this.getProjectProgress(p);
        view.state = this.getProjectState(p);
        view.payments = [p.paymentd1, p.paymentd2, p.paymentd3].map(v => typeof v === 'number' ? this.formatMoney(v) : null);
        view.receivedPct = p.budget > 0 && typeof p.received === 'number' ? Math.round(p.received / p.budget * 100) : null;
        view.papers = this.getDocumentBoard().rows.find(r => r.project === p) || null;
        view.missions = missions.open.filter(m => m.buildingId === building.id || (m.projectId && this.getProject(m.projectId) === p));
      }
    }
    return view;
  }

  /** Workspace dashboard page: {key, label, url}; url is null until workspace.baseUrl is set. */
  getWorkspacePage(key) {
    const ws = this.cache?.workspace;
    const page = ws?.pages?.[key];
    if (!page) return null;
    const base = (ws.baseUrl || '').replace(/\/+$/, '');
    return {key, label: page.label, url: base ? base + (page.path || '') : null};
  }

  /** The dashboard page a building stands for. */
  getBuildingPage(building) {
    if (!building) return null;
    if (building.kind === 'project') return this.getWorkspacePage('projects');
    const key = this.cache?.workspace?.buildingPages?.[building.id];
    return key ? this.getWorkspacePage(key) : null;
  }

  /**
   * One card of facts for a building, used by the hover card on the campus view.
   * `building` is the topology entry ({id, legacyId, kind, projectId, name}).
   * Returns {id, title, subtitle, status: {label, tone}, progress, facts: [{label, value, money}],
   * next, missionCount, connected, page}.
   */
  getBuildingSummary(building) {
    if (!building) return null;
    const kpi = this.getKPI();
    const missions = this.getMissions().open.filter(m => m.buildingId === building.id);
    const card = {
      id: building.id,
      title: building.name,
      subtitle: '',
      status: null,
      progress: null,
      facts: [],
      next: missions[0]?.title || null,
      missionCount: missions.length,
      connected: true,
      page: this.getBuildingPage(building)
    };
    const needsYou = missions.length
      ? {label: missions.length + ' việc cần anh', tone: 'warn'}
      : {label: 'Ổn', tone: 'ok'};
    const key = building.legacyId || building.id;

    if (building.kind === 'project') {
      const p = this.getProject(building.projectId || building.id);
      if (!p) return {...card, connected: false};
      card.title = p.name;
      card.subtitle = p.client;
      card.status = {label: p.status, tone: PROJECT_TONE[p.status] || 'info'};
      card.progress = this.getProjectProgress(p);
      card.facts = [
        {label: 'Deadline', value: p.duedate},
        {label: 'Ngân sách', value: p.budgetFormatted, money: true},
        {label: 'Đã nhận', value: p.receivedFormatted, money: true}
      ];
      card.next = p.nextaction || card.next;
      return card;
    }

    switch (key) {
      case 'hq':
        card.subtitle = 'Tổng quan';
        card.status = needsYou;
        card.facts = [
          {label: 'Dự án đang chạy', value: kpi.activeProjectsCount},
          {label: 'Việc chờ anh quyết định', value: kpi.pendingActionsCount},
          {label: 'Tiền mặt sẵn có', value: kpi.cashAvailableFormatted, money: true}
        ];
        return card;
      case 'bank': {
        const exp = this.getRecentExpenses()[0];
        const inc = this.getAllIncomes()[0];
        card.subtitle = 'Tài chính';
        card.status = needsYou;
        card.facts = [
          {label: 'Tiền mặt sẵn có', value: kpi.cashAvailableFormatted, money: true},
          {label: 'Khoản thu dự kiến', value: kpi.receivableFormatted, money: true}
        ];
        if (exp) card.facts.push({label: 'Chi gần nhất · ' + exp.description, value: exp.amountFormatted, money: true});
        if (inc) card.facts.push({label: 'Thu gần nhất · ' + inc.description, value: inc.amountFormatted, money: true});
        return card;
      }
      case 'documents': {
        const missing = kpi.missingDocumentsCount;
        card.subtitle = 'Giấy tờ';
        card.status = missing > 0 ? {label: 'Thiếu: ' + missing, tone: 'warn'} : needsYou;
        card.facts = [
          {label: 'Dự án thiếu giấy tờ', value: missing},
          {label: 'Dự án đang theo dõi', value: this.getProjects().length}
        ];
        return card;
      }
      case 'drive':
        card.subtitle = 'Thư mục Drive theo dự án';
        card.status = {label: 'Lối tắt', tone: 'info'};
        card.facts = [{label: 'Thư mục dự án', value: this.getProjects().length}];
        return card;
      case 'schedule': {
        const events = this.getScheduleToday();
        const upcoming = events.find(e => !e.done);
        card.subtitle = 'Lịch làm việc';
        card.status = {label: events.length + ' việc hôm nay', tone: events.length ? 'info' : 'ok'};
        card.facts = events.slice(0, 3).map(e => ({label: e.title, value: e.time || ''}));
        card.next = upcoming ? upcoming.title : card.next;
        return card;
      }
      case 'ai': {
        const agents = this.getAgents();
        const active = agents.filter(a => a.status === 'active');
        card.subtitle = 'AI Workforce Trace';
        card.status = {label: active.length + '/' + agents.length + ' agent đang chạy', tone: active.length ? 'ok' : 'idle'};
        card.facts = active.map(a => ({label: a.name + ' · ' + (a.task || a.role), value: a.loadPct != null ? a.loadPct + '%' : ''}));
        return card;
      }
      case 'hermes': {
        const h = this.cache?.dailyBriefing?.hermes;
        if (!h) return {...card, connected: false};
        card.subtitle = 'Quét mail & tự động hóa';
        card.status = needsYou;
        card.facts = [
          {label: 'Hệ thống', value: h.systemStatus},
          {label: 'Quét mail', value: h.mailScanStatus},
          {label: 'Sao lưu', value: h.backupStatus}
        ];
        return card;
      }
      default: {
        const sys = this.getSystems().find(s => s.buildingId === building.id);
        if (!sys) return {...card, connected: false};
        card.subtitle = sys.name;
        card.status = SYSTEM_STATUS[sys.status] || {label: sys.status, tone: 'info'};
        card.facts = [
          {label: 'Chi tiết', value: sys.detail},
          {label: 'Kiểm tra gần nhất', value: sys.lastCheck}
        ];
        return card;
      }
    }
  }

  /** Projects, clients and missions matching a search string. */
  search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const hit = (...texts) => texts.some(t => String(t || '').toLowerCase().includes(q));
    const out = [];
    for (const p of this.getProjects()) {
      if (hit(p.name, p.client, ...(this.getProjectClient(p)?.aliases || []))) out.push({type: 'project', label: p.name, sub: p.client + ' · ' + p.status, projectId: p.id});
      for (const doc of p.documents || []) {
        if (hit(doc.title)) out.push({type: 'document', label: doc.title, sub: p.name + ' · ' + doc.status, projectId: p.id});
      }
    }
    for (const m of [...this.getMissions().open, ...this.getMissions().done]) {
      if (hit(m.title)) out.push({type: 'mission', label: m.title, sub: m.project?.name || m.tag || '', buildingId: m.buildingId});
    }
    return out;
  }

  /** Maps the production API response onto the snapshot schema. The API is expected to return it as is. */
  _transformRawDb(raw) {
    return raw;
  }

  _store(data, source) {
    const changed = source !== this.source || JSON.stringify(data) !== JSON.stringify(this.cache);
    this.cache = data;
    this.source = source;
    this.lastFetched = Date.now();
    if (changed) this.listeners.forEach(fn => fn());
    return this.cache;
  }

  // No data yet: show dashes, never invented numbers.
  _getDefaults() {
    return {
      kpi: {
        cashAvailableFormatted: '—',
        receivableFormatted: '—',
        activeProjectsCount: '—',
        missingDocumentsCount: '—',
        pendingActionsCount: '—'
      },
      projects: [],
      recentExpenses: [],
      allExpenses: [],
      allIncomes: [],
      dailyBriefing: {}
    };
  }
}

export const dataConnector = new DataConnector();
