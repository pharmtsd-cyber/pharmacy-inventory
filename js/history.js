import { fetchBackend } from './api.js';
import { toggleLoader, switchView } from './ui.js';

export let historyData = []; 
export let availableDrugs = []; 
export let selectedDrugCode = null; 

const fullDetailHeaders = ["盤點流水號", "藥品代碼", "藥品名稱", "數量", "登記時間", "員工編號", "姓名", "盤點類型", "操作方式", "調劑類型", "手動數量", "盤點表編號", "選擇儲位碼編號", "選擇條碼輸入區", "選擇批價代碼", "輸入單位"];
const headerKeys = ["sn", "code", "name", "qty", "time", "id", "user", "type", "action", "dispType", "handQty", "tableId", "loc", "barcode", "priceCodeSelect", "unit"];
export let detailColVisibility = headerKeys.map(() => true); 
export let currentModalData = []; 
export let detailModalInstance = null; 

export function initHistoryMode() {
  switchView('view-history-app'); 
  const today = new Date();
  document.getElementById('history-start-date').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()-7).padStart(2,'0')}`;
  document.getElementById('history-end-date').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
}

export function loadHistoryData() {
  const start = document.getElementById('history-start-date').value; 
  const end = document.getElementById('history-end-date').value; 
  if(!start || !end) return alert('請選擇完整區間');
  
  toggleLoader(true);
  fetchBackend('getHistoryData', { startDateStr: start, endDateStr: end }).then(res => {
    toggleLoader(false); 
    
    // 防呆：如果後端有明確回傳錯誤
    if (res && res.success === false) { 
        alert("⚠️ 系統提示：\n" + (res.message || "未知錯誤")); 
        return; 
    }
    
    historyData = res.data || []; 
    if (historyData.length === 0) { 
        document.getElementById('history-tbody').innerHTML = '<tr><td colspan="5" class="text-center py-5 text-muted fw-bold">此區間查無紀錄</td></tr>'; 
        availableDrugs = []; 
        clearDrugFilter(); 
        return; 
    }
    
    const drugMap = new Map(); 
    historyData.forEach(row => { if(!drugMap.has(row[0])) drugMap.set(row[0], row[1]); });
    availableDrugs = Array.from(drugMap, ([code, name]) => ({ code, name }));
    
    document.getElementById('drug-search-input').disabled = false; 
    
    // 【關鍵修復點】：移除所有去尋找被刪除按鈕的程式碼，改用 placeholder 提示操作
    document.getElementById('drug-search-input').placeholder = "輸入代碼或名稱 (清空即還原全部)..."; 
    clearDrugFilter(); 
    
  }).catch(err => { 
    toggleLoader(false); 
    console.error("前端崩潰或網路錯誤：", err);
    alert("📡 嚴重錯誤：無法解析資料，請重新整理網頁再試一次。"); 
  });
}

export function handleDrugSearch() { 
  const inputEl = document.getElementById('drug-search-input');
  const kw = inputEl.value.toLowerCase().trim(); 
  const dropdown = document.getElementById('drug-search-dropdown'); 
  
  // 【新功能】：如果使用者把搜尋框清空，直接還原顯示全部資料
  if (!kw) { 
    dropdown.style.display = 'none'; 
    clearDrugFilter(false); 
    return; 
  } 
  
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

export function renderHistoryTable() {
  const tbody = document.getElementById('history-tbody'); 
  let html = ''; let lastCode = ''; let bgToggle = true; let displayCount = 0;
  
  historyData.forEach((row, idx) => {
    const code = row[0], name = row[1], dateStr = row[2], sap = parseFloat(row[3]) || 0, act = parseFloat(row[4]) || 0, diff = parseFloat(row[5]) || 0;
    if (selectedDrugCode && code !== selectedDrugCode) return; 
    
    displayCount++; 
    if (code !== lastCode) { bgToggle = !bgToggle; lastCode = code; }
    const bgClass = bgToggle ? 'bg-white' : 'table-light'; 
    let diffHtml = diff === 0 ? `<span class="text-success"><i class="bi bi-check-circle-fill"></i> 0</span>` : (diff > 0 ? `<span class="text-academic fw-bold">+${diff}</span>` : `<span class="text-danger fw-bold">${diff}</span>`);
    
    html += `<tr class="${bgClass}">
      <td class="text-center text-secondary">${code}</td>
      <td class="fw-bold text-dark text-start">${name}</td>
      <td class="text-center">${dateStr}</td>
      <td class="text-center fw-bold text-secondary">${sap}</td>
      <td class="text-center fw-bold text-academic">${act}</td>
      <td class="text-center fw-bold">${diffHtml}</td>
      <td class="text-center"><button class="btn btn-sm btn-outline-academic fw-bold shadow-sm py-1" onclick="openDetailsModal(${idx})">明細</button></td>
    </tr>`;
  });
  
  tbody.innerHTML = displayCount === 0 ? `<tr><td colspan="7" class="text-center py-5 text-muted fw-bold">無符合條件數據</td></tr>` : html;
}

export function openDetailsModal(idx) { const row = historyData[idx]; document.getElementById('modal-drug-name').innerText = `${row[1]} (${row[2]})`; currentModalData = JSON.parse(row[6] || "[]"); renderModalToggles(); renderModalContent(); if (!detailModalInstance) detailModalInstance = new window.bootstrap.Modal(document.getElementById('detailsModal')); detailModalInstance.show(); }
export function renderModalToggles() { document.getElementById('modal-col-toggles').innerHTML = fullDetailHeaders.map((h, i) => `<button class="btn btn-sm ${detailColVisibility[i] ? 'btn-academic' : 'btn-outline-secondary'} fw-bold shadow-sm" style="font-size: 0.75rem;" onclick="toggleModalCol(${i})">${detailColVisibility[i] ? '<i class="bi bi-check-square-fill"></i>' : '<i class="bi bi-square"></i>'} ${h}</button>`).join(''); }
export function toggleModalCol(index) { detailColVisibility[index] = !detailColVisibility[index]; renderModalToggles(); renderModalContent(); }
export function renderModalContent() {
  // 確保標題列與內容列完全對齊
  document.getElementById('modal-thead').innerHTML = '<tr>' + fullDetailHeaders.map(h => `<th class="py-2 text-nowrap">${h}</th>`).join('') + '</tr>';
  document.getElementById('modal-tbody').innerHTML = currentModalData.length === 0 ? `<tr><td colspan="${fullDetailHeaders.length}" class="text-center py-4 text-muted">無細項資料</td></tr>` : currentModalData.map(r => '<tr>' + headerKeys.map(k => `<td class="text-center">${r[k] !== undefined ? r[k] : ''}</td>`).join('') + '</tr>').join('');
}
