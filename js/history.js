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

// 🌟 修復版：將指定日期加入欄位並撈取資料 (解決 - 號顯示問題)
export function addHistoryDate(forceDate = null) {
  const dStr = forceDate || document.getElementById('history-add-date').value;
  if (!dStr) return; // 使用者如果只是點開日曆又關掉，不報錯
  if (selectedDates.includes(dStr)) return alert('該日期已在比較清單中');

  toggleLoader(true);
  fetchBackend('getHistoryData', { startDateStr: dStr, endDateStr: dStr }).then(res => {
    toggleLoader(false);
    if (res && res.success === false) return alert("⚠️ 系統提示：\n" + (res.message || "未知錯誤")); 
    
    selectedDates.push(dStr);
    selectedDates.sort(); // 保持日期由小到大排序

    const rawData = res.data || [];
    
    rawData.forEach(row => {
      const code = row[0], name = row[1]; 
      // 🌟 關鍵修復：我們不使用 row[2] (後端回傳的日期)，而是強制使用前端請求的 dStr 當作 Key
      // 這樣無論後端回傳 2026/04/29 還是 04/29，都能 100% 精準對應到表格的欄位！
      const sap = parseFloat(row[3]) || 0, act = parseFloat(row[4]) || 0, diff = parseFloat(row[5]) || 0;
      const detailJSON = row[6] || "[]";

      if (!pivotData[code]) pivotData[code] = { name: name, history: {} };
      pivotData[code].history[dStr] = { sap, act, diff, detailJSON }; 
    });

    updateAvailableDrugs();
    renderDateBadges();
    renderHistoryTable();
    
    // 清空日曆輸入框，方便下次選取
    document.getElementById('history-add-date').value = '';
    
  }).catch(err => { 
    toggleLoader(false); 
    alert("📡 無法連線讀取該日資料"); 
  });
}

// 🌟 新增：快捷加入日期功能
export function addQuickDate(type) {
  const today = new Date();
  let targetDate = new Date();
  
  if (type === 'today') {
    targetDate = today;
  } else if (type === 'yesterday') {
    targetDate.setDate(today.getDate() - 1);
  } else if (type === 'prev') {
    // 往前一天：找出目前已選擇的最早日期，再減一天
    if (selectedDates.length === 0) {
      targetDate = today;
    } else {
      targetDate = new Date(selectedDates[0]); // 因為 selectedDates 有排序，[0] 絕對是最早的那天
      targetDate.setDate(targetDate.getDate() - 1);
    }
  }
  
  // 轉換成 YYYY-MM-DD 格式
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dStr = `${yyyy}-${mm}-${dd}`;
  
  addHistoryDate(dStr);
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

// 🌟 全新重寫：動態渲染樞紐分析表 (加入凍結窗格、斑馬紋與點擊閱讀尺)
export function renderHistoryTable() {
  const thead = document.getElementById('history-thead');
  const tbody = document.getElementById('history-tbody'); 

  if (selectedDates.length === 0) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td class="text-center py-5 text-muted fw-bold">請於上方加入日期以開始比較</td></tr>`;
    return;
  }

  // 1. 動態建立標題列 (Columns)
  // 🌟 神技一：加入 position: sticky 凍結左邊兩欄 (z-index: 11 確保不被蓋住)
  let headHtml = `<tr>
    <th class="text-center text-nowrap align-middle bg-academic text-white border-end" style="min-width: 90px; position: sticky; left: 0; z-index: 11;">代碼</th>
    <th class="text-start text-nowrap align-middle bg-academic text-white border-end border-2" style="min-width: 160px; position: sticky; left: 90px; z-index: 11;">藥品名稱</th>`;
  
  selectedDates.forEach(d => {
    headHtml += `<th class="text-center text-nowrap bg-light border-start align-middle shadow-sm">
                   <div class="text-dark fs-6 fw-bold"><i class="bi bi-calendar-check"></i> ${d.substring(5)}</div>
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
  drugs.forEach((code, index) => {
    const drugName = pivotData[code].name;
    
    // 🌟 神技二：斑馬紋交錯底色 (奇數白、偶數淺灰)
    const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';

    // 🌟 神技三：點擊閱讀尺 (onclick 會切換淺黃色 #fffbeb 與原本的斑馬紋色)
    // 並且在 td 中使用 background-color: inherit 讓凍結的欄位也能透出整列的顏色
    bodyHtml += `<tr style="background-color: ${rowBg}; cursor: pointer; transition: background-color 0.2s;" 
                     onclick="this.style.backgroundColor = this.style.backgroundColor === 'rgb(255, 251, 235)' ? '${rowBg}' : '#fffbeb';">
      <td class="text-center text-secondary fw-bold align-middle border-end" style="position: sticky; left: 0; z-index: 2; background-color: inherit;">${code}</td>
      <td class="text-start fw-bold align-middle text-dark border-end border-2" style="position: sticky; left: 90px; z-index: 2; background-color: inherit;">${drugName}</td>`;
    
    selectedDates.forEach(d => {
      const record = pivotData[code].history[d];
      if (record) {
         const diffClass = record.diff === 0 ? 'text-success' : (record.diff > 0 ? 'text-academic' : 'text-danger');
         const diffStr = record.diff > 0 ? `+${record.diff}` : record.diff;
         
         // 注意：把 onclick 綁在差異那一列，並且加上 event.stopPropagation() 防止觸發整列的高亮變色
         bodyHtml += `
          <td class="align-middle border-start p-2" style="min-width: 130px;">
            <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 0.8rem;">
              <span class="text-muted">SAP</span>
              <span class="text-secondary fw-bold">${record.sap}</span>
            </div>
            <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 0.85rem;">
              <span class="text-muted">盤點</span>
              <span class="text-dark fw-bold">${record.act}</span>
            </div>
            <div class="d-flex justify-content-between align-items-center pt-1 border-top border-secondary border-opacity-25" style="font-size: 0.85rem;" 
                 onclick="event.stopPropagation(); openPivotDetails('${code}', '${d}')">
              <span class="text-muted">差異</span>
              <span class="${diffClass} fw-bold text-decoration-underline" style="text-underline-offset: 2px;">
                ${diffStr} <i class="bi bi-info-circle ms-1"></i>
              </span>
            </div>
          </td>`;
      } else {
         bodyHtml += `<td class="text-center text-muted align-middle border-start opacity-50">-</td>`;
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
