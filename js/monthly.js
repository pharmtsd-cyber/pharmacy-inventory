import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast, playBeep, requestWakeLock, releaseWakeLock } from './ui.js';
import { session } from './config.js';

export let monthlyDrugMaster = []; 
export let monthlyTables = []; 
export let myRecordsData = []; 
export let activeRecordFilters = { stock: null, desk: null, online: null, records: null }; 
export let html5QrCode = null; 
export let stockSelectedDrug = null; 
export let onlineSelectedDrug = null;

// ✨ 1. 修改初始化：預設進入進度看板
export function initMonthlyMode() {
  switchView('view-monthly-app'); 
  switchMonthlyTab('tab-dashboard'); 
  updateOnlineUI(); 
  toggleLoader(true);
  fetchBackend('getMonthlyInitData').then(res => {
    monthlyDrugMaster = res.drugMaster; 
    monthlyTables = res.tables;
    // 預先塞入隱藏選單
    document.getElementById('monthly-table-select').innerHTML = monthlyTables.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    loadUserRecords(() => { toggleLoader(false); });
  }).catch(err => { toggleLoader(false); alert("載入失敗"); });
}

export function startLiveScanner() {
  const scannerWrapper = document.getElementById('scanner-wrapper'); scannerWrapper.classList.remove('d-none'); document.getElementById('btn-start-camera').classList.add('disabled');
  requestWakeLock();
  if (!html5QrCode) html5QrCode = new window.Html5Qrcode("reader");
  const config = { fps: 10, qrbox: { width: 250, height: 150 }, formatsToSupport: [ window.Html5QrcodeSupportedFormats.DATA_MATRIX, window.Html5QrcodeSupportedFormats.QR_CODE, window.Html5QrcodeSupportedFormats.CODE_128 ] };
  html5QrCode.start({ facingMode: "environment" }, config,
    (decodedText) => { if (navigator.vibrate) navigator.vibrate(100); playBeep(); document.getElementById('online-barcode').value = decodedText; closeLiveScanner().then(() => parseBarcodeAndSubmit()); },
    (errorMessage) => {}
  ).catch((err) => { closeLiveScanner(); alert("❌ 無法啟動相機！請確認已允許相機權限。"); });
}

export function closeLiveScanner() {
  return new Promise((resolve) => {
    releaseWakeLock();
    if (html5QrCode && html5QrCode.isScanning) { html5QrCode.stop().then(() => { document.getElementById('scanner-wrapper').classList.add('d-none'); document.getElementById('btn-start-camera').classList.remove('disabled'); resolve(); }).catch(err => resolve()); } 
    else { document.getElementById('scanner-wrapper').classList.add('d-none'); document.getElementById('btn-start-camera').classList.remove('disabled'); resolve(); }
  });
}

export function parseBarcodeAndSubmit() {
  const bcInput = document.getElementById('online-barcode'); const bcStr = bcInput.value.trim(); if (!bcStr) return;
  let qty = 1; let parsedDrug = null;
  if (bcStr.includes(';')) { const parts = bcStr.split(';'); if (parts.length >= 4) { const bcPrice = parts[1].toUpperCase().trim(); qty = parseInt(parts[3], 10); parsedDrug = monthlyDrugMaster.find(d => d.priceCode.toUpperCase() === bcPrice); } } 
  else { parsedDrug = monthlyDrugMaster.find(d => d.priceCode.toUpperCase() === bcStr.toUpperCase() || d.invCode.toUpperCase() === bcStr.toUpperCase() || d.name.includes(bcStr)); }
  if (!parsedDrug) { alert('解析失敗：主檔查無此藥品！'); bcInput.value = ''; return; }
  submitMonthlyOnline('條碼', { priceCode: parsedDrug.priceCode, invCode: parsedDrug.invCode, name: parsedDrug.name, qty: qty, barcode: bcStr }, '');
}

export function showSuccessCard(cardId, drugName, qty, actionTag, colorType = 'success') {
  const card = document.getElementById(cardId); const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const bgClass = colorType === 'danger' ? 'bg-danger' : (colorType === 'warning' ? 'bg-warning text-dark' : 'bg-success');
  const textClass = colorType === 'warning' ? 'text-dark' : 'text-white';
  const icon = colorType === 'warning' ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill';
  const title = colorType === 'warning' ? '寫入異常' : '寫入成功';
  card.className = `mt-2 p-3 rounded shadow-sm text-center success-card-bottom ${bgClass} ${textClass}`;
  card.innerHTML = `<div class="fw-bold fs-5 mb-1"><i class="bi ${icon}"></i> ${title}</div><div class="fs-6">${actionTag} <span class="fw-bold">${drugName}</span> <span class="badge bg-white text-dark ms-1">數量: ${qty}</span></div><div class="small mt-2" style="opacity: 0.9;"><i class="bi bi-clock"></i> 處理時間: ${timeStr}</div>`;
  card.classList.remove('d-none');
}

export function submitMonthlyStock() {
  if (!stockSelectedDrug) return alert('請先搜尋並選擇藥品！');
  const qty = document.getElementById('stock-qty').value; if (!qty || qty <= 0) return alert('請輸入正整數！');
  showSuccessCard('stock-success-card', stockSelectedDrug.name, qty, '庫存盤點', 'success');
  const currentDrug = stockSelectedDrug; 
  document.getElementById('stock-qty').value = ''; stockSelectedDrug = null; 
  document.getElementById('stock-selected-card').classList.add('d-none'); document.getElementById('stock-drug-search').value = '';
  
  fetchBackend('submitInventory', { mode: '月盤點', userId: session.id, userName: session.name, type: '盤點庫存', action: '', dispType: '', drugCode: currentDrug.invCode, drugName: currentDrug.name, priceCodeSelect: currentDrug.priceCode, handQty: qty, tableId: 'BFYYY', locCode: '', barcode: '' })
    .then((res) => { if (res && res.success) pushRecordLocally(res.resultRecord); else showSuccessCard('stock-success-card', currentDrug.name, qty, '異常: '+res.message, 'warning'); })
    .catch(err => { showSuccessCard('stock-success-card', currentDrug.name, qty, '網路連線錯誤', 'warning'); });
}

export function submitMonthlyOnline(actionSrc, parsedData = null, writePriceCode = '') {
  const type = '線上調劑'; const dispType = document.querySelector('input[name="dispType"]:checked').value;
  let payloadDrug = null; let qty = 0; let barcodeStr = '';
  if (actionSrc === '手動') {
    if (!onlineSelectedDrug) return alert('請先搜尋藥品！');
    qty = document.getElementById('online-qty').value; if (!qty || qty <= 0) return alert('請輸入正整數！');
    payloadDrug = onlineSelectedDrug; writePriceCode = payloadDrug.priceCode;
  } else { payloadDrug = parsedData; qty = parsedData.qty; barcodeStr = parsedData.barcode; writePriceCode = ''; }
  
  const actionTag = dispType === '調劑' ? '調劑(-)' : '退藥(+)'; 
  const colorMode = dispType === '調劑' ? 'danger' : 'success';
  showSuccessCard('online-success-card', payloadDrug.name, qty, actionTag, colorMode);
  
  if (actionSrc === '手動') { document.getElementById('online-qty').value = ''; onlineSelectedDrug = null; document.getElementById('online-selected-card').classList.add('d-none'); document.getElementById('online-drug-search').value=''; } 
  else { document.getElementById('online-barcode').value = ''; document.getElementById('online-barcode').focus(); }

  fetchBackend('submitInventory', { mode: '月盤點', userId: session.id, userName: session.name, type: type, action: actionSrc, dispType: dispType, drugCode: payloadDrug.invCode, drugName: payloadDrug.name, priceCodeSelect: writePriceCode, handQty: qty, tableId: 'BFZZZ', locCode: '', barcode: barcodeStr })
    .then((res) => { if(res && res.success) pushRecordLocally(res.resultRecord); else showSuccessCard('online-success-card', payloadDrug.name, qty, '異常: '+res.message, 'warning'); })
    .catch(err => { showSuccessCard('online-success-card', payloadDrug.name, qty, '網路連線錯誤', 'warning'); });
}

export function loadUserRecords(callback) {
  fetchBackend('getMonthlyUserRecords', { userId: session.id }).then(res => { myRecordsData = res; renderAllRecordLists(); if(callback) callback(); }).catch(err => { toggleLoader(false); alert("紀錄載入失敗"); });
}

export function pushRecordLocally(recInfo) {
  if (!recInfo) return;
  if (recInfo.action === 'insert') { myRecordsData.unshift(recInfo); } 
  else if (recInfo.action === 'update') { 
    let existing = null; 
    if (recInfo.type === '盤點調劑台') existing = myRecordsData.find(r => r.loc === recInfo.loc && r.type === '盤點調劑台'); 
    else if (recInfo.type === '盤點庫存') existing = myRecordsData.find(r => r.code === recInfo.code && r.type === '盤點庫存'); 
    if (existing) { existing.qty = recInfo.qty; existing.handQty = recInfo.handQty; } 
    else { loadUserRecords(); return; } 
  }
  renderAllRecordLists();
}

export function updateOnlineUI() { document.querySelector('input[name="actionType"]:checked').value === '手動' ? (document.getElementById('area-manual').classList.remove('d-none'), document.getElementById('area-barcode').classList.add('d-none')) : (document.getElementById('area-manual').classList.add('d-none'), document.getElementById('area-barcode').classList.remove('d-none'), document.getElementById('online-barcode').focus()); }

export function switchMonthlyTab(tabId) {
  document.querySelectorAll('.monthly-content-section').forEach(s => s.classList.add('d-none'));
  document.getElementById(tabId).classList.remove('d-none');
  const tabsContainer = document.getElementById('monthly-tabs');
  if (tabsContainer) { tabsContainer.querySelectorAll('.nav-link').forEach(btn => { btn.classList.remove('active', 'bg-academic', 'text-white'); btn.classList.add('bg-white', 'text-academic'); }); }
  const activeBtnId = tabId.replace('tab-', 'btn-tab-'); const activeBtn = document.getElementById(activeBtnId);
  if (activeBtn) { activeBtn.classList.remove('bg-white', 'text-academic'); activeBtn.classList.add('active', 'bg-academic', 'text-white'); }
  
  if (tabId === 'tab-records') renderAllRecordLists();
  if (tabId === 'tab-dashboard') renderMonthlyDashboard();
}

export function switchStockSubTab(view) { const btnIn = document.getElementById('btn-stock-sub-input'), btnList = document.getElementById('btn-stock-sub-list'); btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; if (view === 'input') { btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; document.getElementById('area-stock-input').classList.remove('d-none'); document.getElementById('area-stock-list').classList.add('d-none'); } else { btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; document.getElementById('area-stock-input').classList.add('d-none'); document.getElementById('area-stock-list').classList.remove('d-none'); renderAllRecordLists(); } }
export function switchDeskSubTab(view) { const btnIn = document.getElementById('btn-desk-sub-input'), btnList = document.getElementById('btn-desk-sub-list'); btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; if (view === 'input') { btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; document.getElementById('area-desk-input').classList.remove('d-none'); document.getElementById('area-desk-list').classList.add('d-none'); } else { btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; document.getElementById('area-desk-input').classList.add('d-none'); document.getElementById('area-desk-list').classList.remove('d-none'); renderAllRecordLists(); } }
export function switchOnlineSubTab(view) { const btnIn = document.getElementById('btn-online-sub-input'), btnList = document.getElementById('btn-online-sub-list'); btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; if (view === 'input') { btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; document.getElementById('area-online-input').classList.remove('d-none'); document.getElementById('area-online-list').classList.add('d-none'); } else { btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; document.getElementById('area-online-input').classList.add('d-none'); document.getElementById('area-online-list').classList.remove('d-none'); renderAllRecordLists(); } }

export function selectStockDrug(priceCode) { const drug = monthlyDrugMaster.find(d => d.priceCode === priceCode); if (!drug) return; stockSelectedDrug = drug; document.getElementById('stock-dropdown').style.display = 'none'; document.getElementById('stock-drug-search').value = ''; document.getElementById('stock-sel-name').innerText = drug.name; document.getElementById('stock-sel-inv').innerText = drug.invCode; document.getElementById('stock-sel-price').innerText = drug.priceCode; document.getElementById('stock-selected-card').classList.remove('d-none'); document.getElementById('stock-qty').focus(); }
export function selectOnlineDrug(priceCode) { const drug = monthlyDrugMaster.find(d => d.priceCode === priceCode); if (!drug) return; onlineSelectedDrug = drug; document.getElementById('online-dropdown').style.display = 'none'; document.getElementById('online-drug-search').value = ''; document.getElementById('online-sel-name').innerText = drug.name; document.getElementById('online-sel-inv').innerText = drug.invCode; document.getElementById('online-selected-card').classList.remove('d-none'); document.getElementById('online-qty').focus(); }

export function handleStockSearch() { const kw = document.getElementById('stock-drug-search').value.toLowerCase().trim(); const dropdown = document.getElementById('stock-dropdown'); if (!kw) { dropdown.style.display = 'none'; return; } let filtered = monthlyDrugMaster.filter(d => { const pCode = (d.priceCode || '').toLowerCase(); const name = (d.name || '').toLowerCase(); const invCode = (d.invCode || '').toLowerCase(); return pCode.includes(kw) || name.includes(kw) || invCode.includes(kw); }); filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if ((d.priceCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.priceCode||'').toLowerCase().indexOf(kw)); if ((d.name||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.name||'').toLowerCase().indexOf(kw)); if ((d.invCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.invCode||'').toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); filtered = filtered.slice(0, 10); if (filtered.length > 0) { dropdown.innerHTML = filtered.map(d => `<div class="search-dropdown-item" onclick="selectStockDrug('${d.priceCode}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">批價: ${d.priceCode} | 加P: ${d.invCode}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">查無藥品</div>'; dropdown.style.display = 'block'; } }
export function handleOnlineSearch() { const kw = document.getElementById('online-drug-search').value.toLowerCase().trim(); const dropdown = document.getElementById('online-dropdown'); if (!kw) { dropdown.style.display = 'none'; return; } let filtered = monthlyDrugMaster.filter(d => { const pCode = (d.priceCode || '').toLowerCase(); const name = (d.name || '').toLowerCase(); const invCode = (d.invCode || '').toLowerCase(); return pCode.includes(kw) || name.includes(kw) || invCode.includes(kw); }); filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if ((d.priceCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.priceCode||'').toLowerCase().indexOf(kw)); if ((d.name||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.name||'').toLowerCase().indexOf(kw)); if ((d.invCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.invCode||'').toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); filtered = filtered.slice(0, 10); if (filtered.length > 0) { dropdown.innerHTML = filtered.map(d => `<div class="search-dropdown-item" onclick="selectOnlineDrug('${d.priceCode}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">批價: ${d.priceCode} | 加P: ${d.invCode}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">查無藥品</div>'; dropdown.style.display = 'block'; } }

export function handleTableSelectChange() { renderMonthlyDesk(); renderAllRecordLists(); }

export function renderMonthlyDesk() { 
  const tableId = document.getElementById('monthly-table-select').value; const area = document.getElementById('monthly-desk-area'); if (!tableId) { area.innerHTML = ''; return; } const tableData = monthlyTables.find(t => t.id === tableId); if (!tableData) return; const countedItems = tableData.items.filter(i => i.hasCounted); const uncountedItems = tableData.items.filter(i => !i.hasCounted); document.getElementById('count-desk-counted').innerText = countedItems.length; document.getElementById('count-desk-uncounted').innerText = uncountedItems.length; const renderList = document.getElementById('btn-desk-sub-input').classList.contains('active') ? uncountedItems : countedItems; if(renderList.length === 0) return area.innerHTML = '<div class="text-center p-4 text-muted fw-bold">此區無資料</div>'; const uniqueDrugs = []; tableData.items.forEach(item => { if (!uniqueDrugs.includes(item.drugCode)) uniqueDrugs.push(item.drugCode); }); const getDrugColor = (code) => { const index = uniqueDrugs.indexOf(code); return index % 2 === 0 ? 'var(--academic-primary)' : '#adb5bd'; }; let html = ''; 
  renderList.forEach(item => { 
    const borderColor = getDrugColor(item.drugCode); const btnClass = item.hasCounted ? 'btn-success' : 'btn-academic'; const btnText = item.hasCounted ? '更新覆蓋' : '確認送出';
    html += `<div class="card drug-card mb-3 shadow-sm border-0" style="border-left: 6px solid ${borderColor} !important;"><div class="card-body p-3"><div class="fw-bold fs-5 text-dark mb-2">${item.drugName}</div><div class="d-flex flex-wrap gap-1 mb-2"><span class="badge bg-light text-dark border border-secondary">儲位: ${item.locCode}</span><span class="badge bg-light text-dark border border-secondary">代碼: ${item.drugCode}</span></div><div class="input-group shadow-sm"><input type="number" id="m-qty-${item.locCode}" class="form-control form-control-lg bg-white fw-bold text-center border-secondary" placeholder="數量" inputmode="numeric" pattern="[0-9]*" value="${item.countedQty}"><button class="btn ${btnClass} px-4 fw-bold fs-5" onclick="submitMonthlyDeskOne('${item.locCode}', '${item.drugCode}', '${item.drugName}', '${item.tableId}')">${btnText}</button></div></div></div>`; 
  }); 
  area.innerHTML = html; 
}

export function submitMonthlyDeskOne(loc, dCode, dName, tId) {
  const inputEl = document.getElementById(`m-qty-${loc}`); const qty = inputEl.value; if(qty === '' || qty < 0) return alert('請輸入有效數量'); 
  const tableId = document.getElementById('monthly-table-select').value; const tableData = monthlyTables.find(t => t.id === tableId); if (!tableData) return; const item = tableData.items.find(i => i.locCode === loc); if (!item) return;
  
  const originalStatus = item.hasCounted; const originalQty = item.countedQty; 
  const originalUser = item.countedUser; const originalTime = item.countedTime;

  item.hasCounted = true; 
  item.countedQty = qty; 
  item.countedUser = session.name;
  item.countedTime = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  if (navigator.vibrate) navigator.vibrate(50);
  
  const card = inputEl.closest('.drug-card'); const isUncountedTab = document.getElementById('btn-desk-sub-input').classList.contains('active');
  const uncountedLength = tableData.items.filter(i => !i.hasCounted).length; document.getElementById('count-desk-counted').innerText = tableData.items.filter(i => i.hasCounted).length; document.getElementById('count-desk-uncounted').innerText = uncountedLength;
  
  if (card && isUncountedTab) { 
    card.style.display = 'none'; setTimeout(() => card.remove(), 10); 
    if (uncountedLength === 0) { document.getElementById('monthly-desk-area').innerHTML = '<div class="text-center p-4 text-muted fw-bold">此區無資料</div>'; } 
  } else { 
    const btn = inputEl.nextElementSibling; btn.innerText = "更新覆蓋"; btn.disabled = false; showToast('更新覆蓋成功！'); 
  }
  
  fetchBackend('submitInventory', { mode: '月盤點', userId: session.id, userName: session.name, type: '盤點調劑台', action: '', dispType: '', drugCode: dCode, drugName: dName, handQty: qty, tableId: tId, locCode: loc })
    .then((res) => { 
      if (res && res.success) { pushRecordLocally(res.resultRecord); } 
      else { showToast('寫入失敗: ' + (res.message || ''), 'error'); item.hasCounted = originalStatus; item.countedQty = originalQty; item.countedUser = originalUser; item.countedTime = originalTime; renderMonthlyDesk(); } 
    }).catch(err => { 
      showToast('網路連線錯誤', 'error'); item.hasCounted = originalStatus; item.countedQty = originalQty; item.countedUser = originalUser; item.countedTime = originalTime; renderMonthlyDesk(); 
    }); 
}

export function renderAllRecordLists() { let stockRecords = myRecordsData.filter(r => r.type === '盤點庫存'); document.getElementById('count-stock-counted').innerText = stockRecords.length; if (activeRecordFilters['stock']) stockRecords = stockRecords.filter(r => r.code === activeRecordFilters['stock']); document.getElementById('stock-records-area').innerHTML = generateRecordCards(stockRecords, '本月尚未輸入庫存盤點', true); const tId = document.getElementById('monthly-table-select').value; let deskRecords = myRecordsData.filter(r => r.type === '盤點調劑台' && r.tableId === tId); document.getElementById('count-desk-counted').innerText = deskRecords.length; if (activeRecordFilters['desk']) deskRecords = deskRecords.filter(r => r.code === activeRecordFilters['desk']); document.getElementById('desk-records-area').innerHTML = generateRecordCards(deskRecords, '本區本月尚無盤點紀錄', true); let onlineRecords = myRecordsData.filter(r => r.type === '線上調劑'); document.getElementById('count-online-counted').innerText = onlineRecords.length; if (activeRecordFilters['online']) onlineRecords = onlineRecords.filter(r => r.code === activeRecordFilters['online']); document.getElementById('online-records-area').innerHTML = generateRecordCards(onlineRecords, '本月尚無線上調劑紀錄', true); let allRecords = myRecordsData; document.getElementById('user-records-count').innerText = myRecordsData.length; if (activeRecordFilters['records']) allRecords = allRecords.filter(r => r.code === activeRecordFilters['records']); document.getElementById('user-records-area').innerHTML = generateRecordCards(allRecords, '此區尚無紀錄', false); }

// ✨ UI 卡片邏輯
export function generateRecordCards(recordsArray, emptyMsg, allowEdit) { 
  if (recordsArray.length === 0) return `<div class="text-center p-3 text-muted fw-bold">${emptyMsg}</div>`; 
  let html = ''; 
  recordsArray.forEach(record => { 
    const isVoid = record.status === '作廢';
    const cardStyle = isVoid ? "opacity: 0.6; filter: grayscale(100%);" : "";
    let qtyStr = record.handQty; let colorClass = 'text-primary'; let dispBadge = ''; 
    if (record.dispType === '調劑') { qtyStr = `-${record.handQty}`; colorClass = 'text-danger'; dispBadge = `<span class="badge bg-danger ms-1">調劑</span>`; } 
    else if (record.dispType === '退藥') { qtyStr = `+${record.handQty}`; colorClass = 'text-success'; dispBadge = `<span class="badge bg-success ms-1">退藥</span>`; } 
    
    const badgeHtml = isVoid ? `<span class="badge bg-secondary ms-1">已作廢</span>` : dispBadge;
    const locInfo = record.loc ? ` | 儲位: ${record.loc}` : ''; 
    
    const actionHtml = isVoid
      ? `<button class="btn btn-sm btn-outline-success py-0" onclick="toggleMonthlyRecordStatus('${record.sn}', '成立')">還原</button>`
      : `<button class="btn btn-sm btn-outline-primary py-0 me-1" onclick="editRecord('${record.sn}')">修改</button>
         <button class="btn btn-sm btn-outline-danger py-0" onclick="toggleMonthlyRecordStatus('${record.sn}', '作廢')">作廢</button>`;

    const editButtons = allowEdit ? `<div class="d-flex justify-content-between align-items-center mt-1 pt-1 border-top"><div class="fs-5 fw-bold ${isVoid ? 'text-muted text-decoration-line-through' : colorClass}">${qtyStr}</div><div>${actionHtml}</div></div>` : `<div class="fs-5 fw-bold ${isVoid ? 'text-muted text-decoration-line-through' : colorClass} mt-1 pt-1 border-top">${qtyStr}</div>`; 
    
    html += `<div class="card mb-2 shadow-sm border-0 border-start border-4 border-info" style="${cardStyle}"><div class="card-body p-2"><div class="d-flex justify-content-between mb-1"><div class="fw-bold text-dark text-truncate" style="max-width: 70%;">${record.name}</div><div class="small text-muted" style="font-size:0.75rem;">${record.time}</div></div><div class="small text-secondary" style="font-size:0.8rem;"><span class="badge bg-secondary">${record.type}</span>${badgeHtml}<span class="ms-1">代碼: ${record.code}${locInfo}</span></div>${editButtons}</div></div>`; 
  }); 
  return html; 
}

// ✨ 補上剛剛遺漏的 Filter 搜尋功能
export function handleRecordFilterSearch(tabKey) { const kw = document.getElementById(`filter-input-${tabKey}`).value.toLowerCase().trim(); const dropdown = document.getElementById(`filter-dropdown-${tabKey}`); let sourceData = []; if (tabKey === 'stock') sourceData = myRecordsData.filter(r => r.type === '盤點庫存'); else if (tabKey === 'desk') { const tId = document.getElementById('monthly-table-select').value; sourceData = myRecordsData.filter(r => r.type === '盤點調劑台' && r.tableId === tId); } else if (tabKey === 'online') sourceData = myRecordsData.filter(r => r.type === '線上調劑'); else if (tabKey === 'records') sourceData = myRecordsData; const uniqueDrugs = []; const seen = new Set(); sourceData.forEach(r => { if (!seen.has(r.code)) { seen.add(r.code); uniqueDrugs.push({ code: r.code, name: r.name }); } }); let filtered = kw ? uniqueDrugs.filter(d => d.code.toLowerCase().includes(kw) || d.name.toLowerCase().includes(kw)) : uniqueDrugs; if (kw && filtered.length > 0) { filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if (d.code.toLowerCase().indexOf(kw) !== -1) score = Math.min(score, d.code.toLowerCase().indexOf(kw)); if (d.name.toLowerCase().indexOf(kw) !== -1) score = Math.min(score, d.name.toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); } if (filtered.length > 0) { dropdown.innerHTML = filtered.slice(0, 10).map(d => `<div class="search-dropdown-item" onclick="applyRecordFilter('${tabKey}', '${d.code}', '${d.name.replace(/'/g, "\\'")}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">${d.code}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">清單中無相符藥品</div>'; dropdown.style.display = 'block'; } }
export function applyRecordFilter(tabKey, code, name) { activeRecordFilters[tabKey] = code; document.getElementById(`filter-input-${tabKey}`).value = `${name} (${code})`; document.getElementById(`filter-dropdown-${tabKey}`).style.display = 'none'; renderAllRecordLists(); }
export function clearRecordFilter(tabKey) { activeRecordFilters[tabKey] = null; document.getElementById(`filter-input-${tabKey}`).value = ''; document.getElementById(`filter-dropdown-${tabKey}`).style.display = 'none'; renderAllRecordLists(); }
document.addEventListener('click', function(e) { if (!e.target.closest('.position-relative')) { document.querySelectorAll('.search-dropdown').forEach(d => d.style.display = 'none'); } });

export function editRecord(sn) {
  const record = myRecordsData.find(r => r.sn === sn);
  if (!record) return;
  const newQty = prompt(`修改 [${record.name}] 數量:`, record.handQty);
  if (newQty === null || newQty === "") return;
  
  const oldQty = record.handQty;
  record.handQty = newQty; 
  renderAllRecordLists(); 
  
  // 🌟 [新增] 瞬間同步月盤點主表的數量
  monthlyTables.forEach(t => t.items.forEach(i => {
    if (i.drugCode === record.code && i.locCode === record.loc) i.countedQty = newQty;
  }));
  renderMonthlyDesk();

  fetchBackend('updateMonthlyRecord', { sn: sn, newQty: newQty, dispType: record.dispType, userId: session.id, userName: session.name })
    .then(res => {
      if (res.success) { showToast('修改成功'); refreshDashboardDataSilently(); } 
      else { record.handQty = oldQty; renderAllRecordLists(); showToast('修改失敗: ' + res.message, 'delete'); }
    }).catch(err => { record.handQty = oldQty; renderAllRecordLists(); showToast('網路連線異常，更新失敗', 'delete'); });
}

// 🌟 替換：作廢/還原 (同步將藥品退回未盤點)
export function toggleMonthlyRecordStatus(sn, newStatus) {
  if (newStatus === '作廢' && !confirm('確定要作廢此筆紀錄嗎？')) return;
  const record = myRecordsData.find(r => r.sn === sn);
  if (!record) return;

  const oldStatus = record.status;
  record.status = newStatus;
  renderAllRecordLists();

  // 🌟 [新增] 瞬間同步月盤點主表，若作廢就退回「未盤點」區
  monthlyTables.forEach(t => t.items.forEach(i => {
    if (i.drugCode === record.code && i.locCode === record.loc) {
      i.hasCounted = (newStatus === '成立');
    }
  }));
  renderMonthlyDesk();

  fetchBackend('modifyMonthlyRecordStatus', { sn: sn, newStatus: newStatus, userId: session.id, userName: session.name })
    .then(res => {
      if (res.success) {
        showToast(newStatus === '作廢' ? '紀錄已作廢' : '紀錄已還原', newStatus === '作廢' ? 'delete' : 'success');
        refreshDashboardDataSilently();
      } else {
        record.status = oldStatus; renderAllRecordLists();
        showToast('更新失敗: ' + res.message, 'delete');
      }
    }).catch(err => {
      record.status = oldStatus; renderAllRecordLists();
      showToast('網路連線異常，更新失敗', 'delete');
    });
}

// 🌟 [新增] 手動全局更新月盤點資料 (請加在 monthly.js 檔案最底部)
export function refreshMonthlyData() {
  toggleLoader(true);
  fetchBackend('getMonthlyInitData').then(res => {
    monthlyDrugMaster = res.drugMaster;
    monthlyTables = res.tables;
    loadUserRecords(() => {
      renderMonthlyDesk();
      renderMonthlyDashboard();
      toggleLoader(false);
      showToast('資料已同步至最新');
    });
  }).catch(err => { toggleLoader(false); alert("更新失敗"); });
}

// ==========================================
// ✨ 進度看板專屬功能
// ==========================================
export function refreshDashboardData() {
  toggleLoader(true);
  fetchBackend('getMonthlyInitData').then(res => {
    monthlyTables = res.tables;
    renderMonthlyDashboard();
    toggleLoader(false);
    showToast('進度已同步更新'); 
  }).catch(err => { toggleLoader(false); alert("更新失敗"); });
}

export function refreshDashboardDataSilently() {
  fetchBackend('getMonthlyInitData').then(res => {
    monthlyTables = res.tables;
    renderMonthlyDashboard();
  }).catch(e => console.warn('背景更新進度失敗'));
}

// ✨ 2. 修改看板：將整張卡片變成點擊進入盤點
export function renderMonthlyDashboard() {
  const unfinishedArea = document.getElementById('dashboard-unfinished');
  const finishedArea = document.getElementById('dashboard-finished');
  if(!unfinishedArea || !finishedArea) return;

  let unfinishedHtml = ''; let finishedHtml = '';
  monthlyTables.forEach(table => {
    const total = table.items.length;
    const counted = table.items.filter(i => i.hasCounted).length;
    const percent = total > 0 ? Math.round((counted / total) * 100) : 0;
    const isComplete = percent === 100;
    
    const cardHtml = `
      <div class="card mb-3 shadow-sm border-0 border-start border-4 ${isComplete ? 'border-success' : 'border-warning'}" 
           onclick="enterTableInventory('${table.id}', '${table.name}')" style="cursor: pointer;">
        <div class="card-body p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="fw-bold text-dark fs-5">${table.name}</div>
            <span class="badge ${isComplete ? 'bg-success' : 'bg-academic'}">${percent}%</span>
          </div>
          <div class="progress mb-2" style="height: 12px;"><div class="progress-bar ${isComplete ? 'bg-success' : 'bg-warning'}" style="width: ${percent}%"></div></div>
          <div class="d-flex justify-content-between align-items-center">
            <div class="small text-secondary">已盤: ${counted} / ${total}</div>
            <div class="text-academic fw-bold small">點擊作業 <i class="bi bi-chevron-right"></i></div>
          </div>
        </div>
      </div>`;
    if (isComplete) finishedHtml += cardHtml; else unfinishedHtml += cardHtml;
  });
  unfinishedArea.innerHTML = unfinishedHtml || '<div class="text-center text-muted py-3">所有藥架皆已盤點完成</div>';
  finishedArea.innerHTML = finishedHtml || '<div class="text-center text-muted py-3">尚無完成的藥架</div>';
}

// ✨ 3. 新增入口功能：點選看板後跳轉
export function enterTableInventory(tableId, tableName) {
  const select = document.getElementById('monthly-table-select');
  if (select) {
    select.value = tableId;
    handleTableSelectChange(); 
  }
  document.getElementById('monthly-app-title').innerText = tableName;
  document.getElementById('monthly-tabs').classList.add('d-none'); // 隱藏導覽列
  document.getElementById('btn-monthly-back').classList.remove('d-none'); // 顯示返回鈕

  document.querySelectorAll('.monthly-content-section').forEach(s => s.classList.add('d-none'));
  document.getElementById('tab-dispense').classList.remove('d-none');
  window.scrollTo(0,0);
}

// ✨ 4. 新增返回功能：處理標題列的返回鈕
export function handleMonthlyBack() {
  const tabs = document.getElementById('monthly-tabs');
  if (tabs.classList.contains('d-none')) {
    tabs.classList.remove('d-none');
    document.getElementById('btn-monthly-back').classList.add('d-none');
    document.getElementById('monthly-app-title').innerHTML = '<i class="bi bi-calendar-month"></i> 月盤點作業';
    switchMonthlyTab('tab-dashboard');
    refreshDashboardData(); 
  } else {
    switchView('view-mode-select');
  }
}

export function showTableDetailModal(tableId, tableName) {
  const table = monthlyTables.find(t => t.id === tableId);
  if (!table) return;

  document.getElementById('modal-drug-name').innerText = `【${tableName}】儲位明細`;
  const headers = ["儲位碼", "代碼", "藥名", "數量", "人員", "時間", "狀態"];
  document.getElementById('modal-thead').innerHTML = `<tr>${headers.map(h => `<th class="py-2 text-nowrap">${h}</th>`).join('')}</tr>`;

  const tbodyHtml = table.items.map(item => {
    const record = myRecordsData.find(r => r.code === item.drugCode && r.loc === item.locCode);
    const userName = item.hasCounted ? (item.countedUser || (record ? record.user : '系統')) : '-';
    const timeStr = item.hasCounted ? (item.countedTime || (record ? record.time : '-')) : '-';
    const qtyStr = item.hasCounted ? (record ? record.handQty : (item.countedQty || '已盤')) : '-';

    return `
      <tr class="${item.hasCounted ? 'table-success-light' : ''}">
        <td class="text-center fw-bold">${item.locCode}</td>
        <td class="text-center">${item.drugCode}</td>
        <td class="text-start text-truncate" style="max-width:150px;">${item.drugName}</td>
        <td class="text-center fw-bold text-academic">${qtyStr}</td>
        <td class="text-center">${userName}</td>
        <td class="text-center small text-secondary">${timeStr}</td>
        <td class="text-center">${item.hasCounted ? '✅' : '❌'}</td>
      </tr>`;
  }).join('');

  document.getElementById('modal-tbody').innerHTML = tbodyHtml;
  new window.bootstrap.Modal(document.getElementById('detailsModal')).show();
}
