import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';

const UNIT_LABEL_MAP = { BA: '門診藥局(BA)', BF: '住院藥局(BF)', BE: '急診藥局(BE)', BG: '調配藥局(BG)' };

let parsedMasterRows = [];
let parsedSapDailyRows = [];
let parsedSapMonthlyRows = [];
let dailySnapCache = [];
let monthlySnapCache = [];

function normalizeExcelDate(v) {
  if (!v) return '';
  if (typeof v === 'number' && window.XLSX) {
    const d = window.XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim().replace(/\//g, '-');
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s.substring(0, 10);
}

function calcDiffPctNum(diff, sap) {
  const d = Number(diff) || 0;
  const s = Number(sap) || 0;
  if (s === 0) return d === 0 ? 0 : (d > 0 ? 100 : -100);
  return Math.round((d / Math.abs(s)) * 10000) / 100;
}

function fmtSignedNum(val) {
  const n = Number(val) || 0;
  if (n > 0) return `<span class="text-danger fw-bold">+${n}</span>`;
  if (n < 0) return `<span class="text-success fw-bold">${n}</span>`;
  return `<span class="text-dark fw-bold">0</span>`;
}

function fmtSignedPct(diff, sap) {
  const pct = calcDiffPctNum(diff, sap);
  const label = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  if (pct > 0) return `<span class="text-danger fw-bold">${label}</span>`;
  if (pct < 0) return `<span class="text-success fw-bold">${label}</span>`;
  return `<span class="text-dark fw-bold">0.00%</span>`;
}

function getLocalTodayStr() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export function initDrugMgmtPortal() {
  switchView('view-drug-mgmt');
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const dEl = document.getElementById('dm-daily-date'); if (dEl) dEl.value = todayStr;
  const mEl = document.getElementById('dm-monthly-month'); if (mEl) mEl.value = monthStr;
  const sapDailyDateEl = document.getElementById('dm-sap-daily-date');
  if (sapDailyDateEl && !sapDailyDateEl.value) sapDailyDateEl.value = todayStr;
  const sapMonthlyDateEl = document.getElementById('dm-sap-monthly-date');
  if (sapMonthlyDateEl && !sapMonthlyDateEl.value) sapMonthlyDateEl.value = todayStr;
  switchDrugMgmtTab('dm-tab-master');
}

export function switchDrugMgmtTab(tabId) {
  ['dm-tab-master', 'dm-tab-sap-daily', 'dm-tab-sap-monthly', 'dm-tab-daily-res', 'dm-tab-monthly-res'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('d-none', id !== tabId);
  });
  document.querySelectorAll('#dm-tabs .nav-link').forEach(btn => {
    const active = btn.getAttribute('data-target') === tabId;
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-academic', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-white', !active);
    btn.classList.toggle('text-academic', !active);
  });

  if (tabId === 'dm-tab-master') loadDrugMasterStats();
  else if (tabId === 'dm-tab-sap-daily') loadSapHistoryList('daily');
  else if (tabId === 'dm-tab-sap-monthly') loadSapHistoryList('monthly');
  else if (tabId === 'dm-tab-daily-res') loadDailySnapshots();
  else if (tabId === 'dm-tab-monthly-res') loadMonthlySnapshots();
}

export function downloadExcelTemplate(type) {
  if (!window.XLSX) return alert('Excel 套件尚未載入完成');
  const wb = window.XLSX.utils.book_new();
  let rows = [], filename = 'template.xlsx', sheetName = 'Sheet1';
  if (type === 'master') {
    sheetName = '藥品主檔'; filename = '範本_藥品主檔更新.xlsx';
    rows = [['批價代碼', '藥品學名', '藥檔狀態'], ['BAMIN0', 'Amino Acid 7% 250ml/bot (Nephrosteril)', '0']];
  } else if (type === 'daily_sap') {
    sheetName = '導入每日SAP'; filename = '範本_每日SAP上傳.xlsx';
    rows = [['物料', '未限制'], ['POTAC01', 120]];
  } else if (type === 'monthly_sap') {
    sheetName = '導入月SAP'; filename = '範本_月SAP上傳.xlsx';
    rows = [['物料', '未限制'], ['PBAMIN0', 82]];
  }
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), sheetName);
  window.XLSX.writeFile(wb, filename);
}

export function loadDrugMasterStats() {
  fetchBackend('getDrugMasterStats').then(res => {
    if (res && res.success) {
      const el = document.getElementById('dm-master-stats');
      if (el) el.innerText = `目前資料庫藥品主檔筆數：${res.count} 筆（最後更新：${res.lastUpdated}）`;
    }
  }).catch(() => {});
}

export function handleMasterFileSelect(event) {
  const file = event.target.files[0];
  parsedMasterRows = [];
  const preview = document.getElementById('dm-master-preview');
  const btn = document.getElementById('dm-master-upload-btn');
  if (!file) { preview.innerText = '尚未選擇檔案'; btn.disabled = true; return; }

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const sheetName = wb.Sheets['藥品主檔'] ? '藥品主檔' : wb.SheetNames[0];
      const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      if (raw.length <= 1) {
        preview.innerHTML = `<span class="text-danger fw-bold">❌ Excel 中沒有資料列</span>`;
        btn.disabled = true;
        return;
      }

      const h = raw[0].map(x => String(x).trim());
      const pIdx = h.indexOf('批價代碼');
      const nIdx = h.indexOf('藥品學名');
      const sIdx = h.indexOf('藥檔狀態');
      if (pIdx === -1 || nIdx === -1) {
        preview.innerHTML = `<span class="text-danger fw-bold">❌ 欄位格式不符！必須包含「批價代碼」、「藥品學名」兩個欄位</span>`;
        btn.disabled = true;
        return;
      }

      const rows = [];
      const errors = [];
      let replacedCount = 0;

      for (let i = 1; i < raw.length; i++) {
        const r = raw[i];
        const rawPriceCode = String(r[pIdx] ?? '').trim();
        const rawDrugName = String(r[nIdx] ?? '').trim();
        const excelRowNo = i + 1;

        // 跳過整列皆空的空白列
        if (!rawPriceCode && !rawDrugName) continue;

        const rowErrs = [];
        const pCode = rawPriceCode.toUpperCase();

        if (!pCode) {
          rowErrs.push('批價代碼為空');
        } else if (pCode.startsWith('P')) {
          rowErrs.push(`批價代碼「${rawPriceCode}」不可為 P 開頭`);
        }

        if (!rawDrugName) {
          rowErrs.push('藥品學名為空');
        }

        if (rowErrs.length > 0) {
          errors.push(`第 ${excelRowNo} 列：${rowErrs.join('；')}`);
        } else {
          let cleanedCode = pCode;
          if (cleanedCode.includes('*') || cleanedCode.includes('+')) {
            cleanedCode = cleanedCode.replace(/\*/g, '8').replace(/\+/g, '9');
            replacedCount++;
          }
          const invCode = `P${cleanedCode}`;
          rows.push({
            price_code: pCode,
            inv_code: invCode,
            drug_name: rawDrugName,
            drug_status: sIdx > -1 && String(r[sIdx] ?? '').trim() !== '' ? String(r[sIdx]).trim() : '0'
          });
        }
      }

      if (errors.length > 0) {
        const showLimit = 30;
        const shown = errors.slice(0, showLimit).map(e => `<li>${e}</li>`).join('');
        const moreText = errors.length > showLimit ? `<div class="mt-1 text-muted">...其餘尚有 ${errors.length - showLimit} 筆錯誤未顯示</div>` : '';
        preview.innerHTML = `
          <div class="text-danger fw-bold mb-1">❌ 檢核失敗，共發現 ${errors.length} 筆錯誤（請修正檔案後重新選擇，全部無誤才可上傳）：</div>
          <ul class="mb-0 ps-3 text-danger" style="max-height: 180px; overflow-y: auto;">${shown}</ul>
          ${moreText}
        `;
        btn.disabled = true;
        return;
      }

      if (rows.length === 0) {
        preview.innerHTML = `<span class="text-danger fw-bold">❌ 檔案中無有效資料列</span>`;
        btn.disabled = true;
        return;
      }

      parsedMasterRows = rows;
      const replaceHint = replacedCount > 0
        ? `<div class="text-primary small mt-1">ℹ️ 已自動產生「加P」代碼，並轉換 ${replacedCount} 筆特殊符號（<code>*</code>→<code>8</code>、<code>+</code>→<code>9</code>）</div>`
        : `<div class="text-primary small mt-1">ℹ️ 已自動於批價代碼前加上 <code>P</code> 產生「加P」代碼</div>`;
      preview.innerHTML = `<div class="text-success fw-bold">✅ 格式驗證通過！共解析 ${rows.length} 筆藥品主檔，可點擊重建</div>${replaceHint}`;
      btn.disabled = false;
    } catch (err) {
      preview.innerHTML = `<span class="text-danger fw-bold">❌ 解析失敗：${err.message}</span>`;
      btn.disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

export function submitRebuildDrugMaster() {
  if (!parsedMasterRows.length || !confirm(`確定要「全刪全重建」藥品主檔（${parsedMasterRows.length} 筆）嗎？`)) return;
  toggleLoader(true, `正在全刪全重建 ${parsedMasterRows.length} 筆藥品主檔...`, true);
  fetchBackend('rebuildDrugMaster', { rows: JSON.stringify(parsedMasterRows) }).then(res => {
    toggleLoader(false, '', true);
    if (!res || !res.success) return alert('重建失敗：' + (res?.message || '未知錯誤'));
    showToast(`藥品主檔重建完成，共 ${res.count} 筆`);
    parsedMasterRows = [];
    document.getElementById('dm-master-file').value = '';
    document.getElementById('dm-master-upload-btn').disabled = true;
    loadDrugMasterStats();
  }).catch(err => { toggleLoader(false, '', true); alert('重建異常：' + err.message); });
}

export function handleSapFileSelectV2(sapType, event) {
  const file = event.target.files[0];
  const preview = document.getElementById(`dm-sap-${sapType}-preview`);
  const btn = document.getElementById(`dm-sap-${sapType}-btn`);
  if (sapType === 'daily') parsedSapDailyRows = []; else parsedSapMonthlyRows = [];
  if (!file) { preview.innerText = '尚未選擇檔案'; btn.disabled = true; return; }

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (raw.length <= 1) {
        preview.innerHTML = `<span class="text-danger fw-bold">❌ Excel 中沒有資料列</span>`;
        btn.disabled = true;
        return;
      }

      const h = raw[0].map(x => String(x).trim());
      const mIdx = h.indexOf('物料');
      // 優先找「未限制」，找不到再相容舊的「數量」欄名
      let qIdx = h.indexOf('未限制');
      if (qIdx === -1) qIdx = h.indexOf('數量');

      if (mIdx === -1 || qIdx === -1) {
        preview.innerHTML = `<span class="text-danger fw-bold">❌ 欄位格式不符！必須包含「物料」與「未限制」（或「數量」）欄位</span>`;
        btn.disabled = true;
        return;
      }

      const rows = [];
      const errors = [];

      for (let i = 1; i < raw.length; i++) {
        const r = raw[i];
        const rawCode = String(r[mIdx] ?? '').trim();
        const rawQty = String(r[qIdx] ?? '').trim();
        const excelRowNo = i + 1;

        // 跳過整列皆空的空白列
        if (!rawCode && !rawQty) continue;

        const rowErrs = [];

        // 1. 物料檢核（必須以 P 開頭）
        const normCode = rawCode.toUpperCase();
        if (!normCode) {
          rowErrs.push('物料為空');
        } else if (!normCode.startsWith('P')) {
          rowErrs.push(`物料「${rawCode}」不是 P 開頭`);
        }

        // 2. 數量檢核（僅允許數字，可含千分位逗號、負號與小數點）
        const cleanQtyStr = rawQty.replace(/,/g, '');
        if (!cleanQtyStr) {
          rowErrs.push('未限制數量為空');
        } else if (!/^-?\d+(\.\d+)?$/.test(cleanQtyStr)) {
          rowErrs.push(`未限制數量「${rawQty}」不是有效數字`);
        }

        if (rowErrs.length > 0) {
          errors.push(`第 ${excelRowNo} 列：${rowErrs.join('；')}`);
        } else {
          rows.push({
            drug_code: normCode,
            drug_name: '',
            qty: parseFloat(cleanQtyStr),
            unit: ''
          });
        }
      }

      // 只要有任何錯誤，鎖定上傳按鈕並列出錯誤明細
      if (errors.length > 0) {
        const showLimit = 30;
        const shown = errors.slice(0, showLimit).map(e => `<li>${e}</li>`).join('');
        const moreText = errors.length > showLimit ? `<div class="mt-1 text-muted">...其餘尚有 ${errors.length - showLimit} 筆錯誤未顯示</div>` : '';
        preview.innerHTML = `
          <div class="text-danger fw-bold mb-1">❌ 檢核失敗，共發現 ${errors.length} 筆錯誤（請修正檔案後重新選擇，全部無誤才可上傳）：</div>
          <ul class="mb-0 ps-3 text-danger" style="max-height: 180px; overflow-y: auto;">${shown}</ul>
          ${moreText}
        `;
        btn.disabled = true;
        return;
      }

      if (rows.length === 0) {
        preview.innerHTML = `<span class="text-danger fw-bold">❌ 檔案中無有效資料列</span>`;
        btn.disabled = true;
        return;
      }

      if (sapType === 'daily') parsedSapDailyRows = rows; else parsedSapMonthlyRows = rows;
      preview.innerHTML = `<div class="text-success fw-bold">✅ 格式驗證通過！共 ${rows.length} 筆有效資料，可點擊上傳</div>`;
      btn.disabled = false;
    } catch (err) {
      preview.innerHTML = `<span class="text-danger fw-bold">❌ 解析失敗：${err.message}</span>`;
      btn.disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

export function uploadSapWithConfirm(sapType) {
  const rows = sapType === 'daily' ? parsedSapDailyRows : parsedSapMonthlyRows;
  if (!rows.length) return;

  const dateInput = document.getElementById(`dm-sap-${sapType}-date`);
  const sapDate = dateInput ? dateInput.value.trim() : '';
  if (!sapDate) return alert('請先選擇「歸屬 SAP 日期」');

  const unitSelect = document.getElementById(`dm-sap-${sapType}-unit`);
  const unitCode = unitSelect.value, unitLabel = unitSelect.options[unitSelect.selectedIndex].text;

  // 若選擇的日期非今日，給予跨日提醒
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const crossDayWarn = sapDate !== todayStr ? `\n⚠️ 注意：您選擇的日期（${sapDate}）非今日（${todayStr}）！\n` : '';

  if (!confirm(`📋 最終確認：${crossDayWarn}\n• 單位：${unitLabel}\n• 歸屬 SAP 日期：${sapDate}\n• 筆數：${rows.length} 筆\n\n確定上傳並覆蓋同日資料嗎？`)) return;

  const payloadRows = rows.map(r => ({ ...r, sap_date: sapDate }));
  toggleLoader(true, `正在上傳 ${payloadRows.length} 筆 SAP...`, true);
  fetchBackend('importSapBatch', { unitCode, sapType, rows: JSON.stringify(payloadRows), replaceDate: true }).then(res => {
    toggleLoader(false, '', true);
    if (!res || !res.success) return alert('上傳失敗：' + (res?.message || '未知錯誤'));
    showToast(`已成功上傳 ${res.count} 筆至 ${unitLabel}（${sapDate}）`);
    if (sapType === 'daily') parsedSapDailyRows = []; else parsedSapMonthlyRows = [];
    document.getElementById(`dm-sap-${sapType}-file`).value = '';
    document.getElementById(`dm-sap-${sapType}-preview`).innerText = '尚未選擇檔案';
    document.getElementById(`dm-sap-${sapType}-btn`).disabled = true;
    loadSapHistoryList(sapType);
  }).catch(err => { toggleLoader(false, '', true); alert('上傳異常：' + err.message); });
}

export function loadSapHistoryList(sapType) {
  const unitCode = document.getElementById(`dm-sap-${sapType}-unit`)?.value || 'BF';
  const tbody = document.getElementById(`dm-sap-${sapType}-tbody`);
  if (!tbody) return;
  fetchBackend('getSapSummary', { unitCode, sapType }).then(res => {
    const list = res?.data || [];
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3 text-muted">目前尚無上傳紀錄</td></tr>'; return; }
    tbody.innerHTML = list.map(r => `
      <tr class="${r.is_latest ? '' : 'table-light text-muted'}">
        <td class="fw-bold">${r.sap_date}</td>
        <td class="text-center">
          <span class="badge ${r.is_latest ? 'bg-success' : 'bg-secondary'}">v${r.version_no || 1} ${r.is_latest ? '(目前採用)' : '(歷史版本)'}</span>
        </td>
        <td class="text-center">${r.item_count} 筆</td>
        <td class="text-end">${Math.round((r.total_qty || 0) * 100) / 100}</td>
        <td class="text-center small text-muted">${r.created_at || '-'}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-danger py-0 fw-bold" onclick="rollbackSapDate('${sapType}', '${r.sap_date}', '${r.version_id || ''}')">刪除此版</button>
        </td>
      </tr>`).join('');
  });
}

export function rollbackSapDate(sapType, sapDate, versionId = '') {
  const unitCode = document.getElementById(`dm-sap-${sapType}-unit`).value;
  if (!confirm(`確定要刪除 ${unitCode} 在 ${sapDate} 的此筆 SAP 版本嗎？（若仍有前一版本將自動切回上一版）`)) return;
  fetchBackend('rollbackSapByDate', { unitCode, sapType, sapDate, versionId }).then(res => {
    if (res?.success) { showToast(`已刪除並更新採用版本`); loadSapHistoryList(sapType); }
  });
}

function renderSnapshotComparisonTable(thead, tbody, list, unitCode, mode) {
  const actKey = mode === 'daily' ? 'actual_qty' : 'total_actual_qty';
  const emptyMsg = mode === 'daily' ? '此日期尚無每日盤點結果存檔' : '此月份尚無月盤點結果存檔';

  if (unitCode === 'ALL') {
    thead.innerHTML = `
      <tr>
        <th class="text-center align-middle" rowspan="2">藥品代碼</th>
        <th class="align-middle" rowspan="2">藥品名稱 (鎖存快照)</th>
        <th class="text-center text-white" colspan="4" style="background-color:#1A365D;">門診藥局 (BA)</th>
        <th class="text-center text-white" colspan="4" style="background-color:#1E4D2B;">住院藥局 (BF)</th>
        <th class="text-center text-white" colspan="4" style="background-color:#7A1717;">急診藥局 (BE)</th>
        <th class="text-center text-white" colspan="4" style="background-color:#4E342E;">調配藥局 (BG)</th>
        <th class="text-center bg-dark text-white" colspan="4">全院加總</th>
      </tr>
      <tr>
        <th class="text-end small" style="background-color:#e8eef7;">SAP</th><th class="text-end small" style="background-color:#e8eef7;">實盤</th><th class="text-end small" style="background-color:#e8eef7;">帳差</th><th class="text-end small" style="background-color:#e8eef7;">帳差%</th>
        <th class="text-end small" style="background-color:#e8f3ec;">SAP</th><th class="text-end small" style="background-color:#e8f3ec;">實盤</th><th class="text-end small" style="background-color:#e8f3ec;">帳差</th><th class="text-end small" style="background-color:#e8f3ec;">帳差%</th>
        <th class="text-end small" style="background-color:#f9eaea;">SAP</th><th class="text-end small" style="background-color:#f9eaea;">實盤</th><th class="text-end small" style="background-color:#f9eaea;">帳差</th><th class="text-end small" style="background-color:#f9eaea;">帳差%</th>
        <th class="text-end small" style="background-color:#f2ecea;">SAP</th><th class="text-end small" style="background-color:#f2ecea;">實盤</th><th class="text-end small" style="background-color:#f2ecea;">帳差</th><th class="text-end small" style="background-color:#f2ecea;">帳差%</th>
        <th class="text-end small bg-light">總SAP</th><th class="text-end small bg-light">總實盤</th><th class="text-end small bg-light">總帳差</th><th class="text-end small bg-light">總帳差%</th>
      </tr>`;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="22" class="text-center py-4 text-muted">${emptyMsg}</td></tr>`;
      return;
    }

    const pivot = {};
    for (const r of list) {
      if (!pivot[r.drug_code]) pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
      pivot[r.drug_code].units[r.unit_code] = r;
    }

    const fmtCell4 = (obj, bg) => {
      if (!obj) {
        return `<td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td>`;
      }
      const sapVal = Number(obj.sap_qty) || 0;
      const actVal = Number(obj[actKey]) || 0;
      const diffVal = Number(obj.diff_qty) || 0;
      return `
        <td class="text-end" style="background-color:${bg};">${sapVal}</td>
        <td class="text-end fw-bold" style="background-color:${bg};">${actVal}</td>
        <td class="text-end" style="background-color:${bg};">${fmtSignedNum(diffVal)}</td>
        <td class="text-end" style="background-color:${bg};">${fmtSignedPct(diffVal, sapVal)}</td>`;
    };

    tbody.innerHTML = Object.values(pivot).sort((a, b) => a.drug_code.localeCompare(b.drug_code)).map(item => {
      let totSap = 0, totAct = 0, totDiff = 0;
      ['BA', 'BF', 'BE', 'BG'].forEach(u => {
        if (item.units[u]) {
          totSap += Number(item.units[u].sap_qty) || 0;
          totAct += Number(item.units[u][actKey]) || 0;
          totDiff += Number(item.units[u].diff_qty) || 0;
        }
      });
      return `
        <tr>
          <td class="text-center fw-bold text-nowrap">${item.drug_code}</td>
          <td class="fw-bold text-nowrap">${item.drug_name}</td>
          ${fmtCell4(item.units['BA'], '#f4f7fc')}
          ${fmtCell4(item.units['BF'], '#f3faf5')}
          ${fmtCell4(item.units['BE'], '#fdf4f4')}
          ${fmtCell4(item.units['BG'], '#f8f5f4')}
          <td class="text-end bg-light">${totSap}</td>
          <td class="text-end fw-bold bg-light">${totAct}</td>
          <td class="text-end bg-light">${fmtSignedNum(totDiff)}</td>
          <td class="text-end bg-light">${fmtSignedPct(totDiff, totSap)}</td>
        </tr>`;
    }).join('');
  } else {
    if (mode === 'daily') {
      thead.innerHTML = `
        <tr>
          <th class="text-center">藥品代碼</th>
          <th>藥品名稱 (鎖存快照)</th>
          <th class="text-end">SAP數量</th>
          <th class="text-end">實際盤點</th>
          <th class="text-end">帳差</th>
          <th class="text-end">帳差百分比</th>
          <th class="text-center">存檔時間</th>
        </tr>`;
      if (!list.length) { tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">${emptyMsg}</td></tr>`; return; }
      tbody.innerHTML = list.map(r => `
        <tr>
          <td class="text-center fw-bold">${r.drug_code}</td>
          <td class="fw-bold">${r.drug_name}</td>
          <td class="text-end">${Number(r.sap_qty) || 0}</td>
          <td class="text-end fw-bold">${Number(r.actual_qty) || 0}</td>
          <td class="text-end">${fmtSignedNum(r.diff_qty)}</td>
          <td class="text-end">${fmtSignedPct(r.diff_qty, r.sap_qty)}</td>
          <td class="text-center small text-muted">${r.created_at || ''}</td>
        </tr>`).join('');
    } else {
      thead.innerHTML = `
        <tr>
          <th class="text-center">藥品代碼</th>
          <th>藥品名稱 (鎖存快照)</th>
          <th class="text-end">月SAP</th>
          <th class="text-end">調劑台</th>
          <th class="text-end">庫存</th>
          <th class="text-end">線上調整</th>
          <th class="text-end">盤點總量</th>
          <th class="text-end">帳差</th>
          <th class="text-end">帳差百分比</th>
        </tr>`;
      if (!list.length) { tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">${emptyMsg}</td></tr>`; return; }
      tbody.innerHTML = list.map(r => `
        <tr>
          <td class="text-center fw-bold">${r.drug_code}</td>
          <td class="fw-bold">${r.drug_name}</td>
          <td class="text-end">${Number(r.sap_qty) || 0}</td>
          <td class="text-end fw-bold">${Number(r.desk_qty) || 0}</td>
          <td class="text-end fw-bold">${Number(r.stock_qty) || 0}</td>
          <td class="text-end fw-bold">${Number(r.online_qty) || 0}</td>
          <td class="text-end fw-bold">${Number(r.total_actual_qty) || 0}</td>
          <td class="text-end">${fmtSignedNum(r.diff_qty)}</td>
          <td class="text-end">${fmtSignedPct(r.diff_qty, r.sap_qty)}</td>
        </tr>`).join('');
    }
  }
}

export function generateDailySnapshotNow() {
  const unitCode = document.getElementById('dm-daily-unit').value;
  const dateStr = document.getElementById('dm-daily-date').value;
  if (!dateStr) return alert('請選擇日期');
  toggleLoader(true, '正在結算並存檔每日盤點結果...');
  fetchBackend('generateDailySnapshotAll', { unitCode, dateStr }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '存檔失敗');
    showToast(`已成功鎖存 ${res.count} 筆每日盤點結果`);
    loadDailySnapshots();
  }).catch(err => { toggleLoader(false); alert('存檔異常：' + err.message); });
}

export function loadDailySnapshots() {
  const unitCode = document.getElementById('dm-daily-unit')?.value || 'ALL';
  const dateStr = document.getElementById('dm-daily-date')?.value || '';
  const thead = document.getElementById('dm-daily-thead');
  const tbody = document.getElementById('dm-daily-tbody');
  if (!tbody || !thead || !dateStr) return;

  fetchBackend('getDailySnapshotsAll', { unitCode, dateStr }).then(res => {
    dailySnapCache = res?.data || [];
    renderSnapshotComparisonTable(thead, tbody, dailySnapCache, unitCode, 'daily');
  });
}

export function exportDailySnapshotsExcel() {
  if (!window.XLSX || !dailySnapCache.length) return alert('無資料可匯出');
  const unitCode = document.getElementById('dm-daily-unit')?.value || 'ALL';
  const dateStr = document.getElementById('dm-daily-date')?.value || '';
  const wb = window.XLSX.utils.book_new();
  if (unitCode === 'ALL') {
    const pivot = {};
    for (const r of dailySnapCache) {
      if (!pivot[r.drug_code]) pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
      pivot[r.drug_code].units[r.unit_code] = r;
    }
    const rows = [['藥品代碼', '藥品名稱', '門診SAP', '門診實盤', '門診帳差', '門診帳差%', '住院SAP', '住院實盤', '住院帳差', '住院帳差%', '急診SAP', '急診實盤', '急診帳差', '急診帳差%', '調配SAP', '調配實盤', '調配帳差', '調配帳差%', '全院總SAP', '全院總實盤', '全院總帳差', '全院總帳差%']];
    Object.values(pivot).sort((a, b) => a.drug_code.localeCompare(b.drug_code)).forEach(item => {
      const g = (u) => item.units[u] || { sap_qty: 0, actual_qty: 0, diff_qty: 0 };
      const ba = g('BA'), bf = g('BF'), be = g('BE'), bg = g('BG');
      const ts = (ba.sap_qty||0)+(bf.sap_qty||0)+(be.sap_qty||0)+(bg.sap_qty||0);
      const ta = (ba.actual_qty||0)+(bf.actual_qty||0)+(be.actual_qty||0)+(bg.actual_qty||0);
      const td = (ba.diff_qty||0)+(bf.diff_qty||0)+(be.diff_qty||0)+(bg.diff_qty||0);
      rows.push([item.drug_code, item.drug_name, ba.sap_qty, ba.actual_qty, ba.diff_qty, calcDiffPctNum(ba.diff_qty, ba.sap_qty) + '%', bf.sap_qty, bf.actual_qty, bf.diff_qty, calcDiffPctNum(bf.diff_qty, bf.sap_qty) + '%', be.sap_qty, be.actual_qty, be.diff_qty, calcDiffPctNum(be.diff_qty, be.sap_qty) + '%', bg.sap_qty, bg.actual_qty, bg.diff_qty, calcDiffPctNum(bg.diff_qty, bg.sap_qty) + '%', ts, ta, td, calcDiffPctNum(td, ts) + '%']);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '全院每日盤點結果');
  } else {
    const rows = [['單位代碼', '單位名稱', '盤點日期', '藥品代碼', '藥品名稱', 'SAP數量', '實際盤點', '帳差', '帳差百分比', '存檔時間']];
    dailySnapCache.forEach(r => rows.push([r.unit_code, UNIT_LABEL_MAP[r.unit_code] || r.unit_code, r.record_date, r.drug_code, r.drug_name, r.sap_qty, r.actual_qty, r.diff_qty, calcDiffPctNum(r.diff_qty, r.sap_qty) + '%', r.created_at || '']));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '每日盤點結果');
  }
  window.XLSX.writeFile(wb, `每日盤點結果_${unitCode}_${dateStr}.xlsx`);
}

export function generateMonthlySnapshotNow() {
  const unitCode = document.getElementById('dm-monthly-unit').value;
  const monthStr = document.getElementById('dm-monthly-month').value;
  if (!monthStr) return alert('請選擇月份');
  toggleLoader(true, '正在結算並存檔月盤點結果...');
  fetchBackend('generateMonthlySnapshotAll', { unitCode, monthStr }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '存檔失敗');
    showToast(`已成功鎖存 ${res.count} 筆月盤點結果`);
    loadMonthlySnapshots();
  }).catch(err => { toggleLoader(false); alert('存檔異常：' + err.message); });
}

export function loadMonthlySnapshots() {
  const unitCode = document.getElementById('dm-monthly-unit')?.value || 'ALL';
  const monthStr = document.getElementById('dm-monthly-month')?.value || '';
  const thead = document.getElementById('dm-monthly-thead');
  const tbody = document.getElementById('dm-monthly-tbody');
  if (!tbody || !thead || !monthStr) return;

  fetchBackend('getMonthlySnapshotsAll', { unitCode, monthStr }).then(res => {
    monthlySnapCache = res?.data || [];
    renderSnapshotComparisonTable(thead, tbody, monthlySnapCache, unitCode, 'monthly');
  });
}

export function exportMonthlySnapshotsExcel() {
  if (!window.XLSX || !monthlySnapCache.length) return alert('無資料可匯出');
  const unitCode = document.getElementById('dm-monthly-unit')?.value || 'ALL';
  const monthStr = document.getElementById('dm-monthly-month')?.value || '';
  const wb = window.XLSX.utils.book_new();
  if (unitCode === 'ALL') {
    const pivot = {};
    for (const r of monthlySnapCache) {
      if (!pivot[r.drug_code]) pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
      pivot[r.drug_code].units[r.unit_code] = r;
    }
    const rows = [['藥品代碼', '藥品名稱', '門診SAP', '門診實盤', '門診帳差', '門診帳差%', '住院SAP', '住院實盤', '住院帳差', '住院帳差%', '急診SAP', '急診實盤', '急診帳差', '急診帳差%', '調配SAP', '調配實盤', '調配帳差', '調配帳差%', '全院總SAP', '全院總實盤', '全院總帳差', '全院總帳差%']];
    Object.values(pivot).sort((a, b) => a.drug_code.localeCompare(b.drug_code)).forEach(item => {
      const g = (u) => item.units[u] || { sap_qty: 0, total_actual_qty: 0, diff_qty: 0 };
      const ba = g('BA'), bf = g('BF'), be = g('BE'), bg = g('BG');
      const ts = (ba.sap_qty||0)+(bf.sap_qty||0)+(be.sap_qty||0)+(bg.sap_qty||0);
      const ta = (ba.total_actual_qty||0)+(bf.total_actual_qty||0)+(be.total_actual_qty||0)+(bg.total_actual_qty||0);
      const td = (ba.diff_qty||0)+(bf.diff_qty||0)+(be.diff_qty||0)+(bg.diff_qty||0);
      rows.push([item.drug_code, item.drug_name, ba.sap_qty, ba.total_actual_qty, ba.diff_qty, calcDiffPctNum(ba.diff_qty, ba.sap_qty) + '%', bf.sap_qty, bf.total_actual_qty, bf.diff_qty, calcDiffPctNum(bf.diff_qty, bf.sap_qty) + '%', be.sap_qty, be.total_actual_qty, be.diff_qty, calcDiffPctNum(be.diff_qty, be.sap_qty) + '%', bg.sap_qty, bg.total_actual_qty, bg.diff_qty, calcDiffPctNum(bg.diff_qty, bg.sap_qty) + '%', ts, ta, td, calcDiffPctNum(td, ts) + '%']);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '全院月盤點總表');
  } else {
    const rows = [['單位代碼', '單位名稱', '盤點月份', '藥品代碼', '藥品名稱', '月SAP', '調劑台', '庫存', '線上調整', '盤點總量', '帳差', '帳差百分比']];
    monthlySnapCache.forEach(r => rows.push([r.unit_code, UNIT_LABEL_MAP[r.unit_code] || r.unit_code, r.record_month, r.drug_code, r.drug_name, r.sap_qty, r.desk_qty, r.stock_qty, r.online_qty, r.total_actual_qty, r.diff_qty, calcDiffPctNum(r.diff_qty, r.sap_qty) + '%']));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '月盤點結果');
  }
  window.XLSX.writeFile(wb, `月盤點結果_${unitCode}_${monthStr}.xlsx`);
}

// 依候選欄位名稱取值（自動忽略欄名前後空白）
function pickSapField(row, keys = []) {
  if (!row || typeof row !== 'object') return '';
  const normMap = {};
  for (const [k, v] of Object.entries(row)) {
    normMap[String(k).trim()] = v;
  }
  for (const key of keys) {
    const val = normMap[String(key).trim()];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return val;
    }
  }
  return '';
}

// 取得 SAP 數量（優先讀取「未限制」，並相容舊欄名與千分位逗號）
function extractSapQty(row) {
  const raw = pickSapField(row, ['未限制', '未限制數量', '數量', '庫存量', '庫存', 'qty', 'quantity']);
  if (raw === '') return 0;
  const num = Number(String(raw).replace(/,/g, '').trim());
  return Number.isNaN(num) ? 0 : num;
}

let drugMasterCatalogCache = [];

function matchesFuzzyKeywords(text, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const target = String(text || '').toLowerCase();
  return tokens.every(tok => target.includes(tok));
}

export function openDrugMasterListView() {
  switchView('view-drug-master-list');
  if (!drugMasterCatalogCache.length) {
    loadDrugMasterCatalog();
  } else {
    renderDrugMasterCatalog();
  }
}

export function loadDrugMasterCatalog() {
  toggleLoader(true, '正在載入藥品主檔清單...');
  fetchBackend('getDrugMasterSearchList')
    .then(res => {
      toggleLoader(false);
      if (!res || !res.success) {
        alert('載入藥品主檔失敗：' + (res?.message || '未知錯誤'));
        return;
      }
      drugMasterCatalogCache = Array.isArray(res.data) ? res.data : [];
      renderDrugMasterCatalog();
    })
    .catch(err => {
      toggleLoader(false);
      alert('載入藥品主檔異常：' + err.message);
    });
}

export function clearDrugMasterCatalogSearch() {
  const input = document.getElementById('dm-catalog-search');
  if (input) input.value = '';
  renderDrugMasterCatalog();
}

export function renderDrugMasterCatalog() {
  const kw = document.getElementById('dm-catalog-search')?.value || '';
  const tbody = document.getElementById('dm-catalog-tbody');
  const countEl = document.getElementById('dm-catalog-count');
  const totalEl = document.getElementById('dm-catalog-total');
  if (!tbody) return;

  const filtered = drugMasterCatalogCache.filter(item => {
    const combined = `${item.inv_code || ''} ${item.price_code || ''} ${item.drug_name || ''}`;
    return matchesFuzzyKeywords(combined, kw);
  });

  if (countEl) countEl.innerText = filtered.length;
  if (totalEl) totalEl.innerText = drugMasterCatalogCache.length;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted">查無符合條件的藥品資料</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(item => `
    <tr>
      <td class="text-center fw-bold text-academic">${item.inv_code || '-'}</td>
      <td class="text-center">${item.price_code || '-'}</td>
      <td class="fw-bold">${item.drug_name || '-'}</td>
    </tr>
  `).join('');
}
