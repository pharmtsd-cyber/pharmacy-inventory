import { fetchBackend } from './api.js'; 
import { toggleLoader, switchView, showToast } from './ui.js'; 
import { session } from './config.js';

export let dailyItems = []; 
export let currentDailyTab = '未盤'; 
export let adminCombinedList = []; 
export let sortableInstance = null; 
export let adminData = null;

// ==========================================
// 🚀 每日盤點：「單筆消失 + 60秒自動打包」引擎
// ==========================================
let dailyAutoSyncTimer = null;
let isDailyFlushing = false;

export function getDailyQueue() {
  try { return JSON.parse(localStorage.getItem('femh_daily_queue')) || []; }
  catch(e) { return []; }
}
function saveDailyQueue(queue) { localStorage.setItem('femh_daily_queue', JSON.stringify(queue)); updateDailyPendingUI(); }
export function getDailyQueueCount() { return getDailyQueue().length; }

function updateDailyPendingUI() {
  const count = getDailyQueueCount();
  const badge = document.getElementById('daily-pending-count');
  const bar = document.getElementById('daily-pending-bar');
  if (badge) badge.innerText = count;
  if (bar) { if (count > 0) bar.classList.remove('d-none'); else bar.classList.add('d-none'); }
}

function startDailyAutoSyncTimer() {
  if (dailyAutoSyncTimer) return;
  dailyAutoSyncTimer = setInterval(() => {
    if (getDailyQueueCount() > 0 && !isDailyFlushing) { flushDailyQueue({ showBlockingLoader: false }); } 
    else if (getDailyQueueCount() === 0) { stopDailyAutoSyncTimer(); }
  }, 60000); // 60秒自動打包
}

function stopDailyAutoSyncTimer() {
  if (dailyAutoSyncTimer) { clearInterval(dailyAutoSyncTimer); dailyAutoSyncTimer = null; }
}

// 攔截並把佇列套用到畫面狀態
function applyDailyQueueToLocalState() {
  const queue = getDailyQueue();
  if (queue.length === 0) return;
  queue.forEach(req => {
    const d = req.data;
    const item = dailyItems.find(i => i.locCode === d.locCode);
    if (item) { item.hasRecord = true; item.countedQty = d.handQty; item.status = '成立'; }
  });
}

export function flushDailyQueue(options = {}) {
  const { showBlockingLoader = true, onComplete = null } = options;
  const queue = getDailyQueue();
  if (queue.length === 0) { if (onComplete) onComplete(true); return Promise.resolve(true); }

  if (isDailyFlushing) {
    if (showBlockingLoader) toggleLoader(true, `📦 正在同步 ${queue.length} 筆資料...`, true);
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!isDailyFlushing) {
          clearInterval(checkInterval);
          if (showBlockingLoader) toggleLoader(false, '', true);
          if (onComplete) onComplete(true);
          resolve(true);
        }
      }, 200);
    });
  }

  isDailyFlushing = true;
  const snapshotIds = queue.map(q => q.queueId);
  const batchPayload = queue.map(q => ({ action: q.action, data: q.data }));

  if (showBlockingLoader) toggleLoader(true, `📦 正在打包上傳 ${queue.length} 筆資料...`, true);

  return fetchBackend('syncBatchOfflineData', { batchArray: JSON.stringify(batchPayload) })
    .then(res => {
      isDailyFlushing = false;
      if (res && res.success) {
        const currentQueue = getDailyQueue();
        const remainingQueue = currentQueue.filter(q => !snapshotIds.includes(q.queueId));
        saveDailyQueue(remainingQueue);
        if (remainingQueue.length === 0) stopDailyAutoSyncTimer();
        
        if (showBlockingLoader) {
          toggleLoader(false, '', true);
          setTimeout(() => { showToast(`🎉 成功同步 ${snapshotIds.length} 筆每日盤點！`); if(onComplete) onComplete(true); }, 500);
        } else {
          showToast(`☁️ 已自動打包同步 ${snapshotIds.length} 筆資料`);
          if(onComplete) onComplete(true);
        }
        return true;
      } else {
        if (showBlockingLoader) toggleLoader(false, '', true);
        alert("❌ 打包同步失敗：" + (res ? res.message : '未知錯誤'));
        if (onComplete) onComplete(false); return false;
      }
    }).catch(err => {
      isDailyFlushing = false;
      if (showBlockingLoader) toggleLoader(false, '', true);
      if (showBlockingLoader) alert("⚠️ 網路異常，稍後將自動重試：" + err.message);
      else showToast('⚠️ 背景自動打包延遲，將於 1 分鐘後重試', 'delete');
      if (onComplete) onComplete(false); return false;
    });
}

// ==========================================
// 基礎作業
// ==========================================
export function initDailyMode() { 
  currentDailyTab = '未盤'; updateTabUI(); switchView('view-daily-app'); 
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dateSelect = document.getElementById('header-date-select'); if (dateSelect) dateSelect.value = todayStr;
  loadDailyData(todayStr); 
}

export function changeDailyDate() {
  if (getDailyQueueCount() > 0) {
    flushDailyQueue({ showBlockingLoader: true, onComplete: () => { loadDailyData(document.getElementById('header-date-select').value); }});
    return;
  }
  loadDailyData(document.getElementById('header-date-select').value); 
}

export function loadDailyData(dateStr) {
  if(dateStr && dateStr.includes('-')) dateStr = dateStr.replace(/-/g, '/');
  toggleLoader(true);
  fetchBackend('getDailyInventoryByDate', { dateStr: dateStr }).then(data => {
    toggleLoader(false); dailyItems = data.items || []; 
    if (data.selectedDate) document.getElementById('header-date-select').value = data.selectedDate.replace(/\//g, '-');
    applyDailyQueueToLocalState();
    updateTabUI(); renderDailyItems(); checkAdminNewDrugs();
    if (getDailyQueueCount() > 0) startDailyAutoSyncTimer();
  }).catch(err => { toggleLoader(false); document.getElementById('daily-list-area').innerHTML = '<div class="text-center p-5 text-muted fw-bold">讀取失敗</div>'; });
}

export function switchDailyTab(tabName) { 
  if (currentDailyTab === tabName) return; 
  if (tabName === '已盤' && getDailyQueueCount() > 0) {
    flushDailyQueue({ showBlockingLoader: true, onComplete: () => {
      currentDailyTab = tabName; const searchInput = document.getElementById('daily-search-input'); if (searchInput) searchInput.value = '';
      loadDailyData(document.getElementById('header-date-select').value);
    }});
    return;
  }
  currentDailyTab = tabName; const searchInput = document.getElementById('daily-search-input'); if (searchInput) searchInput.value = '';
  updateTabUI(); renderDailyItems(); 
}

export function updateTabUI() {
  const btnUn = document.getElementById('btn-tab-uncounted'); const btnCo = document.getElementById('btn-tab-counted');
  btnUn.className = currentDailyTab === '未盤' ? 'nav-link active fw-bold border bg-academic shadow-sm text-white py-2' : 'nav-link fw-bold border text-academic shadow-sm bg-white py-2';
  btnCo.className = currentDailyTab === '已盤' ? 'nav-link active fw-bold border bg-success shadow-sm text-white py-2' : 'nav-link fw-bold border text-success shadow-sm bg-white py-2';
  document.getElementById('count-uncounted').innerText = dailyItems.filter(i => !i.hasRecord || i.status === '作廢').length;
  document.getElementById('count-counted').innerText = dailyItems.filter(i => i.hasRecord).length;
}

export function renderDailyItems() {
  const area = document.getElementById('daily-list-area');
  if (!area) return;
  applyDailyQueueToLocalState();

  let filtered = dailyItems;
  if (currentDailyTab === '未盤') filtered = dailyItems.filter(i => !i.hasRecord || i.status === '作廢');
  else filtered = dailyItems.filter(i => i.hasRecord && i.status === '成立');

  const kwInput = document.getElementById('daily-search-input'); const kw = kwInput ? kwInput.value.toLowerCase().trim() : '';
  if (kw) filtered = filtered.filter(i => (i.drugCode||'').toLowerCase().includes(kw) || (i.drugName||'').toLowerCase().includes(kw) || (i.locCode||'').toLowerCase().includes(kw));

  let html = '';
  const pendingCount = getDailyQueueCount();
  html += `
    <div id="daily-pending-bar" class="d-flex justify-content-between align-items-center mb-3 bg-white p-2 sticky-top shadow-sm border border-warning rounded ${pendingCount > 0 ? '' : 'd-none'}" style="top: 5px; z-index: 9;">
      <div><span class="fw-bold text-dark ms-1">待打包：<span id="daily-pending-count" class="badge bg-warning text-dark fs-6 ms-1">${pendingCount}</span> 筆</span>
      <span class="text-muted small d-block ms-1" style="font-size: 0.72rem;">背景每 60 秒自動上傳</span></div>
      <button class="btn btn-sm btn-academic fw-bold px-3 py-1 shadow-sm" onclick="flushDailyQueue({ showBlockingLoader: true, onComplete: () => loadDailyData(document.getElementById('header-date-select').value) })"><i class="bi bi-cloud-upload"></i> 立即上傳</button>
    </div>`;

  if (filtered.length === 0) { html += `<div class="text-center p-5 text-muted fw-bold">${kw ? '查無符合條件的藥品' : '此區皆已盤點完成'}</div>`; area.innerHTML = html; return; }

  if (currentDailyTab === '未盤') {
    filtered.forEach((item, index) => {
      const encodedName = btoa(encodeURIComponent(item.drugName || '')); 
      const borderColor = index % 2 === 0 ? 'var(--academic-primary)' : '#adb5bd';
      let hintHtml = '';
      if (item.infoNotice && item.infoNotice !== '') hintHtml += `<div class="text-danger small fw-bold mb-1"><i class="bi bi-exclamation-triangle-fill me-1"></i>盤點注意：${item.infoNotice}</div>`;
      if (item.infoMemo && item.infoMemo !== '') hintHtml += `<div class="text-secondary small mb-1" style="font-size: 0.8rem;"><i class="bi bi-info-square-fill me-1"></i>藥品備註：${item.infoMemo}</div>`;
      const lastRecordHtml = item.lastQty !== '無' ? `<div class="bg-light border rounded p-2 mb-2 d-flex justify-content-between align-items-center shadow-sm"><span class="text-secondary small fw-bold"><i class="bi bi-clock-history"></i> 前次紀錄 (${item.lastTime}):</span><span class="text-academic fw-bold" style="font-size: 1.8rem; line-height: 1;">${item.lastQty}</span></div>` : `<div class="bg-light border rounded p-2 mb-2 text-center text-muted small shadow-sm">尚無歷史盤點紀錄</div>`;

      html += `
        <div class="card drug-card mb-3 shadow-sm border-0" style="border-left: 6px solid ${borderColor} !important;">
          <div class="card-body p-3"><div class="fw-bold fs-5 text-dark mb-1">${item.drugName}</div><div class="d-flex flex-wrap gap-1 mb-2"><span class="badge bg-academic shadow-sm">${item.tableName}</span><span class="badge bg-white text-dark border border-secondary shadow-sm">儲位: ${item.locCode}</span></div>${hintHtml ? `<div class="bg-light rounded p-2 mb-2 border border-danger border-opacity-25">${hintHtml}</div>` : ''}${lastRecordHtml}
            <div class="input-group shadow-sm mt-2">
              <input type="number" id="qty-${item.locCode}" class="form-control form-control-lg bg-white fw-bold text-center border-secondary" placeholder="本次數量" inputmode="numeric" pattern="[0-9]*" onkeydown="if(event.key === 'Enter') submitDailyOne('${item.locCode}', '${item.drugCode}', decodeURIComponent(atob('${encodedName}')), '${item.tableId}')">
              <button class="btn btn-outline-secondary px-3 fw-bold bg-light border-secondary" type="button" onclick="openCalculator('qty-${item.locCode}', decodeURIComponent(atob('${encodedName}')))"><i class="bi bi-calculator fs-5"></i></button>
              <button class="btn btn-academic px-4 fw-bold fs-5" onclick="submitDailyOne('${item.locCode}', '${item.drugCode}', decodeURIComponent(atob('${encodedName}')), '${item.tableId}')">送出</button>
            </div>
          </div>
        </div>`;
    });
  } else {
    filtered.forEach((item, index) => {
      const borderColor = index % 2 === 0 ? 'var(--academic-primary)' : '#adb5bd';
      const updateInfo = (item.updateUser && item.updateTime) ? ` <span class="ms-1 badge bg-warning text-dark shadow-sm" style="font-size:0.65rem;"><i class="bi bi-pencil-square"></i> ${item.updateUser} 修改</span>` : '';
      html += `
        <div class="card drug-card mb-2 shadow-sm border-0" style="border-left: 6px solid ${borderColor} !important;"><div class="card-body p-2"><div class="d-flex justify-content-between mb-1"><div class="fw-bold text-dark text-truncate" style="max-width: 70%;">${item.drugName}</div><div class="small text-muted text-end" style="font-size:0.75rem;">${item.timeStr}${updateInfo}</div></div><div class="small text-secondary mb-2"><span class="badge bg-success">已盤點</span><span class="ms-1">儲位: ${item.locCode}</span></div><div class="d-flex justify-content-between align-items-center mt-1 pt-1 border-top"><div class="fs-4 fw-bold text-success">${item.countedQty}</div><div><button class="btn btn-sm btn-outline-primary py-0 me-1" onclick="editDailyQty('${item.locCode}', '${item.countedQty}')">修改</button><button class="btn btn-sm btn-outline-danger py-0" onclick="toggleDailyStatus('${item.locCode}', '作廢')">作廢</button></div></div></div></div>`;
    });
  }
  area.innerHTML = html;
}

// 🌟 單筆送出零延遲寫入佇列
export function submitDailyOne(loc, dCode, dName, tId) {
  const inputEl = document.getElementById(`qty-${loc}`); const qty = inputEl ? inputEl.value.trim() : ''; 
  if (qty === '' || Number(qty) < 0) return alert('請輸入有效數量');
  const dStr = document.getElementById('header-date-select').value;
  const item = dailyItems.find(i => i.locCode === loc); if (!item) return;

  const now = new Date();
  item.hasRecord = true; item.status = '成立'; item.countedQty = qty; item.tStamp = now.getTime();
  item.timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const queue = getDailyQueue();
  const queueItem = {
    queueId: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7),
    timestamp: now.getTime(), action: 'submitInventory',
    data: { mode: '每日盤點', userId: session.id, userName: session.name, type: '盤點調劑台', actionSrc: '', dispType: '', drugCode: dCode, drugName: dName, handQty: qty, tableId: tId, locCode: loc, inventoryDate: dStr, barcode: '' }
  };
  queue.push(queueItem); saveDailyQueue(queue);

  if (navigator.vibrate) navigator.vibrate(50);
  const card = inputEl.closest('.drug-card'); 
  if (card) { 
    card.style.display = 'none'; 
    setTimeout(() => { card.remove(); updateTabUI(); updateDailyPendingUI(); }, 10);
  }
  startDailyAutoSyncTimer();
}

export async function editDailyQty(locCode, currentQty) {
  if (getDailyQueueCount() > 0) { await flushDailyQueue({ showBlockingLoader: true }); await new Promise(resolve => setTimeout(resolve, 500)); }
  const item = dailyItems.find(i => i.locCode === locCode); if (!item || !item.sn) return alert('尚未取得識別碼，請重整後再試');
  const newQty = await new Promise(resolve => { window.resolveEditQtyModal = resolve; document.getElementById('edit-qty-drug-name').innerText = item.drugName; document.getElementById('edit-qty-old').innerText = currentQty; const input = document.getElementById('edit-qty-input'); input.value = currentQty; new window.bootstrap.Modal(document.getElementById('editQtyModal')).show(); document.getElementById('editQtyModal').addEventListener('shown.bs.modal', () => { input.focus(); input.select(); }, { once: true }); });
  if (newQty === null || newQty === "") return; 
  const oldQty = item.countedQty; item.countedQty = newQty; renderDailyItems();
  fetchBackend('modifyDailyRecord', { sn: item.sn, newQty: newQty, newStatus: '成立', userId: session.id, userName: session.name }).then(res => { if (!res.success) { item.countedQty = oldQty; renderDailyItems(); showToast('修改失敗', 'delete'); } }).catch(err => { item.countedQty = oldQty; renderDailyItems(); });
}

export async function toggleDailyStatus(locCode, newStatus) {
  if (getDailyQueueCount() > 0) { await flushDailyQueue({ showBlockingLoader: true }); await new Promise(resolve => setTimeout(resolve, 500)); }
  const item = dailyItems.find(i => i.locCode === locCode); if (!item || !item.sn) return alert('尚未取得識別碼，請重整後再試');
  if (newStatus === '作廢') {
    const isConfirmed = await new Promise(resolve => { window.resolveVoidModal = resolve; document.getElementById('void-drug-name').innerText = item.drugName; document.getElementById('void-drug-info').innerText = item.countedQty; new window.bootstrap.Modal(document.getElementById('voidConfirmModal')).show(); });
    if (!isConfirmed) return; 
  }
  const oldStatus = item.status; item.status = newStatus; updateTabUI(); renderDailyItems();
  fetchBackend('modifyDailyRecord', { sn: item.sn, newQty: '', newStatus: newStatus, userId: session.id, userName: session.name }).then(res => { if (!res.success) { item.status = oldStatus; updateTabUI(); renderDailyItems(); } }).catch(err => { item.status = oldStatus; updateTabUI(); renderDailyItems(); });
}

export function openAdminSort() { 
  toggleLoader(true); fetchBackend('getAdminData').then(data => { toggleLoader(false); if (data && data.success === false) return alert('⚠️ 後端異常: ' + data.message); adminData = data; adminCombinedList = (data.selectable || []).map(item => { const savedItem = (data.saved || []).find(s => s.locCode === item.locCode); return { ...item, order: savedItem ? savedItem.order : '' }; }); renderSortableList(); switchView('view-admin-sort'); }).catch(err => { toggleLoader(false); alert('🚫 連線失敗：' + err.message); }); 
}
export function renderSortableList() {
  const container = document.getElementById('admin-sortable-list'); if (!container) return; 
  adminCombinedList.sort((a, b) => { const aV = a.order !== 0, bV = b.order !== 0; if (aV && !bV) return -1; if (!aV && bV) return 1; if (aV && bV) { if (a.order !== '' && b.order !== '') return a.order - b.order; if (a.order !== '' && b.order === '') return -1; if (a.order === '' && b.order !== '') return 1; } return a.locCode.localeCompare(b.locCode); });
  let html = '';
  adminCombinedList.forEach(item => { const isHidden = item.order === 0; const isNew = item.order === ''; const cardStyle = isHidden ? 'opacity: 0.6; border-left: 5px solid #dc3545;' : (isNew ? 'border-left: 5px solid #ffc107; background-color: #fffbeb;' : 'border-left: 5px solid var(--academic-primary);'); const eyeIcon = isHidden ? 'bi-eye-slash-fill text-danger' : 'bi-eye-fill text-success';
    html += `<div class="card border-0 shadow-sm mb-2 sortable-item" style="${cardStyle}" data-loc="${item.locCode}" data-table="${item.tableId}" data-drug="${item.drugCode}" data-name="${item.drugName}" data-hidden="${isHidden}"><div class="card-body p-2 d-flex align-items-center"><div class="drag-handle"><i class="bi bi-grip-vertical"></i></div><div class="flex-grow-1 px-2 text-truncate"><div class="fw-bold text-dark search-target">${item.drugName} ${isNew ? '<span class="badge bg-warning text-dark ms-2">🆕 新</span>' : ''}</div><div class="small text-muted"><span class="badge bg-academic me-1">${item.tableName}</span>${item.locCode}</div></div><div><button class="btn btn-light border p-2" onclick="toggleVisibility(this, '${item.locCode}')"><i id="eye-${item.locCode}" class="${eyeIcon} fs-5"></i></button></div></div></div>`;
  });
  container.innerHTML = html; if(sortableInstance) sortableInstance.destroy(); sortableInstance = new window.Sortable(container, { handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost' });
}
export function toggleVisibility(btn, locCode) { const card = btn.closest('.sortable-item'); const icon = document.getElementById(`eye-${locCode}`); if (card.getAttribute('data-hidden') === 'true') { card.setAttribute('data-hidden', 'false'); card.style.opacity = '1'; card.style.borderLeftColor = 'var(--academic-primary)'; icon.className = 'bi bi-eye-fill text-success fs-5'; } else { card.setAttribute('data-hidden', 'true'); card.style.opacity = '0.6'; card.style.borderLeftColor = '#dc3545'; icon.className = 'bi bi-eye-slash-fill text-danger fs-5'; } }
export function highlightSearchItem() { const kw = document.getElementById('admin-search-input').value.toLowerCase(); let firstMatch = null; document.querySelectorAll('.sortable-item').forEach(card => { if (kw && (card.querySelector('.search-target').innerText.toLowerCase().includes(kw) || card.getAttribute('data-loc').toLowerCase().includes(kw))) { card.classList.add('bg-warning', 'bg-opacity-25'); if(!firstMatch) firstMatch = card; } else card.classList.remove('bg-warning', 'bg-opacity-25'); }); if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
export function rebuildAdminList() { if(confirm('確定要重建清單嗎？')) { adminCombinedList = adminData.selectable.map(i => ({ ...i, order: '' })); renderSortableList(); } }
export function saveAdminDataToServer() { const payload = []; let currentOrder = 1; document.querySelectorAll('.sortable-item').forEach(el => { payload.push({ tableId: el.getAttribute('data-table'), locCode: el.getAttribute('data-loc'), drugCode: el.getAttribute('data-drug'), drugName: el.getAttribute('data-name'), order: el.getAttribute('data-hidden') === 'true' ? 0 : currentOrder++ }); }); toggleLoader(true); fetchBackend('saveAdminSortData', { payloadArray: JSON.stringify(payload) }).then(res => { toggleLoader(false); if (res && res.success) { showToast('🎉 儲存成功！'); if (typeof changeDailyDate === 'function') changeDailyDate(); } else alert('❌ 失敗：' + (res.message)); }).catch(err => { toggleLoader(false); alert('⚠️ 異常：' + err.message); }); }
export function checkAdminNewDrugs() { fetchBackend('getAdminData').then(data => { if (data && data.success !== false) { const hasNew = (data.selectable || []).some(item => { return !(data.saved || []).find(s => s.locCode === item.locCode); }); const badge = document.getElementById('admin-new-badge'); if (badge) { if (hasNew) badge.classList.remove('d-none'); else badge.classList.add('d-none'); } } }).catch(err => {}); }

window.resolveEditQtyModal = window.resolveEditQtyModal || null; window.resolveVoidModal = window.resolveVoidModal || null;
window.confirmEditQty = () => { const val = document.getElementById('edit-qty-input').value; if (val === '') return alert('請輸入數量'); window.bootstrap.Modal.getInstance(document.getElementById('editQtyModal')).hide(); if(window.resolveEditQtyModal) window.resolveEditQtyModal(val); };
window.cancelEditQty = () => { window.bootstrap.Modal.getInstance(document.getElementById('editQtyModal')).hide(); if(window.resolveEditQtyModal) window.resolveEditQtyModal(null); };
window.confirmVoid = () => { window.bootstrap.Modal.getInstance(document.getElementById('voidConfirmModal')).hide(); if(window.resolveVoidModal) window.resolveVoidModal(true); };
window.cancelVoid = () => { window.bootstrap.Modal.getInstance(document.getElementById('voidConfirmModal')).hide(); if(window.resolveVoidModal) window.resolveVoidModal(false); };
