/**
 * data-connector.js
 * Centralized data bridge for AN PHIM World 3D Game Command Cockpit.
 * Ingests live Supabase metrics with local synchronous caching.
 *
 * Every panel and every 3D state reads through this class. Swapping the
 * snapshot for the production API only changes load() / _transformRawDb().
 * What the data must look like: data-contract.js (listed in DATA_CONTRACT.md).
 */
import {validateCampusData} from './data-contract.js';

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://oislnuutvszpziuzepuk.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pc2xudXV0dnN6cHppdXplcHVrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0MjA3NjksImV4cCI6MjExMDk5Njc2OX0.MhjQ5q9hheoIO2XvgWKN162lpVvgMJRIc0ulwsnLZCg';

export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

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
  'bld:facility:marketing': 'marketing'
};

// The six papers the Giấy tờ page tracks per project, in table order.
const PAPERS = [
  {key: 'quote', short: 'BG', label: 'Báo giá'},
  {key: 'contract', short: 'HĐ', label: 'Hợp đồng'},
  {key: 'vat1', short: 'R1', label: 'VAT R1'},
  {key: 'vat2', short: 'R2', label: 'VAT R2'},
  {key: 'vat3', short: 'R3', label: 'VAT R3'},
  {key: 'handover', short: 'BBTL', label: 'BBTL'}
];

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
    this.staleAfter = 24 * 3600 * 1000; // data exported longer ago than this is flagged as old
    this.problem = null; // why the last load brought nothing in: {state: 'failed' | 'invalid', detail, errors, since}
  }

  /** Loads the data, at most once per ttl unless force is set. A load that fails keeps the last good data and says so in getDataStatus(). */
  async load(force = false) {
    if (!force && this.cache && !this.problem && (Date.now() - this.lastFetched < this.ttl)) {
      return this.cache;
    }
    const failures = [];
    // 1. the snapshot exported from Supabase, 2. the API when a server runs one
    const sources = [
      ['snapshot', './live_campus_data.json?t=' + Date.now(), raw => raw],
      ['api', '/api/db', raw => this._transformRawDb(raw)]
    ];
    for (const [source, url, shape] of sources) {
      let data;
      try {
        const res = await fetch(url, {cache: 'no-store'});
        if (!res.ok) { failures.push(`${source}: HTTP ${res.status}`); continue; }
        data = shape(await res.json());
      } catch (err) {
        failures.push(`${source}: ${err?.name === 'SyntaxError' ? 'không phải JSON' : err?.message || err}`);
        continue;
      }
      const check = validateCampusData(data);
      if (!check.ok) {
        // Wrong-shaped data never reaches the panels: the last good data stays, flagged.
        this._setProblem({state: 'invalid', detail: `${source}: ${check.errors.length} lỗi cấu trúc`, errors: check.errors});
        return this.cache || this._getDefaults();
      }
      const note = check.warnings.join('\n');
      if (note && note !== this._warned) console.debug(`[DataConnector] ${check.warnings.length} ghi chú về dữ liệu (không chặn):\n` + note);
      this._warned = note;
      return this._store(data, source);
    }
    this._setProblem({state: 'failed', detail: failures.join(' · '), errors: []});
    return this.cache || this._getDefaults();
  }

  /** Calls fn() whenever a load brings in data that differs from the cache. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Where the numbers on screen come from and whether they can be trusted, for the HUD.
   * state: 'ok' | 'stale' (exported more than staleAfter ago) | 'failed' (last load failed, showing the
   * last good data) | 'invalid' (last load broke the data contract, showing the last good data) |
   * 'offline' (nothing loaded yet). hasData is false while the panels have nothing real to show.
   */
  getDataStatus(now = Date.now()) {
    const updatedAt = this.cache?.updatedAt || null;
    const base = {
      source: this.cache ? this.source : 'offline', updatedAt, hasData: !!this.cache, sample: this.cache?.sample === true,
      fetchedAt: this.lastFetched, detail: this.problem?.detail || '', errors: this.problem?.errors || []
    };
    if (this.problem) return {...base, state: this.problem.state === 'failed' && !this.cache ? 'offline' : this.problem.state, since: this.problem.since};
    if (!this.cache) return {...base, state: 'offline'};
    const age = now - new Date(updatedAt).getTime();
    return {...base, state: !base.sample && !(age <= this.staleAfter) ? 'stale' : 'ok'};
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
    // No briefing yet: dashes, never invented sentences.
    return this.cache?.dailyBriefing || {
      tramanh: {activeProjectsSummary: '—', pendingActionsSummary: '—', highlights: []},
      hermes: {systemStatus: '—', mailScanStatus: '—', dbLatency: '—', backupStatus: '—'}
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
    const out = (this.cache?.clients || []).map(c => ({...c, aliases: c.aliases || [], kind: c.kind || 'client'}));
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

  /**
   * Today as a Date at local midnight. Real data is read against the real date, so an old export shows
   * as old instead of moving "today" back; the sample data (sample: true) is a frozen day and keeps its own.
   */
  getToday() {
    return this.cache?.sample === true ? this._exportDay() : midnight(new Date());
  }

  /** The day the data was exported (updatedAt) at local midnight; today when it has none. */
  _exportDay() {
    const d = new Date(this.cache?.updatedAt ?? NaN);
    return midnight(isNaN(d) ? new Date() : d);
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

  /** Every calendar event: the month schedule when the data has one, else the list of the day the data was exported. */
  getScheduleEvents() {
    const d = this._exportDay();
    const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const raw = this.cache?.schedule || this.getScheduleToday().map(e => ({...e, date}));
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
      connected: !!this.cache,
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

  /**
   * Maps the production API response onto the data contract (data-contract.js, DATA_CONTRACT.md).
   * This is the one place that knows the database's own table and column names; load() checks what it
   * returns, so a mapping that misses a field is reported instead of drawn.
   */
  _transformRawDb(raw) {
    return raw;
  }

  _store(data, source) {
    const changed = !!this.problem || source !== this.source || JSON.stringify(data) !== JSON.stringify(this.cache);
    if (this.problem) console.info('[DataConnector] Đã nạp lại được dữ liệu.');
    this.problem = null;
    this.cache = data;
    this.source = source;
    this.lastFetched = Date.now();
    if (changed) this.listeners.forEach(fn => fn());
    return this.cache;
  }

  /** Records a load that brought nothing in; logs once per new problem, not once per retry. */
  _setProblem(problem) {
    const same = this.problem && this.problem.state === problem.state && this.problem.detail === problem.detail;
    if (same) return;
    this.problem = {...problem, since: Date.now()};
    const kept = this.cache ? ' Đang giữ dữ liệu nạp lần trước.' : '';
    if (problem.state === 'invalid') console.error(`[DataConnector] Dữ liệu sai cấu trúc, không dùng (${problem.detail}).${kept}\n` + problem.errors.slice(0, 20).join('\n'));
    else console.error(`[DataConnector] Không nạp được dữ liệu (${problem.detail}).${kept}`);
    this.listeners.forEach(fn => fn());
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
