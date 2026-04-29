import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { session } from './config.js'; // 🌟 需要 session 抓取使用者名稱

export let selectedDates = []; 
export let pivotData = {}; 
export let availableDrugs = []; 
export let selectedDrugCode = null; 
export let drugNotesData = []; // 🌟 儲存所有交班註記
export let currentNoteDrugCode = null; // 記錄目前打開註記的藥品
export let currentNoteDrugName = null;

const fullDetailHeaders = ["盤點流水號", "藥品代碼", "藥品名稱", "數量", "登記時間", "員工編號", "姓名", "盤點類型", "操作方式", "手動數量", "盤點表", "儲位", "批價"];
const headerKeys = ["sn", "code", "name", "qty", "time", "id", "user", "type", "action", "handQty", "tableId", "loc", "priceCodeSelect"];
export let detailColVisibility = headerKeys.map(() => true); 
export let currentModalData = []; 
export let detailModalInstance = null; 
export let noteModalInstance = null;

// 🌟 初始化時，先去抓取所有的交班註記
export function initHistoryMode() {
  switchView('view-history-app'); 
  
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.getElementById('history-add-date').value = todayStr;
  
  selectedDates = []; pivotData = {}; availableDrugs = []; clearDrugFilter(true);
  
  toggleLoader(true);
  // 取得交班筆記，完成後才自動載入今天的盤點資料
  fetchBackend('getDrugNotes').then(res => {
    if (res && res.success) drugNotesData = res.data;
    toggleLoader(false);
    addHistoryDate(todayStr); 
  }).catch(err => {
    toggleLoader(false);
    showToast('無法讀取交班資料', 'delete');
    addHistoryDate(todayStr); 
  });
}

export function addHistoryDate(forceDate = null) {
  const dStr = forceDate || document.getElementById('history-add-date').value;
  if (!dStr) return; 
  if (selectedDates.includes(dStr)) return alert('該日期已在比較清單中');

  toggleLoader(true);
  fetchBackend('getHistoryData', { startDateStr: dStr, endDateStr: dStr }).then(res => {
    toggleLoader(false);
    if (res && res.success === false) return alert("⚠️ 系統提示：\n" + (res.message || "未知錯誤")); 
    
    selectedDates.push(dStr);
    selectedDates.sort(); 

    const rawData = res.data || [];
    rawData.forEach(row => {
      const code = row[0], name = row[1]; 
      const sap = parseFloat(row[3]) || 0, act = parseFloat(row[4]) || 0, diff = parseFloat(row[5]) || 0;
      const detailJSON = row[6] || "[]";

      if (!pivotData[code]) pivotData[code] = { name: name, history: {} };
      pivotData[code].history[dStr] = { sap, act, diff, detailJSON }; 
    });

    updateAvailableDrugs();
    renderDateBadges();
    renderHistoryTable();
    document.getElementById('history-add-date').value = '';
    
  }).catch(err => { toggleLoader(false); alert("📡 無法連線讀取該日資料"); });
}

export function addQuickDate(type) {
  const today = new Date(); let targetDate = new Date();
  if (type === 'today') { targetDate = today; } 
  else if (type === 'yesterday') { targetDate.setDate(today.getDate() - 1); } 
  else if (type === 'prev') {
    if (selectedDates.length === 0) targetDate = today;
    else { targetDate = new Date(selectedDates[0]); targetDate.setDate(targetDate.getDate() - 1); }
  }
  const dStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
  addHistoryDate(dStr);
}

export function removeHistoryDate(dateToRemove) {
  selectedDates = selectedDates.filter(d => d !== dateToRemove);
  renderDateBadges(); renderHistoryTable();
}

export function renderDateBadges() {
  const container = document.getElementById('history-selected-dates');
  if (selectedDates.length === 0) { container.innerHTML = '<span class="text-muted small">尚未加入任何日期</span>'; return; }
  container.innerHTML = selectedDates.map(d => `<span class="badge bg-academic fs-6 shadow-sm py-2 px-3 border border-secondary d-flex align-items-center gap-2"><i class="bi bi-calendar-event"></i> ${d} <i class="bi bi-x-circle-fill text-light ms-1" style="cursor:pointer;" onclick="removeHistoryDate('${d}')"></i></span>`).join('');
}

function updateAvailableDrugs() { availableDrugs = Object.keys(pivotData).map(code => ({ code: code, name: pivotData[code].name })); }

// 🌟 完美修復斑馬紋與閱讀尺 (嚴格設定 td 背景色，拒絕破圖)
export function renderHistoryTable() {
  const thead = document.getElementById('history-thead');
  const tbody = document.getElementById('history-tbody'); 
  if (selectedDates.length === 0) { thead.innerHTML = ''; tbody.innerHTML = `<tr><td class="text-center py-5 text-muted fw-bold">請於上方加入日期以開始比較</td></tr>`; return; }

  let headHtml = `<tr>
    <th class="text-center text-nowrap align-middle bg-academic text-white border-end" style="min-width: 90px; position: sticky; left: 0; z-index: 11;">代碼</th>
    <th class="text-start text-nowrap align-middle bg-academic text-white border-end border-2" style="min-width: 170px; position: sticky; left: 90px; z-index: 11;">藥品名稱</th>`;
  selectedDates.forEach(d => { headHtml += `<th class="text-center text-nowrap bg-light border-start align-middle shadow-sm"><div class="text-dark fs-6 fw-bold"><i class="bi bi-calendar-check"></i> ${d.substring(5)}</div></th>`; });
  headHtml += `</tr>`; thead.innerHTML = headHtml;

  let drugs = Object.keys(pivotData);
  if (selectedDrugCode) drugs = drugs.filter(code => code === selectedDrugCode);
  drugs.sort(); 

  if (drugs.length === 0) { tbody.innerHTML = `<tr><td colspan="${selectedDates.length + 2}" class="text-center py-5 text-muted fw-bold">此區間查無盤點紀錄</td></tr>`; return; }

  let bodyHtml = '';
  drugs.forEach((code, index) => {
    const drugName = pivotData[code].name;
    
    // 🌟 強制指定每一列的原始底色 (斑馬紋)
    const rowBg = index % 2 === 0 ? '#ffffff' : '#f1f3f5';
    
    // 🌟 檢查該藥品是否有「成立」的交班註記，決定 Icon 顏色
    const hasActiveNote = drugNotesData.some(n => n.code === code && n.status === '成立');
    const noteIcon = hasActiveNote 
      ? `<i class="bi bi-chat-text-fill text-warning ms-1 fs-5" style="cursor:pointer;" onclick="event.stopPropagation(); openNoteModal('${code}', '${drugName}')"></i>` 
      : `<i class="bi bi-chat-text text-secondary opacity-50 ms-1 fs-6" style="cursor:pointer;" onclick="event.stopPropagation(); openNoteModal('${code}', '${drugName}')"></i>`;

    // 🌟 點擊整列觸發的高亮事件 (完全透過 JS 操作 td 的 background-color，不再依賴 CSS hover)
    bodyHtml += `<tr style="cursor: pointer;" onclick="const h = this.getAttribute('data-h') === '1'; const c = h ? '${rowBg}' : '#fffbeb'; this.querySelectorAll('td').forEach(td => td.style.setProperty('background-color', c, 'important')); this.setAttribute('data-h', h ? '0' : '1');">
      
      <td class="text-center text-secondary fw-bold align-middle border-end" style="position: sticky; left: 0; z-index: 2; background-color: ${rowBg};">${code}</td>
      <td class="text-start fw-bold align-middle text-dark border-end border-2" style="position: sticky; left: 90px; z-index: 2; background-color: ${rowBg}; d-flex justify-content-between align-items-center">
        <span class="text-truncate d-inline-block" style="max-width: 120px; vertical-align: middle;">${drugName}</span>
        ${noteIcon}
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
// ✨ 交班註記系統 (新增)
// ==========================================

export function openNoteModal(code, name) {
  currentNoteDrugCode = code;
  currentNoteDrugName = name;
  document.getElementById('note-modal-title-name').innerText = name;
  document.getElementById('new-note-text').value = '';
  renderNoteList();
  
  if (!noteModalInstance) noteModalInstance = new window.bootstrap.Modal(document.getElementById('drugNoteModal'));
  noteModalInstance.show();
}

// 🌟 新增：時間格式美化小工具
function formatNoteTime(rawTime) {
  if (!rawTime) return '';
  const d = new Date(rawTime);
  if (isNaN(d.getTime())) return rawTime; // 若解析失敗則顯示原字串
  
  const yyyy = d.getFullYear();
  const m = d.getMonth() + 1; // 月份不需要補零，符合您的需求
  const day = d.getDate();    // 日期不需要補零
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  
  return `${yyyy}/${m}/${day} ${hh}:${mm}:${ss}`;
}

// 🌟 更新：渲染交班清單 (套用時間美化)
function renderNoteList() {
  const area = document.getElementById('note-list-area');
  // 篩選出這個藥品的註記，由新到舊排序
  const notes = drugNotesData.filter(n => n.code === currentNoteDrugCode).sort((a, b) => new Date(b.createTime) - new Date(a.createTime));
  
  if (notes.length === 0) {
    area.innerHTML = '<div class="text-center p-4 text-muted small">目前無任何交班紀錄</div>';
    return;
  }
  
  let html = '';
  notes.forEach(n => {
    const isVoid = n.status === '作廢';
    const cardStyle = isVoid ? 'opacity: 0.6; filter: grayscale(100%);' : 'border-start: 4px solid #ffc107;';
    
    // 🌟 這裡套用我們剛剛寫好的美化工具
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
  const noteText = document.getElementById('new-note-text').value.trim();
  if (!noteText) return alert('請輸入註記內容！');
  
  const payload = { action: 'insert', code: currentNoteDrugCode, name: currentNoteDrugName, note: noteText, userName: session.name };
  
  // 樂觀更新 UI
  document.getElementById('new-note-text').value = '';
  const nowStr = new Date().toLocaleString('zh-TW', { hour12: false }).replace(/-/g, '/');
  const tempSn = 'TMP' + new Date().getTime();
  drugNotesData.unshift({ sn: tempSn, code: currentNoteDrugCode, name: currentNoteDrugName, note: noteText, status: '成立', createTime: nowStr, creator: session.name, updateTime: nowStr, updater: session.name });
  renderNoteList();
  renderHistoryTable(); // 更新外層 Icon
  
  fetchBackend('saveDrugNote', payload).then(res => {
    if (!res.success) { alert('寫入失敗，請重新整理'); }
  }).catch(err => alert('網路連線錯誤，註記可能未儲存'));
}

export function voidDrugNote(sn) {
  if (!confirm('確定要作廢此筆交班事項嗎？')) return;
  const payload = { action: 'void', sn: sn, userName: session.name };
  
  // 樂觀更新 UI
  const note = drugNotesData.find(n => n.sn === sn);
  if (note) {
    note.status = '作廢';
    note.updateTime = new Date().toLocaleString('zh-TW', { hour12: false }).replace(/-/g, '/');
    note.updater = session.name;
  }
  renderNoteList();
  renderHistoryTable(); // 更新外層 Icon
  
  fetchBackend('saveDrugNote', payload).then(res => {
    if (!res.success) { alert('作廢失敗，請重新整理'); }
  }).catch(err => alert('網路連線錯誤'));
}

// ============== 以下維持原樣 (搜尋與明細 Modal) ==============
window.openPivotDetails = function(code, dateStr) { const record = pivotData[code].history[dateStr]; if(!record) return; document.getElementById('modal-drug-name').innerText = `${pivotData[code].name} (${dateStr} 明細)`; currentModalData = JSON.parse(record.detailJSON || "[]"); renderModalToggles(); renderModalContent(); if (!detailModalInstance) detailModalInstance = new window.bootstrap.Modal(document.getElementById('detailsModal')); detailModalInstance.show(); }
export function handleDrugSearch() { const inputEl = document.getElementById('drug-search-input'); const kw = inputEl.value.toLowerCase().trim(); const dropdown = document.getElementById('drug-search-dropdown'); if (!kw) { dropdown.style.display = 'none'; clearDrugFilter(false); return; } const filtered = availableDrugs.filter(d => d.code.toLowerCase().includes(kw) || d.name.toLowerCase().includes(kw)).slice(0, 10); if (filtered.length > 0) { dropdown.innerHTML = filtered.map(d => `<div class="search-dropdown-item" onclick="selectDrugFilter('${d.code}', '${d.name.replace(/'/g, "\\'")}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">${d.code}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">查無紀錄</div>'; dropdown.style.display = 'block'; } }
export function selectDrugFilter(code, name) { selectedDrugCode = code; document.getElementById('drug-search-input').value = `${name} (${code})`; document.getElementById('drug-search-dropdown').style.display = 'none'; renderHistoryTable(); }
export function clearDrugFilter(clearInput = true) { selectedDrugCode = null; if (clearInput) document.getElementById('drug-search-input').value = ''; renderHistoryTable(); }
export function renderModalToggles() { document.getElementById('modal-col-toggles').innerHTML = fullDetailHeaders.map((h, i) => `<button class="btn btn-sm ${detailColVisibility[i] ? 'btn-academic' : 'btn-outline-secondary'} fw-bold shadow-sm" style="font-size: 0.75rem;" onclick="toggleModalCol(${i})">${detailColVisibility[i] ? '<i class="bi bi-check-square-fill"></i>' : '<i class="bi bi-square"></i>'} ${h}</button>`).join(''); }
export function toggleModalCol(index) { detailColVisibility[index] = !detailColVisibility[index]; renderModalToggles(); renderModalContent(); }
export function renderModalContent() { document.getElementById('modal-thead').innerHTML = '<tr>' + fullDetailHeaders.map(h => `<th class="py-2 text-nowrap">${h}</th>`).join('') + '</tr>'; document.getElementById('modal-tbody').innerHTML = currentModalData.length === 0 ? `<tr><td colspan="${fullDetailHeaders.length}" class="text-center py-4 text-muted">無細項資料</td></tr>` : currentModalData.map(r => '<tr>' + headerKeys.map(k => `<td class="text-center">${r[k] !== undefined ? r[k] : ''}</td>`).join('') + '</tr>').join(''); }
