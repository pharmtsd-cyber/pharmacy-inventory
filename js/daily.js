import { fetchBackend } from './api.js'; 
import { toggleLoader, switchView, showToast } from './ui.js'; 
import { session } from './config.js';

export let dailyItems = []; 
export let dailyTables = [];
export let currentDailyTab = '未盤'; 

// ==========================================
// 🚀 每日盤點：「單筆消失 + 立刻背景寫入」引擎
// ==========================================
let dailyAutoSyncTimer = null;
let isDailyFlushing = false;

export function getDailyQueue() {
  try { return JSON.parse(localStorage.getItem('femh_daily_queue')) || []; }
  catch(e) { return []; }
}
function saveDailyQueue(queue) {
  localStorage.setItem('femh_daily_queue', JSON.stringify(queue));
  updateDailyPendingUI();
}
export function getDailyQueueCount() { return getDailyQueue().length; }

function updateDailyPendingUI() {
  const count = getDailyQueueCount();
  const badge = document.getElementById('daily-pending-count');
  const bar = document.getElementById('daily-pending-bar');
  if (badge) badge.innerText = count;
  if (bar) {
    if (count > 0) bar.classList.remove('d-none');
    else bar.classList.add('d-none');
  }
}

function startDailyAutoSyncTimer() {
  if (dailyAutoSyncTimer) return;
  dailyAutoSyncTimer = setInterval(() => {
    if (getDailyQueueCount() > 0 && !isDailyFlushing) {
      flushDailyQueue({ showBlockingLoader: false });
    } else if (getDailyQueueCount() === 0) {
      stopDailyAutoSyncTimer();
    }
  }, 15000);
}

function stopDailyAutoSyncTimer() {
  if (dailyAutoSyncTimer) {
    clearInterval(dailyAutoSyncTimer);
    dailyAutoSyncTimer = null;
  }
}

function applyDailyQueueToLocalState() {
  const queue = getDailyQueue();
  if (queue.length === 0) return;
  queue.forEach(req => {
    const d = req.data;
    const item = dailyItems.find(i => i.locCode === d.locCode);
    if (item) {
      item.hasRecord = true;
      item.countedQty = d.handQty;
      item.status = '成立';
      item.userName = d.userName || session.name;
    }
  });
}

function rebuildDailyTables() {
  const map = new Map();
  dailyItems.forEach(item => {
    const tId = item.tableId || 'UNKNOWN';
    if (!map.has(tId)) {
      map.set(tId, {
        id: tId,
        name: item.tableName || '未分類藥架',
        desc: item.tableDesc || '',
        items: []
      });
    }
    map.get(tId).items.push(item);
  });
  dailyTables = Array.from(map.values());
}

export function flushDailyQueue(options = {}) {
  const { showBlockingLoader = true, onComplete = null } = options;
  const queue = getDailyQueue();
  if (queue.length === 0) {
    if (onComplete) onComplete(true);
    return Promise.resolve(true);
  }

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
          setTimeout(() => {
            showToast(`🎉 成功同步 ${snapshotIds.length} 筆每日盤點！`);
            if (onComplete) onComplete(true);
          }, 500);
        } else {
          if (onComplete) onComplete(true);
        }
        return true;
      } else {
        if (showBlockingLoader) {
          toggleLoader(false, '', true);
          alert("❌ 打包同步失敗：" + (res ? res.message : '未知錯誤'));
        }
        if (onComplete) onComplete(false);
        return false;
      }
    }).catch(err => {
      isDailyFlushing = false;
      if (showBlockingLoader) {
        toggleLoader(false, '', true);
        alert("⚠️ 網路異常，稍後將自動重試：" + err.message);
      } else {
        showToast('⚠️ 背景寫入延遲，將於 15 秒後自動重試', 'delete');
      }
      if (onComplete) onComplete(false);
      return false;
    });
}

// ==========================================
// 基礎作業與統一進度小卡
// ==========================================
export function initDailyMode() { 
  currentDailyTab = '未盤';
  switchView('view-daily-app'); 
  const searchInput = document.getElementById('daily-search-input');
  if (searchInput) searchInput.value = '';

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dateSelect = document.getElementById('header-date-select');
  if (dateSelect) dateSelect.value = todayStr;
  loadDailyData(todayStr); 
}

export function changeDailyDate() {
  if (getDailyQueueCount() > 0) {
    flushDailyQueue({
      showBlockingLoader: true,
      onComplete: () => { loadDailyData(document.getElementById('header-date-select').value); }
    });
    return;
  }
  loadDailyData(document.getElementById('header-date-select').value); 
}

export function loadDailyData(dateStr) {
  if (dateStr && dateStr.includes('-')) dateStr = dateStr.replace(/-/g, '/');
  toggleLoader(true);
  fetchBackend('getDailyInventoryByDate', { dateStr: dateStr }).then(data => {
    toggleLoader(false);
    dailyItems = data.items || []; 
    if (data.selectedDate) document.getElementById('header-date-select').value = data.selectedDate.replace(/\//g, '-');
    applyDailyQueueToLocalState();
    rebuildDailyTables();
    renderDailyDashboard();
    updateTabUI();
    renderDailyItems();
    if (getDailyQueueCount() > 0) startDailyAutoSyncTimer();
  }).catch(err => {
    toggleLoader(false);
    const area = document.getElementById('daily-list-area');
    if (area) area.innerHTML = '<div class="text-center p-5 text-muted fw-bold">讀取失敗</div>';
  });
}

export function renderDailyDashboard() {
  const summaryEl = document.getElementById('daily-summary-card');
  if (!summaryEl) return;

  const total = dailyItems.length;
  const counted = dailyItems.filter(i => i.hasRecord && i.status === '成立').length;
  const percent = total > 0 ? Math.round((counted / total) * 100) : 0;
  const isComplete = total > 0 && percent === 100;

  const tablePills = dailyTables.map(t => {
    const tTot = t.items.length;
    const tCnt = t.items.filter(i => i.hasRecord && i.status === '成立').length;
    const tDone = tTot > 0 && tCnt === tTot;
    const safeName = (t.name || '').replace(/'/g, "\\'");
    return `
      <span class="badge ${tDone ? 'bg-success' : 'bg-light text-dark border border-secondary'} d-inline-flex align-items-center gap-1 py-1 px-2" style="cursor:pointer; font-size:0.78rem;" onclick="enterDailyTable('${t.id}', '${safeName}')">
        <span>${t.name}</span>
        <span class="${tDone ? 'text-white' : 'text-academic'} fw-bold">${tCnt}/${tTot}</span>
      </span>`;
  }).join('');

  summaryEl.innerHTML = `
    <div class="p-2 rounded border ${isComplete ? 'border-success bg-success bg-opacity-10' : 'border-secondary-subtle bg-light'}">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="fw-bold small text-dark"><i class="bi bi-speedometer2 me-1 text-academic"></i>當日總進度：${counted} / ${total}</span>
        <span class="badge ${isComplete ? 'bg-success' : 'bg-academic'}">${percent}%</span>
      </div>
      <div class="progress mb-2" style="height: 8px;">
        <div class="progress-bar ${isComplete ? 'bg-success' : 'bg-warning'}" style="width: ${percent}%"></div>
      </div>
      <div class="d-flex flex-wrap gap-1">${tablePills || '<span class="small text-muted">無盤點表資料</span>'}</div>
    </div>`;
}

export function enterDailyTable(tableId) {
  const target = document.getElementById(`daily-sec-${tableId}`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function handleDailyBack() {
  if (getDailyQueueCount() > 0) {
    flushDailyQueue({
      showBlockingLoader: true,
      onComplete: () => switchView('view-mode-select')
    });
    return;
  }
  switchView('view-mode-select');
}

export function showDailyTableDetailModal(tableId, tableName) {
  const table = dailyTables.find(t => t.id === tableId);
  if (!table) return;
  document.getElementById('modal-drug-name').innerText = `【${tableName}】儲位明細 (當日紀錄)`;
  const headers = ["儲位碼", "代碼", "藥名", "數量", "人員", "時間", "修改紀錄", "狀態"];
  document.getElementById('modal-thead').innerHTML = `<tr>${headers.map(h => `<th class="py-2 text-nowrap">${h}</th>`).join('')}</tr>`;
  const tbodyHtml = table.items.map(item => {
    const isCounted = item.hasRecord && item.status === '成立';
    const userName = isCounted ? (item.userName || '系統') : '-';
    const timeStr = isCounted ? (item.timeStr || '-') : '-';
    const qtyStr = isCounted ? (item.countedQty !== '' ? item.countedQty : '已盤') : '-';
    const modifyStr = (isCounted && item.updateUser) ? `<div class="small fw-bold text-dark">${item.updateUser}</div><div class="text-muted" style="font-size: 0.65rem;">${item.updateTime}</div>` : '-';
    return `<tr class="${isCounted ? 'table-success-light' : ''}"><td class="text-center fw-bold">${item.locCode}</td><td class="text-center">${item.drugCode}</td><td class="text-start text-truncate" style="max-width:150px;">${item.drugName}</td><td class="text-center fw-bold text-academic">${qtyStr}</td><td class="text-center">${userName}</td><td class="text-center small text-secondary">${timeStr}</td><td class="text-center align-middle">${modifyStr}</td><td class="text-center">${isCounted ? '✅' : '❌'}</td></tr>`;
  }).join('');
  document.getElementById('modal-tbody').innerHTML = tbodyHtml;
  new window.bootstrap.Modal(document.getElementById('detailsModal')).show();
}

export function switchDailyTab(tabName) { 
  if (currentDailyTab === tabName) return; 
  if (tabName === '已盤' && getDailyQueueCount() > 0) {
    flushDailyQueue({
      showBlockingLoader: true,
      onComplete: () => {
        currentDailyTab = tabName;
        const searchInput = document.getElementById('daily-search-input');
        if (searchInput) searchInput.value = '';
        loadDailyData(document.getElementById('header-date-select').value);
      }
    });
    return;
  }
  currentDailyTab = tabName;
  const searchInput = document.getElementById('daily-search-input');
  if (searchInput) searchInput.value = '';
  updateTabUI();
  renderDailyItems(); 
}

export function updateTabUI() {
  const btnUn = document.getElementById('btn-tab-uncounted');
  const btnCo = document.getElementById('btn-tab-counted');
  if (!btnUn || !btnCo) return;
  btnUn.className = currentDailyTab === '未盤' ? 'nav-link active fw-bold border bg-academic shadow-sm text-white py-2' : 'nav-link fw-bold border text-academic shadow-sm bg-white py-2';
  btnCo.className = currentDailyTab === '已盤' ? 'nav-link active fw-bold border bg-success shadow-sm text-white py-2' : 'nav-link fw-bold border text-success shadow-sm bg-white py-2';

  document.getElementById('count-uncounted').innerText = dailyItems.filter(i => !i.hasRecord || i.status === '作廢').length;
  document.getElementById('count-counted').innerText = dailyItems.filter(i => i.hasRecord && i.status === '成立').length;
}

export function renderDailyItems() {
  const area = document.getElementById('daily-list-area');
  if (!area) return;
  applyDailyQueueToLocalState();

  const kwInput = document.getElementById('daily-search-input');
  const kw = kwInput ? kwInput.value.toLowerCase().trim() : '';

  let html = '';
  const pendingCount = getDailyQueueCount();
  html += `
    <div id="daily-pending-bar" class="d-flex justify-content-between align-items-center mb-3 bg-white p-2 sticky-top shadow-sm border border-warning rounded ${pendingCount > 0 ? '' : 'd-none'}" style="top: 5px; z-index: 9;">
      <div>
        <span class="fw-bold text-dark ms-1">待同步：<span id="daily-pending-count" class="badge bg-warning text-dark fs-6 ms-1">${pendingCount}</span> 筆</span>
        <span class="text-muted small d-block ms-1" style="font-size: 0.72rem;">送出後立即背景寫入資料庫</span>
      </div>
      <button class="btn btn-sm btn-academic fw-bold px-3 py-1 shadow-sm" onclick="flushDailyQueue({ showBlockingLoader: true, onComplete: () => loadDailyData(document.getElementById('header-date-select').value) })">
        <i class="bi bi-cloud-upload"></i> 立即上傳
      </button>
    </div>`;

  let totalRendered = 0;

  dailyTables.forEach(table => {
    let items = currentDailyTab === '未盤'
      ? table.items.filter(i => !i.hasRecord || i.status === '作廢')
      : table.items.filter(i => i.hasRecord && i.status === '成立');

    if (kw) {
      items = items.filter(i =>
        (i.drugCode || '').toLowerCase().includes(kw) ||
        (i.drugName || '').toLowerCase().includes(kw) ||
        (i.locCode || '').toLowerCase().includes(kw)
      );
    }

    if (items.length === 0) return;
    totalRendered += items.length;

    const tTot = table.items.length;
    const tCnt = table.items.filter(i => i.hasRecord && i.status === '成立').length;
    const safeName = (table.name || '').replace(/'/g, "\\'");
    const descHtml = table.desc ? `<div class="small text-dark fw-bold mt-1 px-2 py-1 rounded" style="background-color:#fff3cd; border-left:3px solid #ffc107;">${table.desc}</div>` : '';

    html += `
      <div id="daily-sec-${table.id}" class="mb-3">
        <div class="d-flex justify-content-between align-items-center bg-white border-start border-4 border-primary rounded shadow-sm px-2 py-2 mb-2">
          <div>
            <span class="fw-bold text-dark">${table.name}</span>
            <span class="badge bg-secondary ms-1">${tCnt}/${tTot}</span>
            ${descHtml}
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary fw-bold py-0" onclick="showDailyTableDetailModal('${table.id}', '${safeName}')">
            <i class="bi bi-list-ul"></i> 明細
          </button>
        </div>`;

    if (currentDailyTab === '未盤') {
      items.forEach((item, index) => {
        const encodedName = btoa(encodeURIComponent(item.drugName || ''));
        const borderColor = index % 2 === 0 ? 'var(--academic-primary)' : '#adb5bd';
        let hintHtml = '';
        if (item.infoNotice && item.infoNotice !== '') hintHtml += `<div class="text-danger small fw-bold mb-1"><i class="bi bi-exclamation-triangle-fill me-1"></i>盤點注意：${item.infoNotice}</div>`;
        if (item.infoMemo && item.infoMemo !== '') hintHtml += `<div class="text-secondary small mb-1" style="font-size: 0.8rem;"><i class="bi bi-info-square-fill me-1"></i>藥品備註：${item.infoMemo}</div>`;
        const lastRecordHtml = item.lastQty !== '無'
          ? `<div class="bg-light border rounded p-2 mb-2 d-flex justify-content-between align-items-center shadow-sm"><span class="text-secondary small fw-bold"><i class="bi bi-clock-history"></i> 前次紀錄 (${item.lastTime}):</span><span class="text-academic fw-bold" style="font-size: 1.8rem; line-height: 1;">${item.lastQty}</span></div>`
          : `<div class="bg-light border rounded p-2 mb-2 text-center text-muted small shadow-sm">尚無歷史盤點紀錄</div>`;

        html += `
          <div class="card drug-card mb-3 shadow-sm border-0" style="border-left: 6px solid ${borderColor} !important;">
            <div class="card-body p-3">
              <div class="fw-bold fs-5 text-dark mb-1">${item.drugName}</div>
              <div class="d-flex flex-wrap gap-1 mb-2">
                <span class="badge bg-academic shadow-sm">${item.tableName}</span>
                <span class="badge bg-white text-dark border border-secondary shadow-sm">儲位: ${item.locCode}</span>
              </div>
              ${hintHtml ? `<div class="bg-light rounded p-2 mb-2 border border-danger border-opacity-25">${hintHtml}</div>` : ''}
              ${lastRecordHtml}
              <div class="input-group shadow-sm mt-2">
                <input type="number" id="qty-${item.locCode}" class="form-control form-control-lg bg-white fw-bold text-center border-secondary" placeholder="本次數量" inputmode="numeric" pattern="[0-9]*" onkeydown="if(event.key === 'Enter') submitDailyOne('${item.locCode}', '${item.drugCode}', decodeURIComponent(atob('${encodedName}')), '${item.tableId}')">
                <button class="btn btn-outline-secondary px-3 fw-bold bg-light border-secondary" type="button" onclick="openCalculator('qty-${item.locCode}', decodeURIComponent(atob('${encodedName}')))"><i class="bi bi-calculator fs-5"></i></button>
                <button class="btn btn-academic px-4 fw-bold fs-5" onclick="submitDailyOne('${item.locCode}', '${item.drugCode}', decodeURIComponent(atob('${encodedName}')), '${item.tableId}')">送出</button>
              </div>
            </div>
          </div>`;
      });
    } else {
      items.forEach((item, index) => {
        const borderColor = index % 2 === 0 ? 'var(--academic-primary)' : '#adb5bd';
        const updateInfo = (item.updateUser && item.updateTime) ? ` <span class="ms-1 badge bg-warning text-dark shadow-sm" style="font-size:0.65rem;"><i class="bi bi-pencil-square"></i> ${item.updateUser} 修改</span>` : '';
        html += `
          <div class="card drug-card mb-2 shadow-sm border-0" style="border-left: 6px solid ${borderColor} !important;">
            <div class="card-body p-2">
              <div class="d-flex justify-content-between mb-1">
                <div class="fw-bold text-dark text-truncate" style="max-width: 70%;">${item.drugName}</div>
                <div class="small text-muted text-end" style="font-size:0.75rem;">${item.timeStr}${updateInfo}</div>
              </div>
              <div class="small text-secondary mb-2"><span class="badge bg-success">已盤點</span><span class="ms-1">儲位: ${item.locCode}</span></div>
              <div class="d-flex justify-content-between align-items-center mt-1 pt-1 border-top">
                <div class="fs-4 fw-bold text-success">${item.countedQty}</div>
                <div>
                  <button class="btn btn-sm btn-outline-primary py-0 me-1" onclick="editDailyQty('${item.locCode}', '${item.countedQty}')">修改</button>
                  <button class="btn btn-sm btn-outline-danger py-0" onclick="toggleDailyStatus('${item.locCode}', '作廢')">作廢</button>
                </div>
              </div>
            </div>
          </div>`;
      });
    }

    html += `</div>`;
  });

  if (totalRendered === 0) {
    html += `<div class="text-center p-5 text-muted fw-bold">${kw ? '查無符合條件的藥品' : '此區皆已盤點完成'}</div>`;
  }

  area.innerHTML = html;
}

export function submitDailyOne(loc, dCode, dName, tId) {
  const inputEl = document.getElementById(`qty-${loc}`);
  const qty = inputEl ? inputEl.value.trim() : ''; 
  if (qty === '' || Number(qty) < 0) return alert('請輸入有效數量');
  const dStr = document.getElementById('header-date-select').value;
  const item = dailyItems.find(i => i.locCode === loc);
  if (!item) return;

  const now = new Date();
  item.hasRecord = true;
  item.status = '成立';
  item.countedQty = qty;
  item.userName = session.name;
  item.tStamp = now.getTime();
  item.timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const queue = getDailyQueue();
  queue.push({
    queueId: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7),
    timestamp: now.getTime(),
    action: 'submitInventory',
    data: {
      mode: '每日盤點',
      userId: session.id,
      userName: session.name,
      type: '盤點調劑台',
      actionSrc: '',
      dispType: '',
      drugCode: dCode,
      drugName: dName,
      handQty: qty,
      tableId: tId,
      locCode: loc,
      inventoryDate: dStr,
      barcode: ''
    }
  });
  saveDailyQueue(queue);

  if (navigator.vibrate) navigator.vibrate(50);
  updateTabUI();
  updateDailyPendingUI();
  renderDailyDashboard();
  renderDailyItems();

  startDailyAutoSyncTimer();
  flushDailyQueue({ showBlockingLoader: false });
}

export async function editDailyQty(locCode, currentQty) {
  if (getDailyQueueCount() > 0) {
    await flushDailyQueue({ showBlockingLoader: true });
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const item = dailyItems.find(i => i.locCode === locCode);
  if (!item || !item.sn) return alert('尚未取得識別碼，請重整後再試');
  const newQty = await new Promise(resolve => {
    window.resolveEditQtyModal = resolve;
    document.getElementById('edit-qty-drug-name').innerText = item.drugName;
    document.getElementById('edit-qty-old').innerText = currentQty;
    const input = document.getElementById('edit-qty-input');
    input.value = currentQty;
    new window.bootstrap.Modal(document.getElementById('editQtyModal')).show();
    document.getElementById('editQtyModal').addEventListener('shown.bs.modal', () => { input.focus(); input.select(); }, { once: true });
  });
  if (newQty === null || newQty === "") return; 
  const oldQty = item.countedQty;
  item.countedQty = newQty;
  renderDailyItems();
  fetchBackend('modifyDailyRecord', { sn: item.sn, newQty: newQty, newStatus: '成立', userId: session.id, userName: session.name }).then(res => {
    if (!res.success) { item.countedQty = oldQty; renderDailyItems(); showToast('修改失敗', 'delete'); }
  }).catch(err => { item.countedQty = oldQty; renderDailyItems(); });
}

export async function toggleDailyStatus(locCode, newStatus) {
  if (getDailyQueueCount() > 0) {
    await flushDailyQueue({ showBlockingLoader: true });
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const item = dailyItems.find(i => i.locCode === locCode);
  if (!item || !item.sn) return alert('尚未取得識別碼，請重整後再試');
  if (newStatus === '作廢') {
    const isConfirmed = await new Promise(resolve => {
      window.resolveVoidModal = resolve;
      document.getElementById('void-drug-name').innerText = item.drugName;
      document.getElementById('void-drug-info').innerText = item.countedQty;
      new window.bootstrap.Modal(document.getElementById('voidConfirmModal')).show();
    });
    if (!isConfirmed) return; 
  }
  const oldStatus = item.status;
  item.status = newStatus;
  updateTabUI();
  renderDailyDashboard();
  renderDailyItems();
  fetchBackend('modifyDailyRecord', { sn: item.sn, newQty: '', newStatus: newStatus, userId: session.id, userName: session.name }).then(res => {
    if (!res.success) { item.status = oldStatus; updateTabUI(); renderDailyDashboard(); renderDailyItems(); }
  }).catch(err => { item.status = oldStatus; updateTabUI(); renderDailyDashboard(); renderDailyItems(); });
}

window.resolveEditQtyModal = window.resolveEditQtyModal || null;
window.resolveVoidModal = window.resolveVoidModal || null;
window.confirmEditQty = () => { const val = document.getElementById('edit-qty-input').value; if (val === '') return alert('請輸入數量'); window.bootstrap.Modal.getInstance(document.getElementById('editQtyModal')).hide(); if(window.resolveEditQtyModal) window.resolveEditQtyModal(val); };
window.cancelEditQty = () => { window.bootstrap.Modal.getInstance(document.getElementById('editQtyModal')).hide(); if(window.resolveEditQtyModal) window.resolveEditQtyModal(null); };
window.confirmVoid = () => { window.bootstrap.Modal.getInstance(document.getElementById('voidConfirmModal')).hide(); if(window.resolveVoidModal) window.resolveVoidModal(true); };
window.cancelVoid = () => { window.bootstrap.Modal.getInstance(document.getElementById('voidConfirmModal')).hide(); if(window.resolveVoidModal) window.resolveVoidModal(false); };
