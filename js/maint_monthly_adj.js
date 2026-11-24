import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { currentDept, session } from './config.js';

const UNIT_PREFIX_MAP = { opd: 'BA', ipd: 'BF', erd: 'BE', comp: 'BG' };
const UNIT_COLOR_MAP = {
  BA: '#1A365D', // 門診藥局：海軍藍
  BF: '#1E4D2B', // 住院藥局：海軍綠
  BE: '#7A1717', // 急診藥局：海軍紅
  BG: '#4E342E'  // 調配藥局：海軍棕
};
const unitPrefix = UNIT_PREFIX_MAP[currentDept] || 'BF';

let adjInitData = { headers: [], rows: [], dates: { D1: '', F1: '' }, state: { availableSymbols: [] } };
let adjFilteredRows = [];
let adjSort = { colIndex: -1, order: 'none' };
let adjNeedsRefresh = false;
let adjVerHeaders = [], adjVerRecords = [], adjVerFiltered = [];
let adjAppHeaders = [], adjAppRecords = [], adjTableMap = {}, adjAreaMap = {};
let adjHiddenAppCols = new Set([0, 5, 8, 9, 10, 11, 13, 14, 15, 16]);
let adjMarkerData = { masterList: [], trackedItems: [], availableSymbols: [] };
let activeAdjUnitCode = null;
let pendingAdjUnitTarget = null;
let adjAuditLogs = [];

function recordAdjAudit(actionType, summary) {
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  adjAuditLogs.unshift({
    time: timeStr,
    unit: activeAdjUnitCode || unitPrefix,
    user: session.name || session.id || '操作者',
    action: actionType,
    summary
  });
  if (adjAuditLogs.length > 200) adjAuditLogs.pop();
  renderAdjAuditLogs();
}

export function renderAdjAuditLogs() {
  const tbody = document.getElementById('adj-audit-log-tbody');
  if (!tbody) return;
  if (!adjAuditLogs.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-muted">尚無修改操作紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = adjAuditLogs.map(log => `
    <tr>
      <td class="small text-muted text-nowrap">${log.time}</td>
      <td class="text-center"><span class="badge bg-secondary">${log.unit}</span></td>
      <td class="fw-bold text-nowrap">${log.action} (${log.user})</td>
      <td>${log.summary}</td>
    </tr>`).join('');
}

function setAdjSaveStatus(msg, color = '#6c757d') {
  const el = document.getElementById('adj-save-status');
  if (el) { el.innerText = msg; el.style.color = color; }
}

function applyAdjUnitThemeColor(colorHex) {
  const targetColor = colorHex || '#1A365D';
  document.documentElement.style.setProperty('--academic-primary', targetColor);
  const root = document.getElementById('view-monthly-adj');
  if (root) {
    root.style.setProperty('--academic-primary', targetColor);
  }
  document.querySelectorAll('#adj-workspace-panel .bg-academic, #adj-workspace-panel .btn-academic').forEach(el => {
    el.style.backgroundColor = targetColor;
    el.style.borderColor = targetColor;
  });
}

export function initMonthlyAdjPortal() {
  activeAdjUnitCode = null;
  pendingAdjUnitTarget = null;
  applyAdjUnitThemeColor('#1A365D');
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
    const themeColor = UNIT_COLOR_MAP[activeAdjUnitCode] || '#1A365D';
    applyAdjUnitThemeColor(themeColor);

    const badgeEl = document.getElementById('adj-active-unit-badge');
    if (badgeEl) {
      badgeEl.style.backgroundColor = themeColor;
      badgeEl.innerText = `${pendingAdjUnitTarget.uName} (${res.userName})`;
    }
    document.getElementById('adj-unit-picker-panel')?.classList.add('d-none');
    document.getElementById('adj-workspace-panel')?.classList.remove('d-none');
    recordAdjAudit('登入調帳單位', `進入 ${pendingAdjUnitTarget.uName} (${res.userName})`);
    switchAdjTab('adj-tab-inventory');
    loadAdjInventoryData();
  }).catch(err => { toggleLoader(false); alert('驗證異常：' + err.message); });
}

export function switchAdjTab(tabId) {
  ['adj-tab-inventory', 'adj-tab-records', 'adj-tab-marker', 'adj-tab-version'].forEach(id => {
    const sec = document.getElementById(id);
    if (sec) sec.classList.toggle('d-none', id !== tabId);
  });
  const activeColor = UNIT_COLOR_MAP[activeAdjUnitCode] || '#1A365D';
  document.querySelectorAll('#adj-main-tabs .nav-link').forEach(btn => {
    const active = btn.getAttribute('data-target') === tabId;
    btn.classList.toggle('active', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-white', !active);
    btn.style.backgroundColor = active ? activeColor : '#ffffff';
    btn.style.borderColor = activeColor;
    btn.style.color = active ? '#ffffff' : activeColor;
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

export function toggleCustomNumRangeInputs() {
  const op = document.getElementById('adj-custom-op')?.value || 'NONE';
  const maxWrap = document.getElementById('adj-custom-max-wrap');
  const valWrap = document.getElementById('adj-custom-val-wrap');
  if (maxWrap) maxWrap.classList.toggle('d-none', op !== 'BETWEEN');
  if (valWrap) valWrap.classList.toggle('d-none', op === 'NONE');
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
    if (document.getElementById('adj-rec-start') && !document.getElementById('adj-rec-start').value) {
      document.getElementById('adj-rec-start').value = res.dates?.D1 || '';
    }
    if (document.getElementById('adj-rec-end') && !document.getElementById('adj-rec-end').value) {
      document.getElementById('adj-rec-end').value = res.dates?.F1 || '';
    }

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

function getAdjNumericFieldValue(row, fieldKey) {
  const rd = row.rowData || [];
  switch (fieldKey) {
    case 'prev_sap': return Number(rd[2]) || 0;
    case 'daily_sales': return Number(rd[3]) || 0;
    case 'theory_qty': return Number(rd[4]) || 0;
    case 'prev_app': return Number(rd[5]) || 0;
    case 'bal_diff': return Number(rd[6]) || 0;
    case 'prev_diff_pct': return (Number(row.rawF) || 0) * 100;
    case 'curr_app': return Number(rd[8]) || 0;
    case 'curr_sap': return Number(rd[9]) || 0;
    case 'curr_diff': return Number(rd[10]) || 0;
    case 'curr_diff_pct': return (Number(row.rawJ) || 0) * 100;
    case 'adj_qty': return Number(rd[13]) || 0;
    case 'report_qty': return Number(rd[15]) || 0;
    case 'report_diff': return Number(rd[17]) || 0;
    case 'report_diff_pct': return (Number(row.rawQ) || 0) * 100;
    default: return 0;
  }
}

export function applyAdjFilters() {
  let rows = [...(adjInitData.rows || [])];
  const kw = (document.getElementById('adj-search-input')?.value || '').toLowerCase().trim();
  const sym = document.getElementById('adj-filter-symbol')?.value || 'ALL';
  const fltPrev = document.getElementById('adj-filter-prev')?.value || 'ALL';
  const fltCurr = document.getElementById('adj-filter-curr')?.value || 'HAS_VALUE';

  const customField = document.getElementById('adj-custom-field')?.value || 'prev_diff_pct';
  const customOp = document.getElementById('adj-custom-op')?.value || 'NONE';
  const customMin = parseFloat(document.getElementById('adj-custom-min')?.value);
  const customMax = parseFloat(document.getElementById('adj-custom-max')?.value);

  if (kw) rows = rows.filter(r => kw.split(/\s+/).every(t => (`${r.rowData[0]} ${r.rowData[1]}`).toLowerCase().includes(t)));
  if (sym !== 'ALL') rows = rows.filter(r => String(r.rowData[12] || '').trim() === sym);
  if (fltPrev !== 'ALL') rows = rows.filter(r => { const hv = (Number(r.rowData[2]) !== 0 || Number(r.rowData[3]) !== 0 || Number(r.rowData[5]) !== 0); return fltPrev === 'HAS_VALUE' ? hv : !hv; });
  if (fltCurr !== 'ALL') rows = rows.filter(r => { const hv = (Number(r.rowData[8]) !== 0 || Number(r.rowData[9]) !== 0); return fltCurr === 'HAS_VALUE' ? hv : !hv; });

  if (customOp !== 'NONE' && !isNaN(customMin)) {
    rows = rows.filter(r => {
      const val = getAdjNumericFieldValue(r, customField);
      if (customOp === 'GT') return val > customMin;
      if (customOp === 'GTE') return val >= customMin;
      if (customOp === 'LT') return val < customMin;
      if (customOp === 'LTE') return val <= customMin;
      if (customOp === 'EQ') return val === customMin;
      if (customOp === 'BETWEEN') {
        if (isNaN(customMax)) return val >= customMin;
        return val >= customMin && val <= customMax;
      }
      return true;
    });
  }

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
    const grp = i >= 2 && i <= 7 ? 'head-g1 col-g1' : (i >= 8 && i <= 11 ? 'head-g2 col-g2' : (i >= 12 && i <= 18 ? 'head-g3 col-g3' : ''));
    return `<th class="${grp} text-nowrap" style="cursor:pointer;" onclick="handleAdjSortClick(${i})">${h}${icon}</th>`;
  }).join('') + '<th class="text-center text-nowrap">盤點明細</th></tr>';

  tbody.innerHTML = '';
  (rowsToRender || []).forEach(r => {
    const tr = document.createElement('tr');
    if (r.rowData[12]) tr.classList.add('table-warning');

    r.rowData.forEach((cellData, i) => {
      const td = document.createElement('td');
      td.style.fontSize = '0.96rem';
      if (i >= 2 && i <= 7) {
        td.classList.add('col-g1');
        td.style.backgroundColor = '#f4f8fc';
      } else if (i >= 8 && i <= 11) {
        td.classList.add('col-g2');
        td.style.backgroundColor = '#f3faf5';
      } else if (i >= 12 && i <= 18) {
        td.classList.add('col-g3');
        td.style.backgroundColor = '#faf5ff';
      }

      // SAP 一般字體；實盤為粗體
      if (i === 2 || i === 9 || i === 16) {
        td.style.fontWeight = '400';
      }
      if (i === 5 || i === 8 || i === 15) {
        td.style.fontWeight = '700';
      }

      // 差異百分比與結存帳差：正數紅字、負數綠字、持平黑字
      if (i === 6 || i === 10 || i === 17) {
        const num = Number(cellData) || 0;
        td.style.fontWeight = '700';
        td.style.color = num > 0 ? '#dc3545' : (num < 0 ? '#198754' : '#212529');
      }
      if (i === 7 || i === 11 || i === 18) {
        const pct = parseFloat(cellData) || 0;
        td.style.fontWeight = '700';
        td.style.color = pct > 0 ? '#dc3545' : (pct < 0 ? '#198754' : '#212529');
      }

      if (i === 3 || i === 13 || i === 14) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'form-control form-control-sm border-primary';
        inp.style.width = i === 14 ? '130px' : '90px';
        inp.style.fontSize = '0.95rem';
        inp.value = cellData;
        inp.oninput = () => {
          r.rowData[i] = inp.value;
          inp.style.backgroundColor = '#fff9c4';
          setAdjSaveStatus('⚠️ 有變更未存檔', '#dc3545');

          if (i === 3) {
            const theory = (Number(r.rowData[2]) || 0) - ((inp.value !== '' && !isNaN(inp.value)) ? Number(inp.value) : 0);
            const diff = (Number(r.rowData[5]) || 0) - theory;
            const pct = theory <= 0 ? diff : diff / theory;
            r.rowData[4] = theory; r.rowData[6] = diff; r.rowData[7] = (pct * 100).toFixed(2) + '%'; r.rawF = pct;
            if (tr.children[4]) tr.children[4].innerText = theory;
            if (tr.children[6]) {
              tr.children[6].innerText = diff;
              tr.children[6].style.color = diff > 0 ? '#dc3545' : (diff < 0 ? '#198754' : '#212529');
            }
            if (tr.children[7]) {
              tr.children[7].innerText = r.rowData[7];
              tr.children[7].style.color = pct > 0 ? '#dc3545' : (pct < 0 ? '#198754' : '#212529');
            }
          } else if (i === 13) {
            const adjVal = (inp.value !== '' && !isNaN(inp.value)) ? Number(inp.value) : (Number(r.rowData[8]) || 0);
            const sapDay = Number(r.rowData[9]) || 0;
            const dDiff = adjVal - sapDay;
            const dPct = sapDay <= 0 ? dDiff : dDiff / sapDay;
            r.rowData[15] = adjVal; r.rowData[17] = dDiff; r.rowData[18] = (dPct * 100).toFixed(2) + '%'; r.rawQ = dPct;
            if (tr.children[15]) tr.children[15].innerText = adjVal;
            if (tr.children[17]) {
              tr.children[17].innerText = dDiff;
              tr.children[17].style.color = dDiff > 0 ? '#dc3545' : (dDiff < 0 ? '#198754' : '#212529');
            }
            if (tr.children[18]) {
              tr.children[18].innerText = r.rowData[18];
              tr.children[18].style.color = dPct > 0 ? '#dc3545' : (dPct < 0 ? '#198754' : '#212529');
            }
          }
        };
        inp.onchange = () => {
          const colLabel = i === 3 ? '當日銷售' : (i === 13 ? '調帳成數字' : 'NOTE');
          recordAdjAudit('修改調帳欄位', `[${r.rowData[0]}] ${r.rowData[1]} — ${colLabel} 改為「${inp.value}」`);
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
          const req = nextSym.trim() === ''
            ? fetchBackend('removeMonthlyAdjMarker', { unitCode, code: r.rowData[0] })
            : fetchBackend('saveMonthlyAdjMarker', { unitCode, code: r.rowData[0], name: r.rowData[1], symbol: nextSym.trim(), note: '', creator: session.id || r.rowData[0] });
          req.then(() => {
            r.rowData[12] = nextSym.trim();
            adjNeedsRefresh = true;
            recordAdjAudit('更新標記', `[${r.rowData[0]}] ${r.rowData[1]} 標記設為「${nextSym.trim() || '無'}」`);
            applyAdjFilters();
          });
        };
        td.appendChild(btn);
      } else {
        td.innerText = cellData;
      }

      tr.appendChild(td);
    });

    const tdAct = document.createElement('td');
    tdAct.className = 'text-center';
    const bDet = document.createElement('button');
    bDet.className = 'btn btn-sm btn-outline-info fw-bold py-0';
    bDet.innerText = '📄 紀錄';
    bDet.onclick = () => {
      const fVal = document.getElementById('adj-param-forecast')?.value || adjInitData.dates?.D1 || '';
      const rVal = document.getElementById('adj-param-reference')?.value || adjInitData.dates?.F1 || '';
      if (document.getElementById('adj-rec-start')) document.getElementById('adj-rec-start').value = fVal;
      if (document.getElementById('adj-rec-end')) document.getElementById('adj-rec-end').value = rVal;
      if (document.getElementById('adj-rec-search')) document.getElementById('adj-rec-search').value = r.rowData[0];
      switchAdjTab('adj-tab-records');
    };
    tdAct.appendChild(bDet);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
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
    recordAdjAudit('存檔版本', `鎖存 ${reportDate.substring(0, 7)} 月份調帳版本（共 ${(adjInitData.rows || []).length} 項）`);
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
    adjAppHeaders = res.headers || [];
    adjAppRecords = res.records || [];
    adjTableMap = res.tableMap || {};
    adjAreaMap = res.areaMap || {};
    applyAdjAppRecordFilters();
  }).catch(err => { toggleLoader(false); alert('載入異常：' + err.message); });
}

export function applyAdjAppRecordFilters() {
  const kw = (document.getElementById('adj-rec-search')?.value || '').toLowerCase().trim();
  let rows = kw
    ? adjAppRecords.filter(r => kw.split(/\s+/).every(t => (`${r[1] || ''} ${r[2] || ''} ${r[12] || ''} ${adjTableMap[r[11]] || ''} ${adjAreaMap[r[11]] || ''}`).toLowerCase().includes(t)))
    : [...adjAppRecords];

  const thead = document.getElementById('adj-rec-thead'), tbody = document.getElementById('adj-rec-tbody');
  if (!thead || !tbody) return;

  thead.innerHTML = `
    <tr>
      <th>藥品代碼</th>
      <th>藥品名稱</th>
      <th class="text-end">數量</th>
      <th>登記時間</th>
      <th>人員</th>
      <th>類型</th>
      <th>儲位碼</th>
      <th>區域名稱 (Area)</th>
      <th>盤點表名稱 (Table)</th>
      <th>狀態</th>
      <th>修改紀錄</th>
    </tr>`;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4 text-muted">此日期區間無盤點紀錄</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const tId = String(r[11] || '').trim();
    const areaName = adjAreaMap[tId] || (tId.endsWith('YYY') ? '盤點庫存' : (tId.endsWith('ZZZ') ? '線上調劑或退藥' : '-'));
    const tableName = adjTableMap[tId] || (tId.endsWith('YYY') ? '盤點庫存' : (tId.endsWith('ZZZ') ? '線上調劑或退藥' : (tId || '-')));
    const modLog = (r[18] || r[17]) ? `<span class="badge bg-warning text-dark">${r[18] || ''} ${r[17] || ''}</span>` : '<span class="text-muted">-</span>';
    return `
      <tr>
        <td class="fw-bold text-primary">${r[1] || ''}</td>
        <td class="fw-bold">${r[2] || ''}</td>
        <td class="text-end fw-bold">${r[3] ?? 0}</td>
        <td class="small">${r[4] || ''}</td>
        <td>${r[6] || r[5] || ''}</td>
        <td><span class="badge bg-secondary">${r[7] || ''}</span></td>
        <td class="fw-bold">${r[12] || '-'}</td>
        <td class="fw-bold text-success">${areaName}</td>
        <td class="fw-bold text-academic">${tableName}</td>
        <td>${r[16] || '成立'}</td>
        <td>${modLog}</td>
      </tr>`;
  }).join('');
}

export function loadAdjMarkers() {
  const unitCode = activeAdjUnitCode || unitPrefix;
  toggleLoader(true, '載入標記追蹤藥品...');
  fetchBackend('getMonthlyAdjMarkers', { unitCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    adjMarkerData = res;

    const symSel = document.getElementById('adj-marker-sym-filter');
    if (symSel) {
      const prevSym = symSel.value;
      const allSyms = new Set([
        ...(res.availableSymbols || []),
        ...(res.trackedItems || []).map(x => String(x.symbol || '').trim()).filter(Boolean)
      ]);
      symSel.innerHTML = '<option value="ALL">全部顯示</option>';
      Array.from(allSyms).sort().forEach(s => {
        symSel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
      });
      if (Array.from(symSel.options).some(o => o.value === prevSym)) symSel.value = prevSym;
    }

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
  fetchBackend('saveMonthlyAdjMarker', { unitCode, code, name, symbol, note, creator: session.id || document.getElementById('nav-user-id')?.innerText || '' }).then(() => {
    adjNeedsRefresh = true;
    recordAdjAudit('新增/更新追蹤標記', `[${code}] ${name} ➔ 符號「${symbol}」`);
    showToast('標記已儲存');
    loadAdjMarkers();
  });
}

export function applyAdjMarkerFilters() {
  const kw = (document.getElementById('adj-marker-search')?.value || '').toLowerCase().trim();
  const sym = document.getElementById('adj-marker-sym-filter')?.value || 'ALL';
  const tbody = document.getElementById('adj-marker-tbody');
  if (!tbody) return;
  const list = (adjMarkerData.trackedItems || []).filter(item =>
    (sym === 'ALL' || String(item.symbol || '').trim() === sym) &&
    (!kw || kw.split(/\s+/).every(t => (`${item.code} ${item.name}`).toLowerCase().includes(t)))
  );
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">無符合的追蹤藥品紀錄</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(item => `
    <tr>
      <td class="fw-bold">${item.code}</td>
      <td>${item.name}</td>
      <td><span class="badge bg-warning text-dark">${item.symbol || '-'}</span></td>
      <td>${item.note || ''}</td>
      <td>${item.creator || ''}</td>
      <td>${item.updateTime || ''}</td>
      <td class="text-center"><button class="btn btn-sm btn-outline-danger py-0" onclick="deleteExistingAdjMarker('${item.code}')">移除</button></td>
    </tr>`).join('');
}

export function deleteExistingAdjMarker(code) {
  if (!confirm(`確定移除 [${code}] 的標記嗎？`)) return;
  const unitCode = activeAdjUnitCode || unitPrefix;
  fetchBackend('removeMonthlyAdjMarker', { unitCode, code }).then(() => {
    adjNeedsRefresh = true;
    recordAdjAudit('移除追蹤標記', `移除藥品 [${code}] 標記`);
    showToast('已移除');
    loadAdjMarkers();
  });
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
