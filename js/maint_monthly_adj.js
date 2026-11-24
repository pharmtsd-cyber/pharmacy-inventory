import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { currentDept, session } from './config.js';

const UNIT_PREFIX_MAP = { opd: 'BA', ipd: 'BF', erd: 'BE', comp: 'BG' };
const unitPrefix = UNIT_PREFIX_MAP[currentDept] || 'BF';

let adjInitData = { headers: [], rows: [], dates: { D1: '', F1: '' }, state: { availableSymbols: [] } };
let adjFilteredRows = [];
let adjSort = { colIndex: -1, order: 'none' };
let adjNeedsRefresh = false;
let adjVerHeaders = [], adjVerRecords = [], adjVerFiltered = [];
let adjAppHeaders = [], adjAppRecords = [], adjTableMap = {};
let adjHiddenAppCols = new Set([0, 5, 8, 9, 10, 11, 13, 14, 15, 16]);
let adjMarkerData = { masterList: [], trackedItems: [], availableSymbols: [] };
let activeAdjUnitCode = null;
let pendingAdjUnitTarget = null;

function setAdjSaveStatus(msg, color = '#6c757d') {
  const el = document.getElementById('adj-save-status');
  if (el) { el.innerText = msg; el.style.color = color; }
}

export function initMonthlyAdjPortal() {
  activeAdjUnitCode = null;
  pendingAdjUnitTarget = null;
  switchView('view-monthly-adj');
  document.getElementById('adj-unit-picker-panel')?.classList.remove('d-none');
  document.getElementById('adj-workspace-panel')?.classList.add('d-none');
}

export function selectAdjUnitCard(uCode, uName, portalKey) {
  pendingAdjUnitTarget = { uCode, uName, portalKey };
  const empInput = document.getElementById('adj-unit-auth-id');
  const titleEl = document.getElementById('adj-unit-auth-title');
  if (titleEl) titleEl.innerText = `【${uName}】調帳權限驗證`;
  if (empInput) empInput.value = session.id || '';
  new window.bootstrap.Modal(document.getElementById('adjUnitAuthModal')).show();
}

export function confirmAdjUnitAuth() {
  if (!pendingAdjUnitTarget) return;
  const empId = (document.getElementById('adj-unit-auth-id')?.value || '').trim();
  if (!empId) return alert('請輸入員工編號');

  toggleLoader(true, `驗證 ${pendingAdjUnitTarget.uName} 調帳權限...`);
  fetchBackend('checkLogin', { id: empId, portalKey: pendingAdjUnitTarget.portalKey }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('❌ 權限驗證失敗：' + (res?.message || '無權限'));

    window.bootstrap.Modal.getInstance(document.getElementById('adjUnitAuthModal'))?.hide();
    activeAdjUnitCode = pendingAdjUnitTarget.uCode;
    const badgeEl = document.getElementById('adj-active-unit-badge');
    if (badgeEl) {
      const colorMap = { BA: '#1A365D', BF: '#1E4D2B', BE: '#7A1717', BG: '#4E342E' };
      badgeEl.style.backgroundColor = colorMap[activeAdjUnitCode] || '#6F42C1';
      badgeEl.innerText = `${pendingAdjUnitTarget.uName} (${res.userName})`;
    }
    document.getElementById('adj-unit-picker-panel')?.classList.add('d-none');
    document.getElementById('adj-workspace-panel')?.classList.remove('d-none');
    switchAdjTab('adj-tab-inventory');
    loadAdjInventoryData();
  }).catch(err => { toggleLoader(false); alert('驗證異常：' + err.message); });
}

export function switchAdjTab(tabId) {
  ['adj-tab-inventory', 'adj-tab-records', 'adj-tab-marker', 'adj-tab-version'].forEach(id => {
    const sec = document.getElementById(id);
    if (sec) sec.classList.toggle('d-none', id !== tabId);
  });
  document.querySelectorAll('#adj-main-tabs .nav-link').forEach(btn => {
    const active = btn.getAttribute('data-target') === tabId;
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-academic', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-white', !active);
    btn.classList.toggle('text-academic', !active);
  });
  if (tabId === 'adj-tab-inventory' && adjNeedsRefresh) { adjNeedsRefresh = false; loadAdjInventoryData(true); }
  else if (tabId === 'adj-tab-records') loadAdjAppRecords();
  else if (tabId === 'adj-tab-marker') loadAdjMarkers();
  else if (tabId === 'adj-tab-version') loadAdjVersionRecords();
}

export function toggleAdjColGroup(groupNum) {
  const tbl = document.getElementById('adj-data-table');
  if (!tbl) return;
  if (groupNum === 1) tbl.classList.toggle('hide-g1');
  else if (groupNum === 2) tbl.classList.toggle('hide-g2');
  else if (groupNum === 3) tbl.classList.toggle('hide-g3');
}

export function loadAdjInventoryData(silent = false) {
  const unitCode = activeAdjUnitCode || unitPrefix;
  const fDate = document.getElementById('adj-param-forecast')?.value || '';
  const rDate = document.getElementById('adj-param-reference')?.value || '';
  if (!silent) toggleLoader(true, '載入月盤點調帳總表...');
  fetchBackend('getMonthlyAdjInitData', { unitCode, forecastDate: fDate, referenceDate: rDate }).then(res => {
    if (!silent) toggleLoader(false);
    if (!res || !res.success) return alert('載入調帳資料失敗：' + (res?.message || '未知錯誤'));
    adjInitData = res;
    if (document.getElementById('adj-param-forecast')) document.getElementById('adj-param-forecast').value = res.dates?.D1 || '';
    if (document.getElementById('adj-param-reference')) document.getElementById('adj-param-reference').value = res.dates?.F1 || '';
    const symSel = document.getElementById('adj-filter-symbol');
    if (symSel) {
      const prev = symSel.value;
      symSel.innerHTML = '<option value="ALL">全部符號</option>';
      (res.state?.availableSymbols || []).forEach(s => symSel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));
      if (Array.from(symSel.options).some(o => o.value === prev)) symSel.value = prev;
    }
    if (!silent) setAdjSaveStatus('載入完成，尚未修改', 'green');
    applyAdjFilters();
  }).catch(err => { if (!silent) toggleLoader(false); alert('載入失敗：' + err.message); });
}

export function handleAdjSortClick(colIndex) {
  if (adjSort.colIndex === colIndex) adjSort.order = adjSort.order === 'none' ? 'desc' : (adjSort.order === 'desc' ? 'asc' : 'none');
  else { adjSort.colIndex = colIndex; adjSort.order = 'desc'; }
  applyAdjFilters();
}

function getAdjSortValue(row, colIndex) {
  if (colIndex === 7) return Number(row.rawF) || 0;
  if (colIndex === 11) return Number(row.rawJ) || 0;
  if (colIndex === 18) return Number(row.rawQ) || 0;
  const v = row.rowData[colIndex];
  const n = Number(v);
  return (v !== '' && v !== null && !isNaN(n)) ? n : String(v ?? '');
}

export function applyAdjFilters() {
  let rows = [...(adjInitData.rows || [])];
  const kw = (document.getElementById('adj-search-input')?.value || '').toLowerCase().trim();
  const sym = document.getElementById('adj-filter-symbol')?.value || 'ALL';
  const fltPrev = document.getElementById('adj-filter-prev')?.value || 'ALL';
  const fltCurr = document.getElementById('adj-filter-curr')?.value || 'HAS_VALUE';
  if (kw) rows = rows.filter(r => kw.split(/\s+/).every(t => (`${r.rowData[0]} ${r.rowData[1]}`).toLowerCase().includes(t)));
  if (sym !== 'ALL') rows = rows.filter(r => String(r.rowData[12] || '').trim() === sym);
  if (fltPrev !== 'ALL') rows = rows.filter(r => { const hv = (Number(r.rowData[2]) !== 0 || Number(r.rowData[3]) !== 0 || Number(r.rowData[5]) !== 0); return fltPrev === 'HAS_VALUE' ? hv : !hv; });
  if (fltCurr !== 'ALL') rows = rows.filter(r => { const hv = (Number(r.rowData[8]) !== 0 || Number(r.rowData[9]) !== 0); return fltCurr === 'HAS_VALUE' ? hv : !hv; });
  if (adjSort.colIndex !== -1 && adjSort.order !== 'none') {
    rows.sort((a, b) => {
      const vA = getAdjSortValue(a, adjSort.colIndex), vB = getAdjSortValue(b, adjSort.colIndex);
      return (typeof vA === 'number' && typeof vB === 'number') ? (adjSort.order === 'desc' ? vB - vA : vA - vB) : (adjSort.order === 'desc' ? String(vB).localeCompare(String(vA)) : String(vA).localeCompare(String(vB)));
    });
  } else rows.sort((a, b) => String(a.rowData[0]).localeCompare(String(b.rowData[0])));
  adjFilteredRows = rows;
  renderAdjTable(rows);
}

function renderAdjTable(rowsToRender) {
  const thead = document.getElementById('adj-thead'), tbody = document.getElementById('adj-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = '<tr>' + (adjInitData.headers || []).map((h, i) => {
    const icon = adjSort.colIndex === i ? (adjSort.order === 'asc' ? ' 🔼' : (adjSort.order === 'desc' ? ' 🔽' : '')) : ' ↕';
    const grp = i >= 2 && i <= 7 ? 'head-g1 col-g1' : (i >= 8 && i <= 11 ? 'head-g2 col-g2' : (i >= 13 && i <= 18 ? 'head-g3 col-g3' : ''));
    return `<th class="${grp} text-nowrap" style="cursor:pointer;" onclick="handleAdjSortClick(${i})">${h}${icon}</th>`;
  }).join('') + '<th class="text-center text-nowrap">盤點明細</th></tr>';
  tbody.innerHTML = '';
  (rowsToRender || []).forEach(r => {
    const tr = document.createElement('tr');
    if (r.rowData[12]) tr.classList.add('table-warning');
    r.rowData.forEach((cellData, i) => {
      const td = document.createElement('td');
      if (i >= 2 && i <= 7) td.classList.add('col-g1');
      else if (i >= 8 && i <= 11) td.classList.add('col-g2');
      else if (i >= 13 && i <= 18) td.classList.add('col-g3');
      if (i === 3 || i === 13 || i === 14) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'form-control form-control-sm border-primary';
        inp.style.width = i === 14 ? '120px' : '85px';
        inp.value = cellData;
        inp.oninput = () => {
          r.rowData[i] = inp.value; inp.style.backgroundColor = '#fff9c4'; setAdjSaveStatus('⚠️ 有變更未存檔', '#dc3545');
          if (i === 3) {
            const theory = (Number(r.rowData[2]) || 0) - ((inp.value !== '' && !isNaN(inp.value)) ? Number(inp.value) : 0);
            const diff = (Number(r.rowData[5]) || 0) - theory;
            const pct = theory <= 0 ? diff : diff / theory;
            r.rowData[4] = theory; r.rowData[6] = diff; r.rowData[7] = (pct * 100).toFixed(2) + '%'; r.rawF = pct;
            if (tr.children[4]) tr.children[4].innerText = theory; if (tr.children[6]) tr.children[6].innerText = diff; if (tr.children[7]) tr.children[7].innerText = r.rowData[7];
          } else if (i === 13) {
            const adjVal = (inp.value !== '' && !isNaN(inp.value)) ? Number(inp.value) : (Number(r.rowData[8]) || 0);
            const sapDay = Number(r.rowData[9]) || 0;
            const dDiff = adjVal - sapDay;
            const dPct = sapDay <= 0 ? dDiff : dDiff / sapDay;
            r.rowData[15] = adjVal; r.rowData[17] = dDiff; r.rowData[18] = (dPct * 100).toFixed(2) + '%'; r.rawQ = dPct;
            if (tr.children[15]) tr.children[15].innerText = adjVal; if (tr.children[17]) tr.children[17].innerText = dDiff; if (tr.children[18]) tr.children[18].innerText = r.rowData[18];
          }
        };
        td.appendChild(inp);
      } else if (i === 12) {
        const btn = document.createElement('button');
        const curSym = String(cellData || '').trim();
        btn.className = 'btn btn-sm ' + (curSym ? 'btn-warning text-dark fw-bold' : 'btn-outline-secondary');
        btn.innerText = curSym || '+ 標記';
        btn.onclick = () => {
          const nextSym = prompt(`設定 [${r.rowData[0]}] 標記（留空則移除）:`, curSym);
          if (nextSym === null) return;
          const unitCode = activeAdjUnitCode || unitPrefix;
          const req = nextSym.trim() === '' ? fetchBackend('removeMonthlyAdjMarker', { unitCode, code: r.rowData[0] }) : fetchBackend('saveMonthlyAdjMarker', { unitCode, code: r.rowData[0], name: r.rowData[1], symbol: nextSym.trim(), note: '', creator: r.rowData[0] });
          req.then(() => { r.rowData[12] = nextSym.trim(); adjNeedsRefresh = true; applyAdjFilters(); });
        };
        td.appendChild(btn);
      } else td.innerText = cellData;
      tr.appendChild(td);
    });
    const tdAct = document.createElement('td'); tdAct.className = 'text-center';
    const bDet = document.createElement('button'); bDet.className = 'btn btn-sm btn-outline-info py-0'; bDet.innerText = '📄 紀錄';
    bDet.onclick = () => { if (document.getElementById('adj-rec-search')) document.getElementById('adj-rec-search').value = r.rowData[0]; switchAdjTab('adj-tab-records'); };
    tdAct.appendChild(bDet); tr.appendChild(tdAct); tbody.appendChild(tr);
  });
}

export function handleAdjSaveVersion() {
  const reportDate = document.getElementById('adj-param-reference')?.value || '';
  if (!reportDate) return alert('請先選取盤點基準日！');
  const unitCode = activeAdjUnitCode || unitPrefix;
  if (!confirm(`即將儲存為 ${reportDate.substring(0, 7)} 月份版本（同月將覆蓋），確定嗎？`)) return;
  toggleLoader(true, '正在儲存月盤點調帳版本...');
  fetchBackend('saveMonthlyAdjVersion', { unitCode, reportDate, rows: JSON.stringify(adjInitData.rows || []) }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('存檔失敗：' + (res?.message || '未知錯誤'));
    setAdjSaveStatus(`✔️ 已存檔 (${reportDate.substring(0, 7)})`, 'green');
    showToast(res.message || '已儲存版本');
    loadAdjInventoryData(true);
  }).catch(err => { toggleLoader(false); alert('存檔異常：' + err.message); });
}

export function loadAdjAppRecords() {
  const unitCode = activeAdjUnitCode || unitPrefix;
  const startDate = document.getElementById('adj-rec-start')?.value || '';
  const endDate = document.getElementById('adj-rec-end')?.value || '';
  toggleLoader(true, '載入月盤點輸入區紀錄...');
  fetchBackend('getMonthlyAdjAppRecords', { unitCode, startDate, endDate }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    adjAppHeaders = res.headers || []; adjAppRecords = res.records || []; adjTableMap = res.tableMap || {};
    applyAdjAppRecordFilters();
  }).catch(err => { toggleLoader(false); alert('載入異常：' + err.message); });
}

export function applyAdjAppRecordFilters() {
  const kw = (document.getElementById('adj-rec-search')?.value || '').toLowerCase().trim();
  let rows = kw ? adjAppRecords.filter(r => kw.split(/\s+/).every(t => (`${r[1] || ''} ${r[2] || ''} ${r[12] || ''}`).toLowerCase().includes(t))) : [...adjAppRecords];
  const thead = document.getElementById('adj-rec-thead'), tbody = document.getElementById('adj-rec-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = '<tr>' + adjAppHeaders.map((h, i) => adjHiddenAppCols.has(i) ? '' : `<th class="text-nowrap">${h}</th>`).join('') + '</tr>';
  tbody.innerHTML = rows.map(r => '<tr>' + r.map((c, i) => adjHiddenAppCols.has(i) ? '' : `<td>${c}</td>`).join('') + '</tr>').join('');
}

export function loadAdjMarkers() {
  const unitCode = activeAdjUnitCode || unitPrefix;
  toggleLoader(true, '載入標記追蹤藥品...');
  fetchBackend('getMonthlyAdjMarkers', { unitCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    adjMarkerData = res;
    applyAdjMarkerFilters();
  }).catch(err => { toggleLoader(false); alert('載入異常：' + err.message); });
}

export function handleAdjMarkerAutocomplete() {
  const val = (document.getElementById('adj-mk-code')?.value || '').toLowerCase().trim();
  const listEl = document.getElementById('adj-mk-autocomplete');
  if (!listEl || !val) { if (listEl) listEl.style.display = 'none'; return; }
  const matches = (adjMarkerData.masterList || []).filter(m => m.code.toLowerCase().includes(val) || m.name.toLowerCase().includes(val)).slice(0, 20);
  listEl.innerHTML = matches.map(m => `<div class="search-dropdown-item" onclick="selectAdjMarkerDrug('${m.code}', '${m.name.replace(/'/g, "\\'")}')"><strong>${m.code}</strong> - ${m.name}</div>`).join('');
  listEl.style.display = matches.length ? 'block' : 'none';
}

export function selectAdjMarkerDrug(code, name) {
  document.getElementById('adj-mk-code').value = code;
  document.getElementById('adj-mk-name').value = name;
  document.getElementById('adj-mk-autocomplete').style.display = 'none';
}

export function saveAdjMarkerItem() {
  const code = (document.getElementById('adj-mk-code')?.value || '').trim();
  const name = (document.getElementById('adj-mk-name')?.value || '').trim();
  const symbol = (document.getElementById('adj-mk-symbol')?.value || '').trim();
  const note = (document.getElementById('adj-mk-note')?.value || '').trim();
  if (!code) return alert('請輸入藥品代碼');
  const unitCode = activeAdjUnitCode || unitPrefix;
  fetchBackend('saveMonthlyAdjMarker', { unitCode, code, name, symbol, note, creator: document.getElementById('nav-user-id')?.innerText || '' }).then(() => {
    adjNeedsRefresh = true; showToast('標記已儲存'); loadAdjMarkers();
  });
}

export function applyAdjMarkerFilters() {
  const kw = (document.getElementById('adj-marker-search')?.value || '').toLowerCase().trim();
  const sym = document.getElementById('adj-marker-sym-filter')?.value || 'ALL';
  const tbody = document.getElementById('adj-marker-tbody');
  if (!tbody) return;
  const list = (adjMarkerData.trackedItems || []).filter(item => (sym === 'ALL' || item.symbol === sym) && (!kw || kw.split(/\s+/).every(t => (`${item.code} ${item.name}`).toLowerCase().includes(t))));
  tbody.innerHTML = list.map(item => `<tr><td class="fw-bold">${item.code}</td><td>${item.name}</td><td>${item.symbol}</td><td>${item.note}</td><td>${item.creator || ''}</td><td>${item.updateTime || ''}</td><td><button class="btn btn-sm btn-outline-danger py-0" onclick="deleteExistingAdjMarker('${item.code}')">移除</button></td></tr>`).join('');
}

export function deleteExistingAdjMarker(code) {
  if (!confirm(`確定移除 [${code}] 的標記嗎？`)) return;
  const unitCode = activeAdjUnitCode || unitPrefix;
  fetchBackend('removeMonthlyAdjMarker', { unitCode, code }).then(() => { adjNeedsRefresh = true; showToast('已移除'); loadAdjMarkers(); });
}

export function loadAdjVersionRecords() {
  const unitCode = activeAdjUnitCode || unitPrefix;
  toggleLoader(true, '載入版本紀錄...');
  fetchBackend('getMonthlyAdjVersionRecords', { unitCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    adjVerHeaders = res.headers || []; adjVerRecords = res.records || [];
    const mSel = document.getElementById('adj-ver-month-filter');
    if (mSel) {
      const months = Array.from(new Set(adjVerRecords.map(r => String(r[0] || '').trim()).filter(Boolean))).sort().reverse();
      mSel.innerHTML = '<option value="ALL">全部月份</option>' + months.map(m => `<option value="${m}">${m}</option>`).join('');
    }
    applyAdjVersionFilters();
  }).catch(err => { toggleLoader(false); alert('載入異常：' + err.message); });
}

export function applyAdjVersionFilters() {
  const monthVal = document.getElementById('adj-ver-month-filter')?.value || 'ALL';
  const kw = (document.getElementById('adj-ver-search')?.value || '').toLowerCase().trim();
  let rows = [...adjVerRecords];
  if (monthVal !== 'ALL') rows = rows.filter(r => String(r[0] || '').trim() === monthVal);
  if (kw) rows = rows.filter(r => kw.split(/\s+/).every(t => (`${r[1] || ''} ${r[2] || ''}`).toLowerCase().includes(t)));
  adjVerFiltered = rows;
  const thead = document.getElementById('adj-ver-thead'), tbody = document.getElementById('adj-ver-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = '<tr>' + adjVerHeaders.map(h => `<th class="text-nowrap">${h}</th>`).join('') + '</tr>';
  tbody.innerHTML = rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('');
}

export function exportAdjVersionExcel() {
  if (!adjVerFiltered.length || !window.XLSX) return alert('無可匯出的版本資料');
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([adjVerHeaders, ...adjVerFiltered]), '盤點表版本紀錄');
  window.XLSX.writeFile(wb, `盤點表版本紀錄_${document.getElementById('adj-ver-month-filter')?.value || 'ALL'}.xlsx`);
}

function fmtSignedNum(val) {
  const n = Number(val) || 0;
  if (n > 0) return `<span class="text-danger fw-bold">+${n}</span>`;
  if (n < 0) return `<span class="text-success fw-bold">${n}</span>`;
  return `<span class="text-dark fw-bold">0</span>`;
}

function fmtSignedPct(diff, sap) {
  const d = Number(diff) || 0;
  const s = Number(sap) || 0;
  const pct = s === 0 ? (d === 0 ? 0 : (d > 0 ? 100 : -100)) : (d / Math.abs(s)) * 100;
  const label = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  if (pct > 0) return `<span class="text-danger fw-bold">${label}</span>`;
  if (pct < 0) return `<span class="text-success fw-bold">${label}</span>`;
  return `<span class="text-dark fw-bold">0.00%</span>`;
}
