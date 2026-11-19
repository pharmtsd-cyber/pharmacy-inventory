import { activeUploads, syncOfflineData } from './api.js'; 
import { session, DEPT_NAME, DEPT_COLOR, currentDept, MAINTENANCE_LINK_MAP } from './config.js';
import { switchView } from './ui.js';
import { handleLogin, handleLogout } from './auth.js';

import { 
  initDailyMode, changeDailyDate, switchDailyTab, submitDailyOne, 
  editDailyQty, toggleDailyStatus, flushDailyQueue, getDailyQueueCount,
  openAdminSort, toggleVisibility, highlightSearchItem, rebuildAdminList, saveAdminDataToServer, renderDailyItems 
} from './daily.js';

import { 
  initMonthlyMode, switchMonthlyTab, switchStockSubTab, switchDeskSubTab, switchOnlineSubTab, switchRecordsSubTab,
  handleStockSearch, handleOnlineSearch, selectStockDrug, selectOnlineDrug, 
  handleTableSelectChange, submitMonthlyDeskOne, flushMonthlyQueue, getMonthlyQueueCount, submitMonthlyStock, submitMonthlyOnline, 
  updateOnlineUI, startLiveScanner, closeLiveScanner, parseBarcodeAndSubmit, 
  loadUserRecords, handleRecordFilterSearch, clearRecordFilter, applyRecordFilter, 
  editRecord, toggleMonthlyRecordStatus, refreshMonthlyData,
  refreshDashboardData, refreshDashboardDataSilently, renderMonthlyDashboard, showTableDetailModal, enterTableInventory, handleMonthlyBack
} from './monthly.js';

import { 
  initHistoryMode, addHistoryDate, removeHistoryDate, handleDrugSearch, selectDrugFilter, clearDrugFilter, 
  renderHistoryTable, toggleModalCol, addQuickDate, openNoteModal, submitDrugNote, voidDrugNote 
} from './history.js';

// ==========================================
// 🛡️ 瀏覽器與 APP 內部防護網 (自動攔截與主動打包)
// ==========================================
window.addEventListener('beforeunload', function (e) {
  const mCount = typeof getMonthlyQueueCount === 'function' ? getMonthlyQueueCount() : 0;
  const dCount = typeof getDailyQueueCount === 'function' ? getDailyQueueCount() : 0;
  if (activeUploads > 0 || mCount > 0 || dCount > 0) {
    if (mCount > 0 && typeof flushMonthlyQueue === 'function') flushMonthlyQueue({ showBlockingLoader: false });
    if (dCount > 0 && typeof flushDailyQueue === 'function') flushDailyQueue({ showBlockingLoader: false });
    const msg = '尚有待打包同步的盤點資料，請等待同步完成再關閉網頁！';
    e.returnValue = msg; 
    return msg;          
  }
});

// 🌟 覆寫頂部 Navbar 返回按鈕：離開前強制打包
window.backToModeSelect = function() {
  if (activeUploads > 0) { alert(`⚠️ 系統正在背景同步，請稍候再離開。`); return; }
  const mCount = typeof getMonthlyQueueCount === 'function' ? getMonthlyQueueCount() : 0;
  const dCount = typeof getDailyQueueCount === 'function' ? getDailyQueueCount() : 0;
  if (mCount > 0) { flushMonthlyQueue({ showBlockingLoader: true, onComplete: () => switchView('view-mode-select') }); return; }
  if (dCount > 0) { flushDailyQueue({ showBlockingLoader: true, onComplete: () => switchView('view-mode-select') }); return; }
  switchView('view-mode-select');
};

const originalHandleMonthlyBack = handleMonthlyBack;
window.handleMonthlyBack = function() {
  if (activeUploads > 0) { alert(`⚠️ 系統正在背景同步，請稍候。`); return; }
  originalHandleMonthlyBack();
};

const originalHandleLogout = handleLogout;
window.handleLogout = function() {
  const mCount = typeof getMonthlyQueueCount === 'function' ? getMonthlyQueueCount() : 0;
  const dCount = typeof getDailyQueueCount === 'function' ? getDailyQueueCount() : 0;
  if (mCount > 0) { flushMonthlyQueue({ showBlockingLoader: true, onComplete: (s) => { if(s) originalHandleLogout(); }}); return; }
  if (dCount > 0) { flushDailyQueue({ showBlockingLoader: true, onComplete: (s) => { if(s) originalHandleLogout(); }}); return; }
  originalHandleLogout();
};

window.addEventListener('online', () => {
  syncOfflineData();
  if (typeof getMonthlyQueueCount === 'function' && getMonthlyQueueCount() > 0) flushMonthlyQueue({ showBlockingLoader: false });
  if (typeof getDailyQueueCount === 'function' && getDailyQueueCount() > 0) flushDailyQueue({ showBlockingLoader: false });
});
document.addEventListener('DOMContentLoaded', syncOfflineData);

function safeSilentRefresh() {
  const activeTagName = document.activeElement ? document.activeElement.tagName : '';
  const isTyping = (activeTagName === 'INPUT' || activeTagName === 'TEXTAREA');
  const hasOpenModal = document.querySelector('.modal.show') !== null;

  if (isTyping || hasOpenModal) { setTimeout(safeSilentRefresh, 2000); return; }

  if (session.mode === '月盤點') {
    loadUserRecords(() => { refreshDashboardDataSilently(); });
  } else if (session.mode === '每日盤點') {
    if (typeof changeDailyDate === 'function') changeDailyDate();
  }
}
window.addEventListener('offline-sync-complete', safeSilentRefresh);

// ==========================================
// 🚀 全院多藥局與模組匯出
// ==========================================
(function applyDynamicEnvironment() {
  if (!currentDept) { switchView('view-lobby'); document.title = '盤點系統入口大廳';
  } else { switchView('view-login'); document.title = `${DEPT_NAME}盤點APP`; document.documentElement.style.setProperty('--academic-primary', DEPT_COLOR); const brandEl = document.querySelector('.navbar-brand'); if (brandEl) brandEl.innerHTML = `<i class="bi bi-capsule"></i> ${DEPT_NAME}盤點APP`; }
})();

window.enterPharmacy = function(deptCode) { window.location.href = `?dept=${deptCode}`; };
window.openMaintenanceLink = function() { const link = MAINTENANCE_LINK_MAP[currentDept]; if (link) window.open(link, '_blank'); else alert('未設定連結！'); };

window.switchView = switchView; window.handleLogin = handleLogin;
window.selectMode = function(modeName) { session.mode = modeName; if(modeName === '每日盤點') initDailyMode(); else if (modeName === '月盤點') initMonthlyMode(); };

// Daily Exports
window.initDailyMode = initDailyMode; window.changeDailyDate = changeDailyDate; window.switchDailyTab = switchDailyTab; window.submitDailyOne = submitDailyOne; window.openAdminSort = openAdminSort; window.toggleVisibility = toggleVisibility; window.highlightSearchItem = highlightSearchItem; window.rebuildAdminList = rebuildAdminList; window.saveAdminDataToServer = saveAdminDataToServer; window.renderDailyItems = renderDailyItems; window.flushDailyQueue = flushDailyQueue;

// Monthly Exports
window.refreshMonthlyData = refreshMonthlyData; window.initMonthlyMode = initMonthlyMode; window.switchMonthlyTab = switchMonthlyTab; window.switchStockSubTab = switchStockSubTab; window.switchDeskSubTab = switchDeskSubTab; window.switchOnlineSubTab = switchOnlineSubTab; window.switchRecordsSubTab = switchRecordsSubTab; window.handleStockSearch = handleStockSearch; window.handleOnlineSearch = handleOnlineSearch; window.selectStockDrug = selectStockDrug; window.selectOnlineDrug = selectOnlineDrug; window.handleTableSelectChange = handleTableSelectChange; window.submitMonthlyDeskOne = submitMonthlyDeskOne; window.flushMonthlyQueue = flushMonthlyQueue; window.submitMonthlyStock = submitMonthlyStock; window.submitMonthlyOnline = submitMonthlyOnline; window.updateOnlineUI = updateOnlineUI; window.startLiveScanner = startLiveScanner; window.closeLiveScanner = closeLiveScanner; window.parseBarcodeAndSubmit = parseBarcodeAndSubmit; window.loadUserRecords = loadUserRecords; window.handleRecordFilterSearch = handleRecordFilterSearch; window.clearRecordFilter = clearRecordFilter; window.applyRecordFilter = applyRecordFilter; window.editRecord = editRecord; window.editDailyQty = editDailyQty; window.toggleDailyStatus = toggleDailyStatus; window.toggleMonthlyRecordStatus = toggleMonthlyRecordStatus; window.refreshDashboardData = refreshDashboardData; window.renderMonthlyDashboard = renderMonthlyDashboard; window.showTableDetailModal = showTableDetailModal; window.enterTableInventory = enterTableInventory;

// History Exports
window.initHistoryMode = initHistoryMode; window.addHistoryDate = addHistoryDate; window.removeHistoryDate = removeHistoryDate; window.handleDrugSearch = handleDrugSearch; window.selectDrugFilter = selectDrugFilter; window.clearDrugFilter = clearDrugFilter; window.renderHistoryTable = renderHistoryTable; window.toggleModalCol = toggleModalCol; window.addQuickDate = addQuickDate; window.openNoteModal = openNoteModal; window.submitDrugNote = submitDrugNote; window.voidDrugNote = voidDrugNote;

// ==========================================
// ✨ 全域小算盤功能
// ==========================================
let calcTargetId = null; let calcExpression = '';
window.openCalculator = function(targetId, title = '小算盤') { calcTargetId = targetId; const targetInput = document.getElementById(targetId); calcExpression = targetInput ? targetInput.value || '' : ''; document.getElementById('calc-title').innerText = title; updateCalcDisplay(); const calcModal = new window.bootstrap.Modal(document.getElementById('calculatorModal')); calcModal.show(); };
window.calcPress = function(val) { if (calcExpression === 'Error') calcExpression = ''; calcExpression += val; updateCalcDisplay(); };
window.calcClear = function() { calcExpression = ''; updateCalcDisplay(); };
window.calcBackspace = function() { if (calcExpression === 'Error') calcExpression = ''; calcExpression = calcExpression.toString().slice(0, -1); updateCalcDisplay(); };
window.calcEqual = function() { if (!calcExpression) return; try { const sanitized = calcExpression.toString().replace(/[^-()\d/*+.]/g, ''); let result = new Function('return ' + sanitized)(); if (result !== undefined && !isNaN(result)) { result = Math.round(result * 1000) / 1000; calcExpression = result.toString(); } else { calcExpression = 'Error'; } } catch(e) { calcExpression = 'Error'; } updateCalcDisplay(); };
window.calcConfirm = function() { calcEqual(); if (calcExpression !== 'Error' && calcExpression !== '') { const target = document.getElementById(calcTargetId); if (target) { target.value = calcExpression; target.dispatchEvent(new Event('input')); } } window.bootstrap.Modal.getInstance(document.getElementById('calculatorModal')).hide(); };
function updateCalcDisplay() { const display = document.getElementById('calc-display'); if(display) { display.innerText = calcExpression || '0'; display.scrollLeft = display.scrollWidth; } }

// ==========================================
// ✨ 鍵盤導航
// ==========================================
let globalSearchFocus = -1; let blockSearchKeyup = false;
window.addEventListener('keyup', function(e) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') { if (blockSearchKeyup) { e.stopPropagation(); blockSearchKeyup = false; } } }, true);
document.addEventListener('keydown', function(e) {
  if (e.target.tagName !== 'INPUT') return;
  const activeDropdown = Array.from(document.querySelectorAll('.search-dropdown, [id$="-dropdown"]')).find(d => d.style.display === 'block');
  if (!activeDropdown) { globalSearchFocus = -1; return; }
  const items = activeDropdown.getElementsByClassName('search-dropdown-item'); if (items.length === 0) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
    e.preventDefault(); blockSearchKeyup = true;
    if (e.key === 'ArrowDown') { globalSearchFocus++; updateGlobalSearchFocus(items); } 
    else if (e.key === 'ArrowUp') { globalSearchFocus--; updateGlobalSearchFocus(items); } 
    else if (e.key === 'Enter') { let targetIndex = globalSearchFocus > -1 ? globalSearchFocus : 0; if (items[targetIndex]) { items[targetIndex].click(); globalSearchFocus = -1; } }
  } else { globalSearchFocus = -1; }
});
function updateGlobalSearchFocus(items) { for (let i = 0; i < items.length; i++) { items[i].style.backgroundColor = ''; } if (globalSearchFocus >= items.length) globalSearchFocus = 0; if (globalSearchFocus < 0) globalSearchFocus = (items.length - 1); items[globalSearchFocus].style.backgroundColor = '#e2e3e5'; items[globalSearchFocus].scrollIntoView({ block: 'nearest' }); }
