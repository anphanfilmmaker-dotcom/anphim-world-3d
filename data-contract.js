/**
 * data-contract.js
 * The shape of the data the 3D world reads (live_campus_data.json now, the real database later).
 * One schema, three uses: DataConnector checks every load against it, `npm run check:data` checks a
 * file without a browser, and DATA_CONTRACT.md lists the same fields for whoever writes the export.
 *
 * Spec language: 'str' | 'num' | 'int' | 'bool' | 'day' (dd/mm/yyyy) | 'daytime' (dd/mm/yyyy hh:mm) |
 * 'iso' (ISO date-time) | 'url' (http(s) or relative) | 'enum:a,b,c'; a trailing '?' allows the field to
 * be missing or null. [spec] is a list, {…} an object, {'*': spec} an object with free keys.
 * A wrong type or a missing required field is an error; an unknown enum value or key is a warning,
 * because the world has a neutral fallback for those.
 */

const money = {id: 'str', description: 'str', amount: 'num', amountFormatted: 'str', date: 'day', category: 'str?', method: 'str?', projectId: 'str?'};
const event = {id: 'str', title: 'str', time: 'str?', priority: 'enum:high,medium,low?', projectId: 'str?', done: 'bool?'};

export const CONTRACT = {
  updatedAt: 'iso',
  kpi: {
    cashAvailable: 'num', cashAvailableFormatted: 'str', receivable: 'num', receivableFormatted: 'str',
    activeProjectsCount: 'int', missingDocumentsCount: 'int', pendingActionsCount: 'int',
    estimatedProfit: 'num?', estimatedProfitFormatted: 'str?', invoicesPendingCount: 'int?'
  },
  clients: [{id: 'str', name: 'str', kind: 'enum:client,internal?', aliases: ['str', '?']}],
  projects: [{
    id: 'str', name: 'str', client: 'str', type: 'str?',
    status: 'enum:Đang làm,Chờ feedback,Cần revise,Tạm dừng,Hoàn thành',
    budget: 'num', budgetFormatted: 'str', received: 'num', receivedFormatted: 'str',
    paymentd1: 'num?', paymentd2: 'num?', paymentd3: 'num?',
    duedate: 'day', nextaction: 'str?', lot: 'int?', driveUrl: 'url?',
    milestones: [{date: 'day?', name: 'str', completed: 'bool'}],
    documents: [{title: 'str', status: 'str'}],
    paperwork: {$optional: true, quote: 'bool?', contract: 'bool?', vat1: 'bool?', vat2: 'bool?', vat3: 'bool?', handover: 'bool?'}
  }],
  recentExpenses: [money],
  allExpenses: [money],
  allIncomes: [money],
  actionsPending: [{id: 'str', title: 'str', priority: 'str?', assignee: 'str?', deadline: 'day?'}, '?'],
  dailyBriefing: {
    tramanh: {activeProjectsSummary: 'str', pendingActionsSummary: 'str', highlights: ['str']},
    hermes: {systemStatus: 'str', mailScanStatus: 'str', dbLatency: 'str', backupStatus: 'str'}
  },
  missions: [{
    id: 'str', title: 'str', priority: 'enum:high,medium,low', tag: 'str?', projectId: 'str?', buildingId: 'str?',
    date: 'day?', time: 'str?', done: 'bool', source: 'str?', actionId: 'str?', expenseId: 'str?'
  }],
  notifications: [{id: 'str', type: 'str?', level: 'enum:alert,warn,info', text: 'str', time: 'daytime?', buildingId: 'str?', projectId: 'str?'}],
  aiWorkforce: [{id: 'str', name: 'str', role: 'str', status: 'enum:active,idle', task: 'str?', loadPct: 'num?', buildingId: 'str?', buildingIds: ['str', '?']}],
  systems: [{id: 'str', buildingId: 'str', name: 'str', status: 'enum:online,slow,down', detail: 'str?', lastCheck: 'daytime?'}],
  scheduleToday: [event],
  marketing: {
    $optional: true, totalPosts: 'int', pendingApproval: 'int', approvedQueued: 'int', published: 'int',
    posts: [{id: 'str', page: 'str?', status: 'enum:pending,approved,published', title: 'str', author: 'str?', date: 'day?', image: 'url?', url: 'url?'}, '?']
  },
  workspace: {
    baseUrl: 'url',
    pages: {'*': {label: 'str', path: 'str'}},
    buildingPages: {'*': 'str'}
  },
  schedule: [{...event, date: 'day', dateEnd: 'day?'}, '?']
};

/** What each field is for, by path; DATA_CONTRACT.md is generated from these. */
export const NOTES = {
  updatedAt: 'Thời điểm xuất dữ liệu. Quá 24 giờ thì HUD báo "Dữ liệu cũ".',
  kpi: 'Số trên thanh tài nguyên. Bản *Formatted là chữ hiện ra, bản số để rút gọn và cảnh báo.',
  clients: 'Mỗi khách hàng một khu (district). kind "internal" là AN PHIM, ở lại campus chính.',
  'clients[].aliases': 'Tên khác của khách (ví dụ Winterland87 cho K87K).',
  projects: 'Mỗi dự án một tòa. Thứ tự trong danh sách là thứ tự nhận lô đất trong khu.',
  'projects[].id': 'Kết thúc bằng số (proj_5). Số này nối với projectId trong physical-topology.json, không đổi.',
  'projects[].client': 'Tên, id hoặc alias của một khách trong clients.',
  'projects[].status': 'Quyết định hình ngoài của tòa: giàn giáo, cờ, biển delay.',
  'projects[].duedate': 'Hạn giao. Quá hạn mà chưa Hoàn thành thì tòa hiện trễ hạn.',
  'projects[].lot': 'Số lô cố định trong khu (1..n). Bỏ trống thì nhận lô trống đầu tiên.',
  'projects[].driveUrl': 'Thư mục Drive của dự án. Thiếu thì nút "Mở Drive" bị mờ.',
  'projects[].milestones': 'Chiều cao đã xây = tỉ lệ milestone completed.',
  'projects[].paperwork': 'Sáu giấy tờ trang Giấy tờ theo dõi; true = có, false = thiếu, bỏ trống = chưa rõ.',
  recentExpenses: 'Khoản chi mới nhất (thẻ Ngân hàng).',
  allExpenses: 'Mọi khoản chi của kỳ (trang Tài chính).',
  allIncomes: 'Mọi khoản thu của kỳ (trang Tài chính).',
  actionsPending: 'Việc chờ duyệt bên dashboard. Thế giới 3D chưa đọc; dùng missions.',
  dailyBriefing: 'Tóm tắt trong ngày của Trâm Anh và Hermes.',
  missions: 'Việc An phải làm: danh sách Mission và huy hiệu trên tòa.',
  'missions[].buildingId': 'Id tòa trong physical-topology.json, hoặc bld:project:proj_NN.',
  'missions[].tag': '"Cần Input" được tô nổi; chữ khác hiện nguyên văn.',
  notifications: 'Thông báo dưới danh sách Mission.',
  aiWorkforce: 'Đội AI: người đi lại trong tòa và bảng AI Workforce.',
  'aiWorkforce[].buildingIds': 'Các tòa agent có mặt; thiếu thì dùng buildingId.',
  systems: 'Hạ tầng (Supabase, Oracle, Telegram, Google): trạng thái trên tòa hạ tầng.',
  scheduleToday: 'Lịch của ngày xuất dữ liệu (ngày của updatedAt), dùng khi không có schedule.',
  marketing: 'Bài fanpage. Thiếu thì tòa Marketing hiện "chưa kết nối".',
  workspace: 'Link sang AN PHIM Workspace.',
  'workspace.baseUrl': 'Địa chỉ Workspace. Để "" thì mọi nút "Mở dashboard" bị mờ (có cảnh báo).',
  'workspace.pages': 'Các tab của dashboard: key -> {label, path}; link = baseUrl + path.',
  'workspace.buildingPages': 'Id tòa -> key trong pages.',
  schedule: 'Lịch cả tháng. Thiếu thì trang Lịch chỉ có hôm nay.'
};

/** Top-level keys that are not part of the 18 but are allowed. */
const META_KEYS = {sample: 'bool'};

const DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const DAYTIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: ([01]?\d|2[0-3]):[0-5]\d)?$/;
// Date() rolls 31/02 into March instead of rejecting it, so the day is checked against its month here.
const ISO = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const validIso = s => { const m = String(s).match(ISO); return !!m && validDay(`${m[3]}/${m[2]}/${m[1]}`) && !isNaN(new Date(s)); };
const validDay = s => { const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= new Date(+m[3], +m[2], 0).getDate(); };
const SCALAR = {
  str: v => typeof v === 'string',
  num: v => typeof v === 'number' && Number.isFinite(v),
  int: v => Number.isInteger(v),
  bool: v => typeof v === 'boolean',
  day: v => typeof v === 'string' && DAY.test(v) && validDay(v),
  daytime: v => typeof v === 'string' && DAYTIME.test(v) && validDay(v),
  iso: v => typeof v === 'string' && validIso(v),
  // '' is a link not set yet; anything else must be http(s) or a path inside the site (never javascript:).
  url: v => typeof v === 'string' && (v === '' || /^(https?:\/\/[^\s]+|\.{0,2}\/[^\s]*)$/.test(v))
};
const LABEL = {str: 'chữ', num: 'số', int: 'số nguyên', bool: 'true/false', day: 'ngày dd/mm/yyyy', daytime: 'ngày dd/mm/yyyy hh:mm', iso: 'ISO date-time', url: 'URL http(s)'};
const show = v => { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 60 ? s.slice(0, 57) + '…' : s; };
const kindOf = v => v === null ? 'null' : Array.isArray(v) ? 'danh sách' : typeof v === 'object' ? 'object' : typeof v;
const parse = spec => { const optional = spec.endsWith('?'); const t = optional ? spec.slice(0, -1) : spec; const en = t.startsWith('enum:') ? t.slice(5).split(',') : null; return {optional, type: en ? 'enum' : t, values: en}; };

function walk(spec, value, path, out) {
  if (typeof spec === 'string') {
    const {optional, type, values} = parse(spec);
    if (value == null) { if (!optional) out.errors.push(`${path}: thiếu (cần ${values ? 'một trong ' + values.join(' | ') : LABEL[type]})`); return; }
    if (values) {
      if (typeof value !== 'string') out.errors.push(`${path}: cần chữ, nhận ${kindOf(value)} ${show(value)}`);
      else if (!values.includes(value)) out.warnings.push(`${path}: giá trị lạ ${show(value)} (đã biết: ${values.join(' | ')})`);
    } else if (!SCALAR[type](value)) out.errors.push(`${path}: cần ${LABEL[type]}, nhận ${kindOf(value)} ${show(value)}`);
    return;
  }
  if (Array.isArray(spec)) {
    if (value == null) { if (spec[1] !== '?') out.errors.push(`${path}: thiếu (cần danh sách)`); return; }
    if (!Array.isArray(value)) { out.errors.push(`${path}: cần danh sách, nhận ${kindOf(value)}`); return; }
    value.forEach((item, i) => walk(spec[0], item, `${path}[${i}]`, out));
    return;
  }
  if (value == null) { if (!spec.$optional) out.errors.push(`${path}: thiếu (cần object)`); return; }
  if (typeof value !== 'object' || Array.isArray(value)) { out.errors.push(`${path}: cần object, nhận ${kindOf(value)}`); return; }
  if (spec['*']) { for (const [k, v] of Object.entries(value)) walk(spec['*'], v, `${path}.${k}`, out); return; }
  for (const [k, sub] of Object.entries(spec)) if (k !== '$optional') walk(sub, value[k], path ? `${path}.${k}` : k, out);
  if (path) for (const k of Object.keys(value)) if (!(k in spec)) out.warnings.push(`${path}.${k}: trường ngoài contract, thế giới 3D không đọc`);
}

const trailingNumber = id => { const m = String(id).match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : null; };

/**
 * Checks data against the contract. Returns {ok, errors, warnings}: errors are wrong shapes the world
 * must not show, warnings are things it can show but that probably are mistakes.
 * opts.buildingIds: ids of physical-topology.json, to check buildingId references.
 */
export function validateCampusData(data, opts = {}) {
  const out = {errors: [], warnings: []};
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    out.errors.push(`dữ liệu gốc: cần object có ${Object.keys(CONTRACT).length} key, nhận ${kindOf(data)}`);
    return {ok: false, ...out};
  }
  walk(CONTRACT, data, '', out);
  for (const k of Object.keys(data)) {
    if (k in META_KEYS) { if (!SCALAR[META_KEYS[k]](data[k])) out.errors.push(`${k}: cần ${LABEL[META_KEYS[k]]}, nhận ${show(data[k])}`); }
    else if (!(k in CONTRACT)) out.warnings.push(`${k}: key ngoài contract, thế giới 3D không đọc`);
  }

  const list = k => Array.isArray(data[k]) ? data[k].filter(x => x && typeof x === 'object') : [];
  for (const k of Object.keys(CONTRACT)) {
    const seen = new Set();
    for (const x of list(k)) {
      if (typeof x.id !== 'string') continue;
      if (seen.has(x.id)) out.errors.push(`${k}: id trùng ${show(x.id)}`);
      seen.add(x.id);
    }
  }
  const projectNumbers = new Set();
  list('projects').forEach((p, i) => {
    const n = trailingNumber(p.id);
    if (typeof p.id === 'string' && n === null) out.errors.push(`projects[${i}].id: ${show(p.id)} phải kết thúc bằng số (proj_5)`);
    else if (projectNumbers.has(n)) out.errors.push(`projects[${i}].id: ${show(p.id)} trùng số với dự án khác`);
    projectNumbers.add(n);
  });
  const buildings = opts.buildingIds ? new Set(opts.buildingIds) : null;
  for (const k of ['recentExpenses', 'allExpenses', 'allIncomes', 'missions', 'notifications', 'scheduleToday', 'schedule', 'aiWorkforce', 'systems']) {
    list(k).forEach((x, i) => {
      if (typeof x.projectId === 'string' && !projectNumbers.has(trailingNumber(x.projectId))) out.errors.push(`${k}[${i}].projectId: không có dự án ${show(x.projectId)}`);
      if (!buildings) return;
      for (const id of [x.buildingId, ...(Array.isArray(x.buildingIds) ? x.buildingIds : [])]) {
        if (typeof id !== 'string' || buildings.has(id)) continue;
        if (id.startsWith('bld:project:') && projectNumbers.has(trailingNumber(id))) continue;
        out.warnings.push(`${k}[${i}]: không có tòa ${show(id)} trong physical-topology.json`);
      }
    });
  }
  const ws = data.workspace;
  if (ws && typeof ws === 'object') {
    if (ws.baseUrl === '') out.warnings.push('workspace.baseUrl: đang trống, mọi nút "Mở dashboard" bị mờ');
    const pages = ws.pages && typeof ws.pages === 'object' ? ws.pages : {};
    for (const [b, key] of Object.entries(ws.buildingPages && typeof ws.buildingPages === 'object' ? ws.buildingPages : {})) {
      if (typeof key === 'string' && !(key in pages)) out.errors.push(`workspace.buildingPages.${b}: không có trang ${show(key)} trong workspace.pages`);
      if (buildings && !buildings.has(b)) out.warnings.push(`workspace.buildingPages: không có tòa ${show(b)} trong physical-topology.json`);
    }
  }
  return {ok: out.errors.length === 0, ...out};
}

/** The contract as rows {path, type, required, note}, for DATA_CONTRACT.md. */
export function describeContract() {
  const rows = [];
  const add = (spec, path) => {
    if (typeof spec === 'string') {
      const {optional, type, values} = parse(spec);
      rows.push({path, type: values ? values.map(v => `"${v}"`).join(' / ') : LABEL[type], required: !optional, note: NOTES[path] || ''});
    } else if (Array.isArray(spec)) {
      const scalar = typeof spec[0] === 'string';
      rows.push({path, type: scalar ? `danh sách ${LABEL[parse(spec[0]).type]}` : 'danh sách', required: spec[1] !== '?', note: NOTES[path] || ''});
      if (!scalar) add(spec[0], path + '[]');
    } else {
      if (!path.endsWith('[]')) rows.push({path, type: spec['*'] ? 'object (key tự do)' : 'object', required: !spec.$optional, note: NOTES[path] || ''});
      for (const [k, sub] of Object.entries(spec)) if (k !== '$optional') add(sub, k === '*' ? path + '.<key>' : `${path}.${k}`);
    }
  };
  for (const [k, spec] of Object.entries(CONTRACT)) add(spec, k);
  return rows;
}
