import { fetchBackend } from './api.js'; 
import { toggleLoader, switchView, showToast } from './ui.js'; 
import { session } from './config.js';

export let dailyItems = []; 
export let currentDailyTab = '未盤'; 
export let adminCombinedList = []; 
export let sortableInstance = null; 
export let adminData = null;

export function initDailyMode() { currentDailyTab = '未盤'; updateTabUI(); switchView('view-daily-app'); loadDailyData(null); }
export function changeDailyDate() { loadDailyData(document.getElementById('header-date-select').value); }

export function loadDailyData(dateStr) {
  if(dateStr && dateStr.includes('-')) dateStr = dateStr.replace(/-/g, '/');
  toggleLoader(true);
  fetchBackend('getDailyInventoryByDate', { dateStr: dateStr }).then(data => {
    toggleLoader(false); 
    dailyItems = data.items || []; 
    if (data.selectedDate) {
      document.getElementById('header-date-select').value = data.selectedDate.replace(/\//g, '-');
    }
    // 🌟 [新增] 讀取完資料後，立刻強制作業標籤更新數字！
    updateTabUI(); 
    renderDailyItems(); 
  }).catch(err => { 
    toggleLoader(false); 
    document.getElementById('daily-list-area').innerHTML = '<div class="text-center p-5 text-muted fw-bold">無資料或讀取失敗</div>'; 
  });
}

export function switchDailyTab(tabName) { if (currentDailyTab === tabName) return; currentDailyTab = tabName; updateTabUI(); renderDailyItems(); }

export function updateTabUI() {
  const btnUn = document.getElementById('btn-tab-uncounted'); const btnCo = document.getElementById('btn-tab-counted');
  btnUn.className = currentDailyTab === '未盤' ? 'nav-link active fw-bold border bg-academic shadow-sm text-white py-2' : 'nav-link fw-bold border text-academic shadow-sm bg-white py-2';
  btnCo.className = currentDailyTab === '已盤' ? 'nav-link active fw-bold border bg-success shadow-sm text-white py-2' : 'nav-link fw-bold border text-success shadow-sm bg-white py-2';
  
  // 顯示數量統計
  document.getElementById('count-uncounted').innerText = dailyItems.filter(i => !i.hasRecord || i.status === '作廢').length;
  document.getElementById('count-counted').innerText = dailyItems.filter(i => i.hasRecord).length;
}

export function renderDailyItems() {
  const area = document.getElementById('daily-list-area');
  // 未盤清單：沒有紀錄的，或是有紀錄但被作廢的，讓使用者可以重盤
  // 已盤清單：只要有紀錄就顯示，讓使用者可以操作修改或作廢還原
  const renderList = currentDailyTab === '未盤' ? dailyItems.filter(i => !i.hasRecord || i.status === '作廢') : dailyItems.filter(i => i.hasRecord);
  
  if (renderList.length === 0) { area.innerHTML = '<div class="text-center p-5 text-muted fw-bold">此區無資料</div>'; return; }
  
  let html = '';
  renderList.forEach(item => {
    const isVoid = item.status === '作廢';
    const cardStyle = isVoid ? "opacity: 0.7; filter: grayscale(100%);" : "";
    const badgeHtml = isVoid ? `<span class="badge bg-secondary ms-2">已作廢</span>` : (item.hasRecord ? `<span class="badge bg-success ms-2">已盤點</span>` : '');

    if (currentDailyTab === '已盤') {
      const actionHtml = isVoid 
        ? `<button class="btn btn-sm btn-outline-success fw-bold" onclick="toggleDailyStatus('${item.locCode}', '成立')">還原</button>`
        : `<button class="btn btn-sm btn-outline-primary fw-bold me-2" onclick="editDailyQty('${item.locCode}', '${item.countedQty}')">修改</button>
           <button class="btn btn-sm btn-outline-danger fw-bold" onclick="toggleDailyStatus('${item.locCode}', '作廢')">作廢</button>`;
           
      html += `
        <div class="card mb-3 shadow-sm border-0 drug-card" style="border-left: 6px solid var(--academic-primary); ${cardStyle}">
          <div class="card-body p-3">
            <div class="fw-bold fs-5 text-dark mb-2">${item.drugName} ${badgeHtml}</div>
            <div class="d-flex justify-content-between align-items-center mb-2">
              <div class="text-secondary small">儲位: ${item.locCode} | 代碼: ${item.drugCode}</div>
              <div class="fw-bold fs-4 ${isVoid ? 'text-muted text-decoration-line-through' : 'text-academic'}">${item.countedQty}</div>
            </div>
            <div class="d-flex justify-content-end border-top pt-2 mt-2">${actionHtml}</div>
          </div>
        </div>`;
    } else {
      html += `
        <div class="card mb-3 shadow-sm border-0 drug-card" style="border-left: 6px solid var(--academic-primary); ${cardStyle}">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between mb-2"><div class="fw-bold fs-5 text-dark">${item.drugName} ${badgeHtml}</div></div>
            <div class="d-flex flex-wrap gap-1 mb-2"><span class="badge bg-light text-dark border border-secondary">儲位: ${item.locCode}</span><span class="badge bg-light text-dark border border-secondary">代碼: ${item.drugCode}</span></div>
            <div class="input-group shadow-sm"><input type="number" id="qty-${item.locCode}" class="form-control form-control-lg bg-white fw-bold text-center border-secondary" placeholder="數量" inputmode="numeric" pattern="[0-9]*"><button class="btn btn-academic px-4 fw-bold fs-5" onclick="submitDailyOne('${item.locCode}', '${item.drugCode}', '${item.drugName}', '${item.tableId}')">確認送出</button></div>
          </div>
        </div>`;
    }
  });
  area.innerHTML = html;
}

export function submitDailyOne(loc, dCode, dName, tId) {
  const qty = document.getElementById(`qty-${loc}`).value; if (qty === '' || qty < 0) return alert('請輸入有效數量');
  const dStr = document.getElementById('header-date-select').value;
  const item = dailyItems.find(i => i.locCode === loc);
  if (!item) return;

  // 樂觀 UI
  item.hasRecord = true; item.status = '成立'; item.countedQty = qty;
  updateTabUI(); renderDailyItems(); if (navigator.vibrate) navigator.vibrate(50); showToast('盤點成功');

  fetchBackend('submitInventory', { mode: '每日盤點', userId: session.id, userName: session.name, type: '盤點調劑台', drugCode: dCode, drugName: dName, handQty: qty, tableId: tId, locCode: loc, inventoryDate: dStr })
    .catch(err => { showToast('網路連線錯誤，請重新盤點', 'delete'); loadDailyData(dStr); });
}

// 🌟 修改每日盤點數量 (樂觀 UI，不轉圈圈)
export function editDailyQty(locCode, currentQty) {
  const newQty = prompt("請輸入修改數量:", currentQty);
  if (newQty === null || newQty === "") return;
  const dateStr = document.getElementById('header-date-select').value;
  
  const item = dailyItems.find(i => i.locCode === locCode);
  const oldQty = item.countedQty;
  item.countedQty = newQty; 
  renderDailyItems();

  fetchBackend('modifyDailyRecord', { dateStr, locCode, newQty: newQty, newStatus: null, userId: session.id, userName: session.name })
    .then(res => {
      if (res.success) { showToast('修改成功'); } 
      else { item.countedQty = oldQty; renderDailyItems(); showToast('修改失敗: ' + res.message, 'delete'); }
    }).catch(err => { item.countedQty = oldQty; renderDailyItems(); showToast('網路異常，更新失敗', 'delete'); });
}

// 🌟 作廢或還原每日盤點 (樂觀 UI，不轉圈圈)
export function toggleDailyStatus(locCode, newStatus) {
  if (newStatus === '作廢' && !confirm('確定要作廢這筆紀錄嗎？')) return;
  const dateStr = document.getElementById('header-date-select').value;
  const item = dailyItems.find(i => i.locCode === locCode);
  const oldStatus = item.status;
  item.status = newStatus;
  updateTabUI(); renderDailyItems();

  fetchBackend('modifyDailyRecord', { dateStr, locCode, newQty: null, newStatus: newStatus, userId: session.id, userName: session.name })
    .then(res => {
      if (res.success) { showToast(newStatus === '作廢' ? '紀錄已作廢' : '紀錄已還原', newStatus === '作廢' ? 'delete' : 'success'); } 
      else { item.status = oldStatus; updateTabUI(); renderDailyItems(); showToast('更新失敗: ' + res.message, 'delete'); }
    }).catch(err => { item.status = oldStatus; updateTabUI(); renderDailyItems(); showToast('網路異常，更新失敗', 'delete'); });
}

export function openAdminSort() { 
  toggleLoader(true); 
  fetchBackend('getAdminData').then(data => { 
    toggleLoader(false); 
    
    // 🌟 新增防呆：攔截後端的詳細錯誤
    if (data && data.success === false) {
      alert('後端資料表異常: ' + data.message);
      return;
    }

    adminData = data; 
    
    // 🌟 安全讀取陣列，避免 undefined 當機
    adminCombinedList = (data.selectable || []).map(item => { 
      const savedItem = (data.saved || []).find(s => s.locCode === item.locCode);
      return { ...item, order: savedItem ? savedItem.order : '' }; 
    }); 
    
    renderSortableList(); 
    switchView('view-admin-sort'); 
    
  }).catch(err => { 
    toggleLoader(false); 
    alert('網路異常，無法讀取資料'); 
  }); 
}
export function toggleVisibility(locCode) { const item = adminCombinedList.find(i => i.locCode === locCode); if (item) { item.order = item.order === 0 ? '' : 0; renderSortableList(); } }
export function highlightSearchItem() { const kw = document.getElementById('admin-search-input').value.toLowerCase(); let firstMatch = null; document.querySelectorAll('.sortable-item').forEach(card => { if (kw && (card.querySelector('.search-target').innerText.toLowerCase().includes(kw) || card.getAttribute('data-loc').toLowerCase().includes(kw))) { card.classList.add('bg-warning', 'bg-opacity-25'); if(!firstMatch) firstMatch = card; } else card.classList.remove('bg-warning', 'bg-opacity-25'); }); if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
export function rebuildAdminList() { if(confirm('確定要重建清單嗎？')) { adminCombinedList = adminData.selectable.map(i => ({ ...i, order: '' })); renderSortableList(); } }
function renderSortableList() { const container = document.getElementById('admin-sort-list'); container.innerHTML = adminCombinedList.map(item => ` <div class="card sortable-item mb-2 shadow-sm border-0" data-table="${item.tableId}" data-loc="${item.locCode}" data-drug="${item.drugCode}" data-name="${item.drugName}" data-hidden="${item.order === 0 ? 'true' : 'false'}" style="border-left: 6px solid ${item.order === 0 ? '#dc3545' : 'var(--academic-primary)'}; ${item.order === 0 ? 'opacity:0.6' : ''}"> <div class="card-body p-2 d-flex align-items-center"> <div class="me-3 fs-4 text-muted"><i class="bi bi-grip-vertical"></i></div> <div class="flex-grow-1"> <div class="fw-bold search-target">${item.drugName}</div> <div class="small text-secondary">${item.locCode} | ${item.drugCode}</div> </div> <div class="ms-2 p-2" onclick="toggleVisibility('${item.locCode}')"> <i class="visibility-icon ${item.order === 0 ? 'bi bi-eye-slash-fill text-danger' : 'bi bi-eye-fill text-academic'} fs-5"></i> </div> </div> </div> `).join(''); if(sortableInstance) sortableInstance.destroy(); sortableInstance = new window.Sortable(container, { animation: 150, handle: '.bi-grip-vertical', ghostClass: 'sortable-ghost' }); }
export function saveAdminDataToServer() { const payload = []; let currentOrder = 1; document.querySelectorAll('.sortable-item').forEach(el => { payload.push({ tableId: el.getAttribute('data-table'), locCode: el.getAttribute('data-loc'), drugCode: el.getAttribute('data-drug'), drugName: el.getAttribute('data-name'), order: el.getAttribute('data-hidden') === 'true' ? 0 : currentOrder++ }); }); toggleLoader(true); fetchBackend('saveAdminSortData', { payloadArray: payload }).then(() => { toggleLoader(false); showToast('排序已儲存！'); switchView('view-daily-app'); changeDailyDate(); }).catch(err => { toggleLoader(false); alert('儲存失敗'); }); }
