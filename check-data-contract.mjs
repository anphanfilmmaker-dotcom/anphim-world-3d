/**
 * check-data-contract.mjs
 * Checks a data file against the contract the 3D world reads (data-contract.js), without a browser:
 *   node check-data-contract.mjs [file, default live_campus_data.json]
 *   node check-data-contract.mjs --write-doc     rewrites the field tables of DATA_CONTRACT.md from the contract
 * Exits 1 when the file breaks the contract, when the check itself no longer catches broken data
 * (it damages a small good dataset of its own in known ways), or when DATA_CONTRACT.md is out of date.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {CONTRACT, NOTES, validateCampusData, describeContract} from './data-contract.js';

const args = process.argv.slice(2), writeDoc = args.includes('--write-doc');
const file = args.find(a => !a.startsWith('--')) || 'live_campus_data.json';
const DOC = 'DATA_CONTRACT.md', START = '<!-- contract:start -->', END = '<!-- contract:end -->';
const fails = [];

// ---- the field tables of DATA_CONTRACT.md ----
function tables() {
  const rows = describeContract(), out = [];
  Object.keys(CONTRACT).forEach((key, i) => {
    const mine = rows.filter(r => r.path === key || r.path.startsWith(key + '.') || r.path.startsWith(key + '['));
    out.push(`### ${i + 1}. \`${key}\`${mine[0].required ? '' : ' (không bắt buộc)'}`, '', NOTES[key] || '', '');
    if (mine.length > 1) {
      out.push('| Trường | Kiểu | Bắt buộc | Ghi chú |', '|---|---|---|---|');
      for (const r of mine.slice(1)) out.push(`| \`${r.path}\` | ${r.type.replace(/\|/g, '/')} | ${r.required ? 'có' : ''} | ${r.note} |`);
    } else out.push(`Kiểu: ${mine[0].type}.`);
    out.push('');
  });
  return out.join('\n').trimEnd();
}
let doc = '';
try { doc = readFileSync(DOC, 'utf8'); } catch { /* reported below */ }
const a = doc.indexOf(START), b = doc.indexOf(END);
if (a < 0 || b < a) fails.push(`${DOC}: thiếu hai dòng đánh dấu ${START} … ${END}`);
else if (writeDoc) {
  writeFileSync(DOC, doc.slice(0, a + START.length) + '\n' + tables() + '\n' + doc.slice(b));
  console.log(`Đã ghi lại bảng trường trong ${DOC}.`);
  process.exit(0);
} else if (doc.slice(a + START.length, b).trim() !== tables()) fails.push(`${DOC}: bảng trường không khớp data-contract.js; chạy npm run check:data -- --write-doc`);

// ---- the file ----
const topology = JSON.parse(readFileSync('physical-topology.json', 'utf8'));
// The Marketing room has no building of its own in the topology; main.js opens it inside its host.
const buildingIds = [...topology.buildings.map(x => x.id), topology.schedule?.id, 'bld:facility:marketing'].filter(Boolean);
let data, result = {ok: false, errors: [], warnings: []};
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
  result = validateCampusData(data, {buildingIds});
} catch (err) {
  result.errors.push(`không đọc được file: ${err.message}`);
}

// ---- the check itself: a good copy damaged in known ways must fail ----
// Its own small dataset, so the check does not depend on what the checked file happens to contain.
const project = (id, name) => ({
  id, name, client: 'AN PHIM', status: 'Đang làm', budget: 45000000, budgetFormatted: '45.000.000 đ', received: 0, receivedFormatted: '0 đ',
  duedate: '11/12/2026', driveUrl: 'https://example.com/drive/' + id,
  milestones: [{date: '01/12/2026', name: 'Quay', completed: false}], documents: [{title: 'Hợp đồng', status: 'Đã ký'}]
});
const good = {
  updatedAt: '2026-11-21T16:00:00',
  kpi: {cashAvailable: 1, cashAvailableFormatted: '1 đ', receivable: 1, receivableFormatted: '1 đ', activeProjectsCount: 2, missingDocumentsCount: 0, pendingActionsCount: 1},
  clients: [{id: 'anphim', name: 'AN PHIM'}],
  projects: [project('proj_1', 'Phim A'), project('proj_2', 'Phim B')],
  recentExpenses: [], allExpenses: [], allIncomes: [],
  dailyBriefing: {
    tramanh: {activeProjectsSummary: '2 dự án', pendingActionsSummary: '1 việc', highlights: []},
    hermes: {systemStatus: 'ổn', mailScanStatus: 'ổn', dbLatency: '40ms', backupStatus: 'ổn'}
  },
  missions: [{id: 'm1', title: 'Gửi báo giá', priority: 'high', projectId: 'proj_1', done: false}],
  notifications: [{id: 'n1', level: 'info', text: 'Đã sao lưu', time: '21/11/2026 08:30'}],
  aiWorkforce: [], systems: [], scheduleToday: [],
  workspace: {baseUrl: 'https://example.com/workspace', pages: {home: {label: 'Trang chủ', path: '/'}}, buildingPages: {'bld:facility:hq': 'home'}}
};
const DAMAGE = [
  ['thiếu hẳn key projects', d => { delete d.projects; }],
  ['projects là object thay vì danh sách', d => { d.projects = {}; }],
  ['số tiền là chữ', d => { d.projects[0].budget = '45.000.000 đ'; }],
  ['ngày kiểu ISO thay vì dd/mm/yyyy', d => { d.projects[0].duedate = '2026-12-11'; }],
  ['ngày không có thật', d => { d.projects[0].duedate = '31/02/2026'; }],
  ['milestone thiếu completed', d => { delete d.projects[0].milestones[0].completed; }],
  ['hai dự án trùng id', d => { d.projects[1].id = d.projects[0].id; }],
  ['id dự án không có số', d => { d.projects[0].id = 'atera-central'; }],
  ['mission trỏ tới dự án không có', d => { d.missions[0].projectId = 'proj_9999'; }],
  ['updatedAt không phải ngày giờ', d => { d.updatedAt = 'hôm qua'; }],
  ['updatedAt là ngày không có thật', d => { d.updatedAt = '2026-02-31T10:00:00'; }],
  ['giờ không có thật trong thông báo', d => { d.notifications[0].time = '21/11/2026 25:99'; }],
  ['kpi thiếu số tiền mặt', d => { delete d.kpi.cashAvailable; }],
  ['link javascript: trong driveUrl', d => { d.projects[0].driveUrl = 'javascript:alert(1)'; }],
  ['buildingPages trỏ tới trang không có', d => { d.workspace.buildingPages['bld:facility:hq'] = 'khong-co'; }],
  ['dữ liệu gốc là danh sách', () => []],
  ['dữ liệu gốc rỗng', () => ({})]
];
let caught = 0;
for (const [name, damage] of DAMAGE) {
  const copy = structuredClone(good);
  const r = validateCampusData(damage(copy) ?? copy, {buildingIds});
  if (r.ok) fails.push(`check không bắt được: ${name}`); else caught++;
}
const self = validateCampusData(good, {buildingIds});
if (!self.ok) fails.push('bộ dữ liệu tự kiểm của check không đạt contract: ' + self.errors.join('; '));

// ---- report ----
const count = k => Array.isArray(data?.[k]) ? data[k].length : 0;
console.log(`Data contract · ${file}`);
console.log(`  ${Object.keys(CONTRACT).length} key gốc, ${describeContract().length} trường trong contract`);
if (data) console.log(`  ${count('projects')} dự án, ${count('clients')} khách hàng, ${count('missions')} mission, ${count('aiWorkforce')} agent, ${count('systems')} hệ thống · updatedAt ${data.updatedAt}${data.sample === true ? ' · dữ liệu mẫu' : ''}`);
console.log(`  Tự kiểm: ${caught}/${DAMAGE.length} kiểu dữ liệu hỏng bị bắt`);
if (result.warnings.length) console.log(`\nGhi chú (${result.warnings.length}, không chặn):\n` + result.warnings.map(w => '  - ' + w).join('\n'));
const all = [...result.errors, ...fails];
if (all.length) {
  console.error(`\nSAI CONTRACT · ${all.length} lỗi:\n` + all.map(e => '  ✗ ' + e).join('\n'));
  process.exit(1);
}
console.log('\nĐẠT · dữ liệu đúng contract');
