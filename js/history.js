import { fetchBackend } from './api.js';
import { toggleLoader, switchView } from './ui.js';

export let selectedDates = []; // 儲存使用者加入的日期欄位
export let pivotData = {}; // 樞紐分析資料庫 { drugCode: { name: '...', history: { '2026-04-29': { act, diff, detailJSON } } } }
export let availableDrugs = []; 
export let selectedDrugCode = null; 

const fullDetailHeaders = ["盤點流水號", "藥品代碼", "藥品名稱", "數量", "登記時間", "員工編號", "姓名", "盤點類型", "操作方式", "調劑類型", "手動數量", "盤點表編號", "選擇儲位碼編號", "選擇條碼輸入區", "選擇批價代碼", "輸入單位"];
const headerKeys = ["sn", "code", "name", "qty", "time", "id", "user", "type", "action", "dispType", "handQty", "tableId", "loc", "barcode", "priceCodeSelect", "unit"];
export let detailColVisibility = headerKeys.map(() => true); 
export let currentModalData = []; 
export let detailModalInstance = null; 

export function initHistoryMode() {
  switchView('view-history-app'); 
  
  // 預設填入今天日期
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.getElementById('history-add-date').value = todayStr;
  
  // 初始化狀態
  selectedDates = [];
  pivotData = {};
  availableDrugs = [];
  clearDrugFilter(true);
  
  // 自動幫使用者把今天的欄位加進去
  addHistoryDate(todayStr);
}

// 🌟 新增：將指定日期加入欄位並撈取資料
export function addHistoryDate(forceDate = null) {
  const dStr = forceDate || document.getElementById('history-add-date').value;
  if (!dStr) return alert('請選擇日期');
  if (selectedDates.includes(dStr)) return alert('該日期已在比較清單中');

  toggleLoader(true);
  // 我們不需要修改 GAS，直接將 startDate 和 endDate 都設為同一天，就能精準撈取單日紀錄
  fetchBackend('getHistoryData', { startDateStr: dStr, endDateStr: dStr }).then(res => {
    toggleLoader(false);
    if (res && res.success === false) return alert("⚠️ 系統提示：\n" + (res.message || "未知錯誤")); 
    
    // 將新日期加入並由舊到新排序 (符合趨勢觀看習慣)
    selectedDates.push(dStr);
    selectedDates.sort();

    const rawData = res.data || [];
    
    // 🌟 將生資料解析進樞紐資料庫 (Pivot Data)
    rawData.forEach(row => {
      const code = row[0], name = row[1], date = row[2];
      const sap = parseFloat(row[3]) || 0, act = parseFloat(row[4]) || 0, diff = parseFloat(row[5]) || 0;
      const detailJSON = row[6] || "[]";

      if (!pivotData[code]) pivotData[code] = { name: name, history: {} };
      pivotData[code].history[date] = { sap, act, diff, detailJSON };
    });

    // 更新下拉選單清單
    updateAvailableDrugs();
    
    renderDateBadges();
    renderHistoryTable();
    
  }).catch(err => { 
    toggleLoader(false); 
    alert("📡 無法連線讀取該日資料"); 
  });
}

// 🌟 新增：移除某個日期的欄位
export function removeHistoryDate(dateToRemove) {
  selectedDates = selectedDates.filter(d => d !== dateToRemove);
  renderDateBadges();
  renderHistoryTable();
}

// 🌟 渲染已加入的日期標籤
export function renderDateBadges() {
  const container = document.getElementById('history-selected-dates');
  if (selectedDates.length === 0) {
    container.innerHTML = '<span class="text-muted small">尚未加入任何日期</span>';
    return;
  }
  container.innerHTML = selectedDates.map(d => 
    `<span class="badge bg-academic fs-6 shadow-sm py-2 px-3 border border-secondary d-flex align-items-center gap-2">
       <i class="bi bi-calendar-event"></i> ${d} 
       <i class="bi bi-x-circle-fill text-light ms-1" style="cursor:pointer;" onclick="removeHistoryDate('${d}')"></i>
     </span>`
  ).join('');
}

// 更新可搜尋的藥品清單
function updateAvailableDrugs() {
  availableDrugs = Object.keys(pivotData).map(code => ({ code: code, name: pivotData[code].name }));
}

// 🌟 全新重寫：動態渲染樞紐分析表 (Cross-tab)
export function renderHistoryTable() {
  const thead = document.getElementById('history-thead');
  const tbody = document.getElementById('history-tbody'); 

  if (selectedDates.length === 0) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td class="text-center py-5 text-muted fw-bold">請於上方加入日期以開始比較</td></tr>`;
    return;
  }

  // 1. 動態建立標題列 (Columns)
  let headHtml = `<tr>
    <th class="text-center text-nowrap align-middle" style="min-width: 100px;">代碼</th>
    <th class="text-start text-nowrap align-middle" style="min-width: 180px;">藥品名稱</th>`;
  selectedDates.forEach(d => {
    headHtml += `<th class="text-center text-nowrap bg-light border-start">
                   <div class="text-dark">${d.substring(5)}</div>
                   <div class="small fw-normal text-secondary">數量 (差異)</div>
                 </th>`;
  });
  headHtml += `</tr>`;
  thead.innerHTML = headHtml;

  // 2. 準備列資料 (Rows)
  let drugs = Object.keys(pivotData);
  if (selectedDrugCode) drugs = drugs.filter(code => code === selectedDrugCode);
  drugs.sort(); // 依代碼排序

  if (drugs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${selectedDates.length + 2}" class="text-center py-5 text-muted fw-bold">此區間查無盤點紀錄</td></tr>`;
    return;
  }

  // 3. 填入細胞格 (Cells)
  let bodyHtml = '';
  drugs.forEach(code => {
    const drugName = pivotData[code].name;
    bodyHtml += `<tr>
      <td class="text-center text-secondary fw-bold align-middle">${code}</td>
      <td class="text-start fw-bold align-middle text-dark">${drugName}</td>`;
    
    selectedDates.forEach(d => {
      const record = pivotData[code].history[d];
      if (record) {
         // 有盤點紀錄，顯示數量與差異，並綁定點擊開啟明細
         const diffClass = record.diff === 0 ? 'text-success' : (record.diff > 0 ? 'text-academic' : 'text-danger');
         const diffStr = record.diff > 0 ? `+${record.diff}` : record.diff;
         bodyHtml += `
          <td class="text-center align-middle border-start" style="background-color: #f8f9fa40;">
            <div class="fw-bold fs-5 text-dark">${record.act}</div>
            <div class="small fw-bold ${diffClass}" style="cursor: pointer; text-decoration: underline; text-underline-offset: 3px;" onclick="openPivotDetails('${code}', '${d}')">
              (${diffStr}) <i class="bi bi-info-circle"></i>
            </div>
          </td>`;
      } else {
         // 當天沒有這個藥品的紀錄
         bodyHtml += `<td class="text-center text-muted align-middle border-start bg-light opacity-50">-</td>`;
      }
    });
    bodyHtml += `</tr>`;
  });
  
  tbody.innerHTML = bodyHtml;
}

// 🌟 修改：點擊特定儲存格開啟明細
window.openPivotDetails = function(code, dateStr) { 
  const record = pivotData[code].history[dateStr];
  if(!record) return;

  document.getElementById('modal-drug-name').innerText = `${pivotData[code].name} (${dateStr} 明細)`; 
  currentModalData = JSON.parse(record.detailJSON || "[]"); 
  renderModalToggles(); 
  renderModalContent(); 
  
  if (!detailModalInstance) detailModalInstance = new window.bootstrap.Modal(document.getElementById('detailsModal')); 
  detailModalInstance.show(); 
}

// ---------------- 以下維持原樣：過濾器與 Modal 邏輯 ----------------

export function handleDrugSearch() { 
  const inputEl = document.getElementById('drug-search-input');
  const kw = inputEl.value.toLowerCase().trim(); 
  const dropdown = document.getElementById('drug-search-dropdown'); 
  
  if (!kw) { dropdown.style.display = 'none'; clearDrugFilter(false); return; } 
  
  const filtered = availableDrugs.filter(d => d.code.toLowerCase().includes(kw) || d.name.toLowerCase().includes(kw)).slice(0, 10); 
  if (filtered.length > 0) { 
      dropdown.innerHTML = filtered.map(d => `<div class="search-dropdown-item" onclick="selectDrugFilter('${d.code}', '${d.name.replace(/'/g, "\\'")}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">${d.code}</div></div>`).join(''); 
      dropdown.style.display = 'block'; 
  } else { 
      dropdown.innerHTML = '<div class="p-2 text-muted small">查無紀錄</div>'; 
      dropdown.style.display = 'block'; 
  } 
}

export function selectDrugFilter(code, name) { 
  selectedDrugCode = code; 
  document.getElementById('drug-search-input').value = `${name} (${code})`; 
  document.getElementById('drug-search-dropdown').style.display = 'none'; 
  renderHistoryTable(); 
}

export function clearDrugFilter(clearInput = true) { 
  selectedDrugCode = null; 
  if (clearInput) document.getElementById('drug-search-input').value = ''; 
  renderHistoryTable(); 
}

export function renderModalToggles() { document.getElementById('modal-col-toggles').innerHTML = fullDetailHeaders.map((h, i) => `<button class="btn btn-sm ${detailColVisibility[i] ? 'btn-academic' : 'btn-outline-secondary'} fw-bold shadow-sm" style="font-size: 0.75rem;" onclick="toggleModalCol(${i})">${detailColVisibility[i] ? '<i class="bi bi-check-square-fill"></i>' : '<i class="bi bi-square"></i>'} ${h}</button>`).join(''); }
export function toggleModalCol(index) { detailColVisibility[index] = !detailColVisibility[index]; renderModalToggles(); renderModalContent(); }
export function renderModalContent() {
  document.getElementById('modal-thead').innerHTML = '<tr>' + fullDetailHeaders.map(h => `<th class="py-2 text-nowrap">${h}</th>`).join('') + '</tr>';
  document.getElementById('modal-tbody').innerHTML = currentModalData.length === 0 ? `<tr><td colspan="${fullDetailHeaders.length}" class="text-center py-4 text-muted">無細項資料</td></tr>` : currentModalData.map(r => '<tr>' + headerKeys.map(k => `<td class="text-center">${r[k] !== undefined ? r[k] : ''}</td>`).join('') + '</tr>').join('');
}
