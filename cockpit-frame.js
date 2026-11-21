/**
 * cockpit-frame.js
 * Strategy-game frame around the campus view (approved sketch 1):
 * resource bar on top, missions and notifications on the left, the hovered
 * building and the AI workforce on the right, quick jump at the bottom.
 * View only. Every value comes from dataConnector; buildings come from the topology.
 */

const HIDE_MONEY_KEY = 'anphim.cockpit.hideMoney';

// Top resource bar: KPI field -> label and the building a click flies to.
const RESOURCES = [
  {key: 'cashAvailableFormatted', label: 'Tiền mặt sẵn có', icon: 'coin', money: true, jump: 'bld:facility:bank'},
  {key: 'receivableFormatted', label: 'Khoản thu dự kiến', icon: 'incoming', money: true, jump: 'bld:facility:bank'},
  {key: 'activeProjectsCount', label: 'Dự án đang chạy', icon: 'crane', jump: 'bld:facility:hq'},
  {key: 'missingDocumentsCount', label: 'Thiếu giấy tờ', icon: 'doc', warn: true, jump: 'bld:facility:documents'}
];

// Buildings with their own quick-jump button; other facilities go under "Hạ tầng".
const MAIN_JUMPS = ['bld:facility:hq', 'bld:facility:bank', 'bld:facility:documents', 'bld:facility:schedule', 'bld:facility:ai', 'bld:facility:marketing'];

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
  robot: '<rect x="4.5" y="8" width="15" height="11" rx="3.5"/><path d="M12 8V4.5M9 13v1.5M15 13v1.5M2 12.5v3M22 12.5v3"/><circle cx="12" cy="3.5" r="1"/>'
};

const icon = (name, size = 16) =>
  `<svg class="cf-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const paneClose = pane => `<button data-pane="${pane}" aria-label="Thu gọn">${icon('close', 13)}</button>`;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const CSS = `
#cockpit-frame-root{--cf-bg:rgba(24,33,38,.94);--cf-bg2:rgba(255,255,255,.06);--cf-line:rgba(255,255,255,.10);--cf-text:#f3f6f4;--cf-mute:#9db0ab;--cf-accent:#f7941d;--cf-teal:#4fc9bb;--cf-ok:#5fd68a;--cf-warn:#ffc440;--cf-alert:#ff6a5a;--cf-info:#7cc4f5;--cf-pad:14px;--cf-top:58px;--cf-side:308px;
  position:fixed;inset:0;z-index:45;pointer-events:none;color:var(--cf-text);font:600 12px/1.35 ui-rounded,"SF Pro Rounded","Nunito","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;user-select:none}
#cockpit-frame-root{
*{box-sizing:border-box}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0;text-align:left}
button:disabled{cursor:not-allowed;opacity:.5}
.cf-chip,.cf-panel{background:var(--cf-bg);border:1px solid var(--cf-line);border-radius:16px;box-shadow:0 4px 0 rgba(0,0,0,.22),0 14px 30px rgba(0,0,0,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:auto}
.cf-ico{flex:none}
.cf-top{z-index:2;position:absolute;top:var(--cf-pad);left:var(--cf-pad);right:var(--cf-pad);height:var(--cf-top);display:flex;gap:8px;align-items:stretch}
.cf-brand{display:flex;align-items:center;gap:10px;padding:0 16px 0 12px;flex:none}
.cf-brand-mark{width:34px;height:34px;border-radius:10px;background:var(--cf-accent);color:#1b2428;display:grid;place-items:center;font-weight:900;font-size:15px;letter-spacing:-.5px}
.cf-brand b{display:block;font-size:14px;font-weight:900;letter-spacing:.06em}
.cf-brand span{display:block;font-size:9px;letter-spacing:.16em;color:var(--cf-mute)}
.cf-res{display:flex;align-items:center;gap:9px;padding:0 13px 0 9px;flex:none;transition:transform .15s ease,border-color .15s ease}
.cf-res:hover{transform:translateY(-1px);border-color:rgba(247,148,29,.6)}
.cf-res-ico{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:rgba(247,148,29,.16);color:var(--cf-accent);flex:none}
.cf-res[data-tone=warn] .cf-res-ico{background:rgba(255,106,90,.16);color:var(--cf-alert)}
.cf-res small{display:block;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--cf-mute);white-space:nowrap}
.cf-res strong{display:block;font-size:17px;font-weight:900;line-height:1.15;white-space:nowrap;font-variant-numeric:tabular-nums}
.cf-res[data-tone=warn] strong{color:var(--cf-warn)}
.cf-search{flex:1 1 160px;min-width:0;display:flex;align-items:center;gap:8px;padding:0 14px;position:relative;color:var(--cf-mute)}
.cf-search input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--cf-text);font:inherit;font-size:13px;user-select:text}
.cf-search input::placeholder{color:var(--cf-mute)}
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
.cf-side{position:absolute;top:calc(var(--cf-pad) + var(--cf-top) + 10px);width:var(--cf-side);max-height:calc(100vh - var(--cf-top) - var(--cf-bh,49px) - 55px);display:flex;flex-direction:column;gap:10px;transition:transform .35s cubic-bezier(.22,1,.36,1),opacity .25s ease}
.cf-left{left:var(--cf-pad)}
.cf-right{right:var(--cf-pad);width:auto;align-items:flex-end}
.cf-right .cf-panel{width:var(--cf-side)}
.cf-right [data-slot=building]{flex:none}
.cf-right .cf-panel:not(.cf-open){display:none}
.cf-rail{display:flex;gap:4px;padding:5px;border-radius:14px}
.cf-rail button{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--cf-mute);transition:background .15s ease,color .15s ease}
.cf-rail button:hover{background:var(--cf-bg2);color:var(--cf-text)}
.cf-rail button[aria-pressed=true]{background:var(--cf-accent);color:#1b2428}
.cf-panel{padding:12px;min-height:0;display:flex;flex-direction:column}
.cf-panel.cf-grow{flex:0 1 auto;overflow:hidden}
.cf-scroll{overflow-y:auto;min-height:0;margin-right:-6px;padding-right:6px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent}
.cf-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:var(--cf-teal);margin-bottom:8px}
.cf-h small{font-size:10.5px;letter-spacing:0;text-transform:none;color:var(--cf-mute);font-weight:700}
.cf-h button{color:var(--cf-mute);display:grid;place-items:center;width:22px;height:22px;border-radius:7px;transition:transform .2s ease}
.cf-h button:hover{background:var(--cf-bg2);color:var(--cf-text)}
.cf-collapsed .cf-h{margin-bottom:0}
.cf-collapsed .cf-h button{transform:rotate(-90deg)}
.cf-collapsed .cf-body{display:none}
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
.cf-toast{position:absolute;top:calc(var(--cf-pad) + var(--cf-top) + 10px);right:calc(var(--cf-pad) + var(--cf-rw) + 12px);max-width:340px;display:flex;align-items:flex-start;gap:8px;padding:8px 8px 8px 12px;border-color:rgba(255,196,64,.55);font-size:11.5px}
.cf-toast button.cf-go{display:inline}
.cf-toast .cf-x{color:var(--cf-mute);display:grid;place-items:center;width:20px;height:20px;border-radius:6px;flex:none}
.cf-toast .cf-x:hover{background:var(--cf-bg2);color:var(--cf-text)}
.cf-bottom{position:absolute;left:50%;bottom:var(--cf-pad);transform:translateX(-50%);display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;padding:7px 8px 7px 16px;width:max-content;max-width:calc(100vw - 28px)}
.cf-bottom>small{font-size:10px;font-weight:900;letter-spacing:.16em;color:var(--cf-mute);margin-right:4px;white-space:nowrap}
.cf-bottom .cf-btn{height:34px;border-radius:11px;background:rgba(255,255,255,.07);border:1px solid var(--cf-line)}
.cf-bottom .cf-btn[aria-pressed=true]{background:var(--cf-accent);color:#1b2428}
.cf-badge{min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:var(--cf-alert);color:#fff;font-size:10px;font-weight:900;display:inline-grid;place-items:center}
.cf-menu{position:relative}
.cf-menu-list{position:absolute;bottom:calc(100% + 12px);right:0;min-width:230px;padding:6px;display:none}
.cf-menu.cf-open .cf-menu-list{display:block}
.cf-menu-list button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:7px 10px;border-radius:10px;font-size:12px;font-weight:700}
.cf-menu-list button:hover{background:var(--cf-bg2)}
.cf-menu-list span{color:var(--cf-mute);font-size:10.5px;white-space:nowrap}
.cf-tip{position:fixed;z-index:46;pointer-events:none;padding:5px 10px;border-radius:10px;font-size:12px;font-weight:800;white-space:nowrap;opacity:0;transition:opacity .12s ease}
.cf-tip.cf-show{opacity:1}
--cf-rw:86px;
&.cf-pane-open{--cf-rw:var(--cf-side)}
&.cf-inside .cf-right,&.cf-inside .cf-toast,&.cf-building .cf-side,&.cf-building .cf-toast,&.cf-building .cf-bottom,&.cf-building .cf-tip{opacity:0;pointer-events:none}
&.cf-inside .cf-right,&.cf-building .cf-right{transform:translateX(24px)}
&.cf-building .cf-left{transform:translateX(-24px)}
&.cf-inside .cf-right *,&.cf-building .cf-side *,&.cf-building .cf-bottom *{pointer-events:none}
@media (max-width:1480px){--cf-side:272px;.cf-res strong{font-size:15px}.cf-res-ico{display:none}.cf-res{padding:0 12px}.cf-brand span{display:none}}
@media (max-width:1180px){.cf-brand>div:last-child{display:none}.cf-brand{padding:0 10px}.cf-res small{font-size:8.5px;letter-spacing:.04em}}
@media (max-width:980px){&.cf-pane-open .cf-toast{display:none}.cf-top .cf-lbl{display:none}.cf-top .cf-btn{padding:0 11px}.cf-res small{display:none}.cf-bottom>small{display:none}.cf-bottom{padding-left:8px}}
}

/* Builder tools (old top nav, shader dock, coordinate badge) only show in "Công cụ" mode. */
body.cf-frame:not(.cf-tools) #clean-top-nav,body.cf-frame:not(.cf-tools) #game-shader-dock,body.cf-frame:not(.cf-tools) #live-coord-badge{display:none!important}
body.cf-frame.cf-tools #clean-top-nav{top:80px!important}
body.cf-frame.cf-tools #game-shader-dock{top:var(--cf-dock-top,126px)!important}
body.cf-frame.cf-tools #cockpit-frame-root .cf-side,body.cf-frame.cf-tools #cockpit-frame-root .cf-toast{top:var(--cf-tools-top,166px);max-height:calc(100vh - var(--cf-tools-top,166px) - var(--cf-bh,49px) - 35px)}
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
   */
  constructor({dataConnector, buildings, onEnterBuilding, onOverview, onMoneyToggle}) {
    this.onMoneyToggle = onMoneyToggle;
    this.data = dataConnector;
    this.buildings = buildings;
    this.byId = new Map(buildings.map(b => [b.id, b]));
    this.onEnterBuilding = onEnterBuilding;
    this.onOverview = onOverview;

    this.hovered = null;
    this.inside = null;
    this.hideMoney = localStorage.getItem(HIDE_MONEY_KEY) === '1';
    document.body.classList.toggle('cf-hide-money', this.hideMoney);
    this.dismissed = new Set();
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
        <div class="cf-chip cf-brand"><div class="cf-brand-mark">AP</div><div><b>AN PHIM WORLD</b><span>TRUNG TÂM ĐIỀU HÀNH 3D</span></div></div>
        <div data-slot="resources" style="display:contents"></div>
        <div class="cf-chip cf-search">${icon('search')}<input type="search" data-search placeholder="Tìm dự án, khách hàng, giấy tờ, tòa nhà…" aria-label="Tìm kiếm" autocomplete="off"><div data-slot="results"></div></div>
        <div data-slot="controls" style="display:contents"></div>
      </div>
      <div class="cf-side cf-left" role="complementary" aria-label="Mission và thông báo"><div class="cf-panel cf-grow" data-slot="missions"></div></div>
      <div class="cf-side cf-right" role="complementary" aria-label="Tòa đang trỏ và đội AI">
        <div class="cf-chip cf-rail" role="toolbar" aria-label="Mở bảng bên phải" data-slot="rail"></div>
        <div class="cf-panel" data-slot="building"></div>
        <div class="cf-panel cf-grow" data-slot="agents"></div>
      </div>
      <div data-slot="toast"></div>
      <div class="cf-chip cf-bottom" role="navigation" aria-label="Đi nhanh" data-slot="jump"></div>
      <div class="cf-chip cf-tip" data-slot="tip"></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.slot = Object.fromEntries([...root.querySelectorAll('[data-slot]')].map(el => [el.dataset.slot, el]));

    root.addEventListener('click', e => this.onClick(e));
    const input = root.querySelector('[data-search]');
    input.addEventListener('input', () => { this.query = input.value; this.renderResults(); });
    input.addEventListener('keydown', e => {
      e.stopPropagation(); // typing must not trigger camera or editor shortcuts
      if (e.key === 'Enter') this.slot.results.querySelector('button')?.click();
      if (e.key === 'Escape') { input.value = this.query = ''; this.renderResults(); input.blur(); }
    });
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest?.('.cf-menu')) this.closeMenus();
      if (!e.target.closest?.('.cf-search') && this.query) { input.value = this.query = ''; this.renderResults(); }
    });
    new ResizeObserver(() => root.style.setProperty('--cf-bh', this.slot.jump.offsetHeight + 'px')).observe(this.slot.jump);
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
  setInside(building) {
    this.inside = building ? (this.byId.get(building.id) || building) : null;
    this.root.classList.toggle('cf-inside', !!this.inside);
    this.slot.tip.classList.remove('cf-show');
    this.renderJump();
  }

  /** Builder mode: the frame steps aside for the campus editor. */
  setBuilding(active) {
    if (!!active === this.root.classList.contains('cf-building')) return;
    this.root.classList.toggle('cf-building', !!active);
  }

  /** In tools mode the old builder toolbar and shader dock stack under the resource bar; the panels start below them. */
  layoutTools() {
    if (!document.body.classList.contains('cf-tools')) return;
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
    this.renderControls();
    this.renderMissions();
    this.renderBuilding();
    this.renderAgents();
    this.renderRail();
    this.renderToast();
    this.renderJump();
    this.renderResults();
  }

  renderResources() {
    const kpi = this.data.getKPI();
    this.slot.resources.innerHTML = RESOURCES.map(r => {
      const value = kpi[r.key] ?? '—';
      const tone = r.warn && Number(value) > 0 ? 'warn' : '';
      const b = this.byId.get(r.jump);
      return `<button class="cf-chip cf-res" data-tone="${tone}" data-enter="${esc(r.jump)}" title="${esc(r.label)} → ${esc(this.label(b))}">
        <span class="cf-res-ico">${icon(r.icon, 17)}</span>
        <span><small>${esc(r.label)}</small><strong>${esc(r.money ? this.money(value) : value)}</strong></span>
      </button>`;
    }).join('');
  }

  renderControls() {
    const status = this.data.getDataStatus();
    const s = DATA_STATUS[status.source] || DATA_STATUS.offline;
    const when = status.updatedAt ? ' · cập nhật ' + new Date(status.updatedAt).toLocaleString('vi-VN') : '';
    const page = this.data.getWorkspacePage('overview');
    const tools = document.body.classList.contains('cf-tools');
    this.slot.controls.innerHTML = `
      <button class="cf-chip cf-btn" data-act="money" aria-pressed="${this.hideMoney}" title="${this.hideMoney ? 'Hiện số tiền' : 'Ẩn số tiền'}" aria-label="Ẩn hoặc hiện số tiền">${icon(this.hideMoney ? 'eyeOff' : 'eye')}</button>
      <div class="cf-chip cf-btn" data-tone="${s.tone}" title="${esc(s.title + when)}"><i class="cf-dot"></i><span class="cf-lbl">${esc(s.label)}</span></div>
      ${this.link(page, 'Mở dashboard', 'cf-chip cf-btn')}
      <button class="cf-chip cf-btn" data-act="tools" aria-pressed="${tools}" title="Công cụ dựng campus: góc máy, lưới, sửa cảnh" aria-label="Công cụ dựng campus">${icon('tools')}</button>`;
  }

  /** Link to a Workspace dashboard page; greyed out until workspace.baseUrl is set in the data. */
  link(page, text, cls) {
    if (page?.url) return `<a class="${cls}" href="${esc(page.url)}" target="_blank" rel="noopener" title="${esc(text)}"><span class="cf-lbl">${esc(text)}</span> ${icon('external', 13)}</a>`;
    return `<span class="${cls}" aria-disabled="true" title="Chưa có địa chỉ AN PHIM Workspace (workspace.baseUrl trong dữ liệu)"><span class="cf-lbl">${esc(text)}</span> ${icon('external', 13)}</span>`;
  }

  renderMissions() {
    const {open, done} = this.data.getMissions();
    const notes = this.data.getNotifications();
    const collapsed = this.slot.missions.classList.contains('cf-collapsed');
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
      <div class="cf-h"><span>Mission hôm nay</span><small>${open.length} việc</small><button data-act="collapse" aria-label="Thu gọn Mission" aria-expanded="${!collapsed}">${icon('chevron', 15)}</button></div>
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
      return `<button data-pane="${pane}" aria-pressed="${open}" title="${label}" aria-label="${label}">${icon(name, 18)}</button>`;
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

  renderToast() {
    const n = this.data.getNotifications().find(x => x.type === 'deadline' && !this.dismissed.has(x.id));
    if (!n) { this.slot.toast.innerHTML = ''; return; }
    const b = this.target(n);
    this.slot.toast.innerHTML = `<div class="cf-chip cf-toast" role="status">
      <span class="cf-tag" data-tone="warn">SẮP DEADLINE</span>
      <span>${this.text(n.text.replace(/^Sắp deadline:\s*/i, ''))} ${b ? `<button class="cf-go" data-enter="${esc(b.id)}">→ Đến tòa ${esc(this.label(b))}</button>` : ''}</span>
      <button class="cf-x" data-dismiss="${esc(n.id)}" aria-label="Đóng">${icon('close', 13)}</button>
    </div>`;
  }

  renderJump() {
    const counts = this.data.getMissionCounts();
    const badge = id => counts.get(id) ? `<i class="cf-badge" title="${counts.get(id)} việc chờ anh">${counts.get(id)}</i>` : '';
    const pressed = id => String(this.inside?.id === id);
    const main = MAIN_JUMPS.map(id => this.byId.get(id)).filter(Boolean);
    const projects = this.buildings.filter(b => b.kind === 'project');
    const infra = this.buildings.filter(b => b.kind !== 'project' && !MAIN_JUMPS.includes(b.id));
    const marketing = this.data.getWorkspacePage('marketing');
    const menu = (key, title, list, sub) => !list.length ? '' : `<div class="cf-menu" data-menu="${key}">
      <button class="cf-btn" data-act="menu" aria-haspopup="true" aria-pressed="${list.some(b => b.id === this.inside?.id)}">${title} ${icon('chevron', 13)}</button>
      <div class="cf-chip cf-menu-list">${list.map(b => `<button data-enter="${esc(b.id)}">${esc(this.label(b))}<span>${sub(b)}${badge(b.id)}</span></button>`).join('')}</div>
    </div>`;
    this.slot.jump.innerHTML = `<small>ĐI NHANH</small>
      <button class="cf-btn" data-act="overview" aria-pressed="${!this.inside}">Toàn cảnh</button>
      ${main.map(b => `<button class="cf-btn" data-enter="${esc(b.id)}" aria-pressed="${pressed(b.id)}">${esc(b.name)}${badge(b.id)}</button>`).join('')}
      ${marketing && !this.byId.has('bld:facility:marketing') ? this.link(marketing, 'Marketing', 'cf-btn') : ''}
      ${menu('projects', 'Dự án', projects, b => esc(this.data.getProject(b.projectId)?.status || ''))}
      ${menu('infra', 'Hạ tầng', infra, b => esc(this.data.getBuildingSummary(b)?.status?.label || 'Chưa kết nối'))}
      ${this.inside ? `<button class="cf-btn" data-act="overview" title="Esc">${icon('close', 13)} Thoát</button>` : ''}`;
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
    const dismiss = e.target.closest('[data-dismiss]');
    if (dismiss) {
      this.dismissed.add(dismiss.dataset.dismiss);
      this.renderToast();
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
      this.onOverview();
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
    } else if (act === 'collapse') {
      this.slot.missions.classList.toggle('cf-collapsed');
      this.renderMissions();
    } else if (act === 'menu') {
      const menu = e.target.closest('.cf-menu');
      const open = menu.classList.contains('cf-open');
      this.closeMenus();
      menu.classList.toggle('cf-open', !open);
    }
  }
}
