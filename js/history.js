import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { session } from './config.js';

export let selectedDates = [];
export let pivotData = {};
export let availableDrugs = [];
export let selectedDrugCode = null;
export let drugNotesData = [];
export let currentNoteDrugCode = null;
export let currentNoteDrugName = null;

const fullDetailHeaders = ["盤點流水號", "藥品代碼", "藥品名稱", "數量", "登記時間", "員工編號", "姓名", "盤點類型", "操作方式", "手動數量", "盤點表", "儲位", "批價"];
const headerKeys = ["sn", "code", "name", "qty", "time", "id", "user", "type", "action", "handQty", "tableId", "loc", "priceCodeSelect"];
export let detailColVisibility = headerKeys.map(() => true);
export let currentModalData = [];
export let detailModalInstance = null;
export let noteModalInstance = null;

export function initHistoryMode() {
  switchView('view-history-app');

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const addDateEl = document.getElementById('history-add-date');
  if (addDateEl) addDateEl.value = todayStr;

  selectedDates = [];
  pivotData = {};
  availableDrugs = [];
  clearDrugFilter(true);

  toggleLoader(true);
  fetchBackend('getDrugNotes').then(res => {
    if (res && res.success && Array.isArray(res.data)) drugNotesData = res.data;
    toggleLoader(false);
    addHistoryDate(todayStr);
  }).catch(() => {
    toggleLoader(false);
    showToast('無法讀取交班資料', 'delete');
    addHistoryDate(todayStr);
  });
}

export function addHistoryDate(forceDate = null) {
  const inputEl = document.getElementById('history-add-date');
  const dStr = forceDate || (inputEl ? inputEl.value : '');
  if (!dStr) return;
  if (selectedDates.includes(dStr)) return alert('該日期已在比較清單中');

  toggleLoader(true);
  fetchBackend('getHistoryData', { startDateStr: dStr, endDateStr: dStr }).then(res => {
    toggleLoader(false);
    if (!res || res.success === false) {
      return alert("⚠️ 系統提示：\n" + ((res && res.message) || "無法取得該日資料"));
    }

    selectedDates.push(dStr);
    selectedDates.sort();

    const rawData = Array.isArray(res.data) ? res.data : [];
    rawData.forEach(row => {
      if (!Array.isArray(row) || !row[0]) return;
      const code = String(row[0]).trim();
      const name = String(row[1] || code).trim();
      const priceCode = String(row[7] || '').trim();
      const sap = parseFloat(row[3]) || 0;
      const act = parseFloat(row[4]) || 0;
      const diff = parseFloat(row[5]) || 0;
      const detailJSON = row[6] || "[]";

      if (!pivotData[code]) {
        pivotData[code] = { name, priceCode, history: {} };
      } else {
        if (name && name !== code) pivotData[code].name = name;
        if (priceCode && !pivotData[code].priceCode) pivotData[code].priceCode = priceCode;
      }
      pivotData[code].history[dStr] = { sap, act, diff, detailJSON };
    });

    updateAvailableDrugs();
    renderDateBadges();
    renderHistoryTable();
    if (inputEl) inputEl.value = '';
  }).catch(err => {
    toggleLoader(false);
    console.error('getHistoryData 錯誤:', err);
    alert("📡 無法連線讀取該日資料");
  });
}

export function addQuickDate(type) {
  const today = new Date();
  let targetDate = new Date();
  if (type === 'today') {
    targetDate = today;
  } else if (type === 'yesterday') {
    targetDate.setDate(today.getDate() - 1);
  } else if (type === 'prev') {
    if (selectedDates.length === 0) targetDate = today;
    else {
      targetDate = new Date(selectedDates[0]);
      targetDate.setDate(targetDate.getDate() - 1);
    }
  }
  const dStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
  addHistoryDate(dStr);
}

export function removeHistoryDate(dateToRemove) {
  selectedDates = selectedDates.filter(d => d !== dateToRemove);
  renderDateBadges();
  renderHistoryTable();
}

export function renderDateBadges() {
  const container = document.getElementById('history-selected-dates');
  if (!container) return;
  if (selectedDates.length === 0) {
    container.innerHTML = '<span class="text-muted small">尚未加入任何日期</span>';
    return;
  }
  container.innerHTML = selectedDates.map(d =>
    `<span class="badge bg-academic fs-6 shadow-sm py-2 px-3 border border-secondary d-flex align-items-center gap-2"><i class="bi bi-calendar-event"></i> ${d} <i class="bi bi-x-circle-fill text-light ms-1" style="cursor:pointer;" onclick="removeHistoryDate('${d}')"></i></span>`
  ).join('');
}

function updateAvailableDrugs() {
  availableDrugs = Object.keys(pivotData).map(code => ({
    code,
    priceCode: pivotData[code].priceCode || '',
    name: pivotData[code].name || code
  }));
}

export function renderHistoryTable() {
  const thead = document.getElementById('history-thead');
  const tbody = document.getElementById('history-tbody');
  if (!thead || !tbody) return;

  if (selectedDates.length === 0) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td class="text-center py-5 text-muted fw-bold">請於上方加入日期以開始比較</td></tr>`;
    return;
  }

  const zeroFilterEl = document.getElementById('history-zero-filter');
  const zeroFilter = zeroFilterEl ? zeroFilterEl.value : 'hide_zero';

  let headHtml = `<tr>
    <th class="text-center text-nowrap align-middle bg-academic text-white border-end" style="min-width: 95px; position: sticky; left: 0; z-index: 11;">藥品代碼</th>
    <th class="text-center text-nowrap align-middle bg-academic text-white border-end" style="min-width: 95px; position: sticky; left: 95px; z-index: 11;">批價代碼</th>
    <th class="text-start text-nowrap align-middle bg-academic text-white border-end border-2" style="min-width: 175px; position: sticky; left: 190px; z-index: 11;">藥品名稱</th>`;
  selectedDates.forEach(d => {
    headHtml += `<th class="text-center text-nowrap bg-light border-start align-middle shadow-sm"><div class="text-dark fs-6 fw-bold"><i class="bi bi-calendar-check"></i> ${d.substring(5)}</div></th>`;
  });
  headHtml += `</tr>`;
  thead.innerHTML = headHtml;

  let drugs = Object.keys(pivotData);
  if (selectedDrugCode) drugs = drugs.filter(code => code === selectedDrugCode);
  drugs.sort();

  if (drugs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${selectedDates.length + 3}" class="text-center py-5 text-muted fw-bold">此區間查無盤點紀錄</td></tr>`;
    return;
  }

  let bodyHtml = '';
  let visibleRowIndex = 0;

  drugs.forEach((code) => {
    let isAllZero = true;
    selectedDates.forEach(d => {
      const record = pivotData[code].history[d];
      if (record && (record.sap !== 0 || record.act !== 0)) {
        isAllZero = false;
      }
    });

    if (zeroFilter === 'hide_zero' && isAllZero) {
      return;
    }

    const drugName = pivotData[code].name || code;
    const priceCode = pivotData[code].priceCode || '-';
    const rowBg = visibleRowIndex % 2 === 0 ? '#ffffff' : '#f1f3f5';
    visibleRowIndex++;

    const hasActiveNote = drugNotesData.some(n => n.code === code && n.status === '成立');
    const noteIcon = hasActiveNote
      ? `<i class="bi bi-chat-text-fill text-warning fs-5" style="cursor:pointer;" title="點擊查看交班註記" onclick="event.stopPropagation(); openNoteModal('${code}', '${drugName.replace(/'/g, "\\'")}')"></i>`
      : `<i class="bi bi-chat-text text-secondary opacity-50 fs-6" style="cursor:pointer;" title="新增交班註記" onclick="event.stopPropagation(); openNoteModal('${code}', '${drugName.replace(/'/g, "\\'")}')"></i>`;

    bodyHtml += `<tr style="cursor: pointer;" onclick="const h = this.getAttribute('data-h') === '1'; const c = h ? '${rowBg}' : '#fffbeb'; this.querySelectorAll('td').forEach(td => td.style.setProperty('background-color', c, 'important')); this.setAttribute('data-h', h ? '0' : '1');">
      <td class="text-center text-secondary fw-bold align-middle border-end" style="position: sticky; left: 0; z-index: 2; background-color: ${rowBg}; min-width: 95px;">${code}</td>
      <td class="text-center text-dark fw-semibold align-middle border-end" style="position: sticky; left: 95px; z-index: 2; background-color: ${rowBg}; min-width: 95px;">${priceCode}</td>
      <td class="text-start align-middle border-end border-2 p-2" style="position: sticky; left: 190px; z-index: 2; background-color: ${rowBg}; min-width: 175px;">
        <div class="d-flex align-items-center gap-2">
          <div>${noteIcon}</div>
          <div class="fw-bold text-dark" style="white-space: normal; word-break: break-word; line-height: 1.2;">${drugName}</div>
        </div>
      </td>`;

    selectedDates.forEach(d => {
      const record = pivotData[code].history[d];
      if (record) {
        const diffClass = record.diff === 0 ? 'text-success' : (record.diff > 0 ? 'text-academic' : 'text-danger');
        const diffStr = record.diff > 0 ? `+${record.diff}` : record.diff;
        bodyHtml += `
          <td class="align-middle border-start p-2" style="min-width: 130px; background-color: ${rowBg};">
            <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 0.8rem;"><span class="text-muted">SAP</span><span class="text-secondary fw-bold">${record.sap}</span></div>
            <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 0.85rem;"><span class="text-muted">盤點</span><span class="text-dark fw-bold">${record.act}</span></div>
            <div class="d-flex justify-content-between align-items-center pt-1 border-top border-secondary border-opacity-25" style="font-size: 0.85rem;" onclick="event.stopPropagation(); openPivotDetails('${code}', '${d}')">
              <span class="text-muted">差異</span><span class="${diffClass} fw-bold text-decoration-underline" style="text-underline-offset: 2px;">${diffStr} <i class="bi bi-info-circle ms-1"></i></span>
            </div>
          </td>`;
      } else {
        bodyHtml += `<td class="text-center text-muted align-middle border-start opacity-50" style="background-color: ${rowBg};">-</td>`;
      }
    });
    bodyHtml += `</tr>`;
  });
  tbody.innerHTML = bodyHtml;
}

// ==========================================
// 交班註記系統
// ==========================================
export function openNoteModal(code, name) {
  currentNoteDrugCode = code;
  currentNoteDrugName = name;
  const titleNameEl = document.getElementById('note-modal-title-name');
  const noteInputEl = document.getElementById('new-note-text');
  if (titleNameEl) titleNameEl.innerText = name;
  if (noteInputEl) noteInputEl.value = '';
  renderNoteList();

  if (!noteModalInstance) {
    const modalEl = document.getElementById('drugNoteModal');
    if (modalEl) noteModalInstance = new window.bootstrap.Modal(modalEl);
  }
  if (noteModalInstance) noteModalInstance.show();
}

function formatNoteTime(rawTime) {
  if (!rawTime) return '';
  const d = new Date(rawTime);
  if (isNaN(d.getTime())) return rawTime;

  const yyyy = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  return `${yyyy}/${m}/${day} ${hh}:${mm}:${ss}`;
}

function renderNoteList() {
  const area = document.getElementById('note-list-area');
  if (!area) return;
  const notes = drugNotesData
    .filter(n => n.code === currentNoteDrugCode)
    .sort((a, b) => new Date(b.createTime) - new Date(a.createTime));

  if (notes.length === 0) {
    area.innerHTML = '<div class="text-center p-4 text-muted small">目前無任何交班紀錄</div>';
    return;
  }

  let html = '';
  notes.forEach(n => {
    const isVoid = n.status === '作廢';
    const cardStyle = isVoid ? 'opacity: 0.6; filter: grayscale(100%);' : 'border-start: 4px solid #ffc107;';
    const niceCreateTime = formatNoteTime(n.createTime);
    const niceUpdateTime = formatNoteTime(n.updateTime);

    const btnHtml = isVoid
      ? `<span class="badge bg-secondary">已於 ${niceUpdateTime} 由 ${n.updater} 作廢</span>`
      : `<button class="btn btn-sm btn-outline-danger py-0" onclick="voidDrugNote('${n.sn}')">作廢</button>`;

    html += `
      <div class="card shadow-sm border-0 mb-2" style="${cardStyle}">
        <div class="card-body p-2">
          <div class="d-flex justify-content-between align-items-center mb-1 border-bottom pb-1">
            <span class="fw-bold text-dark small"><i class="bi bi-person-fill"></i> ${n.creator}</span>
            <span class="text-muted" style="font-size: 0.75rem;">${niceCreateTime}</span>
          </div>
          <div class="text-dark mb-2 fw-bold" style="white-space: pre-wrap; font-size: 0.9rem;">${n.note}</div>
          <div class="text-end">${btnHtml}</div>
        </div>
      </div>`;
  });
  area.innerHTML = html;
}

export function submitDrugNote() {
  const noteInputEl = document.getElementById('new-note-text');
  const noteText = noteInputEl ? noteInputEl.value.trim() : '';
  if (!noteText) return alert('請輸入註記內容！');

  const newSn = 'NOTE' + new Date().getTime();
  const payload = {
    noteAction: 'insert',
    sn: newSn,
    code: currentNoteDrugCode,
    name: currentNoteDrugName,
    note: noteText,
    userName: session.name
  };

  if (noteInputEl) noteInputEl.value = '';
  const nowStr = new Date().toLocaleString('zh-TW', { hour12: false }).replace(/-/g, '/');

  drugNotesData.unshift({
    sn: newSn,
    code: currentNoteDrugCode,
    name: currentNoteDrugName,
    note: noteText,
    status: '成立',
    createTime: nowStr,
    creator: session.name,
    updateTime: nowStr,
    updater: session.name
  });
  renderNoteList();
  renderHistoryTable();

  fetchBackend('saveDrugNote', payload).then(res => {
    if (!res || !res.success) alert('寫入失敗，請重新整理');
  }).catch(() => alert('網路連線錯誤，註記可能未儲存'));
}

export function voidDrugNote(sn) {
  if (!confirm('確定要作廢此筆交班事項嗎？')) return;
  const payload = { noteAction: 'void', sn, userName: session.name };

  const note = drugNotesData.find(n => n.sn === sn);
  if (note) {
    note.status = '作廢';
    note.updateTime = new Date().toLocaleString('zh-TW', { hour12: false }).replace(/-/g, '/');
    note.updater = session.name;
  }
  renderNoteList();
  renderHistoryTable();

  fetchBackend('saveDrugNote', payload).then(res => {
    if (!res || !res.success) alert('作廢失敗，請重新整理');
  }).catch(() => alert('網路連線錯誤'));
}

// ==========================================
// 搜尋與明細 Modal
// ==========================================
window.openPivotDetails = function(code, dateStr) {
  const record = pivotData[code] && pivotData[code].history ? pivotData[code].history[dateStr] : null;
  if (!record) return;
  const titleEl = document.getElementById('modal-drug-name');
  if (titleEl) titleEl.innerText = `${pivotData[code].name} (${dateStr} 明細)`;
  currentModalData = JSON.parse(record.detailJSON || "[]");
  renderModalToggles();
  renderModalContent();
  if (!detailModalInstance) {
    const modalEl = document.getElementById('detailsModal');
    if (modalEl) detailModalInstance = new window.bootstrap.Modal(modalEl);
  }
  if (detailModalInstance) detailModalInstance.show();
};

export function handleDrugSearch() {
  const inputEl = document.getElementById('drug-search-input');
  const dropdown = document.getElementById('drug-search-dropdown');
  if (!inputEl || !dropdown) return;

  const kw = inputEl.value.toLowerCase().trim();
  if (!kw) {
    dropdown.style.display = 'none';
    clearDrugFilter(false);
    return;
  }

  const filtered = availableDrugs.filter(d =>
    (d.code || '').toLowerCase().includes(kw) ||
    (d.priceCode || '').toLowerCase().includes(kw) ||
    (d.name || '').toLowerCase().includes(kw)
  ).slice(0, 10);

  if (filtered.length > 0) {
    dropdown.innerHTML = filtered.map(d =>
      `<div class="search-dropdown-item" onclick="selectDrugFilter('${d.code}', '${(d.name || '').replace(/'/g, "\\'")}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">代碼: ${d.code}${d.priceCode ? ` | 批價: ${d.priceCode}` : ''}</div></div>`
    ).join('');
    dropdown.style.display = 'block';
  } else {
    dropdown.innerHTML = '<div class="p-2 text-muted small">查無紀錄</div>';
    dropdown.style.display = 'block';
  }
}

export function selectDrugFilter(code, name) {
  selectedDrugCode = code;
  const inputEl = document.getElementById('drug-search-input');
  const dropdown = document.getElementById('drug-search-dropdown');
  if (inputEl) inputEl.value = `${name} (${code})`;
  if (dropdown) dropdown.style.display = 'none';
  renderHistoryTable();
}

export function clearDrugFilter(clearInput = true) {
  selectedDrugCode = null;
  const inputEl = document.getElementById('drug-search-input');
  if (clearInput && inputEl) inputEl.value = '';
  renderHistoryTable();
}

export function renderModalToggles() {
  const el = document.getElementById('modal-col-toggles');
  if (!el) return;
  el.innerHTML = fullDetailHeaders.map((h, i) =>
    `<button class="btn btn-sm ${detailColVisibility[i] ? 'btn-academic' : 'btn-outline-secondary'} fw-bold shadow-sm" style="font-size: 0.75rem;" onclick="toggleModalCol(${i})">${detailColVisibility[i] ? '<i class="bi bi-check-square-fill"></i>' : '<i class="bi bi-square"></i>'} ${h}</button>`
  ).join('');
}

export function toggleModalCol(index) {
  detailColVisibility[index] = !detailColVisibility[index];
  renderModalToggles();
  renderModalContent();
}

export function renderModalContent() {
  const thead = document.getElementById('modal-thead');
  const tbody = document.getElementById('modal-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = '<tr>' + fullDetailHeaders.map(h => `<th class="py-2 text-nowrap">${h}</th>`).join('') + '</tr>';
  tbody.innerHTML = currentModalData.length === 0
    ? `<tr><td colspan="${fullDetailHeaders.length}" class="text-center py-4 text-muted">無細項資料</td></tr>`
    : currentModalData.map(r => '<tr>' + headerKeys.map(k => `<td class="text-center">${r[k] !== undefined ? r[k] : ''}</td>`).join('') + '</tr>').join('');
}
