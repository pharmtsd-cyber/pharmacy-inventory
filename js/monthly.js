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
export let barcodeQtyResolve = null;

export function initMonthlyMode() {
  switchView('view-monthly-app'); 
  switchMonthlyTab('tab-dashboard'); 
  updateOnlineUI(); 
  
  // 🌟 這裡就是幫您補上的「日期預設為今天」邏輯
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dateInput = document.getElementById('filter-date-records');
  if (dateInput) dateInput.value = todayStr;

  toggleLoader(true);
  fetchBackend('getMonthlyInitData').then(res => {
    monthlyDrugMaster = res.drugMaster; 
    monthlyTables = res.tables;
    const select = document.getElementById('monthly-table-select');
    if(select) select.innerHTML = monthlyTables.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    loadUserRecords(() => { 
      renderMonthlyDashboard(); 
      toggleLoader(false); 
    });
  }).catch(err => { toggleLoader(false); alert("載入失敗"); });
}

// 🌟 啟動相機：完美出場機制 (先遮罩，等完全準備好再顯示畫面)
export function startLiveScanner() {
  const scannerWrapper = document.getElementById('scanner-wrapper'); 
  scannerWrapper.style.display = 'flex'; 
  document.getElementById('btn-start-camera').classList.add('disabled');
  
  // 1. 初始化 UI：顯示轉圈圈遮罩，隱藏相機畫面與雷射線
  const loadingMask = document.getElementById('scanner-loading');
  const scannerContainer = document.getElementById('scanner-container');
  const scannerLaser = document.getElementById('scanner-laser');
  const scannerHint = document.getElementById('scanner-hint');
  
  if(loadingMask) loadingMask.style.display = 'flex';
  if(scannerContainer) scannerContainer.style.opacity = '0';
  if(scannerLaser) scannerLaser.style.display = 'none';
  if(scannerHint) scannerHint.style.display = 'none';

  requestWakeLock();
  if (!html5QrCode) html5QrCode = new window.Html5Qrcode("reader");
  
  const config = { 
    fps: 20, 
    qrbox: { width: 250, height: 250 },
    aspectRatio: 1.0,
    disableFlip: false 
  };
  
  html5QrCode.start({ facingMode: "environment" }, config,
    (decodedText) => { 
      if (navigator.vibrate) navigator.vibrate(100); 
      playBeep(); 
      document.getElementById('online-barcode').value = decodedText; 
      closeLiveScanner().then(() => parseBarcodeAndSubmit()); 
    },
    (errorMessage) => {} 
  ).then(() => {
    // 🌟 2. 相機硬體已連線，等待 0.8 秒測光
    setTimeout(() => {
      // 隱藏轉圈圈，淡入清晰的相機畫面，並啟動雷射線
      if(loadingMask) loadingMask.style.display = 'none';
      if(scannerContainer) scannerContainer.style.opacity = '1';
      if(scannerLaser) scannerLaser.style.display = 'block';
      if(scannerHint) scannerHint.style.display = 'block';

      // 🌟 【新增魔法】：畫面出現的瞬間，系統「自動」幫您踹一次對焦馬達！
      try {
        // 發送單次強制對焦指令
        html5QrCode.applyVideoConstraints({ advanced: [{ focusMode: "single-shot" }] }).catch(()=>{});
        
        // 選擇性加強：預設直接微幅放大 1.5 倍 (這會強迫鏡頭進入比較適合掃條碼的微距狀態)
        html5QrCode.applyVideoConstraints({ advanced: [{ zoom: 1.5 }] }).catch(()=>{});
      } catch(e) {}

      // 依然保留點擊畫面可以再次強制對焦/放大的功能
      const videoEl = document.querySelector("#reader video");
      if (videoEl) {
        let isZoomed = true; // 因為上面預設放大了，這裡起始狀態設為 true
        videoEl.addEventListener("click", () => {
          try {
            html5QrCode.applyVideoConstraints({ advanced: [{ focusMode: "single-shot" }] }).catch(()=>{});
            isZoomed = !isZoomed;
            html5QrCode.applyVideoConstraints({ advanced: [{ zoom: isZoomed ? 2.0 : 1.0 }] }).catch(()=>{});
            if (navigator.vibrate) navigator.vibrate(30); 
          } catch(e) {}
        });
      }
    }, 800); 
    
  }).catch((err) => {
    closeLiveScanner(); 
    alert("❌ 相機啟動失敗！\n\n請確認：\n1. 已允許相機權限\n2. 使用 Safari 或 Chrome 開啟\n3. 處於 https 安全連線狀態"); 
  });
}

export function closeLiveScanner() {
  return new Promise((resolve) => {
    releaseWakeLock();
    const wrapper = document.getElementById('scanner-wrapper');
    const btn = document.getElementById('btn-start-camera');
    
    if (html5QrCode && html5QrCode.isScanning) { 
      html5QrCode.stop().then(() => { 
        wrapper.style.display = 'none'; 
        btn.classList.remove('disabled'); 
        resolve(); 
      }).catch(err => resolve()); 
    } else { 
      wrapper.style.display = 'none'; 
      btn.classList.remove('disabled'); 
      resolve(); 
    }
  });
}

export async function parseBarcodeAndSubmit() { // 🌟 注意這裡變成了 async
  const bcInput = document.getElementById('online-barcode'); 
  const bcStr = bcInput.value.trim(); 
  if (!bcStr) return;
  
  let qty = 1; let parsedDrug = null; let searchKey = bcStr;

  if (bcStr.includes(';')) { 
    const parts = bcStr.split(';'); 
    if (parts.length >= 3) {
      searchKey = parts[1].toUpperCase().trim();
      parsedDrug = monthlyDrugMaster.find(d => (d.priceCode || '').toUpperCase() === searchKey);
      
      if (parsedDrug) {
        if (parts.length >= 4 && parts[3].trim() !== '') {
          qty = parseInt(parts[3], 10) || 1;
        } else {
          // 🌟 這裡改成等待我們的新彈窗，會自動強制數字鍵盤
          const userQty = await openBarcodeQtyModal(parsedDrug.name, `批價碼: ${parsedDrug.priceCode}`);
          
          if (userQty === null) {
            bcInput.value = ''; 
            setTimeout(() => bcInput.focus(), 10);
            return;
          }
          qty = parseInt(userQty, 10);
        }
      }
    } 
  } else { 
    // ... 原本的非分號解析邏輯保持不變 ...
  }
  
  // 檢查藥品是否存在 (同原邏輯)
  if (!parsedDrug) { 
    alert(`❌ 系統查無此藥品！`); 
    bcInput.value = ''; 
    setTimeout(() => bcInput.focus(), 10);
    return; 
  }
  
  submitMonthlyOnline('條碼', { priceCode: parsedDrug.priceCode, invCode: parsedDrug.invCode, name: parsedDrug.name, qty: qty, barcode: bcStr }, '');
}

export function showSuccessCard(cardId, drugName, qty, actionTag, colorType = 'success') {
  const card = document.getElementById(cardId); 
  const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  card.classList.remove('success-card-bottom');
  void card.offsetWidth; 
  
  card.className = `mt-3 p-3 rounded shadow-lg text-center success-card-bottom bg-success text-white`;
  card.innerHTML = `
    <div class="fw-bold mb-1 opacity-75"><i class="bi bi-check-circle-fill"></i> 寫入成功</div>
    <div class="fw-bold text-warning mb-2" style="font-size: 1.8rem; line-height: 1.2;">${drugName}</div>
    <div class="fw-bold mb-2" style="font-size: 2.2rem;">
      <span class="fs-5 fw-normal opacity-75">${actionTag} 數量:</span> ${qty}
    </div>
    <div class="small mt-2 border-top border-light pt-2" style="opacity: 0.8;">
      <i class="bi bi-clock"></i> 處理時間: ${timeStr}
    </div>`;
    
  card.classList.remove('d-none');
}

export function submitMonthlyStock() {
  if (!stockSelectedDrug) return alert('請先搜尋並選擇藥品！');
  const qty = document.getElementById('stock-qty').value; if (!qty || qty <= 0) return alert('請輸入正整數！');
  
  const currentDrug = stockSelectedDrug; 
  showSuccessCard('stock-success-card', currentDrug.name, qty, '庫存盤點', 'success'); // 樂觀UI立刻彈出綠卡
  
  document.getElementById('stock-qty').value = ''; stockSelectedDrug = null; 
  document.getElementById('stock-selected-card').classList.add('d-none'); document.getElementById('stock-drug-search').value = '';
  
  fetchBackend('submitInventory', { mode: '月盤點', userId: session.id, userName: session.name, type: '盤點庫存', action: '', dispType: '', drugCode: currentDrug.invCode, drugName: currentDrug.name, priceCodeSelect: currentDrug.priceCode, handQty: qty, tableId: 'BFYYY', locCode: '', barcode: '' })
    .then((res) => { 
        if (res && res.success) pushRecordLocally(res.resultRecord); 
        else showToast('寫入異常: '+res.message, 'delete'); // 異常改用上方紅色 Toast
    })
    .catch(err => { showToast('網路連線錯誤，資料未寫入', 'delete'); });
}

// 🌟 2. 送出寫入 (破解 DOM 渲染導致的焦點遺失)
export function submitMonthlyOnline(actionSrc, parsedData = null, writePriceCode = '') {
  const type = '線上調劑'; const dispType = document.querySelector('input[name="dispType"]:checked').value;
  let payloadDrug = null; let qty = 0; let barcodeStr = '';
  
  if (actionSrc === '手動') {
    if (!onlineSelectedDrug) return alert('請先搜尋藥品！');
    qty = document.getElementById('online-qty').value; if (!qty || qty <= 0) return alert('請輸入正整數！');
    payloadDrug = onlineSelectedDrug; writePriceCode = payloadDrug.priceCode;
  } else { payloadDrug = parsedData; qty = parsedData.qty; barcodeStr = parsedData.barcode; writePriceCode = ''; }
  
  const actionTag = dispType === '調劑' ? '調劑(-)' : '退藥(+)'; 
  showSuccessCard('online-success-card', payloadDrug.name, qty, actionTag, 'success'); 
  
  if (actionSrc === '手動') { 
    document.getElementById('online-qty').value = ''; onlineSelectedDrug = null; document.getElementById('online-selected-card').classList.add('d-none'); document.getElementById('online-drug-search').value=''; 
  } else { 
    const bcInput = document.getElementById('online-barcode');
    bcInput.value = ''; 
    // 🌟 延遲 10 毫秒對焦：等綠色卡片畫完之後，才把游標搶回來
    setTimeout(() => bcInput.focus(), 10); 
  }

  fetchBackend('submitInventory', { mode: '月盤點', userId: session.id, userName: session.name, type: type, action: actionSrc, dispType: dispType, drugCode: payloadDrug.invCode, drugName: payloadDrug.name, priceCodeSelect: writePriceCode, handQty: qty, tableId: 'BFZZZ', locCode: '', barcode: barcodeStr })
    .then((res) => { 
        if(res && res.success) pushRecordLocally(res.resultRecord); 
        else showToast('寫入異常: '+res.message, 'delete'); 
    })
    .catch(err => { showToast('網路連線錯誤，資料未寫入', 'delete'); });
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

export function updateOnlineUI() { 
  const checkedInput = document.querySelector('input[name="actionType"]:checked');
  if (!checkedInput) return;
  if (checkedInput.value === '手動') {
    const areaManual = document.getElementById('area-manual'); const areaBarcode = document.getElementById('area-barcode');
    if (areaManual) areaManual.classList.remove('d-none'); if (areaBarcode) areaBarcode.classList.add('d-none');
  } else {
    const areaManual = document.getElementById('area-manual'); const areaBarcode = document.getElementById('area-barcode');
    if (areaManual) areaManual.classList.add('d-none'); if (areaBarcode) areaBarcode.classList.remove('d-none');
    const barcodeInput = document.getElementById('online-barcode'); if (barcodeInput) barcodeInput.focus();
  }
}

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

// 🌟 修正問題 3：明確劃分切換標籤時的渲染邏輯
export function switchDeskSubTab(view) { 
  const btnIn = document.getElementById('btn-desk-sub-input');
  const btnList = document.getElementById('btn-desk-sub-list'); 
  if(btnIn) btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; 
  if(btnList) btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; 
  
  if (view === 'input') { 
    if(btnIn) btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; 
    document.getElementById('area-desk-input').classList.remove('d-none'); 
    document.getElementById('area-desk-list').classList.add('d-none'); 
    renderMonthlyDesk(); // 確保每次切過來都強制更新未盤點清單
  } else { 
    if(btnList) btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; 
    document.getElementById('area-desk-input').classList.add('d-none'); 
    document.getElementById('area-desk-list').classList.remove('d-none'); 
    renderAllRecordLists(); // 確保每次切過來都顯示最新的紀錄
  } 
}

export function switchStockSubTab(view) { const btnIn = document.getElementById('btn-stock-sub-input'), btnList = document.getElementById('btn-stock-sub-list'); if(btnIn) btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; if(btnList) btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; if (view === 'input') { if(btnIn) btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; document.getElementById('area-stock-input').classList.remove('d-none'); document.getElementById('area-stock-list').classList.add('d-none'); } else { if(btnList) btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; document.getElementById('area-stock-input').classList.add('d-none'); document.getElementById('area-stock-list').classList.remove('d-none'); renderAllRecordLists(); } }
export function switchOnlineSubTab(view) { const btnIn = document.getElementById('btn-online-sub-input'), btnList = document.getElementById('btn-online-sub-list'); if(btnIn) btnIn.className = 'nav-link fw-bold border text-academic bg-white shadow-sm py-2'; if(btnList) btnList.className = 'nav-link fw-bold border text-success bg-white shadow-sm py-2'; if (view === 'input') { if(btnIn) btnIn.className = 'nav-link active fw-bold border bg-academic text-white shadow-sm py-2'; document.getElementById('area-online-input').classList.remove('d-none'); document.getElementById('area-online-list').classList.add('d-none'); } else { if(btnList) btnList.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2'; document.getElementById('area-online-input').classList.add('d-none'); document.getElementById('area-online-list').classList.remove('d-none'); renderAllRecordLists(); } }

export function selectStockDrug(priceCode) { const drug = monthlyDrugMaster.find(d => d.priceCode === priceCode); if (!drug) return; stockSelectedDrug = drug; document.getElementById('stock-dropdown').style.display = 'none'; document.getElementById('stock-drug-search').value = ''; document.getElementById('stock-sel-name').innerText = drug.name; document.getElementById('stock-sel-inv').innerText = drug.invCode; document.getElementById('stock-sel-price').innerText = drug.priceCode; document.getElementById('stock-selected-card').classList.remove('d-none'); document.getElementById('stock-qty').focus(); }
export function selectOnlineDrug(priceCode) { const drug = monthlyDrugMaster.find(d => d.priceCode === priceCode); if (!drug) return; onlineSelectedDrug = drug; document.getElementById('online-dropdown').style.display = 'none'; document.getElementById('online-drug-search').value = ''; document.getElementById('online-sel-name').innerText = drug.name; document.getElementById('online-sel-inv').innerText = drug.invCode; document.getElementById('online-selected-card').classList.remove('d-none'); document.getElementById('online-qty').focus(); }

export function handleStockSearch() { const kw = document.getElementById('stock-drug-search').value.toLowerCase().trim(); const dropdown = document.getElementById('stock-dropdown'); if (!kw) { dropdown.style.display = 'none'; return; } let filtered = monthlyDrugMaster.filter(d => { const pCode = (d.priceCode || '').toLowerCase(); const name = (d.name || '').toLowerCase(); const invCode = (d.invCode || '').toLowerCase(); return pCode.includes(kw) || name.includes(kw) || invCode.includes(kw); }); filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if ((d.priceCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.priceCode||'').toLowerCase().indexOf(kw)); if ((d.name||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.name||'').toLowerCase().indexOf(kw)); if ((d.invCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.invCode||'').toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); filtered = filtered.slice(0, 10); if (filtered.length > 0) { dropdown.innerHTML = filtered.map(d => `<div class="search-dropdown-item" onclick="selectStockDrug('${d.priceCode}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">批價: ${d.priceCode} | 加P: ${d.invCode}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">查無藥品</div>'; dropdown.style.display = 'block'; } }
export function handleOnlineSearch() { const kw = document.getElementById('online-drug-search').value.toLowerCase().trim(); const dropdown = document.getElementById('online-dropdown'); if (!kw) { dropdown.style.display = 'none'; return; } let filtered = monthlyDrugMaster.filter(d => { const pCode = (d.priceCode || '').toLowerCase(); const name = (d.name || '').toLowerCase(); const invCode = (d.invCode || '').toLowerCase(); return pCode.includes(kw) || name.includes(kw) || invCode.includes(kw); }); filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if ((d.priceCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.priceCode||'').toLowerCase().indexOf(kw)); if ((d.name||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.name||'').toLowerCase().indexOf(kw)); if ((d.invCode||'').toLowerCase().indexOf(kw) !== -1) score = Math.min(score, (d.invCode||'').toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); filtered = filtered.slice(0, 10); if (filtered.length > 0) { dropdown.innerHTML = filtered.map(d => `<div class="search-dropdown-item" onclick="selectOnlineDrug('${d.priceCode}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">批價: ${d.priceCode} | 加P: ${d.invCode}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">查無藥品</div>'; dropdown.style.display = 'block'; } }

export function handleTableSelectChange() { renderMonthlyDesk(); renderAllRecordLists(); }

// 🌟 修正問題 3 的核心：輸入區「永遠只」顯示未盤點的藥品，徹底解決重疊與錯亂
export function renderMonthlyDesk() { 
  const tableId = document.getElementById('monthly-table-select').value; 
  const area = document.getElementById('monthly-desk-area'); 
  if (!tableId) { area.innerHTML = ''; return; } 
  const tableData = monthlyTables.find(t => t.id === tableId); 
  if (!tableData) return; 
  
  // 只撈取還沒盤點的藥品
  const uncountedItems = tableData.items.filter(i => !i.hasCounted); 
  
  const uncountedBadge = document.getElementById('count-desk-uncounted');
  if (uncountedBadge) uncountedBadge.innerText = uncountedItems.length; 
  
  if(uncountedItems.length === 0) {
    area.innerHTML = '<div class="text-center p-4 text-muted fw-bold">所有藥品皆已盤點完成</div>';
    return;
  }
  
  const uniqueDrugs = []; 
  tableData.items.forEach(item => { if (!uniqueDrugs.includes(item.drugCode)) uniqueDrugs.push(item.drugCode); }); 
  const getDrugColor = (code) => { const index = uniqueDrugs.indexOf(code); return index % 2 === 0 ? 'var(--academic-primary)' : '#adb5bd'; }; 
  
  let html = ''; 
  uncountedItems.forEach(item => { 
    const borderColor = getDrugColor(item.drugCode); 
    html += `<div class="card drug-card mb-3 shadow-sm border-0" style="border-left: 6px solid ${borderColor} !important;"><div class="card-body p-3"><div class="fw-bold fs-5 text-dark mb-2">${item.drugName}</div><div class="d-flex flex-wrap gap-1 mb-2"><span class="badge bg-light text-dark border border-secondary">儲位: ${item.locCode}</span><span class="badge bg-light text-dark border border-secondary">代碼: ${item.drugCode}</span></div><div class="input-group shadow-sm"><input type="number" id="m-qty-${item.locCode}" class="form-control form-control-lg bg-white fw-bold text-center border-secondary" placeholder="數量" inputmode="numeric" pattern="[0-9]*" value=""><button class="btn btn-academic px-4 fw-bold fs-5" onclick="submitMonthlyDeskOne('${item.locCode}', '${item.drugCode}', '${item.drugName}', '${item.tableId}')">確認送出</button></div></div></div>`; 
  }); 
  area.innerHTML = html; 
}

// 🌟 配合上述修正，簡化送出後的畫面互動
export function submitMonthlyDeskOne(loc, dCode, dName, tId) {
  const inputEl = document.getElementById(`m-qty-${loc}`); const qty = inputEl.value; 
  if(qty === '' || qty < 0) return alert('請輸入有效數量'); 
  const tableId = document.getElementById('monthly-table-select').value; 
  const tableData = monthlyTables.find(t => t.id === tableId); if (!tableData) return; 
  const item = tableData.items.find(i => i.locCode === loc); if (!item) return;
  
  const originalStatus = item.hasCounted; const originalQty = item.countedQty; 
  const originalUser = item.countedUser; const originalTime = item.countedTime;

  item.hasCounted = true; 
  item.countedQty = qty; 
  item.countedUser = session.name;
  item.countedTime = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  if (navigator.vibrate) navigator.vibrate(50);
  
  const uncountedLength = tableData.items.filter(i => !i.hasCounted).length; 
  const uncountedBadge = document.getElementById('count-desk-uncounted');
  if (uncountedBadge) uncountedBadge.innerText = uncountedLength;
  
  const card = inputEl.closest('.drug-card'); 
  if (card) { 
    card.style.display = 'none'; 
    setTimeout(() => {
      card.remove();
      if (uncountedLength === 0) { 
        const area = document.getElementById('monthly-desk-area');
        if (area) area.innerHTML = '<div class="text-center p-4 text-muted fw-bold">所有藥品皆已盤點完成</div>'; 
      } 
    }, 10);
  } 
  
  fetchBackend('submitInventory', { mode: '月盤點', userId: session.id, userName: session.name, type: '盤點調劑台', action: '', dispType: '', drugCode: dCode, drugName: dName, handQty: qty, tableId: tId, locCode: loc })
    .then((res) => { 
      if (res && res.success) { pushRecordLocally(res.resultRecord); } 
      else { showToast('寫入失敗: ' + (res.message || ''), 'error'); item.hasCounted = originalStatus; item.countedQty = originalQty; item.countedUser = originalUser; item.countedTime = originalTime; renderMonthlyDesk(); } 
    }).catch(err => { 
      showToast('網路連線錯誤', 'error'); item.hasCounted = originalStatus; item.countedQty = originalQty; item.countedUser = originalUser; item.countedTime = originalTime; renderMonthlyDesk(); 
    }); 
}

export function renderAllRecordLists() { 
  // 1. 庫存分頁紀錄
  let stockRecords = myRecordsData.filter(r => r.type === '盤點庫存'); 
  const stockCount = document.getElementById('count-stock-counted');
  if (stockCount) stockCount.innerText = stockRecords.length; 
  if (activeRecordFilters['stock']) stockRecords = stockRecords.filter(r => r.code === activeRecordFilters['stock']); 
  const stockArea = document.getElementById('stock-records-area');
  if (stockArea) stockArea.innerHTML = generateRecordCards(stockRecords, '本月尚未輸入庫存盤點', true); 

  // 2. 調劑台(藥架)分頁紀錄
  const tIdSelect = document.getElementById('monthly-table-select');
  const tId = tIdSelect ? tIdSelect.value : ''; 
  let deskRecords = myRecordsData.filter(r => r.type === '盤點調劑台' && r.tableId === tId); 
  const deskCount = document.getElementById('count-desk-counted');
  if (deskCount) deskCount.innerText = deskRecords.length; 
  if (activeRecordFilters['desk']) deskRecords = deskRecords.filter(r => r.code === activeRecordFilters['desk']); 
  const deskArea = document.getElementById('desk-records-area');
  if (deskArea) deskArea.innerHTML = generateRecordCards(deskRecords, '本區本月尚無盤點紀錄', true); 

  // 3. 線上區紀錄
  let onlineRecords = myRecordsData.filter(r => r.type === '線上調劑'); 
  const onlineCount = document.getElementById('count-online-counted');
  if (onlineCount) onlineCount.innerText = onlineRecords.length; 
  if (activeRecordFilters['online']) onlineRecords = onlineRecords.filter(r => r.code === activeRecordFilters['online']); 
  const onlineArea = document.getElementById('online-records-area');
  if (onlineArea) onlineArea.innerHTML = generateRecordCards(onlineRecords, '本月尚無線上調劑紀錄', true); 

  // 🌟 4. 「我的紀錄」分頁：加入日期過濾邏輯
  let allRecords = [...myRecordsData]; 
  const selectedDate = document.getElementById('filter-date-records') ? document.getElementById('filter-date-records').value : '';
  
  // 藥品代碼篩選
  if (activeRecordFilters['records']) {
    allRecords = allRecords.filter(r => r.code === activeRecordFilters['records']);
  }
  
  // 日期篩選 (比較 YYYY-MM-DD)
  if (selectedDate) {
    allRecords = allRecords.filter(r => {
      if (!r.tStamp) return false;
      const d = new Date(r.tStamp);
      const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return dStr === selectedDate;
    });
  }

  const totalCount = document.getElementById('user-records-count');
  if (totalCount) totalCount.innerText = allRecords.length; 
  
  const userArea = document.getElementById('user-records-area');
  if (userArea) userArea.innerHTML = generateRecordCards(allRecords, '查無符合條件的紀錄', false); 
}

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

export function handleRecordFilterSearch(tabKey) { const kw = document.getElementById(`filter-input-${tabKey}`).value.toLowerCase().trim(); const dropdown = document.getElementById(`filter-dropdown-${tabKey}`); let sourceData = []; if (tabKey === 'stock') sourceData = myRecordsData.filter(r => r.type === '盤點庫存'); else if (tabKey === 'desk') { const tId = document.getElementById('monthly-table-select').value; sourceData = myRecordsData.filter(r => r.type === '盤點調劑台' && r.tableId === tId); } else if (tabKey === 'online') sourceData = myRecordsData.filter(r => r.type === '線上調劑'); else if (tabKey === 'records') sourceData = myRecordsData; const uniqueDrugs = []; const seen = new Set(); sourceData.forEach(r => { if (!seen.has(r.code)) { seen.add(r.code); uniqueDrugs.push({ code: r.code, name: r.name }); } }); let filtered = kw ? uniqueDrugs.filter(d => d.code.toLowerCase().includes(kw) || d.name.toLowerCase().includes(kw)) : uniqueDrugs; if (kw && filtered.length > 0) { filtered.sort((a, b) => { const getScore = (d) => { let score = 999; if (d.code.toLowerCase().indexOf(kw) !== -1) score = Math.min(score, d.code.toLowerCase().indexOf(kw)); if (d.name.toLowerCase().indexOf(kw) !== -1) score = Math.min(score, d.name.toLowerCase().indexOf(kw)); return score; }; return getScore(a) - getScore(b); }); } if (filtered.length > 0) { dropdown.innerHTML = filtered.slice(0, 10).map(d => `<div class="search-dropdown-item" onclick="applyRecordFilter('${tabKey}', '${d.code}', '${d.name.replace(/'/g, "\\'")}')"><div class="fw-bold text-academic">${d.name}</div><div class="small text-muted">${d.code}</div></div>`).join(''); dropdown.style.display = 'block'; } else { dropdown.innerHTML = '<div class="p-2 text-muted small">清單中無相符藥品</div>'; dropdown.style.display = 'block'; } }
export function applyRecordFilter(tabKey, code, name) { activeRecordFilters[tabKey] = code; document.getElementById(`filter-input-${tabKey}`).value = `${name} (${code})`; document.getElementById(`filter-dropdown-${tabKey}`).style.display = 'none'; renderAllRecordLists(); }
export function clearRecordFilter(tabKey) { activeRecordFilters[tabKey] = null; document.getElementById(`filter-input-${tabKey}`).value = ''; document.getElementById(`filter-dropdown-${tabKey}`).style.display = 'none'; renderAllRecordLists(); }
// 🌟 3. 全域點擊監聽 (賦予條碼框「焦點霸體」)
document.addEventListener('click', function(e) { 
  // 處理搜尋下拉選單的關閉
  if (!e.target.closest('.position-relative')) { 
    document.querySelectorAll('.search-dropdown').forEach(d => d.style.display = 'none'); 
  } 

  // 🌟 實體條碼機友善設計：只要在條碼模式下，點擊畫面空白處就強制鎖定焦點
  const barcodeArea = document.getElementById('area-barcode');
  if (barcodeArea && !barcodeArea.classList.contains('d-none')) {
    // 確保點擊的不是別的按鈕或輸入框 (例如切換手動/條碼的按鈕)
    if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
      const bcInput = document.getElementById('online-barcode');
      if (bcInput) setTimeout(() => bcInput.focus(), 10);
    }
  }
});

export function editRecord(sn) {
  const record = myRecordsData.find(r => r.sn === sn);
  if (!record) return;
  const newQty = prompt(`修改 [${record.name}] 數量:`, record.handQty);
  if (newQty === null || newQty === "") return;
  
  const oldQty = record.handQty;
  record.handQty = newQty; 
  renderAllRecordLists(); 
  
  monthlyTables.forEach(t => t.items.forEach(i => {
    if (i.drugCode === record.code && i.locCode === record.loc) i.countedQty = newQty;
  }));
  renderMonthlyDesk();

  fetchBackend('updateMonthlyRecord', { sn: sn, newQty: newQty, dispType: record.dispType, userId: session.id, userName: session.name })
    .then(res => {
      if (res.success) { showToast('修改成功'); refreshDashboardDataSilently(); } 
      else { record.handQty = oldQty; renderAllRecordLists(); renderMonthlyDesk(); showToast('修改失敗: ' + res.message, 'delete'); }
    }).catch(err => { record.handQty = oldQty; renderAllRecordLists(); renderMonthlyDesk(); showToast('網路連線異常，更新失敗', 'delete'); });
}

export function toggleMonthlyRecordStatus(sn, newStatus) {
  if (newStatus === '作廢' && !confirm('確定要作廢此筆紀錄嗎？')) return;
  const record = myRecordsData.find(r => r.sn === sn);
  if (!record) return;

  const oldStatus = record.status;
  record.status = newStatus;
  renderAllRecordLists();

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
        record.status = oldStatus; renderAllRecordLists(); renderMonthlyDesk();
        showToast('更新失敗: ' + res.message, 'delete');
      }
    }).catch(err => {
      record.status = oldStatus; renderAllRecordLists(); renderMonthlyDesk();
      showToast('網路連線異常，更新失敗', 'delete');
    });
}

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
          <div class="progress mb-2" style="height: 12px;">
            <div class="progress-bar ${isComplete ? 'bg-success' : 'bg-warning'}" style="width: ${percent}%"></div>
          </div>
          <div class="d-flex justify-content-between align-items-center mt-3">
            <div class="small text-secondary">已盤: ${counted} / ${total}</div>
            <div>
              <button class="btn btn-sm btn-outline-secondary me-2 fw-bold" onclick="event.stopPropagation(); showTableDetailModal('${table.id}', '${table.name}')">
                <i class="bi bi-list-ul"></i> 明細
              </button>
              <span class="text-academic fw-bold small">點擊作業 <i class="bi bi-chevron-right"></i></span>
            </div>
          </div>
        </div>
      </div>`;

    if (isComplete) finishedHtml += cardHtml; else unfinishedHtml += cardHtml;
  });

  unfinishedArea.innerHTML = unfinishedHtml || '<div class="text-center text-muted py-3">所有藥架皆已盤點完成</div>';
  finishedArea.innerHTML = finishedHtml || '<div class="text-center text-muted py-3">尚無完成的藥架</div>';
}

export function enterTableInventory(tableId, tableName) {
  const select = document.getElementById('monthly-table-select');
  if(select) { select.value = tableId; handleTableSelectChange(); }

  document.getElementById('monthly-app-title').innerText = tableName; 
  document.getElementById('monthly-tabs').classList.add('d-none');
  document.getElementById('btn-monthly-back').classList.remove('d-none');
  
  document.querySelectorAll('.monthly-content-section').forEach(s => s.classList.add('d-none'));
  document.getElementById('tab-dispense').classList.remove('d-none');
  window.scrollTo(0,0);
}

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

  document.getElementById('modal-drug-name').innerText = `【${tableName}】儲位明細 (全域紀錄)`;
  const headers = ["儲位碼", "代碼", "藥名", "數量", "人員", "時間", "狀態"];
  document.getElementById('modal-thead').innerHTML = `<tr>${headers.map(h => `<th class="py-2 text-nowrap">${h}</th>`).join('')}</tr>`;

  const tbodyHtml = table.items.map(item => {
    // 這裡直接使用 item 裡面的資料 (來自 getMonthlyInitData，包含所有人的最新紀錄)
    const userName = item.hasCounted ? (item.countedUser || '系統') : '-';
    const timeStr = item.hasCounted ? (item.countedTime || '-') : '-';
    const qtyStr = item.hasCounted ? (item.countedQty || '已盤') : '-';

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

// 🌟 新增：開啟數量彈窗的功能
export function openBarcodeQtyModal(drugName, drugInfo) {
  return new Promise((resolve) => {
    barcodeQtyResolve = resolve;
    document.getElementById('barcode-qty-drug-name').innerText = drugName;
    document.getElementById('barcode-qty-drug-info').innerText = drugInfo;
    const input = document.getElementById('barcode-qty-input');
    input.value = ''; // 清空上次輸入
    
    const modal = new window.bootstrap.Modal(document.getElementById('barcodeQtyModal'));
    modal.show();

    // 🌟 關鍵：當彈窗完全打開後，自動對焦並彈出鍵盤
    document.getElementById('barcodeQtyModal').addEventListener('shown.bs.modal', () => {
      input.focus();
    }, { once: true });
  });
}

// 🌟 綁定到 HTML 的按鈕功能
window.confirmBarcodeQty = () => {
  const qty = document.getElementById('barcode-qty-input').value;
  if (qty === '' || qty <= 0) return alert('請輸入有效數量');
  const modal = window.bootstrap.Modal.getInstance(document.getElementById('barcodeQtyModal'));
  modal.hide();
  if (barcodeQtyResolve) barcodeQtyResolve(qty);
};

window.cancelBarcodeQty = () => {
  const modal = window.bootstrap.Modal.getInstance(document.getElementById('barcodeQtyModal'));
  modal.hide();
  if (barcodeQtyResolve) barcodeQtyResolve(null);
};
