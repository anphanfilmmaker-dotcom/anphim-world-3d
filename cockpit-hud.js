/**
 * cockpit-hud.js
 * Renders the 3-Zone Symmetrical Cockpit HUD Overlay (Top Macro Bar, Left Wing, Right Wing)
 * for AN PHIM World Command Dashboard.
 */

export class CockpitHUD {
  constructor(dataConnector, onJumpDepartment, onExit) {
    this.dataConnector = dataConnector;
    this.onJumpDepartment = onJumpDepartment;
    this.onExit = onExit;

    this.currentDept = 'hq';
    this.activeFinanceTab = 'expenses';
    this.activeBriefingTab = 'tramanh';
    this.financeFilter = {
      month: 'all',
      project: 'all',
      category: 'all',
      method: 'all'
    };

    this.container = null;
    this.initDOM();
  }

  initDOM() {
    let hud = document.getElementById('cockpit-hud-root');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'cockpit-hud-root';
      hud.className = 'fixed inset-0 pointer-events-none z-40 flex flex-col p-4 select-none';
      document.body.appendChild(hud);
    }
    this.container = hud;
  }

  render(buildingId = 'bld:facility:hq') {
    const kpi = this.dataConnector.getKPI();
    const recentExp = this.dataConnector.getRecentExpenses();
    const allExp = this.dataConnector.getAllExpenses();
    const allInc = this.dataConnector.getAllIncomes();
    const briefing = this.dataConnector.getDailyBriefing();

    // Map building ID to view
    let viewType = 'hq';
    if (buildingId.includes('bank') || buildingId.includes('reserve')) viewType = 'bank';
    else if (buildingId.includes('ai') || buildingId.includes('hermes')) viewType = 'ai';
    else if (buildingId.includes('doc') || buildingId.includes('drive')) viewType = 'docs';
    else if (buildingId.includes('sched')) viewType = 'schedule';
    else if (buildingId.includes('project')) viewType = 'project';
    this.currentDept = viewType;

    this.container.innerHTML = `
      <!-- TOP MACRO BAR -->
      <header class="pointer-events-auto bg-[#121418]/90 backdrop-blur-md rounded-xl px-5 py-3 mb-3 flex flex-wrap items-center justify-between gap-4 border border-white/10 shadow-2xl">
        <div class="flex items-center space-x-3">
          <div class="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center font-bold text-emerald-400 text-sm">
            AP
          </div>
          <div>
            <h1 class="text-xs sm:text-sm font-bold text-white tracking-wide uppercase flex items-center gap-2">
              AN PHIM World <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">Cockpit v2.5</span>
            </h1>
            <p class="text-[11px] text-neutral-400">Command Center · Three.js Diorama</p>
          </div>
        </div>

        <!-- Macro Stats in Header -->
        <div class="flex items-center space-x-4 text-xs font-mono">
          <div class="text-right">
            <span class="text-neutral-400 text-[11px]">Tiền mặt sẵn có:</span>
            <span class="text-emerald-400 font-bold ml-1 text-xs sm:text-sm">${kpi.cashAvailableFormatted}</span>
          </div>
          <div class="h-5 w-[1px] bg-neutral-800"></div>
          <div class="text-right">
            <span class="text-neutral-400 text-[11px]">Dự án đang chạy:</span>
            <span class="text-cyan-400 font-bold ml-1 text-xs sm:text-sm">${kpi.activeProjectsCount} Jobs</span>
          </div>
          <div class="h-5 w-[1px] bg-neutral-800"></div>
          <button id="btn-hud-exit" class="px-2.5 py-1 bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition border border-white/10">
            ✕ Thoát Inspect
          </button>
        </div>
      </header>

      <!-- 3-ZONE COCKPIT SPREAD -->
      <div class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 pointer-events-none overflow-hidden">
        
        <!-- LEFT WING PANEL (Macro KPIs + Jump Switcher) -->
        <aside class="lg:col-span-3 pointer-events-auto flex flex-col gap-3 overflow-y-auto pr-1">
          
          <!-- KPI Box -->
          <div class="bg-[#121418]/90 backdrop-blur-md rounded-xl p-3.5 border border-white/10 shadow-2xl flex flex-col gap-2.5">
            <div class="flex items-center justify-between pb-1.5 border-b border-neutral-800">
              <span class="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Chỉ Số Vĩ Mô (CEO)</span>
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            </div>

            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="bg-neutral-900/60 p-2 rounded-lg border border-neutral-800">
                <span class="text-[10px] text-neutral-400 block">Tiền mặt khả dụng</span>
                <span class="font-bold text-emerald-400 font-mono text-xs">${kpi.cashAvailableFormatted}</span>
                <span class="text-[9px] text-emerald-500 block">↑ Khớp sao kê</span>
              </div>
              <div class="bg-neutral-900/60 p-2 rounded-lg border border-neutral-800">
                <span class="text-[10px] text-neutral-400 block">Khoản phải thu</span>
                <span class="font-bold text-cyan-400 font-mono text-xs">${kpi.receivableFormatted}</span>
                <span class="text-[9px] text-neutral-400 block">Wincity, Nexius</span>
              </div>
              <div class="bg-neutral-900/60 p-2 rounded-lg border border-neutral-800">
                <span class="text-[10px] text-neutral-400 block">Dự án đang chạy</span>
                <span class="font-bold text-amber-400 font-mono text-xs">${kpi.activeProjectsCount} Jobs</span>
                <span class="text-[9px] text-rose-400 block">1 Cần revise</span>
              </div>
              <div class="bg-neutral-900/60 p-2 rounded-lg border border-neutral-800">
                <span class="text-[10px] text-neutral-400 block">Thiếu giấy tờ</span>
                <span class="font-bold text-orange-400 font-mono text-xs">${kpi.missingDocumentsCount} Jobs</span>
                <span class="text-[9px] text-orange-400 block">Chờ biên bản TL</span>
              </div>
            </div>
          </div>

          <!-- Quick Jump Buttons -->
          <div class="bg-[#121418]/90 backdrop-blur-md rounded-xl p-3 border border-white/10 shadow-2xl flex flex-col gap-1.5 text-xs">
            <span class="text-[11px] font-mono uppercase tracking-wider text-neutral-400 mb-1">Điều Hướng Nhanh (Jump)</span>
            <button data-jump="bld:facility:hq" class="w-full py-1.5 px-2.5 bg-neutral-900/80 hover:bg-emerald-500/10 border border-neutral-800 hover:border-emerald-500/40 rounded-lg text-left flex items-center justify-between transition ${viewType === 'hq' ? 'border-emerald-500 text-emerald-400 font-bold' : 'text-neutral-300'}">
              <span class="flex items-center gap-1.5">🏛️ <span>Trụ Sở Chính (HQ)</span></span>
              <span class="text-neutral-500 text-[10px]">→</span>
            </button>
            <button data-jump="bld:facility:bank" class="w-full py-1.5 px-2.5 bg-neutral-900/80 hover:bg-emerald-500/10 border border-neutral-800 hover:border-emerald-500/40 rounded-lg text-left flex items-center justify-between transition ${viewType === 'bank' ? 'border-emerald-500 text-emerald-400 font-bold' : 'text-neutral-300'}">
              <span class="flex items-center gap-1.5">🏦 <span>Ban Tài Chính & Két Sắt</span></span>
              <span class="text-neutral-500 text-[10px]">→</span>
            </button>
            <button data-jump="bld:facility:ai" class="w-full py-1.5 px-2.5 bg-neutral-900/80 hover:bg-cyan-500/10 border border-neutral-800 hover:border-cyan-500/40 rounded-lg text-left flex items-center justify-between transition ${viewType === 'ai' ? 'border-cyan-500 text-cyan-400 font-bold' : 'text-neutral-300'}">
              <span class="flex items-center gap-1.5">🤖 <span>AI Studio (5 Agents)</span></span>
              <span class="text-neutral-500 text-[10px]">→</span>
            </button>
            <button data-jump="bld:facility:documents" class="w-full py-1.5 px-2.5 bg-neutral-900/80 hover:bg-amber-500/10 border border-neutral-800 hover:border-amber-500/40 rounded-lg text-left flex items-center justify-between transition ${viewType === 'docs' ? 'border-amber-500 text-amber-400 font-bold' : 'text-neutral-300'}">
              <span class="flex items-center gap-1.5">📂 <span>Nhà Giấy Tờ & Pháp Lý</span></span>
              <span class="text-neutral-500 text-[10px]">→</span>
            </button>
            <button data-jump="bld:facility:schedule" class="w-full py-1.5 px-2.5 bg-neutral-900/80 hover:bg-emerald-500/10 border border-neutral-800 hover:border-emerald-500/40 rounded-lg text-left flex items-center justify-between transition ${viewType === 'schedule' ? 'border-emerald-500 text-emerald-400 font-bold' : 'text-neutral-300'}">
              <span class="flex items-center gap-1.5">📅 <span>Kiosk Lịch Trình (Schedule)</span></span>
              <span class="text-neutral-500 text-[10px]">→</span>
            </button>
          </div>

        </aside>

        <!-- CENTER 3D VIEWPORT GAP (Leaves Center 6 Cols unobstructed for 3D X-Ray) -->
        <div class="lg:col-span-5 pointer-events-none"></div>

        <!-- RIGHT WING PANEL (Contextual Actions, Ledger, Briefing) -->
        <aside class="lg:col-span-4 pointer-events-auto flex flex-col gap-3 overflow-y-auto pr-1">
          ${this._renderRightWing(viewType, kpi, recentExp, allExp, allInc, briefing, buildingId)}
        </aside>

      </div>
    `;

    this._bindEvents();
  }

  _renderRightWing(viewType, kpi, recentExp, allExp, allInc, briefing, buildingId) {
    if (viewType === 'bank') {
      return this._renderBankLedger(allExp, allInc);
    }

    if (viewType === 'project') {
      const proj = this.dataConnector.getProject(buildingId);
      return this._renderProjectCard(proj);
    }

    // Default: HQ Executive View
    return this._renderHQView(kpi, recentExp, briefing);
  }

  _renderHQView(kpi, recentExp, briefing) {
    return `
      <!-- Recent 3-Day Expenses -->
      <div class="bg-[#121418]/90 backdrop-blur-md rounded-xl p-3.5 border border-white/10 shadow-2xl flex flex-col gap-2">
        <div class="flex items-center justify-between pb-1.5 border-b border-neutral-800">
          <span class="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Chi Phí 3 Ngày Gần Nhất</span>
          <span class="text-[10px] text-emerald-400 font-mono">Đã đối soát</span>
        </div>
        <div class="space-y-1.5 text-xs">
          ${recentExp.map(e => `
            <div class="flex items-center justify-between p-2 rounded bg-neutral-900/60 border border-neutral-800/80">
              <div class="overflow-hidden pr-2">
                <span class="font-bold text-white block truncate text-[11px]">${e.payee || e.description || ""}</span>
                <span class="text-[10px] text-neutral-400">${e.date} · ${e.category}</span>
              </div>
              <span class="text-rose-400 font-mono font-bold text-xs shrink-0">${e.amountFormatted}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Daily Briefing Feed -->
      <div class="bg-[#121418]/90 backdrop-blur-md rounded-xl p-3.5 border border-white/10 shadow-2xl flex flex-col gap-2.5">
        <div class="flex items-center justify-between pb-1.5 border-b border-neutral-800">
          <span class="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Báo Cáo Hàng Ngày</span>
          <div class="flex gap-1 text-[10px]">
            <button id="tab-brief-tramanh" class="px-2 py-0.5 rounded ${this.activeBriefingTab === 'tramanh' ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30' : 'text-neutral-400 hover:text-white'}">
              Trâm Anh PM
            </button>
            <button id="tab-brief-hermes" class="px-2 py-0.5 rounded ${this.activeBriefingTab === 'hermes' ? 'bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/30' : 'text-neutral-400 hover:text-white'}">
              Hermes Lab
            </button>
          </div>
        </div>

        ${this.activeBriefingTab === 'tramanh' ? `
          <div class="text-xs space-y-2">
            <div class="p-2.5 rounded bg-neutral-900/60 border border-neutral-800 text-[11px] leading-relaxed">
              <span class="text-emerald-400 font-bold block mb-1">🎯 Tiến độ Dự án Hôm Nay:</span>
              <p class="text-neutral-300">
                ${briefing.tramanh.activeProjectsSummary}<br>
                ${briefing.tramanh.highlights.map(h => `• ${h}`).join('<br>')}
              </p>
            </div>
            <div class="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-center justify-between">
              <span>⚠️ ${briefing.tramanh.pendingActionsSummary}</span>
              <span class="font-bold underline cursor-pointer">Xem ngay</span>
            </div>
          </div>
        ` : `
          <div class="text-xs space-y-2">
            <div class="p-2.5 rounded bg-neutral-900/60 border border-neutral-800 text-[11px] leading-relaxed">
              <span class="text-cyan-400 font-bold block mb-1">🤖 Cronjobs & Tự Động Hóa:</span>
              <p class="text-neutral-300">
                • Trạng thái: ${briefing.hermes.systemStatus}<br>
                • Quét mail: ${briefing.hermes.mailScanStatus}<br>
                • Supabase DB: ${briefing.hermes.dbLatency}<br>
                • Backup: ${briefing.hermes.backupStatus}
              </p>
            </div>
          </div>
        `}

        <!-- CEO Action Pending Pulse Button -->
        <button class="w-full py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-950/40 transition">
          <span class="w-2 h-2 rounded-full bg-white animate-ping"></span>
          <span>DUYỆT ${kpi.pendingActionsCount} QUYẾT ĐỊNH CHỜ SẾP</span>
        </button>
      </div>
    `;
  }

  _renderBankLedger(allExp, allInc) {
    const isExpenses = this.activeFinanceTab === 'expenses';
    const list = isExpenses ? allExp : allInc;
    const totalSum = list.reduce((sum, item) => sum + (item.amount || 0), 0);
    const formattedSum = totalSum.toLocaleString('vi-VN') + ' đ';

    return `
      <div class="bg-[#121418]/95 backdrop-blur-md rounded-xl p-3.5 border border-white/10 shadow-2xl flex flex-col gap-2.5 max-h-[calc(100vh-6rem)]">
        
        <!-- Top Tabs & Total Filtered Sum -->
        <div class="flex items-center justify-between pb-1.5 border-b border-neutral-800">
          <div class="flex space-x-1.5 text-xs">
            <button id="btn-tab-exp" class="px-2.5 py-1 rounded-md font-bold transition ${isExpenses ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-neutral-900 text-neutral-400 hover:text-white'}">
              ↘ KHOẢN CHI (${allExp.length})
            </button>
            <button id="btn-tab-inc" class="px-2.5 py-1 rounded-md font-bold transition ${!isExpenses ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-neutral-900 text-neutral-400 hover:text-white'}">
              ↗ KHOẢN THU (${allInc.length})
            </button>
          </div>
          <div class="text-right">
            <span class="text-[9px] text-neutral-400 block font-mono">TỔNG LỌC</span>
            <span class="text-xs sm:text-sm font-bold text-amber-400 font-mono">${formattedSum}</span>
          </div>
        </div>

        <!-- 4-Filter Dropdowns -->
        <div class="grid grid-cols-2 gap-1.5 text-[10px]">
          <select class="bg-neutral-900 border border-neutral-800 text-neutral-300 rounded px-1.5 py-1">
            <option>Tất cả tháng ▾</option>
          </select>
          <select class="bg-neutral-900 border border-neutral-800 text-neutral-300 rounded px-1.5 py-1">
            <option>Tất cả dự án ▾</option>
          </select>
          <select class="bg-neutral-900 border border-neutral-800 text-neutral-300 rounded px-1.5 py-1">
            <option>Tất cả danh mục ▾</option>
          </select>
          <select class="bg-neutral-900 border border-neutral-800 text-neutral-300 rounded px-1.5 py-1">
            <option>PT thanh toán ▾</option>
          </select>
        </div>

        <!-- Transaction Rows List (Exact match with Sếp's uploaded photo) -->
        <div class="space-y-1.5 overflow-y-auto max-h-[380px] custom-scroll pr-1 text-xs">
          ${list.slice(0, 30).map(t => `
            <div class="p-2 rounded bg-neutral-900/80 border border-neutral-800 hover:border-neutral-700 transition">
              <div class="flex items-center gap-1.5 mb-1 text-[9px]">
                <span class="text-neutral-400 font-mono">${t.date}</span>
                ${t.paymentmethod ? `<span class="px-1 py-0.2 rounded bg-neutral-800 text-neutral-300 font-mono">${t.paymentmethod.toUpperCase()}</span>` : ''}
                <span class="px-1 py-0.2 rounded bg-blue-500/20 text-blue-400">${t.projectname || 'CÔNG TY'}</span>
                ${t.category ? `<span class="px-1 py-0.2 rounded bg-amber-500/20 text-amber-400">${t.category}</span>` : ''}
              </div>
              <div class="flex justify-between items-center">
                <div class="overflow-hidden pr-2">
                  <span class="font-bold text-white block truncate text-[11px]">${t.payee || t.client || t.description || 'Giao dịch'}</span>
                  <span class="text-[10px] text-neutral-400 block truncate">${t.notes || ''}</span>
                </div>
                <span class="font-mono font-bold text-xs shrink-0 ${isExpenses ? 'text-white' : 'text-emerald-400'}">${t.amountFormatted}</span>
              </div>
            </div>
          `).join('')}
        </div>

      </div>
    `;
  }

  _renderProjectCard(proj) {
    if (!proj) {
      return `
        <div class="bg-[#121418]/90 backdrop-blur-md rounded-xl p-4 border border-white/10 shadow-2xl text-xs text-neutral-400">
          Chọn một dự án để xem chi tiết.
        </div>
      `;
    }

    return `
      <div class="bg-[#121418]/90 backdrop-blur-md rounded-xl p-4 border border-white/10 shadow-2xl flex flex-col gap-3 text-xs">
        <div class="flex justify-between items-center pb-2 border-b border-neutral-800">
          <div>
            <h2 class="font-bold text-white text-sm">${proj.name}</h2>
            <span class="text-[10px] text-neutral-400 font-mono">${proj.client} · Hạn: ${proj.duedate || 'N/A'}</span>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
            ${proj.status}
          </span>
        </div>

        <!-- Budget & Received -->
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="bg-neutral-900/60 p-2 rounded border border-neutral-800">
            <span class="text-[10px] text-neutral-400 block">Tổng ngân sách</span>
            <span class="font-bold text-emerald-400 font-mono">${proj.budgetFormatted}</span>
          </div>
          <div class="bg-neutral-900/60 p-2 rounded border border-neutral-800">
            <span class="text-[10px] text-neutral-400 block">Đã thanh toán</span>
            <span class="font-bold text-cyan-400 font-mono">${proj.receivedFormatted}</span>
          </div>
        </div>

        <!-- Milestones list -->
        <div>
          <span class="text-[11px] font-mono uppercase tracking-wider text-neutral-400 block mb-1.5">Tiến Độ Milestones:</span>
          <div class="space-y-1">
            ${(proj.milestones || []).map(m => `
              <div class="flex items-center justify-between p-1.5 rounded bg-neutral-900/60 border border-neutral-800 text-[11px]">
                <span class="${m.completed ? 'text-neutral-400 line-through' : 'text-neutral-200'}">
                  ${m.completed ? '✓' : '○'} ${m.name}
                </span>
                <span class="text-[10px] text-neutral-500 font-mono">${m.date || ''}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Google Drive HTTPS Link -->
        <a href="https://drive.google.com/drive/search?q=${encodeURIComponent(proj.name)}" target="_blank" class="w-full py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/40 rounded-lg text-center font-bold text-xs transition flex items-center justify-center gap-1.5">
          <span>📂</span> <span>Mở Thư Mục Google Drive (HTTPS)</span>
        </a>
      </div>
    `;
  }

  _bindEvents() {
    // Exit button
    const exitBtn = document.getElementById('btn-hud-exit');
    if (exitBtn) exitBtn.onclick = () => this.onExit && this.onExit();

    // Jump department buttons
    this.container.querySelectorAll('[data-jump]').forEach(btn => {
      btn.onclick = () => {
        const targetId = btn.dataset.jump;
        this.onJumpDepartment && this.onJumpDepartment(targetId);
      };
    });

    // Briefing tabs
    const tabTrâmAnh = document.getElementById('tab-brief-tramanh');
    const tabHermes = document.getElementById('tab-brief-hermes');
    if (tabTrâmAnh) tabTrâmAnh.onclick = () => { this.activeBriefingTab = 'tramanh'; this.render('bld:facility:hq'); };
    if (tabHermes) tabHermes.onclick = () => { this.activeBriefingTab = 'hermes'; this.render('bld:facility:hq'); };

    // Bank tabs
    const tabExp = document.getElementById('btn-tab-exp');
    const tabInc = document.getElementById('btn-tab-inc');
    if (tabExp) tabExp.onclick = () => { this.activeFinanceTab = 'expenses'; this.render('bld:facility:bank'); };
    if (tabInc) tabInc.onclick = () => { this.activeFinanceTab = 'incomes'; this.render('bld:facility:bank'); };
  }
}
