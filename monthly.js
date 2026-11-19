import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast, playBeep, requestWakeLock, releaseWakeLock } from './ui.js';
import { session } from './config.js';

export let monthlyDrugMaster = []; export let monthlyTables = []; export let myRecordsData = []; 
export let activeRecordFilters = { stock: null, desk: null, online: null, records: null }; 
export let html5QrCode = null; export let stockSelectedDrug = null; export let onlineSelectedDrug = null;
export let barcodeQtyResolve = null; export let allRecordsData = [];

// ==========================================
// 🚀 核心：「單筆消失/清空 + 60秒自動打包」統一引擎
// ==========================================
let monthlyAutoSyncTimer = null;
let isMonthlyFlushing = false;

export function getMonthlyQueue() {
  try { return JSON.parse(localStorage.getItem('femh_monthly_queue')) || []; } catch(e) { return []; }
}
function saveMonthlyQueue(queue) {
  localStorage.setItem('femh_monthly_queue', JSON.stringify(queue));
  updateMonthlyPendingUI();
}
export function getMonthlyQueueCount() { return getMonthlyQueue().length; }

function updateMonthlyPendingUI() {
  const q = getMonthlyQueue();
  // 調劑台 UI
  const deskCount = q.filter(i => i.data.type === '盤點調劑台').length;
  const deskBadge = document.getElementById('desk-pending-count');
  const deskBar = document.getElementById('desk-pending-bar');
  if (deskBadge) deskBadge.innerText = deskCount;
  if (deskBar) { if (deskCount > 0) deskBar.classList.remove('d-none'); else deskBar.classList.add('d-none'); }
  
  // 庫存與線上，採用右上角/標題旁的提示 (如果需要的話)，這裡我們用靜默處理即可
}

function startMonthlyAutoSyncTimer() {
  if (monthlyAutoSyncTimer) return;
  monthlyAutoSyncTimer = setInterval(() => {
    if (getMonthlyQueueCount() > 0 && !isMonthlyFlushing) { flushMonthlyQueue({ showBlockingLoader: false }); } 
    else if (getMonthlyQueueCount() === 0) { stopMonthlyAutoSyncTimer(); }
  }, 60000); // 60秒背景靜默打包
}
function stopMonthlyAutoSyncTimer() {
  if (monthlyAutoSyncTimer) { clearInterval(monthlyAutoSyncTimer); monthlyAutoSyncTimer = null; }
}

function applyMonthlyQueueToLocalState() {
  const queue = getMonthlyQueue();
  if (queue.length === 0) return;

  queue.forEach(req => {
    const d = req.data;
    // 調劑台
    if (d.type === '盤點調劑台') {
      const table = monthlyTables.find(t => t.id === d.tableId);
      if (table) {
        const item = table.items.find(i => i.locCode === d.locCode);
        if (item) { item.hasCounted = true; item.countedQty = d.handQty; item.countedUser = d.userName; item.countedTime = req.localTimeStr; }
      }
    }
    // 加入全域紀錄讓「已盤點/明細」看得到
    const exists = allRecordsData.some(r => r.sn === req.tempSn);
    if (!exists) {
      const tempRec = {
        sn: req.tempSn, code: d.drugCode, name: d.drugName, qty: Number(d.handQty), handQty: Math.abs(Number(d.handQty)),
        time: req.localTimeStr, tStamp: req.timestamp || Date.now(), type: d.type, dispType: d.dispType, loc: d.locCode || '',
        tableId: d.tableId || '', status: '成立', userId: d.userId, userName: d.userName
      };
      allRecordsData.unshift(tempRec); myRecordsData.unshift(tempRec);
    }
  });
}

export function flushMonthlyQueue(options = {}) {
  const { showBlockingLoader = true, onComplete = null } = options;
  const queue = getMonthlyQueue();
  if (queue.length === 0) { if (onComplete) onComplete(true); return Promise.resolve(true); }

  if (isMonthlyFlushing) {
    if (showBlockingLoader) toggleLoader(true, `📦 正在同步 ${queue.length} 筆資料...`, true);
    return new Promise(resolve => {
      const checkInt = setInterval(() => {
        if (!isMonthlyFlushing) {
          clearInterval(checkInt);
          if (showBlockingLoader) toggleLoader(false, '', true);
          if (onComplete) onComplete(true); resolve(true);
        }
      }, 200);
    });
  }

  isMonthlyFlushing = true;
  const snapshotIds = queue.map(q => q.queueId);
  const batchPayload = queue.map(q => ({ action: q.action, data: q.data }));

  if (showBlockingLoader) toggleLoader(true, `📦 正在打包上傳 ${queue.length} 筆資料...`, true);

  return fetchBackend('syncBatchOfflineData', { batchArray: JSON.stringify(batchPayload) }).then(res => {
    isMonthlyFlushing = false;
    if (res && res.success) {
      const currentQueue = getMonthlyQueue();
      const remaining = currentQueue.filter(q => !snapshotIds.includes(q.queueId));
      saveMonthlyQueue(remaining);
      if (remaining.length === 0) stopMonthlyAutoSyncTimer();
      
      if (showBlockingLoader) {
        toggleLoader(false, '', true);
        setTimeout(() => { showToast(`🎉 成功同步 ${snapshotIds.length} 筆盤點資料！`); if (onComplete) onComplete(true); }, 500);
      } else {
        showToast(`☁️ 已自動打包同步 ${snapshotIds.length} 筆資料`);
        loadUserRecords(() => { refreshDashboardDataSilently(); }); // 背景更新
        if (onComplete) onComplete(true);
      }
      return true;
    } else {
      if (showBlockingLoader) toggleLoader(false, '', true);
      alert("❌ 打包同步失敗：" + (res ? res.message : ''));
      if (onComplete) onComplete(false); return false;
    }
  }).catch(err => {
    isMonthlyFlushing = false;
    if (showBlockingLoader) { toggleLoader(false, '', true); alert("⚠️ 連線異常，稍後將重試：" + err.message); }
    else { showToast('⚠️ 背景自動打包延遲，將於 1 分鐘後重試', 'delete'); }
    if (onComplete) onComplete(false); return false;
  });
}
window.flushMonthlyQueue = flushMonthlyQueue;

// ==========================================
// 初始化與相機
// ==========================================
export function initMonthlyMode() {
  switchView('view-monthly-app'); switchMonthlyTab('tab-dashboard'); 
  document.querySelectorAll('input[name="actionType"]').forEach(radio => { if (radio.value !== '手動') radio.checked = true; });
  updateOnlineUI(); 
  document.querySelectorAll('input[name="dispType"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const actionType = document.querySelector('input[name="actionType"]:checked');
      if (actionType && actionType.value === '手動') { const searchInput = document.getElementById('online-drug-search'); if (searchInput) setTimeout(() => searchInput.focus(), 10);
      } else { const bcInput = document.getElementById('online-barcode'); if (bcInput) setTimeout(() => bcInput.focus(), 10); }
    });
  });
  
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const startInput = document.getElementById('filter-date-start'); if (startInput) startInput.value = todayStr;
  const endInput = document.getElementById('filter-date-end'); if (endInput) endInput.value = todayStr;

  toggleLoader(true);
  fetchBackend('getMonthlyInitData').then(res => {
    monthlyDrugMaster = res.drugMaster; monthlyTables = res.tables;
    const select = document.getElementById('monthly-table-select'); if(select) select.innerHTML = monthlyTables.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    loadUserRecords(() => { 
      applyMonthlyQueueToLocalState(); renderMonthlyDashboard(); toggleLoader(false); 
      if (getMonthlyQueueCount() > 0) startMonthlyAutoSyncTimer();
    });
  }).catch(err => { toggleLoader(false); alert("載入失敗"); });
}

export function startLiveScanner() {
  const scannerWrapper = document.getElementById('scanner-wrapper'); scannerWrapper.style.display = 'flex'; document.getElementById('btn-start-camera').classList.add('disabled');
  const loadingMask = document.getElementById('scanner-loading'); const scannerContainer = document.getElementById('scanner-container'); const scannerLaser = document.getElementById('scanner-laser'); const scannerHint = document.getElementById('scanner-hint');
  
  if(loadingMask) loadingMask.style.display = 'flex'; if(scannerContainer) scannerContainer.style.opacity = '0'; if(scannerLaser) scannerLaser.style.display = 'none'; if(scannerHint) scannerHint.style.display = 'none';
  requestWakeLock();
  if (!html5QrCode) html5QrCode = new window.Html5Qrcode("reader");
  const config = { fps: 20, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0, disableFlip: false };
  
  html5QrCode.start({ facingMode: "environment" }, config,
    (decodedText) => { if (navigator.vibrate) navigator.vibrate(100); playBeep(); document.getElementById('online-barcode').value = decodedText; closeLiveScanner().then(() => parseBarcodeAndSubmit()); },
    (errorMessage) => {} 
  ).then(() => {
    setTimeout(() => {
      if(loadingMask) loadingMask.style.display = 'none'; if(scannerContainer) scannerContainer.style.opacity = '1'; if(scannerLaser) scannerLaser.style.display = 'block'; if(scannerHint) scannerHint.style.display = 'block';
      try { html5QrCode.applyVideoConstraints({ advanced: [{ focusMode: "single-shot" }] }).catch(()=>{}); html5QrCode.applyVideoConstraints({ advanced: [{ zoom: 1.5 }] }).catch(()=>{}); } catch(e) {}
      const videoEl = document.querySelector("#reader video");
      if (videoEl) {
        let isZoomed = true; 
        videoEl.addEventListener("click", () => {
          try { html5QrCode.applyVideoConstraints({ advanced: [{ focusMode: "single-shot" }] }).catch(()=>{}); isZoomed = !isZoomed; html5QrCode.applyVideoConstraints({ advanced: [{ zoom: isZoomed ? 2.0 : 1.0 }] }).catch(()=>{}); if (navigator.vibrate) navigator.vibrate(30); } catch(e) {}
        });
      }
    }, 800); 
  }).catch((err) => { closeLiveScanner(); alert("❌ 相機啟動失敗！"); });
}
export function closeLiveScanner() { return new Promise((resolve) => { releaseWakeLock(); const wrapper = document.getElementById('scanner-wrapper'); const btn = document.getElementById('btn-start-camera'); if (html5QrCode && html5QrCode.isScanning) { html5QrCode.stop().then(() => { wrapper.style.display = 'none'; btn.classList.remove('disabled'); resolve(); }).catch(err => resolve()); } else { wrapper.style.display = 'none'; btn.classList.remove('disabled'); resolve(); } }); }
export async function parseBarcodeAndSubmit() { 
  const bcInput = document.getElementById('online-barcode'); const bcStr = bcInput.value.trim(); if (!bcStr) return;
  let qty = 1; let parsedDrug = null; let searchKey = bcStr;
  if (bcStr.includes(';')) { 
    const parts = bcStr.split(';'); 
    if (parts.length >= 3) {
      searchKey = parts[1].toUpperCase().trim(); parsedDrug = monthlyDrugMaster.find(d => (d.priceCode || '').toUpperCase() === searchKey);
      if (parsedDrug) {
        if (parts.length >= 4 && parts[3].trim() !== '') qty = parseInt(parts[3], 10) || 1;
        const dispType = document.querySelector('input[name="dispType"]:checked').value;
        if (dispType === '退藥' || !(parts.length >= 4 && parts[3].trim() !== '')) {
          const userQty = await openBarcodeQtyModal(parsedDrug.name, `批價碼: ${parsedDrug.priceCode}`, qty);
          if (userQty === null) { bcInput.value = ''; setTimeout(() => bcInput.focus(), 10); return; }
          qty = parseInt(userQty, 10);
        }
      }
    } 
  }
  if (!parsedDrug) { alert(`❌ 系統查無此藥品！`); bcInput.value = ''; setTimeout(() => bcInput.focus(), 10); return; }
  submitMonthlyOnline('條碼', { priceCode: parsedDrug.priceCode, invCode: parsedDrug.invCode, name: parsedDrug.name, qty: qty, barcode: bcStr }, '');
}
export function showSuccessCard(cardId, drugName, qty, actionTag, colorType = 'success') {
  const card = document.getElementById(cardId); const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  card.classList.remove('success-card-bottom'); void card.offsetWidth; 
  let colorTheme = 'bg-success text-white'; let inlineStyle = ''; let iconClass = 'bi-check-circle-fill'; let drugNameColor = 'text-warning'; let dividerColor = 'border-light';
  if (colorType === '調劑') { colorTheme = 'text-danger border border-danger border-2'; inlineStyle = 'background-color: #fff0f4;'; iconClass = 'bi-exclamation-circle-fill'; drugNameColor = 'text-danger'; dividerColor = 'border-danger border-opacity-25'; }
  card.className = `mt-3 p-3 rounded shadow-lg text-center success-card-bottom ${colorTheme}`; card.setAttribute('style', inlineStyle);
  card.innerHTML = `<div class="fw-bold mb-1 opacity-75"><i class="bi ${iconClass}"></i> 暫存成功</div><div class="fw-bold mb-2 ${drugNameColor}" style="font-size: 1.8rem; line-height: 1.2;">${drugName}</div><div class="fw-bold mb-2" style="font-size: 2.2rem;"><span class="fs-5 fw-normal opacity-75">${actionTag} 數量:</span> ${qty}</div><div class="small mt-2 border-top ${dividerColor} pt-2" style="opacity: 0.8;"><i class="bi bi-cloud-arrow-up"></i> 將於背景自動同步</div>`;
  card.classList.remove('d-none');
}

// ==========================================
// 🚀 月盤點：零延遲單筆暫存寫入
// ==========================================
export function submitMonthlyStock() {
  if (!stockSelectedDrug) return alert('請先搜尋並選擇藥品！'); const qty = document.getElementById('stock-qty').value; if (qty === '' || Number(qty) < 0) return alert('請輸入有效數量！');
  const currentDrug = stockSelectedDrug; 
  showSuccessCard('stock-success-card', currentDrug.name, qty, '庫存盤點', 'success'); 
  
  // 零延遲清空
  document.getElementById('stock-qty').value = ''; stockSelectedDrug = null; 
  document.getElementById('stock-selected-card').classList.add('d-none'); document.getElementById('stock-drug-search').value = '';
  setTimeout(() => { const searchInput = document.getElementById('stock-drug-search'); if (searchInput) searchInput.focus(); }, 10);
  
  const now = new Date();
  const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const tempSn = 'PENDING_STOCK_' + Date.now();

  const queue = getMonthlyQueue();
  queue.push({
    queueId: Date.now().toString() + '_' + Math.random().toString(36).substring(2,7), tempSn, timestamp: now.getTime(), localTimeStr: timeStr, action: 'submitInventory',
    data: { mode: '月盤點', userId: session.id, userName: session.name, type: '盤點庫存', actionSrc: '', dispType: '', drugCode: currentDrug.invCode, drugName: currentDrug.name, priceCodeSelect: currentDrug.priceCode, handQty: qty, tableId: 'BFYYY', locCode: '', barcode: '' }
  });
  saveMonthlyQueue(queue); applyMonthlyQueueToLocalState(); renderAllRecordLists(); startMonthlyAutoSyncTimer();
}

export function submitMonthlyOnline(actionSrc, parsedData = null, writePriceCode = '') {
  const type = '線上調劑'; const dispType = document.querySelector('input[name="dispType"]:checked').value;
  let payloadDrug = null; let qty = 0; let barcodeStr = '';
  
  if (actionSrc === '手動') {
    if (!onlineSelectedDrug) return alert('請先搜尋藥品！'); qty = document.getElementById('online-qty').value; if (qty === '' || Number(qty) < 0) return alert('請輸入有效數量！');
    payloadDrug = onlineSelectedDrug; writePriceCode = payloadDrug.priceCode;
  } else { payloadDrug = parsedData; qty = parsedData.qty; barcodeStr = parsedData.barcode; writePriceCode = ''; }
  
  const actionTag = dispType === '調劑' ? '調劑(-)' : '退藥(+)'; showSuccessCard('online-success-card', payloadDrug.name, qty, actionTag, dispType); 
  
  // 零延遲清空
  if (actionSrc === '手動') { 
    document.getElementById('online-qty').value = ''; onlineSelectedDrug = null; document.getElementById('online-selected-card').classList.add('d-none'); document.getElementById('online-drug-search').value=''; 
    setTimeout(() => { const searchInput = document.getElementById('online-drug-search'); if (searchInput) searchInput.focus(); }, 10);
  } else { 
    const bcInput = document.getElementById('online-barcode'); bcInput.value = ''; setTimeout(() => bcInput.focus(), 10); 
  }

  const now = new Date();
  const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const tempSn = 'PENDING_ONLINE_' + Date.now();

  const queue = getMonthlyQueue();
  queue.push({
    queueId: Date.now().toString() + '_' + Math.random().toString(36).substring(2,7), tempSn, timestamp: now.getTime(), localTimeStr: timeStr, action: 'submitInventory',
    data: { mode: '月盤點', userId: session.id, userName: session.name, type: type, actionSrc: actionSrc, dispType: dispType, drugCode: payloadDrug.invCode, drugName: payloadDrug.name, priceCodeSelect: writePriceCode, handQty: qty, tableId: 'BFZZZ', locCode: '', barcode: barcodeStr }
  });
  saveMonthlyQueue(queue); applyMonthlyQueueToLocalState(); renderAllRecordLists(); startMonthlyAutoSyncTimer();
}

export function submitMonthlyDeskOne(loc, dCode, dName, tId) {
  const inputEl = document.getElementById(`m-qty-${loc}`); const qty = inputEl ? inputEl.value.trim() : ''; 
  if (qty === '' || Number(qty) < 0) return alert('請輸入有效數量'); 
  
  const tableId = document.getElementById('monthly-table-select').value; const tableData = monthlyTables.find(t => t.id === tableId); if (!tableData) return; 
  const item = tableData.items.find(i => i.locCode === loc); if (!item) return;
  
  const now = new Date();
  const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  item.hasCounted = true; item.countedQty = qty; item.countedUser = session.name; item.countedTime = timeStr;
  
  const tempSn = 'PENDING_' + loc;
  const queue = getMonthlyQueue();
  const existingIdx = queue.findIndex(q => q.data && q.data.locCode === loc && q.data.type === '盤點調劑台');
  const queueItem = {
    queueId: Date.now().toString() + '_' + Math.random().toString(36).substring(2,7), tempSn, timestamp: now.getTime(), localTimeStr: timeStr, action: 'submitInventory',
    data: { mode: '月盤點', userId: session.id, userName: session.name, type: '盤點調劑台', actionSrc: '', dispType: '', drugCode: dCode, drugName: dName, handQty: qty, tableId: tId, locCode: loc, barcode: '' }
  };
  if (existingIdx > -1) queue[existingIdx] = queueItem; else queue.push(queueItem);
  saveMonthlyQueue(queue); applyMonthlyQueueToLocalState(); renderAllRecordLists();

  if (navigator.vibrate) navigator.vibrate(50);
  const uncountedLength = tableData.items.filter(i => !i.hasCounted).length; 
  const uncountedBadge = document.getElementById('count-desk-uncounted'); if (uncountedBadge) uncountedBadge.innerText = uncountedLength;
  const card = inputEl.closest('.drug-card'); 
  if (card) { 
    card.style.display = 'none'; 
    setTimeout(() => { 
      card.remove(); 
      if (uncountedLength === 0) { 
        const area = document.getElementById('monthly-desk-area'); 
        if (area) area.insertAdjacentHTML('beforeend', '<div class="text-center p-4 text-muted fw-bold">所有藥品皆已盤點完成</div>');
        flushMonthlyQueue({ showBlockingLoader: true, onComplete: () => refreshMonthlyData(true) }); // 盤完一區強制上傳
      } 
    }, 10);
  }
  startMonthlyAutoSyncTimer();
}

export function renderMonthlyDesk() { 
  const tableId = document.getElementById('monthly-table-select').value; const area = document.getElementById('monthly-desk-area'); if (!tableId) { area.innerHTML = ''; return; } 
  const tableData = monthlyTables.find(t => t.id === tableId); if (!tableData) return; 
  
  applyMonthlyQueueToLocalState();
  const uncountedItems = tableData.items.filter(i => !i.hasCounted); 
  const uncountedBadge = document.getElementById('count-desk-uncounted'); if (uncountedBadge) uncountedBadge.innerText = uncountedItems.length; 
  const pendingCount = getMonthlyQueue().filter(i => i.data.type === '盤點調劑台').length;

  let html = `
    <div id="desk-pending-bar" class="d-flex justify-content-between align-items-center mb-3 bg-white p-2 sticky-top shadow-sm border border-warning rounded ${pendingCount > 0 ? '' : 'd-none'}" style="top: 52px; z-index: 9;">
      <div><span class="fw-bold text-dark ms-1">待打包：<span id="desk-pending-count" class="badge bg-warning text-dark fs-6 ms-1">${pendingCount}</span> 筆</span><span class="text-muted small d-block ms-1" style="font-size: 0.72rem;">背景每 60 秒自動上傳</span></div>
      <button class="btn btn-sm btn-academic fw-bold px-3 py-1 shadow-sm" onclick="flushMonthlyQueue({ showBlockingLoader: true, onComplete: () => refreshMonthlyData(true) })"><i class="bi bi-cloud-upload"></i> 立即上傳</button>
    </div>`;

  if (uncountedItems.length === 0) { html += '<div class="text-center p-4 text-muted fw-bold">所有藥品皆已盤點完成</div>'; area.innerHTML = html; return; }
  
  const uniqueDrugs = []; tableData.items.forEach(item => { if (!uniqueDrugs.includes(item.drugCode)) uniqueDrugs.push(item.drugCode); }); 
  const getDrugColor = (code) => { const index = uniqueDrugs.indexOf(code); return index % 2 === 0 ? 'var(--academic-primary)' : '#adb5bd'; }; 
  
  uncountedItems.forEach(item => { 
    const borderColor = getDrugColor(item.drugCode); const encodedName = btoa(encodeURIComponent(item.drugName || '')); 
    let hintHtml = ''; if (item.desc && item.desc !== '') hintHtml += `<div class="text-danger small fw-bold mb-1"><i class="bi bi-exclamation-triangle-fill me-1"></i>盤點說明：${item.desc}</div>`; if (item.remark && item.remark !== '') hintHtml += `<div class="text-secondary small mb-1" style="font-size: 0.8rem;"><i class="bi bi-info-square-fill me-1"></i>藥品備註：${item.remark}</div>`;

    html += `<div class="card drug-card mb-3 shadow-sm border-0" style="border-left: 6px solid ${borderColor} !important;"><div class="card-body p-3"><div class="fw-bold fs-5 text-dark mb-2">${item.drugName}</div><div class="d-flex flex-wrap gap-1 mb-2"><span class="badge bg-light text-dark border border-secondary">儲位: ${item.locCode}</span><span class="badge bg-light text-dark border border-secondary">代碼: ${item.drugCode}</span></div>${hintHtml ? `<div class="bg-light rounded p-2 mb-2 border border-light-subtle">${hintHtml}</div>` : ''}
        <div class="input-group shadow-sm">
          <input type="number" id="m-qty-${item.locCode}" class="form-control form-control-lg bg-white fw-bold text-center border-secondary" placeholder="本次數量" inputmode="numeric" pattern="[0-9]*" onkeydown="if(event.key === 'Enter') submitMonthlyDeskOne('${item.locCode}', '${item.drugCode}', decodeURIComponent(atob('${encodedName}')), '${item.tableId}')">
          <button class="btn btn-outline-secondary px-3 fw-bold bg-light border-secondary" type="button" onclick="openCalculator('m-qty-${item.locCode}', decodeURIComponent(atob('${encodedName}')))"><i class="bi bi-calculator fs-5"></i></button>
          <button class="btn btn-academic px-4 fw-bold fs-5" onclick="submitMonthlyDeskOne('${item.locCode}', '${item.drugCode}', decodeURIComponent(atob('${encodedName}')), '${item.tableId}')">送出</button>
        </div></div></div>`; 
  }); 
  area.innerHTML = html;
}

// ==========================================
// 其他清單與功能保持不變，並加上跨分頁攔截
// ==========================================
export function loadUserRecords(callback) {
  fetchBackend('getMonthlyUserRecords', { userId: 'ALL' }).then(res => { 
    const validMonthlyTypes = ['盤點調劑台', '盤點庫存', '線上調劑']; allRecordsData = res.filter(r => validMonthlyTypes.includes((r.type || '').trim())); 
    const sName = session.name ? session.name.trim() : ''; const sId = session.id ? session.id.trim() : '';
    myRecordsData = allRecordsData.filter(r => (r.userId || '').trim() === sId || (r.updateUser || '').trim() === sName);
    applyMonthlyQueueToLocalState(); renderAllRecordLists(); 
    if(callback) callback(); 
  }).catch(err => { toggleLoader(false); alert("紀錄載入失敗"); });
}

export function updateOnlineUI() { 
  const checkedInput = document.querySelector('input[name="actionType"]:checked'); if (!checkedInput) return;
  const areaManual = document.getElementById('area-manual'); const areaBarcode = document.getElementById('area-barcode');
  if (checkedInput.value === '手動') { if (areaManual) areaManual.classList.remove('d-none'); if (areaBarcode) areaBarcode.classList.add('d-none'); const searchInput = document.getElementById('online-drug-search'); if (searchInput) setTimeout(() => searchInput.focus(), 10);
  } else { if (areaManual) areaManual.classList.add('d-none'); if (areaBarcode) areaBarcode.classList.remove('d-none'); const barcodeInput = document.getElementById('online-barcode'); if (barcodeInput) setTimeout(() => barcodeInput.focus(), 10); }
}

export function switchMonthlyTab(tabId) {
  if (getMonthlyQueueCount() > 0) {
    flushMonthlyQueue({ showBlockingLoader: true, onComplete: () => executeSwitchMonthlyTab(tabId) }); return;
  }
  executeSwitchMonthlyTab(tabId);
}
function executeSwitchMonthlyTab(tabId) {
  document.querySelectorAll('.monthly-content-section').forEach(s => s.classList.add('d-none')); document.getElementById(tabId).classList.remove('d-none');
  const tabsContainer = document.getElementById('monthly-tabs'); if (tabsContainer) { tabsContainer.querySelectorAll('.nav-link').forEach(btn => { btn.classList.remove('active', 'bg-academic', 'text-white'); btn.classList.add('bg-white', 'text-academic'); }); }
  const activeBtnId = tabId.replace('tab-', 'btn-tab-'); const activeBtn = document.getElementById(activeBtnId); if (activeBtn) { activeBtn.classList.remove('bg-white', 'text-academic'); activeBtn.classList.add('active', 'bg-academic', 'text-white'); }
  if (tabId === 'tab-records') renderAllRecordLists(); if (tabId === 'tab-dashboard') renderMonthlyDashboard();
  if (tabId === 'tab-online') { switchOnlineSubTab('input'); document.querySelectorAll('input[name="actionType"]').forEach(radio => { if (radio.value !== '手動') radio.checked = true; }); updateOnlineUI(); }
}

export function switchDeskSubTab(view) { 
  if (view === 'list' && getMonthlyQueueCount() > 0) { flushMonthlyQueue({ showBlockingLoader: true, onComplete: (success) => { if (success) loadUserRecords(() => executeSwitchDeskSubTab(view)); else executeSwitchDeskSubTab(view); } }); return; }
  executeSwitchDeskSubTab(view);
}
function executeSwitchDeskSubTab(view) {
  const btnIn = document.getElementById('btn-desk-sub-input'), btnList = document.getElementById('btn-desk-sub-list'); 
  if(btnIn) btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; if(btnList) btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; 
  if (view === 'input') { if(btnIn) btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; document.getElementById('area-desk-input').classList.remove('d-none'); document.getElementById('area-desk-list').classList.add('d-none'); renderMonthlyDesk(); } 
  else { if(btnList) btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; document.getElementById('area-desk-input').classList.add('d-none'); document.getElementById('area-desk-list').classList.remove('d-none'); renderAllRecordLists(); } 
}

export function switchStockSubTab(view) { 
  const btnIn = document.getElementById('btn-stock-sub-input'), btnList = document.getElementById('btn-stock-sub-list'), btnAll = document.getElementById('btn-stock-sub-all'); 
  if(btnIn) btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; if(btnList) btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; if(btnAll) btnAll.className = 'nav-link fw-bold border text-primary bg-white shadow-sm py-2'; 
  document.getElementById('area-stock-input').classList.add('d-none'); document.getElementById('area-stock-list').classList.add('d-none'); document.getElementById('area-stock-all').classList.add('d-none');
  if (view === 'input') { if(btnIn) btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; document.getElementById('area-stock-input').classList.remove('d-none'); } 
  else if (view === 'list') { if(btnList) btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; document.getElementById('area-stock-list').classList.remove('d-none'); renderAllRecordLists(); } 
  else if (view === 'all') { if(btnAll) btnAll.className = 'nav-link active fw-bold border bg-primary text-white shadow-sm py-2'; document.getElementById('area-stock-all').classList.remove('d-none'); renderAllRecordLists(); }
}
export function switchOnlineSubTab(view) { 
  const btnIn = document.getElementById('btn-online-sub-input'), btnList = document.getElementById('btn-online-sub-list'), btnAll = document.getElementById('btn-online-sub-all'); 
  if(btnIn) btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; if(btnList) btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; if(btnAll) btnAll.className = 'nav-link fw-bold border text-primary bg-white shadow-sm py-2'; 
  document.getElementById('area-online-input').classList.add('d-none'); document.getElementById('area-online-list').classList.add('d-none'); document.getElementById('area-online-all').classList.add('d-none');
  if (view === 'input') { if(btnIn) btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; document.getElementById('area-online-input').classList.remove('d-none'); } 
  else if (view === 'list') { if(btnList) btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; document.getElementById('area-online-list').classList.remove('d-none'); renderAllRecordLists(); } 
  else if (view === 'all') { if(btnAll) btnAll.className = 'nav-link active fw-bold border bg-primary text-white shadow-sm py-2'; document.getElementById('area-online-all').classList.remove('d-none'); renderAllRecordLists(); }
}
export function switchRecordsSubTab(view) {
  const btnMy = document.getElementById('btn-records-sub-my'), btnAll = document.getElementById('btn-records-sub-all');
  if(btnMy) btnMy.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; if(btnAll) btnAll.className = 'nav-link fw-bold border text-primary bg-white shadow-sm py-2';
  const areaMy = document.getElementById('area-records-my'), areaAll = document.getElementById('area-records-all');
  if (areaMy) areaMy.classList.add('d-none'); if (areaAll) areaAll.classList.add('d-none');
  if (view === 'my') { if(btnMy) btnMy.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; if (areaMy) areaMy.classList.remove('d-none'); } 
  else { if(btnAll) btnAll.className = 'nav-link active fw-bold border bg-primary text-white shadow-sm py-2'; if (areaAll) areaAll.classList.remove('d-none'); }
  renderAllRecordLists();
}

export function selectStockDrug(priceCode) { const drug = monthlyDrugMaster.find(d => d.priceCode === priceCode); if (!drug) return; stockSelectedDrug = drug; document.getElementById('stock-dropdown').style.display = 'none'; document.getElementById('stock-drug-search').value = ''; document.getElementById('stock-sel-name').innerText = drug.name; document.getElementById('stock-sel-inv').innerText = drug.invCode; document.getElementById('stock-sel-price').innerText = drug.priceCode; document.getElementById('stock-selected-card').classList.remove('d-none'); document.getElementById('stock-qty').focus(); }
export function selectOnlineDrug(priceCode) { const drug = monthlyDrugMaster.find(d => d.priceCode === priceCode); if (!drug) return; onlineSelectedDrug = drug; document.getElementById('online-dropdown').style.display = 'none'; document.getElementById('online-drug-search').value = ''; document.getElementById('online-sel-name').innerText = drug.name; document.getElementById('online-sel-inv').innerText = drug.invCode; document.getElementById('online-selected-card').classList.remove('d-none'); document.getElementById('online-qty').focus(); }
export function handleStockSearch() { const kw = document.getElementById('stock-drug-search').value.toLowerCase().trim(); const dropdown = document.getElementById('stock-dropdown'); if (!kw) { dropdown.style.display = 'none'; return; } let filtered = monthlyDrugMaster.filter(d => { const pCode = (d.priceCode || '').toLowerCase(); const name = (d.name || '').toLowerCase(); const invCode = (d.invCode || '').toLowerCase(); return pCode.includes(kw) || name.includes(kw) || invCode.includes(kw); }); filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if ((d.priceCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.priceCode||'').toLowerCase().indexOf(kw)); if ((d.name||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.name||'').toLowerCase().indexOf(kw)); if ((d.invCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.invCode||'').toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); filtered = filtered.slice(0, 10); if (filtered.length > 0) { dropdown.innerHTML = filtered.map(d => `<div class="search-dropdown-item" onclick="selectStockDrug('${d.priceCode}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">批價: ${d.priceCode} | 加P: ${d.invCode}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">查無藥品</div>'; dropdown.style.display = 'block'; } }
export function handleOnlineSearch() { const kw = document.getElementById('online-drug-search').value.toLowerCase().trim(); const dropdown = document.getElementById('online-dropdown'); if (!kw) { dropdown.style.display = 'none'; return; } let filtered = monthlyDrugMaster.filter(d => { const pCode = (d.priceCode || '').toLowerCase(); const name = (d.name || '').toLowerCase(); const invCode = (d.invCode || '').toLowerCase(); return pCode.includes(kw) || name.includes(kw) || invCode.includes(kw); }); filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if ((d.priceCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.priceCode||'').toLowerCase().indexOf(kw)); if ((d.name||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.name||'').toLowerCase().indexOf(kw)); if ((d.invCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.invCode||'').toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); filtered = filtered.slice(0, 10); if (filtered.length > 0) { dropdown.innerHTML = filtered.map(d => `<div class="search-dropdown-item" onclick="selectOnlineDrug('${d.priceCode}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">批價: ${d.priceCode} | 加P: ${d.invCode}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">查無藥品</div>'; dropdown.style.display = 'block'; } }

export function handleTableSelectChange() { 
  if (getMonthlyQueueCount() > 0) { flushMonthlyQueue({ showBlockingLoader: true, onComplete: () => { renderMonthlyDesk(); renderAllRecordLists(); }}); return; }
  renderMonthlyDesk(); renderAllRecordLists(); 
}

export function renderAllRecordLists() { 
  let stockRecords = myRecordsData.filter(r => r.type === '盤點庫存'); let stockAllRecords = allRecordsData.filter(r => r.type === '盤點庫存');
  if (activeRecordFilters['stock']) { stockRecords = stockRecords.filter(r => r.code === activeRecordFilters['stock']); stockAllRecords = stockAllRecords.filter(r => r.code === activeRecordFilters['stock']); }
  const stockCount = document.getElementById('count-stock-counted'); if (stockCount) stockCount.innerText = stockRecords.length; const stockAllCount = document.getElementById('count-stock-all'); if (stockAllCount) stockAllCount.innerText = stockAllRecords.length;
  const stockArea = document.getElementById('stock-records-area'); if (stockArea) stockArea.innerHTML = generateRecordCards(stockRecords, '本月尚未輸入庫存盤點', true); const stockAllArea = document.getElementById('stock-all-records-area'); if (stockAllArea) stockAllArea.innerHTML = generateRecordCards(stockAllRecords, '本月尚無任何人輸入庫存', false); 

  const tIdSelect = document.getElementById('monthly-table-select'); const tId = tIdSelect ? tIdSelect.value : ''; 
  let deskRecords = allRecordsData.filter(r => r.type === '盤點調劑台' && r.tableId === tId); 
  if (activeRecordFilters['desk']) deskRecords = deskRecords.filter(r => r.code === activeRecordFilters['desk']); 
  const deskCount = document.getElementById('count-desk-counted'); if (deskCount) deskCount.innerText = deskRecords.length; 
  const deskArea = document.getElementById('desk-records-area'); if (deskArea) deskArea.innerHTML = generateRecordCards(deskRecords, '本區本月尚無盤點紀錄', true); 

  let onlineRecords = myRecordsData.filter(r => r.type === '線上調劑'); let onlineAllRecords = allRecordsData.filter(r => r.type === '線上調劑');
  if (activeRecordFilters['online']) { onlineRecords = onlineRecords.filter(r => r.code === activeRecordFilters['online']); onlineAllRecords = onlineAllRecords.filter(r => r.code === activeRecordFilters['online']); }
  const onlineCount = document.getElementById('count-online-counted'); if (onlineCount) onlineCount.innerText = onlineRecords.length; const onlineAllCount = document.getElementById('count-online-all'); if (onlineAllCount) onlineAllCount.innerText = onlineAllRecords.length;
  const onlineArea = document.getElementById('online-records-area'); if (onlineArea) onlineArea.innerHTML = generateRecordCards(onlineRecords, '本月尚無線上調劑紀錄', true); const onlineAllArea = document.getElementById('online-all-records-area'); if (onlineAllArea) onlineAllArea.innerHTML = generateRecordCards(onlineAllRecords, '本月尚無任何線上調劑紀錄', false); 

  let allMyRecords = [...myRecordsData]; let allGlobalRecords = [...allRecordsData]; 
  const startDateStr = document.getElementById('filter-date-start') ? document.getElementById('filter-date-start').value : '';
  const endDateStr = document.getElementById('filter-date-end') ? document.getElementById('filter-date-end').value : '';
  if (activeRecordFilters['records']) { allMyRecords = allMyRecords.filter(r => r.code === activeRecordFilters['records']); allGlobalRecords = allGlobalRecords.filter(r => r.code === activeRecordFilters['records']); }
  if (startDateStr || endDateStr) {
    const startT = startDateStr ? new Date(startDateStr.replace(/-/g, '/') + ' 00:00:00').getTime() : 0;
    const endT = endDateStr ? new Date(endDateStr.replace(/-/g, '/') + ' 23:59:59').getTime() : Number.MAX_SAFE_INTEGER;
    const dFilter = r => { let match = false; if (r.tStamp && r.tStamp >= startT && r.tStamp <= endT) match = true; if (r.updateTStamp && r.updateTStamp >= startT && r.updateTStamp <= endT) match = true; return match; };
    allMyRecords = allMyRecords.filter(dFilter); allGlobalRecords = allGlobalRecords.filter(dFilter);
  }
  const totalCount = document.getElementById('user-records-count'); if (totalCount) totalCount.innerText = allMyRecords.length; const allCount = document.getElementById('all-records-count'); if (allCount) allCount.innerText = allGlobalRecords.length; 
  const userArea = document.getElementById('user-records-area'); if (userArea) userArea.innerHTML = generateRecordCards(allMyRecords, '查無符合條件的紀錄', true); 
  const globalArea = document.getElementById('all-records-area'); if (globalArea) globalArea.innerHTML = generateRecordCards(allGlobalRecords, '查無符合條件的紀錄', true); 
}

export function generateRecordCards(recordsArray, emptyMsg, allowEdit) { 
  if (recordsArray.length === 0) return `<div class="text-center p-3 text-muted fw-bold">${emptyMsg}</div>`; 
  let html = ''; 
  recordsArray.forEach(record => { 
    const isVoid = record.status === '作廢';
    let qtyStr = record.handQty; let colorClass = 'text-primary'; let dispBadge = ''; let cardBg = ''; let borderClass = 'border-info'; 
    if (record.dispType === '調劑') { qtyStr = `-${record.handQty}`; colorClass = 'text-danger'; dispBadge = `<span class="badge bg-danger ms-1">調劑</span>`; cardBg = 'background-color: #fff0f4;'; borderClass = 'border-danger'; } 
    else if (record.dispType === '退藥') { qtyStr = `+${record.handQty}`; colorClass = 'text-success'; dispBadge = `<span class="badge bg-success ms-1">退藥</span>`; borderClass = 'border-success'; } 
    const cardStyle = isVoid ? `opacity: 0.6; filter: grayscale(100%); ${cardBg}` : cardBg;
    const badgeHtml = isVoid ? `<span class="badge bg-secondary ms-1">已作廢</span>` : dispBadge;
    const locInfo = record.loc ? ` | 儲位: ${record.loc}` : ''; 
    const userInfo = record.userName ? `<span class="badge bg-light text-dark border ms-1"><i class="bi bi-person-fill"></i> 建立: ${record.userName}</span>` : '';
    const updateInfo = (record.updateUser && record.updateTime) ? `<span class="badge bg-warning text-dark border ms-1"><i class="bi bi-pencil-square"></i> 修改: ${record.updateUser} (${record.updateTime})</span>` : '';
    const actionHtml = isVoid ? `<button class="btn btn-sm btn-outline-success py-0" onclick="toggleMonthlyRecordStatus('${record.sn}', '成立')">還原</button>` : `<button class="btn btn-sm btn-outline-primary py-0 me-1" onclick="editRecord('${record.sn}')">修改</button><button class="btn btn-sm btn-outline-danger py-0" onclick="toggleMonthlyRecordStatus('${record.sn}', '作廢')">作廢</button>`;
    const editButtons = allowEdit ? `<div class="d-flex justify-content-between align-items-center mt-1 pt-1 border-top"><div class="fs-5 fw-bold ${isVoid ? 'text-muted text-decoration-line-through' : colorClass}">${qtyStr}</div><div>${actionHtml}</div></div>` : `<div class="fs-5 fw-bold ${isVoid ? 'text-muted text-decoration-line-through' : colorClass} mt-1 pt-1 border-top">${qtyStr}</div>`; 
    html += `<div class="card mb-2 shadow-sm border-0 border-start border-4 ${borderClass}" style="${cardStyle}"><div class="card-body p-2"><div class="d-flex justify-content-between mb-1"><div class="fw-bold text-dark text-truncate" style="max-width: 70%;">${record.name}</div><div class="small text-muted" style="font-size:0.75rem;">${record.time}</div></div><div class="small text-secondary mt-1" style="font-size:0.8rem;"><span class="badge bg-secondary">${record.type}</span>${badgeHtml}<span class="ms-1">代碼: ${record.code}${locInfo}</span><div class="mt-1">${userInfo}${updateInfo}</div></div>${editButtons}</div></div>`; 
  }); 
  return html; 
}

export function handleRecordFilterSearch(tabKey) { 
  const kw = document.getElementById(`filter-input-${tabKey}`).value.toLowerCase().trim(); const dropdown = document.getElementById(`filter-dropdown-${tabKey}`); 
  let sourceData = []; 
  if (tabKey === 'stock') sourceData = myRecordsData.filter(r => r.type === '盤點庫存'); 
  else if (tabKey === 'desk') { const tId = document.getElementById('monthly-table-select').value; sourceData = allRecordsData.filter(r => r.type === '盤點調劑台' && r.tableId === tId); } 
  else if (tabKey === 'online') sourceData = myRecordsData.filter(r => r.type === '線上調劑'); 
  else if (tabKey === 'records') sourceData = allRecordsData; 
  const uniqueMap = new Map();
  sourceData.forEach(r => { if (!uniqueMap.has(r.code)) { uniqueMap.set(r.code, { code: r.code, name: r.name, locs: new Set() }); } if (r.loc) uniqueMap.get(r.code).locs.add(r.loc); }); 
  const uniqueDrugs = Array.from(uniqueMap.values()).map(d => ({ code: d.code, name: d.name, locStr: Array.from(d.locs).join(', ') }));
  let filtered = kw ? uniqueDrugs.filter(d => d.code.toLowerCase().includes(kw) || d.name.toLowerCase().includes(kw) || d.locStr.toLowerCase().includes(kw)) : uniqueDrugs; 
  if (kw && filtered.length > 0) { filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if (d.code.toLowerCase().indexOf(kw) !== -1) score = Math.min(score, d.code.toLowerCase().indexOf(kw)); if (d.name.toLowerCase().indexOf(kw) !== -1) score = Math.min(score, d.name.toLowerCase().indexOf(kw)); if (d.locStr.toLowerCase().indexOf(kw) !== -1) score = Math.min(score, d.locStr.toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); } 
  if (filtered.length > 0) { dropdown.innerHTML = filtered.slice(0, 10).map(d => { const locBadge = d.locStr ? `<span class="badge bg-secondary ms-1">儲位: ${d.locStr}</span>` : ''; return `<div class="search-dropdown-item" onclick="applyRecordFilter('${tabKey}', '${d.code}', '${d.name.replace(/'/g, "\\'")}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">${d.code} ${locBadge}</div></div>`; }).join(''); dropdown.style.display = 'block'; } 
  else { dropdown.innerHTML = '<div class="p-2 text-muted small">清單中無相符藥品</div>'; dropdown.style.display = 'block'; } 
}
export function applyRecordFilter(tabKey, code, name) { activeRecordFilters[tabKey] = code; document.getElementById(`filter-input-${tabKey}`).value = `${name} (${code})`; document.getElementById(`filter-dropdown-${tabKey}`).style.display = 'none'; renderAllRecordLists(); }
export function clearRecordFilter(tabKey) { activeRecordFilters[tabKey] = null; document.getElementById(`filter-input-${tabKey}`).value = ''; document.getElementById(`filter-dropdown-${tabKey}`).style.display = 'none'; renderAllRecordLists(); }
document.addEventListener('click', function(e) { if (!e.target.closest('.position-relative')) { document.querySelectorAll('.search-dropdown').forEach(d => d.style.display = 'none'); } const barcodeArea = document.getElementById('area-barcode'); if (barcodeArea && !barcodeArea.classList.contains('d-none')) { if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') { const bcInput = document.getElementById('online-barcode'); if (bcInput) setTimeout(() => bcInput.focus(), 10); } } });

export async function editRecord(sn) {
  if (String(sn).startsWith('PENDING_')) { await flushMonthlyQueue({ showBlockingLoader: true }); await new Promise(resolve => setTimeout(resolve, 500)); sn = allRecordsData.find(r => r.sn !== sn && r.type === '盤點調劑台')?.sn || sn; }
  const record = allRecordsData.find(r => r.sn === sn); if (!record) return;
  const newQty = await new Promise(resolve => { window.resolveEditQtyModal = resolve; document.getElementById('edit-qty-drug-name').innerText = record.name; document.getElementById('edit-qty-old').innerText = record.handQty; const input = document.getElementById('edit-qty-input'); input.value = record.handQty; new window.bootstrap.Modal(document.getElementById('editQtyModal')).show(); document.getElementById('editQtyModal').addEventListener('shown.bs.modal', () => { input.focus(); input.select(); }, { once: true }); });
  if (newQty === null || newQty === "") return;
  
  record.handQty = newQty; record.updateUser = session.name; record.updateTime = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); record.updateTStamp = new Date().getTime();
  const myRec = myRecordsData.find(r => r.sn === sn); if (myRec) { myRec.handQty = newQty; myRec.updateUser = session.name; myRec.updateTime = record.updateTime; myRec.updateTStamp = record.updateTStamp; } else { myRecordsData.unshift(record); }
  renderAllRecordLists(); monthlyTables.forEach(t => t.items.forEach(i => { if (i.drugCode === record.code && i.locCode === record.loc) i.countedQty = newQty; })); renderMonthlyDesk();
  fetchBackend('updateMonthlyRecord', { sn: sn, newQty: newQty, dispType: record.dispType, userId: session.id, userName: session.name }).then(res => { refreshDashboardDataSilently(); }).catch(err => { console.warn('修改要求已送出，前端略過錯誤'); });
}

export async function toggleMonthlyRecordStatus(sn, newStatus) {
  if (String(sn).startsWith('PENDING_')) { await flushMonthlyQueue({ showBlockingLoader: true }); await new Promise(resolve => setTimeout(resolve, 500)); sn = allRecordsData.find(r => r.sn !== sn && r.type === '盤點調劑台')?.sn || sn; }
  const record = allRecordsData.find(r => r.sn === sn); if (!record) return;
  if (newStatus === '作廢') { const isConfirmed = await new Promise(resolve => { window.resolveVoidModal = resolve; document.getElementById('void-drug-name').innerText = record.name; document.getElementById('void-drug-info').innerText = record.handQty; new window.bootstrap.Modal(document.getElementById('voidConfirmModal')).show(); }); if (!isConfirmed) return; }
  record.status = newStatus; record.updateUser = session.name; record.updateTime = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); record.updateTStamp = new Date().getTime(); 
  const myRec = myRecordsData.find(r => r.sn === sn); if (myRec) { myRec.status = newStatus; myRec.updateUser = session.name; myRec.updateTime = record.updateTime; myRec.updateTStamp = record.updateTStamp; } else { myRecordsData.unshift(record); }
  renderAllRecordLists(); monthlyTables.forEach(t => t.items.forEach(i => { if (i.drugCode === record.code && i.locCode === record.loc) { i.hasCounted = (newStatus === '成立'); } })); renderMonthlyDesk();
  fetchBackend('modifyMonthlyRecordStatus', { sn: sn, newStatus: newStatus, userId: session.id, userName: session.name }).then(res => { refreshDashboardDataSilently(); }).catch(err => { console.warn('狀態更新已送出，前端略過錯誤'); });
}

export function refreshMonthlyData(force = false) {
  if (!force && getMonthlyQueueCount() > 0) { flushMonthlyQueue({ showBlockingLoader: true, onComplete: () => refreshMonthlyData(true) }); return; }
  toggleLoader(true);
  fetchBackend('getMonthlyInitData').then(res => { monthlyDrugMaster = res.drugMaster; monthlyTables = res.tables; loadUserRecords(() => { applyMonthlyQueueToLocalState(); renderMonthlyDesk(); renderMonthlyDashboard(); toggleLoader(false); showToast('資料已同步至最新'); }); }).catch(err => { toggleLoader(false); alert("更新失敗"); });
}
export function refreshDashboardData() { toggleLoader(true); fetchBackend('getMonthlyInitData').then(res => { monthlyTables = res.tables; applyMonthlyQueueToLocalState(); renderMonthlyDashboard(); toggleLoader(false); showToast('進度已同步更新'); }).catch(err => { toggleLoader(false); alert("更新失敗"); }); }
export function refreshDashboardDataSilently() { fetchBackend('getMonthlyInitData').then(res => { monthlyTables = res.tables; applyMonthlyQueueToLocalState(); renderMonthlyDashboard(); }).catch(e => console.warn('背景更新進度失敗')); }

export function renderMonthlyDashboard() {
  const unfinishedArea = document.getElementById('dashboard-unfinished'); const finishedArea = document.getElementById('dashboard-finished');
  if(!unfinishedArea || !finishedArea) return;
  let unfinishedHtml = ''; let finishedHtml = '';
  monthlyTables.forEach(table => {
    const total = table.items.length; const counted = table.items.filter(i => i.hasCounted).length; const percent = total > 0 ? Math.round((counted / total) * 100) : 0; const isComplete = percent === 100;
    const tableDesc = table.desc ? `<div class="mt-2 px-2 py-1 rounded text-dark fw-bold shadow-sm" style="background-color: #fff3cd; border-left: 4px solid #ffc107; font-size: 0.85rem;"><i class="bi bi-exclamation-circle-fill text-warning me-1" style="font-size: 1rem;"></i>${table.desc}</div>` : '';
    const cardHtml = `<div class="card mb-3 shadow-sm border-0 border-start border-4 ${isComplete ? 'border-success' : 'border-warning'}" onclick="enterTableInventory('${table.id}', '${table.name}')" style="cursor: pointer;"><div class="card-body p-3"><div class="d-flex justify-content-between align-items-start mb-2"><div><div class="fw-bold text-dark fs-5">${table.name}</div>${tableDesc}</div><span class="badge ${isComplete ? 'bg-success' : 'bg-academic'}">${percent}%</span></div><div class="progress mb-2" style="height: 12px;"><div class="progress-bar ${isComplete ? 'bg-success' : 'bg-warning'}" style="width: ${percent}%"></div></div><div class="d-flex justify-content-between align-items-center mt-3"><div class="small text-secondary">已盤: ${counted} / ${total}</div><div><button class="btn btn-sm btn-outline-secondary me-2 fw-bold" onclick="event.stopPropagation(); showTableDetailModal('${table.id}', '${table.name}')"><i class="bi bi-list-ul"></i> 明細</button><span class="text-academic fw-bold small">點擊作業 <i class="bi bi-chevron-right"></i></span></div></div></div></div>`;
    if (isComplete) finishedHtml += cardHtml; else unfinishedHtml += cardHtml;
  });
  unfinishedArea.innerHTML = unfinishedHtml || '<div class="text-center text-muted py-3">所有藥架皆已盤點完成</div>'; finishedArea.innerHTML = finishedHtml || '<div class="text-center text-muted py-3">尚無完成的藥架</div>';
}

export function enterTableInventory(tableId, tableName) {
  const select = document.getElementById('monthly-table-select'); if(select) { select.value = tableId; handleTableSelectChange(); }
  document.getElementById('monthly-app-title').innerText = tableName; document.getElementById('monthly-tabs').classList.add('d-none'); document.getElementById('btn-monthly-back').classList.remove('d-none');
  document.querySelectorAll('.monthly-content-section').forEach(s => s.classList.add('d-none')); document.getElementById('tab-dispense').classList.remove('d-none'); window.scrollTo(0,0);
}

export function handleMonthlyBack() {
  if (getMonthlyQueueCount() > 0) { flushMonthlyQueue({ showBlockingLoader: true, onComplete: (success) => { if (success) executeMonthlyBack(); } }); return; }
  executeMonthlyBack();
}
function executeMonthlyBack() {
  const tabs = document.getElementById('monthly-tabs');
  if (tabs.classList.contains('d-none')) {
    tabs.classList.remove('d-none'); document.getElementById('btn-monthly-back').classList.add('d-none'); document.getElementById('monthly-app-title').innerHTML = '<i class="bi bi-calendar-month"></i> 月盤點作業'; 
    executeSwitchMonthlyTab('tab-dashboard'); refreshDashboardData(); 
  } else { switchView('view-mode-select'); }
}

export function showTableDetailModal(tableId, tableName) {
  const table = monthlyTables.find(t => t.id === tableId); if (!table) return;
  document.getElementById('modal-drug-name').innerText = `【${tableName}】儲位明細 (全域紀錄)`;
  const headers = ["儲位碼", "代碼", "藥名", "數量", "人員", "時間", "修改紀錄", "狀態"];
  document.getElementById('modal-thead').innerHTML = `<tr>${headers.map(h => `<th class="py-2 text-nowrap">${h}</th>`).join('')}</tr>`;
  const tbodyHtml = table.items.map(item => {
    const userName = item.hasCounted ? (item.countedUser || '系統') : '-'; const timeStr = item.hasCounted ? (item.countedTime || '-') : '-'; const qtyStr = item.hasCounted ? (item.countedQty !== '' ? item.countedQty : '已盤') : '-'; const modifyStr = (item.hasCounted && item.updateUser) ? `<div class="small fw-bold text-dark">${item.updateUser}</div><div class="text-muted" style="font-size: 0.65rem;">${item.updateTime}</div>` : '-';
    return `<tr class="${item.hasCounted ? 'table-success-light' : ''}"><td class="text-center fw-bold">${item.locCode}</td><td class="text-center">${item.drugCode}</td><td class="text-start text-truncate" style="max-width:150px;">${item.drugName}</td><td class="text-center fw-bold text-academic">${qtyStr}</td><td class="text-center">${userName}</td><td class="text-center small text-secondary">${timeStr}</td><td class="text-center align-middle">${modifyStr}</td><td class="text-center">${item.hasCounted ? '✅' : '❌'}</td></tr>`;
  }).join('');
  document.getElementById('modal-tbody').innerHTML = tbodyHtml;
  new window.bootstrap.Modal(document.getElementById('detailsModal')).show();
}

export function openBarcodeQtyModal(drugName, drugInfo, defaultQty = '') {
  return new Promise((resolve) => { barcodeQtyResolve = resolve; document.getElementById('barcode-qty-drug-name').innerText = drugName; document.getElementById('barcode-qty-drug-info').innerText = drugInfo; const input = document.getElementById('barcode-qty-input'); input.value = defaultQty; const modal = new window.bootstrap.Modal(document.getElementById('barcodeQtyModal')); modal.show(); document.getElementById('barcodeQtyModal').addEventListener('shown.bs.modal', () => { input.focus(); input.select(); }, { once: true }); });
}
window.confirmBarcodeQty = () => { const qty = document.getElementById('barcode-qty-input').value; if (qty === '' || qty <= 0) return alert('請輸入有效數量'); const modal = window.bootstrap.Modal.getInstance(document.getElementById('barcodeQtyModal')); modal.hide(); if (barcodeQtyResolve) barcodeQtyResolve(qty); };
window.cancelBarcodeQty = () => { const modal = window.bootstrap.Modal.getInstance(document.getElementById('barcodeQtyModal')); modal.hide(); if (barcodeQtyResolve) barcodeQtyResolve(null); };
