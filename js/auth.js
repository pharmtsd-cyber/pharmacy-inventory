import { fetchBackend } from './api.js'; 
import { toggleLoader, switchView } from './ui.js'; 
import { session, currentDept } from './config.js';

export function handleLogin() {
  const inputElement = document.getElementById('login-id');
  if (!inputElement) return alert('找不到輸入框元件');
  
  const id = inputElement.value.trim(); 
  if (!id) return alert('請輸入員工編號');
  
  toggleLoader(true);
  
  fetchBackend('checkLogin', { id: id, portalKey: currentDept || '' }).then(res => {
    toggleLoader(false);
    
    if (res.success) {
      session.id = res.userId || res.id; 
      session.name = res.userName || res.name; 
      session.email = res.email || '';
      session.department = res.department || '';
      session.infoLevel = res.infoLevel || 'C';
      session.mgmtRole = res.mgmtRole || '一般藥師';
      session.isAdmin = !!res.isAdmin;
      
      const navInfoElement = document.getElementById('nav-info');
      if (navInfoElement) navInfoElement.innerText = session.name;

      // 依入口路由導向對應主畫面
      if (currentDept === 'user_mgmt') {
        if (typeof window.initUserMgmtPortal === 'function') window.initUserMgmtPortal();
      } else if (currentDept === 'drug_mgmt') {
        if (typeof window.initDrugMgmtPortal === 'function') window.initDrugMgmtPortal();
      } else if (currentDept === 'portal_perm') {
        if (typeof window.initPortalPermPortal === 'function') window.initPortalPermPortal();
      } else {
        switchView('view-mode-select');
      }
    } else { 
      alert("❌ 登入失敗：" + (res.message || "未知錯誤")); 
    }
  }).catch(err => { 
    toggleLoader(false); 
    console.error("登入過程發生錯誤:", err);
    alert('⚠️ 系統錯誤：' + err.message); 
  });
}

export function handleLogout() { 
  if (confirm('確定要登出並返回網站入口嗎？')) {
    window.location.href = window.location.pathname; 
  }
}

export function backToLobby() {
  window.location.href = window.location.pathname;
}
四大維護專區邏輯：maintenance_v2.js → 覆蓋 js/maintenance.js


maintenance_v2
 JS 
主程式與全域匯出：main_v2.js → 覆蓋 js/main.js


main_v2
import { activeUploads, syncOfflineData } from './api.js'; 
import { session, DEPT_NAME, DEPT_COLOR, currentDept, MAINTENANCE_LINK_MAP } from './config.js';
import { switchView } from './ui.js';
import { handleLogin, handleLogout, backToLobby } from './auth.js';

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

import {
  initUserMgmtPortal, autoGenerateUserEmail, loadUsersList, renderUsersTable, openUserEditModal, submitUserEdit,
  initPortalPermPortal, loadPortalPermissions, savePortalPermRow,
  initDrugMgmtPortal, switchDrugMgmtTab, loadDrugMasterStats, handleMasterFileSelect, submitRebuildDrugMaster,
  generateDailySnapshotNow, loadDailySnapshots, generateMonthlySnapshotNow, loadMonthlySnapshots,
  handleSapFileSelectV2, uploadSapWithConfirm, loadSapHistoryList, rollbackSapDate,
  initHierarchyMaintenance, loadHierarchyData, selectHierArea, selectHierTable, renderLocationsColumn,
  openAreaModal, autoPreviewAreaId, submitAreaEdit, deleteAreaItem,
  openTableModal, autoPreviewTableId, submitTableEdit, deleteTableItem,
  openLocEditModal, autoPreviewLocCode, submitLocEdit, deleteLocItem
} from './maintenance.js';

// ==========================================
// 🛡️ 瀏覽器與 APP 內部防護網
// ==========================================
window.addEventListener('beforeunload', function (e) {
  const mCount = typeof getMonthlyQueueCount === 'function' ? getMonthlyQueueCount() : 0;
  const dCount = typeof getDailyQueueCount === 'function' ? getDailyQueueCount() : 0;
  if (activeUploads > 0 || mCount > 0 || dCount > 0) {
    if (mCount > 0 && typeof flushMonthlyQueue === 'function') flushMonthlyQueue({ showBlockingLoader: false });
    if (dCount > 0 && typeof flushDailyQueue === 'function') flushDailyQueue({ showBlockingLoader: false });
    const msg = '尚有待同步的盤點資料，請等待同步完成再關閉網頁！';
    e.returnValue = msg; 
    return msg;          
  }
});

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
// 🚀 全院多藥局與管理專區路由
// ==========================================
(function applyDynamicEnvironment() {
  if (!currentDept) {
    switchView('view-lobby');
    document.title = 'FEMH藥學部盤點APP';
  } else {
    switchView('view-login');
    document.title = `${DEPT_NAME} — FEMH藥學部盤點APP`;
    document.documentElement.style.setProperty('--academic-primary', DEPT_COLOR);
    const brandEl = document.querySelector('.navbar-brand');
    if (brandEl) brandEl.innerHTML = `<i class="bi bi-capsule"></i> ${DEPT_NAME}`;
    const loginTitle = document.getElementById('login-portal-title');
    if (loginTitle) loginTitle.innerText = `【${DEPT_NAME}】身分驗證`;
  }
})();

window.enterPharmacy = function(deptCode) { window.location.href = `?dept=${deptCode}`; };
window.backToLobby = backToLobby;
window.openMaintenanceLink = function() { initHierarchyMaintenance(); };

window.switchView = switchView;
window.handleLogin = handleLogin;
window.selectMode = function(modeName) {
  session.mode = modeName;
  if (modeName === '每日盤點') initDailyMode();
  else if (modeName === '月盤點') initMonthlyMode();
};

// Daily Exports
window.initDailyMode = initDailyMode; window.changeDailyDate = changeDailyDate; window.switchDailyTab = switchDailyTab; window.submitDailyOne = submitDailyOne; window.openAdminSort = openAdminSort; window.toggleVisibility = toggleVisibility; window.highlightSearchItem = highlightSearchItem; window.rebuildAdminList = rebuildAdminList; window.saveAdminDataToServer = saveAdminDataToServer; window.renderDailyItems = renderDailyItems; window.flushDailyQueue = flushDailyQueue;

// Monthly Exports
window.refreshMonthlyData = refreshMonthlyData; window.initMonthlyMode = initMonthlyMode; window.switchMonthlyTab = switchMonthlyTab; window.switchStockSubTab = switchStockSubTab; window.switchDeskSubTab = switchDeskSubTab; window.switchOnlineSubTab = switchOnlineSubTab; window.switchRecordsSubTab = switchRecordsSubTab; window.handleStockSearch = handleStockSearch; window.handleOnlineSearch = handleOnlineSearch; window.selectStockDrug = selectStockDrug; window.selectOnlineDrug = selectOnlineDrug; window.handleTableSelectChange = handleTableSelectChange; window.submitMonthlyDeskOne = submitMonthlyDeskOne; window.flushMonthlyQueue = flushMonthlyQueue; window.submitMonthlyStock = submitMonthlyStock; window.submitMonthlyOnline = submitMonthlyOnline; window.updateOnlineUI = updateOnlineUI; window.startLiveScanner = startLiveScanner; window.closeLiveScanner = closeLiveScanner; window.parseBarcodeAndSubmit = parseBarcodeAndSubmit; window.loadUserRecords = loadUserRecords; window.handleRecordFilterSearch = handleRecordFilterSearch; window.clearRecordFilter = clearRecordFilter; window.applyRecordFilter = applyRecordFilter; window.editRecord = editRecord; window.editDailyQty = editDailyQty; window.toggleDailyStatus = toggleDailyStatus; window.toggleMonthlyRecordStatus = toggleMonthlyRecordStatus; window.refreshDashboardData = refreshDashboardData; window.renderMonthlyDashboard = renderMonthlyDashboard; window.showTableDetailModal = showTableDetailModal; window.enterTableInventory = enterTableInventory;

// History Exports
window.initHistoryMode = initHistoryMode; window.addHistoryDate = addHistoryDate; window.removeHistoryDate = removeHistoryDate; window.handleDrugSearch = handleDrugSearch; window.selectDrugFilter = selectDrugFilter; window.clearDrugFilter = clearDrugFilter; window.renderHistoryTable = renderHistoryTable; window.toggleModalCol = toggleModalCol; window.addQuickDate = addQuickDate; window.openNoteModal = openNoteModal; window.submitDrugNote = submitDrugNote; window.voidDrugNote = voidDrugNote;

// Maintenance & Portals Exports
window.initUserMgmtPortal = initUserMgmtPortal;
window.autoGenerateUserEmail = autoGenerateUserEmail;
window.loadUsersList = loadUsersList;
window.renderUsersTable = renderUsersTable;
window.openUserEditModal = openUserEditModal;
window.submitUserEdit = submitUserEdit;

window.initPortalPermPortal = initPortalPermPortal;
window.loadPortalPermissions = loadPortalPermissions;
window.savePortalPermRow = savePortalPermRow;

window.initDrugMgmtPortal = initDrugMgmtPortal;
window.switchDrugMgmtTab = switchDrugMgmtTab;
window.loadDrugMasterStats = loadDrugMasterStats;
window.handleMasterFileSelect = handleMasterFileSelect;
window.submitRebuildDrugMaster = submitRebuildDrugMaster;
window.generateDailySnapshotNow = generateDailySnapshotNow;
window.loadDailySnapshots = loadDailySnapshots;
window.generateMonthlySnapshotNow = generateMonthlySnapshotNow;
window.loadMonthlySnapshots = loadMonthlySnapshots;
window.handleSapFileSelectV2 = handleSapFileSelectV2;
window.uploadSapWithConfirm = uploadSapWithConfirm;
window.loadSapHistoryList = loadSapHistoryList;
window.rollbackSapDate = rollbackSapDate;

window.initHierarchyMaintenance = initHierarchyMaintenance;
window.loadHierarchyData = loadHierarchyData;
window.selectHierArea = selectHierArea;
window.selectHierTable = selectHierTable;
window.renderLocationsColumn = renderLocationsColumn;
window.openAreaModal = openAreaModal;
window.autoPreviewAreaId = autoPreviewAreaId;
window.submitAreaEdit = submitAreaEdit;
window.deleteAreaItem = deleteAreaItem;
window.openTableModal = openTableModal;
window.autoPreviewTableId = autoPreviewTableId;
window.submitTableEdit = submitTableEdit;
window.deleteTableItem = deleteTableItem;
window.openLocEditModal = openLocEditModal;
window.autoPreviewLocCode = autoPreviewLocCode;
window.submitLocEdit = submitLocEdit;
window.deleteLocItem = deleteLocItem;

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
