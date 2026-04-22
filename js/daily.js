import { fetchBackend } from './api.js'; import { toggleLoader, switchView, showToast } from './ui.js'; import { session } from './config.js';
export let dailyItems = []; export let currentDailyTab = '未盤'; export let adminCombinedList = []; export let sortableInstance = null; export let adminData = null;

export function initDailyMode() { currentDailyTab = '未盤'; updateTabUI(); switchView('view-daily-app'); loadDailyData(null); }
export function changeDailyDate() { loadDailyData(document.getElementById('header-date-select').value); }
export function loadDailyData(dateStr) {
  if(dateStr && dateStr.includes('-')) dateStr = dateStr.replace(/-/g, '/');
  toggleLoader(true);
  fetchBackend('getDailyInventoryByDate', { dateStr: dateStr }).then(data => {
    toggleLoader(false); dailyItems = data.items || []; document.getElementById('header-date-select').value = data.selectedDate.replace(/\//g, '-'); renderDailyItems(); 
  }).catch(err => { toggleLoader(false); document.getElementById('daily-list-area').innerHTML = '<div class="text-center p-5 text-muted fw-bold">無資料或讀取失敗</div>'; });
}
export function switchDailyTab(tabName) { if (currentDailyTab === tabName) return; currentDailyTab = tabName; updateTabUI(); renderDailyItems(); }
export function updateTabUI() {
  const btnUn = document.getElementById('btn-tab-uncounted'); const btnCo = document.getElementById('btn-tab-counted');
  btnUn.className = 'nav-link fw-bold border text-academic shadow-sm bg-white py-2'; btnCo.className = 'nav-link fw-bold border text-success shadow-sm bg-white py-2';
  if (currentDailyTab === '未盤') btnUn.className = 'nav-link active fw-bold border bg-academic shadow-sm text-white py-2'; else btnCo.className = 'nav-link active fw-bold border bg-success text-white shadow-sm py-2';
}
export function renderDailyItems() {
  const area = document.getElementById('daily-list-area'); const countedItems = dailyItems.filter(i => i.hasCounted); const uncountedItems = dailyItems.filter(i => !i.hasCounted);
  document.getElementById('count-counted').innerText = countedItems.length; document.getElementById('count-uncounted').innerText = uncountedItems.length;
  const renderList = currentDailyTab === '未盤' ? uncountedItems : countedItems;
  if(renderList.length === 0) return area.innerHTML = '<div class="text-center p-5 text-muted fw-bold">此區無資料</div>';
  const uniqueDrugs = []; dailyItems.forEach(item => { if (!uniqueDrugs.includes(item.drugCode)) uniqueDrugs.push(item.drugCode); });
  const getDrugColor = (code) => { const index = uniqueDrugs.indexOf(code); return index % 2 === 0 ? 'var(--academic-primary)' : '#adb5bd'; };
  let html = '';
  renderList.forEach(item => {
    const borderColor = getDrugColor(item.drugCode); let notesHtml = ''; const notesArr = [];
    if(item.tableDesc) notesArr.push(`表說明: ${item.tableDesc}`); if(item.infoDesc) notesArr.push(`說明: ${item.infoDesc}`); if(item.infoMemo) notesArr.push(`備註: ${item.infoMemo}`); if(item.infoNotice) notesArr.push(`注意: ${item.infoNotice}`);
    if (notesArr.length > 0) notesHtml = `<div class="small text-danger fw-bold mt-1 mb-2">${notesArr.join(' | ')}</div>`;
    let recentHtml = item.lastRecord ? `<div class="recent-record-text small fw-bold mb-2 text-academic"><i class="bi bi-clock-history"></i> 前次: ${item.lastRecord.qty} (${item.lastRecord.timeStr})</div>` : `<div class="text-muted small mb-2">無前次紀錄</div>`;
    const btnClass = item.hasCounted ? 'btn-success' : 'btn-academic'; const btnText = item.hasCounted ? '更新覆蓋' : '確認送出';
    html += `<div class="card drug-card mb-3 shadow-sm border-0" style="border-left: 6px solid ${borderColor} !important;"><div class="card-body p-3"><div class="fw-bold fs-5 text-dark mb-2">${item.drugName}</div><div class="d-flex flex-wrap gap-2 mb-1"><span class="badge bg-academic shadow-sm"><i class="bi bi-geo-alt-fill"></i> ${item.tableName}</span><span class="badge bg-light text-dark border border-secondary">儲位: ${item.locCode}</span><span class="badge bg-light text-dark border border-secondary">代碼: ${item.drugCode}</span></div>${notesHtml}${recentHtml}<div class="input-group mt-2 shadow-sm"><input type="number" id="qty-${item.locCode}" class="form-control form-control-lg bg-white fw-bold text-center border-secondary" placeholder="數量" inputmode="numeric" pattern="[0-9]*" value="${item.hasCounted ? item.countedQty : ''}"><button class="btn ${btnClass} px-4 fw-bold fs-5" onclick="submitDailyOne('${item.locCode}', '${item.drugCode}', '${item.drugName}', '${item.tableId}')">${btnText}</button></div></div></div>`;
  });
  area.innerHTML = html;
}
export function submitDailyOne(loc, dCode, dName, tId) {
  const inputEl = document.getElementById(`qty-${loc}`); const qty = inputEl.value; if(qty === '' || qty < 0) return alert('請輸入有效數量');
  const invDate = document.getElementById('header-date-select').value.replace(/-/g, '/');
  const payload = { userId: session.id, userName: session.name, mode: '每日盤點', type: '盤點調劑台', drugCode: dCode, drugName: dName, handQty: qty, tableId: tId, locCode: loc, inventoryDate: invDate };
  const item = dailyItems.find(i => i.locCode === loc); if (!item) return;
  const originalStatus = item.hasCounted; const originalQty = item.countedQty;
  item.hasCounted = true; item.countedQty = qty; if (navigator.vibrate) navigator.vibrate(50); 
  const card = inputEl.closest('.drug-card'); const isUncountedTab = currentDailyTab === '未盤';
  const uncountedItems = dailyItems.filter(i => !i.hasCounted);
  document.getElementById('count-counted').innerText = dailyItems.filter(i => i.hasCounted).length; document.getElementById('count-uncounted').innerText = uncountedItems.length;
  if (card && isUncountedTab) {
    card.style.display = 'none'; setTimeout(() => card.remove(), 10); 
    if (uncountedItems.length === 0) document.getElementById('daily-list-area').innerHTML = '<div class="text-center p-5 text-muted fw-bold">此區無資料</div>';
  } else { const btn = inputEl.nextElementSibling; btn.innerText = "更新覆蓋"; btn.disabled = false; showToast('更新覆蓋成功！'); }
  fetchBackend('submitInventory', payload).then(res => {
    if(res && !res.success) { alert("警告：" + res.message); item.hasCounted = originalStatus; item.countedQty = originalQty; renderDailyItems(); }
  }).catch(err => { alert('網路錯誤，資料未送出，已恢復原狀態'); item.hasCounted = originalStatus; item.countedQty = originalQty; renderDailyItems(); });
}
export function openAdminSort() { toggleLoader(true); fetchBackend('getAdminData').then(data => { toggleLoader(false); adminData = data; adminCombinedList = data.selectable.map(item => { return { ...item, order: data.saved.find(s => s.locCode === item.locCode)?.order || '' }; }); renderSortableList(); switchView('view-admin-sort'); }).catch(err => { toggleLoader(false); alert('讀取失敗'); }); }
export function renderSortableList() {
  adminCombinedList.sort((a, b) => { const aV = a.order !== 0, bV = b.order !== 0; if (aV && !bV) return -1; if (!aV && bV) return 1; if (aV && bV) { if (a.order !== '' && b.order !== '') return a.order - b.order; if (a.order !== '' && b.order === '') return -1; if (a.order === '' && b.order !== '') return 1; } return a.locCode.localeCompare(b.locCode); });
  let html = '';
  adminCombinedList.forEach(item => {
    const isHidden = item.order === 0; const cardStyle = isHidden ? 'opacity: 0.6; border-left: 5px solid #dc3545;' : 'border-left: 5px solid var(--academic-primary);'; const eyeIcon = isHidden ? 'bi-eye-slash-fill text-danger' : 'bi-eye-fill text-success';
    html += `<div class="card border-0 shadow-sm mb-2 sortable-item bg-white" style="${cardStyle}" data-loc="${item.locCode}" data-table="${item.tableId}" data-drug="${item.drugCode}" data-name="${item.drugName}" data-hidden="${isHidden}"><div class="card-body p-2 d-flex align-items-center"><div class="drag-handle"><i class="bi bi-grip-vertical"></i></div><div class="flex-grow-1 px-2 text-truncate"><div class="fw-bold text-dark search-target">${item.drugName}</div><div class="small text-muted"><span class="badge bg-academic me-1">${item.tableName}</span>${item.locCode}</div></div><div><button class="btn btn-light border p-2" onclick="toggleVisibility(this, '${item.locCode}')"><i id="eye-${item.locCode}" class="${eyeIcon} fs-5"></i></button></div></div></div>`;
  });
  document.getElementById('admin-sortable-list').innerHTML = html; if(sortableInstance) sortableInstance.destroy(); sortableInstance = new window.Sortable(document.getElementById('admin-sortable-list'), { handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost' });
}
export function toggleVisibility(btn, locCode) { const card = btn.closest('.sortable-item'); const icon = document.getElementById(`eye-${locCode}`); if (card.getAttribute('data-hidden') === 'true') { card.setAttribute('data-hidden', 'false'); card.style.opacity = '1'; card.style.borderLeftColor = 'var(--academic-primary)'; icon.className = 'bi bi-eye-fill text-success fs-5'; } else { card.setAttribute('data-hidden', 'true'); card.style.opacity = '0.6'; card.style.borderLeftColor = '#dc3545'; icon.className = 'bi bi-eye-slash-fill text-danger fs-5'; } }
export function highlightSearchItem() { const kw = document.getElementById('admin-search-input').value.toLowerCase(); let firstMatch = null; document.querySelectorAll('.sortable-item').forEach(card => { if (kw && (card.querySelector('.search-target').innerText.toLowerCase().includes(kw) || card.getAttribute('data-loc').toLowerCase().includes(kw))) { card.classList.add('bg-warning', 'bg-opacity-25'); if(!firstMatch) firstMatch = card; } else card.classList.remove('bg-warning', 'bg-opacity-25'); }); if (firstMatch) firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
export function rebuildAdminList() { if(confirm('確定要重建清單嗎？')) { adminCombinedList = adminData.selectable.map(i => ({ ...i, order: '' })); renderSortableList(); } }
export function saveAdminDataToServer() { const payload = []; let currentOrder = 1; document.querySelectorAll('.sortable-item').forEach(el => { payload.push({ tableId: el.getAttribute('data-table'), locCode: el.getAttribute('data-loc'), drugCode: el.getAttribute('data-drug'), drugName: el.getAttribute('data-name'), order: el.getAttribute('data-hidden') === 'true' ? 0 : currentOrder++ }); }); toggleLoader(true); fetchBackend('saveAdminSortData', { payloadArray: payload }).then(() => { toggleLoader(false); showToast('儲存順序成功！'); switchView('view-daily-app'); }).catch(err => { toggleLoader(false); alert('儲存失敗'); }); }
