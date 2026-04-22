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
  
  document.getElementById('count-uncounted').innerText = dailyItems.filter(i => !i.hasRecord || i.status === '作廢').length;
  document.getElementById('count-counted').innerText = dailyItems.filter(i => i.hasRecord).length;
}

export function renderDailyItems() {
  const area = document.getElementById('daily-list-area');
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

  item.hasRecord = true; item.status = '成立'; item.countedQty = qty;
  updateTabUI(); renderDailyItems(); if (navigator.vibrate) navigator.vibrate(50); showToast('盤點成功');

  fetchBackend('submitInventory', { mode: '每日盤點', userId: session.id, userName: session.name, type: '盤點調劑台', drugCode: dCode, drugName: dName, handQty: qty, tableId: tId, locCode: loc, inventoryDate: dStr })
    .catch(err => { showToast('網路連線錯誤，請重新盤點', 'delete'); loadDailyData(dStr); });
}

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

// ==========================================
// ✨ 管理排序功能區
// ==========================================

export function openAdminSort() { 
  toggleLoader(true); 
  fetchBackend('getAdminData').then(data => { 
    toggleLoader(false); 
    
    if (data && data.success === false) { alert('⚠️ 後端資料異常: ' + data.message); return; }
    
    adminData = data; 
    adminCombinedList = (data.selectable || []).map(item => { 
      const savedItem = (data.saved || []).find(s => s.locCode === item.locCode);
      return { ...item, order: savedItem ? savedItem.order : '' }; 
    }); 
    
    try {
      renderSortableList(); 
      switchView('view-admin-sort'); 
    } catch(e) {
      alert('畫面渲染失敗：' + e.message);
    }
  }).catch(err => { 
    toggleLoader(false); 
    alert('🚫 系統連線失敗：' + err.message); 
  }); 
}

export function renderSortableList() {
  const container = document.getElementById('admin-sortable-list');
  if (!container) return; 

  adminCombinedList.sort((a, b) => { const aV = a.order !== 0, bV = b.order !== 0; if (aV && !bV) return -1; if (!aV && bV) return 1; if (aV && bV) { if (a.order !== '' && b.order !== '') return a.order - b.order; if (a.order !== '' && b.order === '') return -1; if (a.order === '' && b.order !== '') return 1; } return a.locCode.localeCompare(b.locCode); });
  
  let html = '';
  adminCombinedList.forEach(item => {
    const isHidden = item.order === 0; 
    const cardStyle = isHidden ? 'opacity: 0.6; border-left: 5px solid #dc3545;' : 'border-left: 5px solid var(--academic-primary);'; 
    const eyeIcon = isHidden ? 'bi-eye-slash-fill text-danger' : 'bi-eye-fill text-success';
    
    html += `<div class="card border-0 shadow-sm mb-2 sortable-item bg-white" style="${cardStyle}" data-loc="${item.locCode}" data-table="${item.tableId}" data-drug="${item.drugCode}" data-name="${item.drugName}" data-hidden="${isHidden}">
      <div class="card-body p-2 d-flex align-items-center">
        <div class="drag-handle"><i class="bi bi-grip-vertical"></i></div>
        <div class="flex-grow-1 px-2 text-truncate">
          <div class="fw-bold text-dark search-target">${item.drugName}</div>
          <div class="small text-muted"><span class="badge bg-academic me-1">${item.tableName}</span>${item.locCode}</div>
        </div>
        <div>
          <button class="btn btn-light border p-2" onclick="toggleVisibility(this, '${item.locCode}')"><i id="eye-${item.locCode}" class="${eyeIcon} fs-5"></i></button>
        </div>
      </div>
    </div>`;
  });
  
  container.innerHTML = html; 
  if(sortableInstance) sortableInstance.destroy(); 
  sortableInstance = new window.Sortable(container, { handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost' });
}

export function toggleVisibility(btn, locCode) { 
  const card = btn.closest('.sortable-item'); 
  const icon = document.getElementById(`eye-${locCode}`); 
  if (card.getAttribute('data-hidden') === 'true') { 
    card.setAttribute('data-hidden', 'false'); 
    card.style.opacity = '1'; 
    card.style.borderLeftColor = 'var(--academic-primary)'; 
    icon.className = 'bi bi-eye-fill text-success fs-5'; 
  } else { 
    card.setAttribute('data-hidden', 'true'); 
    card.style.opacity = '0.6'; 
    card.style.borderLeftColor = '#dc3545'; 
    icon.className = 'bi bi-eye-slash-fill text-danger fs-5'; 
  } 
}

export function highlightSearchItem() { const kw = document.getElementById('admin-search-input').value.toLowerCase(); let firstMatch = null; document.querySelectorAll('.sortable-item').forEach(card => { if (kw && (card.querySelector('.search-target').innerText.toLowerCase().includes(kw) || card.getAttribute('data-loc').toLowerCase().includes(kw))) { card.classList.add('bg-warning', 'bg-opacity-25'); if(!firstMatch) firstMatch = card; } else card.classList.remove('bg-warning', 'bg-opacity-25'); }); if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

export function rebuildAdminList() { if(confirm('確定要重建清單嗎？')) { adminCombinedList = adminData.selectable.map(i => ({ ...i, order: '' })); renderSortableList(); } }

export function saveAdminDataToServer() { const payload = []; let currentOrder = 1; document.querySelectorAll('.sortable-item').forEach(el => { payload.push({ tableId: el.getAttribute('data-table'), locCode: el.getAttribute('data-loc'), drugCode: el.getAttribute('data-drug'), drugName: el.getAttribute('data-name'), order: el.getAttribute('data-hidden') === 'true' ? 0 : currentOrder++ }); }); toggleLoader(true); fetchBackend('saveAdminSortData', { payloadArray: payload }).then(() => { toggleLoader(false); showToast('排序已儲存！'); switchView('view-daily-app'); changeDailyDate(); }).catch(err => { toggleLoader(false); alert('儲存失敗'); }); }
