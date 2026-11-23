/**
 * check-data-contract.mjs
 * Checks a data file against the contract the 3D world reads (data-contract.js), without a browser:
 *   node check-data-contract.mjs [file, default live_campus_data.json]
 *   node check-data-contract.mjs --write-doc     rewrites the field tables of DATA_CONTRACT.md from the contract
 * Exits 1 when the file breaks the contract, when the check itself no longer catches broken data
 * (it first damages a good copy in known ways), or when DATA_CONTRACT.md is out of date.
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
const good = data && result.ok ? data : JSON.parse(readFileSync('live_campus_data.json', 'utf8'));
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
if (!validateCampusData(good, {buildingIds}).ok) fails.push('live_campus_data.json (bản mẫu để thử check) không đạt contract');

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
