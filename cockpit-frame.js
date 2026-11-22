/**
 * cockpit-frame.js
 * Strategy-game frame around the campus view (approved sketch 1, cleaned up from An's reference):
 * brand and resource icons on top, an icon dock on the left (home, missions, search,
 * dashboard, settings), small icons on the right for the hovered building and the AI
 * workforce, the place menu bottom-left and the main buildings as tiles bottom-right.
 * Panels open only from their icon.
 * View only. Every value comes from dataConnector; buildings come from the topology.
 */

const HIDE_MONEY_KEY = 'anphim.cockpit.hideMoney';
const MISSIONS_KEY = 'anphim.cockpit.missionsOpen';

// Top resource icons: KPI field (raw number, formatted text) -> icon, tooltip label and the building a click flies to.
const RESOURCES = [
  {key: 'cashAvailable', text: 'cashAvailableFormatted', label: 'Tiền mặt sẵn có', icon: 'coin', color: '#f5c242', money: true, jump: 'bld:facility:bank'},
  {key: 'receivable', text: 'receivableFormatted', label: 'Khoản thu dự kiến', icon: 'incoming', color: '#5fd68a', money: true, jump: 'bld:facility:bank'},
  {key: 'activeProjectsCount', label: 'Dự án đang chạy', icon: 'crane', color: '#f7941d', jump: 'bld:facility:hq'},
  {key: 'missingDocumentsCount', label: 'Thiếu giấy tờ', icon: 'doc', color: '#7cc4f5', warn: true, jump: 'bld:facility:documents'}
];

/** 348520000 -> "348,5 tr": the top bar shows short amounts, the tooltip the full one. */
const compact = n => {
  const a = Math.abs(n);
  const f = (v, unit) => v.toLocaleString('vi-VN', {maximumFractionDigits: 1}) + ' ' + unit;
  if (a >= 1e9) return f(n / 1e9, 'tỷ');
  if (a >= 1e6) return f(n / 1e6, 'tr');
  if (a >= 1e4) return f(n / 1e3, 'k');
  return n.toLocaleString('vi-VN');
};

// Buildings with their own quick-jump button; other facilities go under "Hạ tầng".
const MAIN_JUMPS = ['bld:facility:hq', 'bld:facility:bank', 'bld:facility:documents', 'bld:facility:schedule', 'bld:facility:ai', 'bld:facility:marketing'];
const TILES = {
  'bld:facility:hq': {icon: 'building'},
  'bld:facility:bank': {icon: 'bank'},
  'bld:facility:documents': {icon: 'doc'},
  'bld:facility:schedule': {icon: 'calendar', short: 'Lịch'},
  'bld:facility:ai': {icon: 'robot', short: 'AI Team'},
  'bld:facility:marketing': {icon: 'megaphone'}
};

const PRIORITY = {
  high: {label: 'CAO', tone: 'alert'},
  medium: {label: 'T.BÌNH', tone: 'warn'},
  low: {label: 'THẤP', tone: 'info'}
};

const DATA_STATUS = {
  api: {label: 'DB: Real-time', tone: 'ok', title: 'Đang đọc trực tiếp từ database'},
  snapshot: {label: 'DB: Snapshot', tone: 'warn', title: 'Đang đọc bản chụp dữ liệu live_campus_data.json'},
  offline: {label: 'DB: Mất kết nối', tone: 'alert', title: 'Chưa nạp được dữ liệu'}
};

const ICONS = {
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.4 6 4.3 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.5-3.1-1.5"/>',
  incoming: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  crane: '<path d="M6 21V4l12 4H6M6 8l-3 3M18 8v5M16 13h4v3h-4zM3 21h9"/>',
  doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.2A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.3 7.6A17 17 0 0 0 2 12s3.6 6.5 10 6.5a9.7 9.7 0 0 0 4-.8"/>',
  tools: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3 18l3 3 6.2-6.2a4 4 0 0 0 5.3-5.3L15 12l-3-3z"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  building: '<path d="M4 21V6l8-3v18M12 9l8 2v10M2 21h20M7.5 9h1M7.5 13h1M7.5 17h1M15.5 14h1M15.5 17.5h1"/>',
  home: '<path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  chart: '<path d="M3 21h18M6 17v-5M11 17V7M16 17v-8M21 17V4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  cube: '<path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z"/><path d="M3.5 7.25L12 12l8.5-4.75M12 12v9.5"/>',
  bank: '<path d="M12 3l9 5H3zM3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  megaphone: '<path d="M3 10v4h3l7 4V6l-7 4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  robot: '<rect x="4.5" y="8" width="15" height="11" rx="3.5"/><path d="M12 8V4.5M9 13v1.5M15 13v1.5M2 12.5v3M22 12.5v3"/><circle cx="12" cy="3.5" r="1"/>'
};

const icon = (name, size = 16) =>
  `<svg class="cf-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const paneClose = pane => `<button data-pane="${pane}" aria-label="Thu gọn">${icon('close', 13)}</button>`;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const CSS = `
#cockpit-frame-root{--cf-bg:rgba(24,33,38,.94);--cf-bg2:rgba(255,255,255,.06);--cf-line:rgba(255,255,255,.10);--cf-text:#f3f6f4;--cf-mute:#9db0ab;--cf-accent:#f7941d;--cf-teal:#4fc9bb;--cf-ok:#5fd68a;--cf-warn:#ffc440;--cf-alert:#ff6a5a;--cf-info:#7cc4f5;--cf-pad:14px;--cf-top:52px;--cf-side:308px;
  position:fixed;inset:0;z-index:45;pointer-events:none;color:var(--cf-text);font:600 12px/1.35 ui-rounded,"SF Pro Rounded","Nunito","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;user-select:none}
#cockpit-frame-root{
*{box-sizing:border-box}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0;text-align:left}
button:disabled{cursor:not-allowed;opacity:.5}
.cf-chip,.cf-panel{background:var(--cf-bg);border:1px solid var(--cf-line);border-radius:16px;box-shadow:0 4px 0 rgba(0,0,0,.22),0 14px 30px rgba(0,0,0,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto}
.cf-ico{flex:none}
.cf-top{z-index:2;position:absolute;top:var(--cf-pad);left:var(--cf-pad);right:calc(var(--cf-pad) + var(--cf-aside,0px));height:var(--cf-top);display:flex;gap:8px;align-items:center}
.cf-brand{display:flex;align-items:center;gap:10px;height:100%;padding:0 18px 0 8px;flex:none}
.cf-brand-mark{width:38px;height:38px;border-radius:12px;background:var(--cf-accent);color:#1b2428;display:grid;place-items:center;font-weight:900;font-size:15px;letter-spacing:-.5px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}
.cf-brand b{display:block;font-size:15px;font-weight:900;letter-spacing:.06em;line-height:1.1}
.cf-brand span{display:block;font-size:9px;letter-spacing:.42em;color:var(--cf-mute)}
.cf-gap{flex:1}
.cf-res{display:flex;align-items:center;gap:8px;height:42px;padding:0 15px 0 6px;border-radius:99px;flex:none;transition:transform .15s ease,border-color .15s ease}
.cf-res:hover{transform:translateY(-1px);border-color:rgba(247,148,29,.6)}
.cf-res-ico{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#1b2428;background:var(--cf-res-c,var(--cf-accent));box-shadow:inset 0 -3px 0 rgba(0,0,0,.2);flex:none}
.cf-res strong{font-size:15px;font-weight:900;white-space:nowrap;font-variant-numeric:tabular-nums}
.cf-res[data-tone=warn] strong{color:var(--cf-warn)}
.cf-dock{position:absolute;z-index:3;left:var(--cf-pad);top:calc(var(--cf-pad) + var(--cf-top) + 12px);display:flex;flex-direction:column;gap:6px;padding:6px;border-radius:18px;transition:opacity .25s ease,transform .35s cubic-bezier(.22,1,.36,1)}
.cf-ib{position:relative;width:44px;height:44px;border-radius:13px;display:grid;place-items:center;color:var(--cf-text);background:rgba(255,255,255,.06);text-align:center;text-decoration:none;transition:background .15s ease,color .15s ease}
.cf-ib:hover:not([aria-disabled=true]){background:rgba(255,255,255,.15)}
.cf-ib[aria-pressed=true],.cf-menu.cf-open>.cf-ib{background:var(--cf-accent);color:#1b2428}
.cf-ib[aria-disabled=true]{opacity:.4;cursor:not-allowed}
.cf-ib .cf-badge{position:absolute;top:-5px;right:-5px}
.cf-dock .cf-menu-list{bottom:auto;top:0;left:calc(100% + 16px);right:auto}
.cf-pop-search{width:360px}
.cf-search{display:flex;align-items:center;gap:8px;padding:4px 6px 6px;color:var(--cf-mute)}
.cf-search input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--cf-text);font:inherit;font-size:13px;user-select:text}
.cf-search input::placeholder{color:var(--cf-mute)}
.cf-pop-search .cf-results{position:static;min-width:0;max-height:320px;padding:0;border:0;border-top:1px solid var(--cf-line);border-radius:0;background:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none}
.cf-pop-search .cf-results:empty{display:none}
.cf-set{min-width:250px}
.cf-set .cf-row-btn{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:10px;font-size:12px;font-weight:700;color:var(--cf-text);text-decoration:none}
.cf-set button.cf-row-btn:hover,.cf-set a.cf-row-btn:hover{background:var(--cf-bg2)}
.cf-set .cf-row-btn[aria-pressed=true]{color:var(--cf-accent)}
.cf-set .cf-row-btn em{margin-left:auto;font-style:normal;color:var(--cf-mute);font-size:10.5px;font-weight:600}
.cf-results{z-index:3;position:absolute;top:calc(100% + 8px);left:0;right:0;min-width:300px;max-height:320px;overflow:auto;padding:6px}
.cf-results button{display:block;width:100%;padding:7px 10px;border-radius:10px}
.cf-results button:hover,.cf-results button:focus-visible{background:var(--cf-bg2);outline:0}
.cf-results b{display:block;color:var(--cf-text);font-size:12.5px}
.cf-results span{display:block;font-size:11px;color:var(--cf-mute)}
.cf-results em{font-style:normal;color:var(--cf-teal)}
.cf-empty{padding:8px 10px;color:var(--cf-mute);font-size:11.5px}
.cf-btn{display:flex;align-items:center;gap:7px;padding:0 13px;white-space:nowrap;font-weight:800;font-size:12px;text-decoration:none;color:var(--cf-text);transition:transform .15s ease,background .15s ease}
.cf-btn:hover:not(:disabled):not([aria-disabled=true]){transform:translateY(-1px);background:rgba(40,54,60,.96)}
.cf-btn[aria-pressed=true]{background:var(--cf-accent);color:#1b2428;border-color:transparent}
.cf-btn[aria-pressed=true]:hover:not(:disabled):not([aria-disabled=true]){background:var(--cf-accent)}
.cf-btn[aria-disabled=true]{opacity:.55;cursor:not-allowed}
.cf-dot{width:8px;height:8px;border-radius:50%;background:var(--cf-mute);flex:none}
[data-tone=ok]>.cf-dot,.cf-dot[data-tone=ok]{background:var(--cf-ok);box-shadow:0 0 0 3px rgba(95,214,138,.18)}
[data-tone=warn]>.cf-dot,.cf-dot[data-tone=warn]{background:var(--cf-warn)}
[data-tone=alert]>.cf-dot,.cf-dot[data-tone=alert]{background:var(--cf-alert)}
[data-tone=info]>.cf-dot,.cf-dot[data-tone=info]{background:var(--cf-info)}
.cf-side{position:absolute;top:calc(var(--cf-pad) + var(--cf-top) + 12px);width:var(--cf-side);max-height:calc(100vh - var(--cf-top) - var(--cf-bh,72px) - 62px);display:flex;flex-direction:column;gap:10px;transition:transform .35s cubic-bezier(.22,1,.36,1),opacity .25s ease}
.cf-left{left:calc(var(--cf-pad) + 72px)}
.cf-left:not(.cf-open){opacity:0;transform:translateX(-12px);pointer-events:none}
.cf-left:not(.cf-open) *{pointer-events:none}
.cf-right{right:calc(var(--cf-pad) + var(--cf-aside,0px));width:auto;flex-direction:row;align-items:flex-start}
.cf-panes{display:flex;flex-direction:column;gap:10px;min-height:0;max-height:calc(100vh - var(--cf-top) - var(--cf-bh,72px) - 62px)}
.cf-right .cf-panel{width:var(--cf-side)}
.cf-right [data-slot=building]{flex:none}
.cf-right .cf-panel:not(.cf-open){display:none}
.cf-rail{display:flex;flex-direction:column;gap:6px;padding:6px;border-radius:18px;flex:none}
.cf-panel{padding:12px;min-height:0;display:flex;flex-direction:column}
.cf-panel.cf-grow{flex:0 1 auto;overflow:hidden}
.cf-scroll{overflow-y:auto;min-height:0;margin-right:-6px;padding-right:6px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
.cf-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:var(--cf-teal);margin-bottom:8px}
.cf-h small{font-size:10.5px;letter-spacing:0;text-transform:none;color:var(--cf-mute);font-weight:700}
.cf-h button{color:var(--cf-mute);display:grid;place-items:center;width:22px;height:22px;border-radius:7px;transition:transform .2s ease}
.cf-h button:hover{background:var(--cf-bg2);color:var(--cf-text)}
.cf-sub{margin:12px 0 6px;font-size:10px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:var(--cf-mute)}
.cf-mission{display:block;width:100%;padding:9px 10px;margin-bottom:7px;border-radius:12px;background:var(--cf-bg2);border:1px solid var(--cf-line);transition:transform .15s ease,border-color .15s ease}
.cf-mission:hover:not(:disabled){transform:translateX(2px);border-color:rgba(247,148,29,.7)}
.cf-mission[data-tone=alert]{border-left:3px solid var(--cf-alert)}
.cf-mission[data-tone=warn]{border-left:3px solid var(--cf-warn)}
.cf-mission[data-tone=info]{border-left:3px solid var(--cf-info)}
.cf-row{display:flex;align-items:center;gap:6px;min-width:0}
.cf-row .cf-fill{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cf-tag{font-size:9.5px;font-weight:900;padding:1px 6px;border-radius:6px;border:1px solid currentColor;white-space:nowrap;letter-spacing:.03em}
.cf-tag[data-tone=alert]{color:var(--cf-alert)}
.cf-tag[data-tone=warn]{color:var(--cf-warn)}
.cf-tag[data-tone=ok]{color:var(--cf-ok)}
.cf-tag[data-tone=info]{color:var(--cf-info)}
.cf-tag[data-tone=done]{color:var(--cf-teal)}
.cf-tag[data-tone=idle]{color:var(--cf-mute)}
.cf-proj{color:var(--cf-teal);font-size:11px}
.cf-time{color:var(--cf-mute);font-size:10.5px;white-space:nowrap;font-variant-numeric:tabular-nums}
.cf-title{display:block;margin:5px 0 4px;font-size:12.5px;font-weight:700;line-height:1.3;white-space:normal}
.cf-go{display:block;font-size:11px;font-weight:800;color:var(--cf-accent)}
.cf-done{padding:6px 10px;border-radius:10px;border:1px dashed var(--cf-line);color:var(--cf-mute);text-decoration:line-through;font-size:11.5px;margin-bottom:5px}
.cf-note{display:flex;gap:8px;align-items:flex-start;width:100%;padding:5px 6px;border-radius:9px;font-size:11.5px;color:#d5dfdb;font-weight:600}
.cf-note .cf-dot{margin-top:4px}
button.cf-note:hover{background:var(--cf-bg2)}
.cf-card{border-radius:12px;background:var(--cf-bg2);border:1px solid var(--cf-line);padding:11px}
.cf-card h3{margin:0;font-size:15px;font-weight:900;line-height:1.2}
.cf-card-sub{color:var(--cf-mute);font-size:11px;margin-top:2px}
.cf-bar{height:6px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:8px}
.cf-bar i{display:block;height:100%;border-radius:99px;background:var(--cf-accent);transition:width .5s cubic-bezier(.22,1,.36,1)}
.cf-bar[data-tone=ok] i{background:var(--cf-ok)}
.cf-facts{margin:9px 0 0;padding:0;list-style:none}
.cf-facts li{display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:11.5px;border-top:1px solid rgba(255,255,255,.06)}
.cf-facts span{color:var(--cf-mute);min-width:0}
.cf-facts b{font-weight:800;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.cf-next{margin-top:8px;font-size:11.5px;color:#d5dfdb}
.cf-next b{color:var(--cf-mute);font-weight:700}
.cf-actions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.cf-actions .cf-btn{height:30px;border-radius:10px;background:rgba(255,255,255,.08);border:1px solid var(--cf-line);font-size:11.5px}
.cf-actions .cf-primary{background:var(--cf-accent);color:#1b2428;border-color:transparent}
.cf-actions .cf-primary:hover:not(:disabled){background:#ffa53c}
.cf-agent{padding:6px 0;border-top:1px solid rgba(255,255,255,.06)}
.cf-agent:first-child{border-top:0;padding-top:0}
.cf-agent b{font-size:12.5px;font-weight:800}
.cf-agent p{margin:1px 0 0;font-size:11px;color:var(--cf-mute)}
.cf-agent .cf-bar{height:4px;margin-top:5px}
.cf-place{position:absolute;z-index:4;left:var(--cf-pad);bottom:var(--cf-pad);display:flex;gap:8px;align-items:flex-end;transition:opacity .25s ease}
.cf-place .cf-btn{height:50px;border-radius:15px;padding:0 14px 0 12px;gap:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.cf-place .cf-lbl{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.cf-place .cf-menu-list{left:0;right:auto}
.cf-tiles{position:absolute;z-index:4;right:calc(var(--cf-pad) + var(--cf-aside,0px));bottom:var(--cf-pad);display:flex;gap:6px;padding:6px;border-radius:18px;transition:opacity .25s ease}
.cf-tile{position:relative;width:74px;height:60px;border-radius:13px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;background:rgba(255,255,255,.07);border:1px solid var(--cf-line);font-size:9px;font-weight:900;letter-spacing:.05em;text-transform:uppercase;color:var(--cf-text);text-decoration:none;text-align:center;transition:transform .15s ease,background .15s ease}
.cf-tile:hover:not([aria-disabled=true]){transform:translateY(-2px);background:rgba(255,255,255,.14)}
.cf-tile[aria-pressed=true],.cf-menu.cf-open>.cf-tile{background:var(--cf-accent);color:#1b2428;border-color:transparent}
.cf-tile[aria-disabled=true]{opacity:.45;cursor:not-allowed}
.cf-tile>span{max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cf-tile .cf-badge{position:absolute;top:-6px;right:-6px}
.cf-badge{min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:var(--cf-alert);color:#fff;font-size:10px;font-weight:900;display:inline-grid;place-items:center}
.cf-menu{position:relative}
.cf-menu-list{position:absolute;bottom:calc(100% + 12px);right:0;min-width:230px;max-height:min(62vh,560px);overflow-y:auto;padding:6px;display:none}
.cf-menu-list small{display:block;padding:8px 10px 3px;color:var(--cf-mute);font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.cf-menu.cf-open .cf-menu-list{display:block}
.cf-menu-list button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:7px 10px;border-radius:10px;font-size:12px;font-weight:700}
.cf-menu-list button:hover{background:var(--cf-bg2)}
.cf-menu-list span{color:var(--cf-mute);font-size:10.5px;white-space:nowrap}
.cf-tip{position:fixed;z-index:46;pointer-events:none;padding:5px 10px;border-radius:10px;font-size:12px;font-weight:800;white-space:nowrap;opacity:0;transition:opacity .12s ease}
.cf-tip.cf-show{opacity:1}
&.cf-inside .cf-right,&.cf-building .cf-side,&.cf-building .cf-dock,&.cf-building .cf-place,&.cf-building .cf-tiles,&.cf-building .cf-tip,&.bp-open>.cf-dock{opacity:0;pointer-events:none}
&.cf-inside .cf-right,&.cf-building .cf-right{transform:translateX(24px)}
&.cf-building .cf-left,&.cf-building .cf-dock,&.bp-open>.cf-dock{transform:translateX(-24px)}
&.cf-inside .cf-right *,&.cf-building .cf-side *,&.cf-building .cf-dock *,&.cf-building .cf-place *,&.cf-building .cf-tiles *,&.bp-open>.cf-dock *{pointer-events:none}
@media (max-width:1280px){--cf-side:272px}
@media (max-width:1100px){.cf-brand>div:last-child{display:none}.cf-brand{padding:0 6px}.cf-res{padding-right:11px}.cf-res strong{font-size:13.5px}}
@media (max-width:900px){.cf-tile{width:48px;height:48px}.cf-tile>span{display:none}.cf-place .cf-lbl{display:none}}
@media (max-width:640px){.cf-tiles{left:var(--cf-pad);bottom:calc(var(--cf-pad) + 62px);overflow-x:auto}.cf-tile{width:42px;height:42px;flex:none}}
}

/* Builder tools (old top nav, shader dock, coordinate badge) only show in "Công cụ" mode. */
body.cf-frame:not(.cf-tools) #clean-top-nav,body.cf-frame:not(.cf-tools) #game-shader-dock,body.cf-frame:not(.cf-tools) #live-coord-badge{display:none!important}
body.cf-frame.cf-tools #clean-top-nav{top:80px!important}
/* The old Details panel (opened from the builder toolbar) sits below the bars, beside the right column. */
body.cf-frame #main-aside-panel{top:var(--cf-tools-top,166px);right:14px;z-index:46;max-height:calc(100vh - var(--cf-tools-top,166px) - var(--cf-bh,49px) - 35px)}
body.cf-frame:not(.cf-tools) #main-aside-panel{visibility:hidden}
body.cf-frame:not(.cf-tools) .footer{display:none}
body.cf-frame.cf-tools #game-shader-dock{top:var(--cf-dock-top,126px)!important}
body.cf-frame.cf-tools #cockpit-frame-root .cf-side,body.cf-frame.cf-tools #cockpit-frame-root .cf-dock{top:var(--cf-tools-top,166px);max-height:calc(100vh - var(--cf-tools-top,166px) - var(--cf-bh,49px) - 35px)}
/* Inside a building the existing detail wing takes the right side; its KPI header and left wing are replaced by this frame. */
body.cf-frame #cockpit-hud-root{inset:82px 0 70px auto!important;width:392px!important;padding:0 14px 0 0!important;z-index:44!important}
body.cf-frame #cockpit-hud-root>header,body.cf-frame #cockpit-hud-root aside:first-of-type{display:none!important}
body.cf-frame #cockpit-hud-root>div{display:block!important;height:100%;overflow:visible!important}
body.cf-hide-money #cockpit-hud-root .font-mono.font-bold{filter:blur(7px)}
body.cf-frame #cockpit-hud-root aside{position:static;width:auto;padding:0;max-height:100%}
`;

export class CockpitFrame {
  /**
   * @param {object} o
   * @param {object} o.dataConnector  the shared dataConnector
   * @param {object[]} o.buildings    topology entries ({id, legacyId, kind, projectId, name})
   * @param {(b: object) => void} o.onEnterBuilding  fly inside a building
   * @param {() => void} o.onOverview  back to the whole-campus view
   * @param {() => void} [o.onMoneyToggle]  the "hide money" switch changed
   * @param {() => object[]} [o.getDistricts]  client districts ({id, client, landscape, projects, lots})
   * @param {(d: object) => void} [o.onEnterDistrict]  fly to a client district
   */
  constructor({dataConnector, buildings, onEnterBuilding, onOverview, onMoneyToggle, getDistricts, onEnterDistrict}) {
    this.onMoneyToggle = onMoneyToggle;
    this.getDistricts = getDistricts || (() => []);
    this.onEnterDistrict = onEnterDistrict;
    this.data = dataConnector;
    this.buildings = buildings;
    this.byId = new Map(buildings.map(b => [b.id, b]));
    this.onEnterBuilding = onEnterBuilding;
    this.onOverview = onOverview;

    this.hovered = null;
    this.inside = null;
    this.hideMoney = localStorage.getItem(HIDE_MONEY_KEY) === '1';
    document.body.classList.toggle('cf-hide-money', this.hideMoney);
    this.missionsOpen = localStorage.getItem(MISSIONS_KEY) === '1';
    this.query = '';

    this.initDOM();
    this.render();
    this.data.subscribe(() => this.render());
    setInterval(() => this.data.load(), this.data.ttl + 1000);
  }

  initDOM() {
    if (!document.getElementById('cockpit-frame-style')) {
      const style = document.createElement('style');
      style.id = 'cockpit-frame-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    document.body.classList.add('cf-frame');

    const root = document.createElement('div');
    root.id = 'cockpit-frame-root';
    root.innerHTML = `
      <div class="cf-top" role="banner" aria-label="Thanh tài nguyên">
        <div class="cf-chip cf-brand"><div class="cf-brand-mark">AP</div><div><b>AN PHIM</b><span>WORLD</span></div></div>
        <span class="cf-gap"></span>
        <div data-slot="resources" style="display:contents"></div>
      </div>
      <div class="cf-chip cf-dock" role="toolbar" aria-label="Điều hướng">
        <div data-slot="dock" style="display:contents"></div>
        <div class="cf-menu" data-menu="search">
          <button class="cf-ib" data-act="menu" aria-haspopup="true" title="Tìm kiếm" aria-label="Tìm kiếm">${icon('search', 20)}</button>
          <div class="cf-chip cf-menu-list cf-pop-search">
            <div class="cf-search">${icon('search')}<input type="search" data-search placeholder="Tìm dự án, khách hàng, giấy tờ, tòa nhà…" aria-label="Tìm kiếm" autocomplete="off"></div>
            <div data-slot="results"></div>
          </div>
        </div>
        <div data-slot="dashboard" style="display:contents"></div>
        <div class="cf-menu" data-menu="settings">
          <button class="cf-ib" data-act="menu" aria-haspopup="true" title="Cài đặt" aria-label="Cài đặt">${icon('gear', 20)}</button>
          <div class="cf-chip cf-menu-list cf-set" data-slot="controls"></div>
        </div>
      </div>
      <div class="cf-side cf-left" role="complementary" aria-label="Mission và thông báo"><div class="cf-panel cf-grow" data-slot="missions"></div></div>
      <div class="cf-side cf-right" role="complementary" aria-label="Tòa đang trỏ và đội AI">
        <div class="cf-panes">
          <div class="cf-panel" data-slot="building"></div>
          <div class="cf-panel cf-grow" data-slot="agents"></div>
        </div>
        <div class="cf-chip cf-rail" role="toolbar" aria-label="Mở bảng bên phải" data-slot="rail"></div>
      </div>
      <div class="cf-place" role="navigation" aria-label="Khu vực" data-slot="place"></div>
      <div class="cf-chip cf-tiles" role="navigation" aria-label="Đi nhanh" data-slot="jump"></div>
      <div class="cf-chip cf-tip" data-slot="tip"></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.slot = Object.fromEntries([...root.querySelectorAll('[data-slot]')].map(el => [el.dataset.slot, el]));

    root.addEventListener('click', e => this.onClick(e));
    const input = root.querySelector('[data-search]');
    input.addEventListener('input', () => { this.query = input.value; this.renderResults(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeMenus(); });
    input.addEventListener('keydown', e => {
      e.stopPropagation(); // typing must not trigger camera or editor shortcuts
      if (e.key === 'Enter') this.slot.results.querySelector('button')?.click();
      if (e.key === 'Escape') { input.value = this.query = ''; this.renderResults(); input.blur(); this.closeMenus(); }
    });
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest?.('.cf-menu')) this.closeMenus();
      if (!e.target.closest?.('.cf-pop-search') && this.query) { input.value = this.query = ''; this.renderResults(); }
    });
    new ResizeObserver(() => document.body.style.setProperty('--cf-bh', this.slot.jump.offsetHeight + 'px')).observe(this.slot.jump);
    const details = document.getElementById('main-aside-panel');
    if (details) new MutationObserver(() => this.layoutTools()).observe(details, {attributes: true, attributeFilter: ['style']});
    addEventListener('resize', () => { this.layoutTools(); this.fitPanes(); });
    addEventListener('pointermove', e => {
      const tip = this.slot.tip;
      tip.style.left = Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 8) + 'px';
      tip.style.top = (e.clientY + 18) + 'px';
    }, {passive: true});
  }

  // ---- state coming from the 3D scene ---------------------------------------

  /** Building under the pointer (topology entry) or null. The card keeps the last one. */
  setHovered(building) {
    const id = building?.id || null;
    if (id === (this.tipId || null)) return;
    this.tipId = id;
    const tip = this.slot.tip;
    tip.classList.toggle('cf-show', !!id && !this.inside);
    if (!id) return;
    this.hovered = this.byId.get(id) || building;
    tip.textContent = this.label(this.hovered);
    this.renderBuilding();
  }

  /** Building the camera is inside (topology entry) or null for the campus view. */
  /** Replace the building list, when project buildings were added or removed. */
  setBuildings(buildings) {
    this.buildings = buildings;
    this.byId = new Map(buildings.map(b => [b.id, b]));
    this.render();
  }

  setInside(building) {
    this.inside = building ? (this.byId.get(building.id) || building) : null;
    this.root.classList.toggle('cf-inside', !!this.inside);
    this.slot.tip.classList.remove('cf-show');
    this.renderDock();
    this.renderJump();
  }

  /** Builder mode: the frame steps aside for the campus editor. */
  setBuilding(active) {
    if (!!active === this.root.classList.contains('cf-building')) return;
    this.root.classList.toggle('cf-building', !!active);
  }

  /** In tools mode the old builder toolbar and shader dock stack under the resource bar; the panels start below them. */
  layoutTools() {
    const tools = document.body.classList.contains('cf-tools');
    const details = document.getElementById('main-aside-panel');
    const detailsWidth = tools && details ? details.offsetWidth : 0;
    document.body.style.setProperty('--cf-aside', (detailsWidth ? detailsWidth + 10 : 0) + 'px');
    this.root.classList.toggle('cf-details', detailsWidth > 0);
    if (!tools) return;
    const nav = document.getElementById('clean-top-nav');
    const dock = document.getElementById('game-shader-dock');
    const dockTop = 80 + (nav?.offsetHeight || 0) + 6;
    document.body.style.setProperty('--cf-dock-top', dockTop + 'px');
    document.body.style.setProperty('--cf-tools-top', dockTop + (dock ? dock.offsetHeight + 8 : 0) + 'px');
  }

  /** When the window is too short for both right panels, only the one opened last stays. */
  fitPanes() {
    const {building, agents} = this.slot;
    const list = agents.querySelector('.cf-scroll');
    const squeezed = agents.offsetHeight < 150 && list && list.scrollHeight > list.clientHeight;
    if (building.classList.contains('cf-open') && agents.classList.contains('cf-open') && squeezed) {
      (this.lastPane === 'building' ? agents : building).classList.remove('cf-open');
    }
    this.renderRail();
  }

  // ---- helpers ----------------------------------------------------------------

  money(text) {
    return this.hideMoney ? '•••••• đ' : text;
  }

  /** Free text from data can carry amounts ("khoản chi 3.2.0 đ"). */
  text(text) {
    const safe = esc(text);
    return this.hideMoney ? safe.replace(/\d[\d.,]*\s?(đ|VND|vnđ)/g, '•••••• đ') : safe;
  }

  label(building) {
    if (!building) return '';
    if (building.kind === 'project') return this.data.getProject(building.projectId)?.name || building.name;
    return building.name;
  }

  /** The building a search hit or mission points at; projects without a building go to HQ. */
  target({buildingId, projectId, type}) {
    if (buildingId) return this.byId.get(buildingId) || null;
    if (type === 'document') return this.byId.get('bld:facility:documents') || null;
    if (projectId) {
      const p = this.data.getProject(projectId);
      const own = this.buildings.find(b => b.kind === 'project' && this.data.getProject(b.projectId) === p);
      return own || this.byId.get('bld:facility:hq') || null;
    }
    return null;
  }

  // ---- rendering ----------------------------------------------------------------

  render() {
    this.renderResources();
    this.renderDock();
    this.renderControls();
    this.renderMissions();
    this.renderBuilding();
    this.renderAgents();
    this.renderRail();
    this.renderJump();
    this.renderResults();
  }

  renderResources() {
    const kpi = this.data.getKPI();
    this.slot.resources.innerHTML = RESOURCES.map(r => {
      const raw = Number(kpi[r.key]);
      const full = r.text ? kpi[r.text] : kpi[r.key];
      const shown = r.money && this.hideMoney ? '•••' : Number.isFinite(raw) && kpi[r.key] !== null && kpi[r.key] !== '' ? compact(raw) : (full ?? '—');
      const warn = r.warn && raw > 0;
      const b = this.byId.get(r.jump);
      const tip = `${r.label}: ${r.money ? this.money(full ?? '—') : (full ?? '—')}${b ? ' → ' + this.label(b) : ''}`;
      return `<button class="cf-chip cf-res" data-tone="${warn ? 'warn' : ''}" data-enter="${esc(r.jump)}" style="--cf-res-c:${warn ? 'var(--cf-alert)' : r.color}" title="${esc(tip)}" aria-label="${esc(tip)}">
        <span class="cf-res-ico">${icon(r.icon, 17)}</span><strong>${esc(shown)}</strong>
      </button>`;
    }).join('');
  }

  /** Left dock: home and missions (badge = open missions); search and settings are static menus around them. */
  renderDock() {
    const open = this.data.getMissions().open.length;
    this.slot.dock.innerHTML = `
      <button class="cf-ib" data-act="overview" aria-pressed="${!this.inside}" title="Toàn cảnh" aria-label="Toàn cảnh">${icon('home', 20)}</button>
      <button class="cf-ib" data-act="missions" aria-pressed="${this.missionsOpen}" title="Mission hôm nay · ${open} việc" aria-label="Mission hôm nay">${icon('list', 20)}${open ? `<i class="cf-badge">${open}</i>` : ''}</button>`;
    const page = this.data.getWorkspacePage('overview');
    this.slot.dashboard.innerHTML = page?.url
      ? `<a class="cf-ib" href="${esc(page.url)}" target="_blank" rel="noopener" title="Mở dashboard" aria-label="Mở dashboard">${icon('chart', 20)}</a>`
      : `<span class="cf-ib" aria-disabled="true" title="Mở dashboard: chưa có địa chỉ AN PHIM Workspace (workspace.baseUrl trong dữ liệu)">${icon('chart', 20)}</span>`;
    this.slot.missions.parentElement.classList.toggle('cf-open', this.missionsOpen);
    this.slot.missions.parentElement.inert = !this.missionsOpen;
  }

  renderControls() {
    const status = this.data.getDataStatus();
    const s = DATA_STATUS[status.source] || DATA_STATUS.offline;
    const when = status.updatedAt ? new Date(status.updatedAt).toLocaleString('vi-VN') : '';
    const tools = document.body.classList.contains('cf-tools');
    this.slot.controls.innerHTML = `
      <button class="cf-row-btn" data-act="money" aria-pressed="${this.hideMoney}">${icon(this.hideMoney ? 'eyeOff' : 'eye')}${this.hideMoney ? 'Hiện số tiền' : 'Ẩn số tiền'}</button>
      <button class="cf-row-btn" data-act="tools" aria-pressed="${tools}" title="Góc máy, lưới, sửa cảnh">${icon('tools')}Công cụ dựng campus<em>${tools ? 'Đang bật' : ''}</em></button>
      <div class="cf-row-btn" data-tone="${s.tone}" title="${esc(s.title)}"><i class="cf-dot"></i>${esc(s.label)}<em>${esc(when)}</em></div>`;
  }

  /** Link to a Workspace dashboard page; greyed out until workspace.baseUrl is set in the data. */
  link(page, text, cls) {
    if (page?.url) return `<a class="${cls}" href="${esc(page.url)}" target="_blank" rel="noopener" title="${esc(text)}"><span class="cf-lbl">${esc(text)}</span> ${icon('external', 13)}</a>`;
    return `<span class="${cls}" aria-disabled="true" title="Chưa có địa chỉ AN PHIM Workspace (workspace.baseUrl trong dữ liệu)"><span class="cf-lbl">${esc(text)}</span> ${icon('external', 13)}</span>`;
  }

  renderMissions() {
    const {open, done} = this.data.getMissions();
    const notes = this.data.getNotifications();
    const mission = m => {
      const pr = PRIORITY[m.priority] || PRIORITY.low;
      const b = this.target(m);
      return `<button class="cf-mission" data-tone="${pr.tone}" ${b ? `data-enter="${esc(b.id)}"` : 'disabled'}>
        <span class="cf-row">
          <span class="cf-tag" data-tone="${pr.tone}">${pr.label}</span>
          <span class="cf-proj cf-fill">${esc(m.project?.name || '')}</span>
          ${m.tag ? `<span class="cf-tag" data-tone="${m.tag === 'Cần Input' ? 'warn' : 'done'}">${esc(m.tag)}</span>` : ''}
          ${m.time ? `<span class="cf-time">${esc(m.time)}</span>` : ''}
        </span>
        <span class="cf-title">${this.text(m.title)}</span>
        <span class="cf-go">${b ? '→ Đến tòa ' + esc(this.label(b)) : 'Chưa có tòa trên campus'}</span>
      </button>`;
    };
    const note = n => {
      const b = this.target(n);
      const inner = `<i class="cf-dot" data-tone="${esc(n.level === 'alert' ? 'alert' : n.level === 'warn' ? 'warn' : 'info')}"></i><span>${this.text(n.text)}</span>`;
      return b ? `<button class="cf-note" data-enter="${esc(b.id)}" title="→ Đến tòa ${esc(this.label(b))}">${inner}</button>` : `<div class="cf-note">${inner}</div>`;
    };
    this.slot.missions.innerHTML = `
      <div class="cf-h"><span>Mission hôm nay</span><small>${open.length} việc</small><button data-act="missions" aria-label="Đóng Mission">${icon('close', 13)}</button></div>
      <div class="cf-body cf-scroll">
        ${open.map(mission).join('') || '<div class="cf-empty">Không còn việc nào chờ anh.</div>'}
        ${done.length ? `<div class="cf-sub">Đã hoàn thành (${done.length})</div>${done.map(m => `<div class="cf-done">${this.text(m.title)}${m.project ? ' (' + esc(m.project.name) + ')' : ''}</div>`).join('')}` : ''}
        ${notes.length ? `<div class="cf-sub">Thông báo</div>${notes.map(note).join('')}` : ''}
      </div>`;
  }

  /** The right side stays a row of small icons; a panel opens only when its icon is pressed. */
  renderRail() {
    const btn = (pane, name, label) => {
      const open = this.slot[pane].classList.contains('cf-open');
      return `<button class="cf-ib" data-pane="${pane}" aria-pressed="${open}" title="${label}" aria-label="${label}">${icon(name, 20)}</button>`;
    };
    this.slot.rail.innerHTML = btn('building', 'building', 'Tòa đang trỏ') + btn('agents', 'robot', 'AI Workforce Trace');
    this.root.classList.toggle('cf-pane-open', !!this.root.querySelector('.cf-right .cf-panel.cf-open'));
  }

  renderBuilding() {
    const b = this.hovered;
    const head = `<div class="cf-h"><span>Tòa đang trỏ</span><small>rê chuột</small>${paneClose('building')}</div>`;
    if (!b) {
      this.slot.building.innerHTML = head + `<div class="cf-empty">Rê chuột lên một tòa nhà để xem tóm tắt. Bấm vào tòa để vào bên trong.</div>`;
      return;
    }
    const c = this.data.getBuildingSummary(b);
    const enter = `<button class="cf-btn cf-primary" data-enter="${esc(b.id)}">→ Vào bên trong</button>`;
    if (!c || !c.connected) {
      this.slot.building.innerHTML = head + `<div class="cf-card">
        <div class="cf-row"><h3 class="cf-fill">${esc(b.name)}</h3><span class="cf-tag" data-tone="idle">CHƯA KẾT NỐI</span></div>
        <div class="cf-card-sub">Tòa này chưa có dữ liệu từ dashboard.</div>
        <div class="cf-actions">${enter}</div></div>`;
      return;
    }
    const tone = c.status?.tone || 'info';
    this.slot.building.innerHTML = head + `<div class="cf-card">
      <div class="cf-row"><h3 class="cf-fill" title="${esc(c.title)}">${esc(c.title)}</h3>${c.status ? `<span class="cf-tag" data-tone="${esc(tone)}">${esc(String(c.status.label).toUpperCase())}</span>` : ''}</div>
      <div class="cf-card-sub">${esc(c.subtitle)}${c.progress != null ? ` · ${c.progress}% mốc` : ''}</div>
      ${c.progress != null ? `<div class="cf-bar" data-tone="${tone === 'done' ? 'ok' : ''}"><i style="width:${c.progress}%"></i></div>` : ''}
      <ul class="cf-facts">${c.facts.map(f => `<li><span>${this.text(f.label)}</span><b>${f.money ? esc(this.money(f.value)) : this.text(f.value)}</b></li>`).join('')}</ul>
      ${c.next ? `<div class="cf-next"><b>Việc tiếp theo:</b> ${this.text(c.next)}</div>` : ''}
      <div class="cf-actions">${enter}${c.page ? this.link(c.page, 'Mở ' + c.page.label, 'cf-btn') : ''}</div>
    </div>`;
  }

  renderAgents() {
    const agents = this.data.getAgents();
    this.slot.agents.innerHTML = `
      <div class="cf-h"><span>AI Workforce Trace</span><small>${agents.filter(a => a.status === 'active').length}/${agents.length} đang chạy</small>${paneClose('agents')}</div>
      <div class="cf-body cf-scroll">${agents.map(a => {
        const active = a.status === 'active';
        return `<div class="cf-agent">
          <div class="cf-row"><b>${esc(a.name)}</b>${active ? '<span class="cf-tag" data-tone="ok">ACTIVE</span>' : ''}<span class="cf-fill"></span><span class="cf-time">${a.loadPct != null ? esc(a.loadPct) + '%' : 'đang rảnh'}</span></div>
          <p>${esc(a.task || a.role)}</p>
          ${a.loadPct != null ? `<div class="cf-bar" data-tone="ok"><i style="width:${Math.max(0, Math.min(100, Number(a.loadPct)))}%"></i></div>` : ''}
        </div>`;
      }).join('') || '<div class="cf-empty">Chưa có dữ liệu agent.</div>'}</div>`;
  }

  /** Bottom-left: where the camera is, with the menu of districts and infrastructure. Bottom-right: main buildings as tiles. */
  renderJump() {
    const counts = this.data.getMissionCounts();
    const badge = id => counts.get(id) ? `<i class="cf-badge" title="${counts.get(id)} việc chờ anh">${counts.get(id)}</i>` : '';
    const main = MAIN_JUMPS.map(id => this.byId.get(id)).filter(Boolean);
    const districts = this.getDistricts().filter(d => d.client);
    // Projects are listed under their client, in the order of the client list.
    const clientOf = b => this.data.getProjectClient(this.data.getProject(b.projectId));
    const order = this.data.getClients().map(c => c.id);
    const projects = this.buildings.filter(b => b.kind === 'project')
      .map((b, i) => ({b, i, c: clientOf(b)}))
      .sort((x, y) => (order.indexOf(x.c?.id) - order.indexOf(y.c?.id)) || x.i - y.i);
    const projectRows = projects.map(({b, c}, i) => `${c && c.id !== projects[i - 1]?.c?.id ? `<small>${esc(c.name)}</small>` : ''}<button data-enter="${esc(b.id)}">${esc(this.label(b))}<span>${esc(this.data.getProject(b.projectId)?.status || '')}${badge(b.id)}</span></button>`).join('');
    const infra = this.buildings.filter(b => b.kind !== 'project' && !MAIN_JUMPS.includes(b.id));
    const marketing = this.data.getWorkspacePage('marketing');

    this.slot.place.innerHTML = `<div class="cf-menu" data-menu="place">
        <button class="cf-chip cf-btn" data-act="menu" aria-haspopup="true" title="Khu vực: toàn cảnh, quận, hạ tầng">${icon('cube', 20)}<span class="cf-lbl">${esc(this.inside ? this.label(this.inside) : 'Campus')}</span>${icon('up', 14)}</button>
        <div class="cf-chip cf-menu-list">
          <button data-act="overview">Toàn cảnh campus</button>
          ${districts.length ? `<small>Quận</small>${districts.map(d => `<button data-district="${esc(d.id)}">${esc(d.client.name)}<span>${esc(d.landscape || '')} · ${d.projects}/${d.lots} lô</span></button>`).join('')}` : ''}
          ${infra.length ? `<small>Hạ tầng</small>${infra.map(b => `<button data-enter="${esc(b.id)}">${esc(this.label(b))}<span>${esc(this.data.getBuildingSummary(b)?.status?.label || 'Chưa kết nối')}${badge(b.id)}</span></button>`).join('')}` : ''}
        </div>
      </div>
      ${this.inside ? `<button class="cf-chip cf-btn" data-act="overview" title="Esc">${icon('close', 13)} Thoát</button>` : ''}`;

    const tile = (b, t) => `<button class="cf-tile" data-enter="${esc(b.id)}" aria-pressed="${String(this.inside?.id === b.id)}" title="${esc(b.name)}">${icon(t.icon, 22)}<span>${esc(t.short || b.name)}</span>${badge(b.id)}</button>`;
    this.slot.jump.innerHTML = `
      ${main.map(b => tile(b, TILES[b.id])).join('')}
      ${marketing && !this.byId.has('bld:facility:marketing') ? (marketing.url
        ? `<a class="cf-tile" href="${esc(marketing.url)}" target="_blank" rel="noopener" title="Marketing (mở dashboard)">${icon('megaphone', 22)}<span>Marketing</span></a>`
        : `<span class="cf-tile" aria-disabled="true" title="Marketing: chưa có địa chỉ AN PHIM Workspace">${icon('megaphone', 22)}<span>Marketing</span></span>`) : ''}
      ${!projects.length ? '' : `<div class="cf-menu" data-menu="projects">
        <button class="cf-tile" data-act="menu" aria-haspopup="true" aria-pressed="${projects.some(({b}) => b.id === this.inside?.id)}" title="Dự án">${icon('crane', 22)}<span>Dự án</span></button>
        <div class="cf-chip cf-menu-list">${projectRows}</div>
      </div>`}`;
  }

  renderResults() {
    const q = this.query.trim().toLowerCase();
    if (!q) { this.slot.results.innerHTML = ''; return; }
    const hits = [
      ...this.buildings.filter(b => b.kind !== 'project' && b.name.toLowerCase().includes(q)).map(b => ({label: b.name, sub: 'Tòa nhà', buildingId: b.id})),
      ...this.data.search(q)
    ].slice(0, 12);
    this.slot.results.innerHTML = `<div class="cf-chip cf-results">${hits.map(h => {
      const b = this.target(h);
      return `<button ${b ? `data-enter="${esc(b.id)}"` : 'disabled'}><b>${this.text(h.label)}</b><span>${this.text(h.sub)}${b ? ` · <em>→ ${esc(this.label(b))}</em>` : ''}</span></button>`;
    }).join('') || '<div class="cf-empty">Không tìm thấy.</div>'}</div>`;
  }

  // ---- events -------------------------------------------------------------------

  closeMenus() {
    this.root.querySelectorAll('.cf-menu.cf-open').forEach(m => m.classList.remove('cf-open'));
  }

  onClick(e) {
    const enter = e.target.closest('[data-enter]');
    if (enter) {
      const b = this.byId.get(enter.dataset.enter);
      this.closeMenus();
      if (this.query) { this.root.querySelector('[data-search]').value = this.query = ''; this.renderResults(); }
      if (b) this.onEnterBuilding(b);
      return;
    }
    const district = e.target.closest('[data-district]');
    if (district) {
      const d = this.getDistricts().find(x => x.id === district.dataset.district);
      this.closeMenus();
      if (d) this.onEnterDistrict?.(d);
      return;
    }
    const pane = e.target.closest('[data-pane]')?.dataset.pane;
    if (pane) {
      this.slot[pane].classList.toggle('cf-open');
      this.lastPane = pane;
      this.fitPanes();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'overview') {
      this.closeMenus();
      this.onOverview();
    } else if (act === 'missions') {
      this.missionsOpen = !this.missionsOpen;
      localStorage.setItem(MISSIONS_KEY, this.missionsOpen ? '1' : '0');
      this.renderDock();
    } else if (act === 'money') {
      this.hideMoney = !this.hideMoney;
      localStorage.setItem(HIDE_MONEY_KEY, this.hideMoney ? '1' : '0');
      document.body.classList.toggle('cf-hide-money', this.hideMoney);
      this.render();
      this.onMoneyToggle?.();
    } else if (act === 'tools') {
      document.body.classList.toggle('cf-tools');
      this.renderControls();
      this.layoutTools();
      this.fitPanes();
    } else if (act === 'menu') {
      const menu = e.target.closest('.cf-menu');
      const open = menu.classList.contains('cf-open');
      this.closeMenus();
      menu.classList.toggle('cf-open', !open);
      if (!open && menu.dataset.menu === 'search') menu.querySelector('[data-search]').focus();
    }
  }
}
