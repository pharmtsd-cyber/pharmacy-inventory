import { activeUploads, syncOfflineData } from './api.js';
import { session, DEPT_NAME, DEPT_COLOR, currentDept } from './config.js';
import { switchView } from './ui.js';
import { handleLogin, handleLogout, backToLobby } from './auth.js';
import { openDrugMasterListView, loadDrugMasterCatalog, clearDrugMasterCatalogSearch, renderDrugMasterCatalog } from './maint_drug_mgmt.js';
import { onHierSearchInput, selectHierSearchCandidate, clearHierSearchFilter } from './maint_hierarchy.js';

Object.assign(window, {
  onHierSearchInput,
  selectHierSearchCandidate,
  clearHierSearchFilter
});

Object.assign(window, {
  onHierSearchInput,
  openDrugMasterListView,
  loadDrugMasterCatalog,
  clearDrugMasterCatalogSearch,
  renderDrugMasterCatalog
});

import * as dailyMod from './daily.js';
import * as monthlyMod from './monthly.js';
import * as historyMod from './history.js';
import * as usersPortalMod from './maint_users_portal.js';
import * as drugMgmtMod from './maint_drug_mgmt.js';
import * as hierMod from './maint_hierarchy.js';
import * as monthlyAdjMod from './maint_monthly_adj.js';


// ==========================================
// 自動將各模組匯出的函式掛載至 window（供 HTML onclick 呼叫）
// ==========================================
function exposeFunctions(...modules) {
  for (const mod of modules) {
    for (const [key, val] of Object.entries(mod)) {
      if (typeof val === 'function') {
        window[key] = val;
      }
    }
  }
}

exposeFunctions(
  dailyMod,
  monthlyMod,
  historyMod,
  usersPortalMod,
  drugMgmtMod,
  hierMod,
  monthlyAdjMod
);

// ==========================================
// 基礎共用與導覽函式
// ==========================================
window.switchView = switchView;
window.handleLogin = handleLogin;
window.backToLobby = function() {
  if (typeof hierMod.confirmLeaveHierarchy === 'function' && !hierMod.confirmLeaveHierarchy()) return;
  backToLobby();
};
window.enterPharmacy = function(deptCode) { window.location.href = `?dept=${deptCode}`; };
window.openMaintenanceLink = function() { hierMod.initHierarchyMaintenance(); };

window.selectMode = function(modeName) {
  session.mode = modeName;
  if (modeName === '每日盤點') dailyMod.initDailyMode();
  else if (modeName === '月盤點') monthlyMod.initMonthlyMode();
};

// ==========================================
// 離線與背景同步防呆包裝（覆蓋預設同名函式）
// ==========================================
window.addEventListener('beforeunload', function (e) {
  const mCount = typeof monthlyMod.getMonthlyQueueCount === 'function' ? monthlyMod.getMonthlyQueueCount() : 0;
  const dCount = typeof dailyMod.getDailyQueueCount === 'function' ? dailyMod.getDailyQueueCount() : 0;
  const hasHierUnsaved = typeof hierMod.hasUnsavedHierarchyChanges === 'function' ? hierMod.hasUnsavedHierarchyChanges() : false;
  if (activeUploads > 0 || mCount > 0 || dCount > 0 || hasHierUnsaved) {
    if (mCount > 0 && typeof monthlyMod.flushMonthlyQueue === 'function') monthlyMod.flushMonthlyQueue({ showBlockingLoader: false });
    if (dCount > 0 && typeof dailyMod.flushDailyQueue === 'function') dailyMod.flushDailyQueue({ showBlockingLoader: false });
    const msg = hasHierUnsaved
      ? '分層儲位維護尚有未存檔的變更，確定要離開嗎？'
      : '尚有待同步的盤點資料，請等待同步完成再關閉網頁！';
    e.preventDefault();
    e.returnValue = msg;
    return msg;
  }
});

window.backToModeSelect = function() {
  if (typeof hierMod.confirmLeaveHierarchy === 'function' && !hierMod.confirmLeaveHierarchy()) return;
  if (activeUploads > 0) { alert('⚠️ 系統正在背景同步，請稍候再離開。'); return; }
  const mCount = typeof monthlyMod.getMonthlyQueueCount === 'function' ? monthlyMod.getMonthlyQueueCount() : 0;
  const dCount = typeof dailyMod.getDailyQueueCount === 'function' ? dailyMod.getDailyQueueCount() : 0;
  if (mCount > 0) { monthlyMod.flushMonthlyQueue({ showBlockingLoader: true, onComplete: () => switchView('view-mode-select') }); return; }
  if (dCount > 0) { dailyMod.flushDailyQueue({ showBlockingLoader: true, onComplete: () => switchView('view-mode-select') }); return; }
  switchView('view-mode-select');
};

window.handleMonthlyBack = function() {
  if (activeUploads > 0) { alert('⚠️ 系統正在背景同步，請稍候。'); return; }
  monthlyMod.handleMonthlyBack();
};

window.handleLogout = function() {
  if (typeof hierMod.confirmLeaveHierarchy === 'function' && !hierMod.confirmLeaveHierarchy()) return;
  const mCount = typeof monthlyMod.getMonthlyQueueCount === 'function' ? monthlyMod.getMonthlyQueueCount() : 0;
  const dCount = typeof dailyMod.getDailyQueueCount === 'function' ? dailyMod.getDailyQueueCount() : 0;
  if (mCount > 0) { monthlyMod.flushMonthlyQueue({ showBlockingLoader: true, onComplete: (s) => { if (s) handleLogout(); } }); return; }
  if (dCount > 0) { dailyMod.flushDailyQueue({ showBlockingLoader: true, onComplete: (s) => { if (s) handleLogout(); } }); return; }
  handleLogout();
};

window.addEventListener('online', () => {
  syncOfflineData();
  if (typeof monthlyMod.getMonthlyQueueCount === 'function' && monthlyMod.getMonthlyQueueCount() > 0) monthlyMod.flushMonthlyQueue({ showBlockingLoader: false });
  if (typeof dailyMod.getDailyQueueCount === 'function' && dailyMod.getDailyQueueCount() > 0) dailyMod.flushDailyQueue({ showBlockingLoader: false });
});
document.addEventListener('DOMContentLoaded', syncOfflineData);

function safeSilentRefresh() {
  const activeTagName = document.activeElement ? document.activeElement.tagName : '';
  const isTyping = (activeTagName === 'INPUT' || activeTagName === 'TEXTAREA');
  const hasOpenModal = document.querySelector('.modal.show') !== null;
  if (isTyping || hasOpenModal) { setTimeout(safeSilentRefresh, 2000); return; }
  if (session.mode === '月盤點') monthlyMod.loadUserRecords(() => { monthlyMod.refreshDashboardDataSilently(); });
  else if (session.mode === '每日盤點' && typeof dailyMod.changeDailyDate === 'function') dailyMod.changeDailyDate();
}
window.addEventListener('offline-sync-complete', safeSilentRefresh);

// ==========================================
// 動態套用各單位入口環境與主題色
// ==========================================
(function applyDynamicEnvironment() {
  if (!currentDept) {
    switchView('view-lobby');
    document.title = 'FEMH藥學部盤點APP';
  } else if (currentDept === 'monthly_adj') {
    document.title = `${DEPT_NAME} — FEMH藥學部盤點APP`;
    document.documentElement.style.setProperty('--academic-primary', '#212529');
    const brandEl = document.querySelector('.navbar-brand');
    if (brandEl) brandEl.innerHTML = `<i class="bi bi-calculator-fill"></i> ${DEPT_NAME}`;
    monthlyAdjMod.initMonthlyAdjPortal();
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

// ==========================================
// 小算盤與全域搜尋下拉鍵盤導覽
// ==========================================
let calcTargetId = null;
let calcExpression = '';

window.openCalculator = function(targetId, title = '小算盤') {
  calcTargetId = targetId;
  const targetInput = document.getElementById(targetId);
  calcExpression = targetInput ? targetInput.value || '' : '';
  document.getElementById('calc-title').innerText = title;
  updateCalcDisplay();
  const calcModal = new window.bootstrap.Modal(document.getElementById('calculatorModal'));
  calcModal.show();
};
window.calcPress = function(val) { if (calcExpression === 'Error') calcExpression = ''; calcExpression += val; updateCalcDisplay(); };
window.calcClear = function() { calcExpression = ''; updateCalcDisplay(); };
window.calcBackspace = function() { if (calcExpression === 'Error') calcExpression = ''; calcExpression = calcExpression.toString().slice(0, -1); updateCalcDisplay(); };
window.calcEqual = function() {
  if (!calcExpression) return;
  try {
    const sanitized = calcExpression.toString().replace(/[^-()\d/*+.]/g, '');
    let result = new Function('return ' + sanitized)();
    if (result !== undefined && !isNaN(result)) {
      result = Math.round(result * 1000) / 1000;
      calcExpression = result.toString();
    } else {
      calcExpression = 'Error';
    }
  } catch (e) {
    calcExpression = 'Error';
  }
  updateCalcDisplay();
};
window.calcConfirm = function() {
  window.calcEqual();
  if (calcExpression !== 'Error' && calcExpression !== '') {
    const target = document.getElementById(calcTargetId);
    if (target) {
      target.value = calcExpression;
      target.dispatchEvent(new Event('input'));
    }
  }
  window.bootstrap.Modal.getInstance(document.getElementById('calculatorModal')).hide();
};
function updateCalcDisplay() {
  const display = document.getElementById('calc-display');
  if (display) {
    display.innerText = calcExpression || '0';
    display.scrollLeft = display.scrollWidth;
  }
}

let globalSearchFocus = -1;
let blockSearchKeyup = false;

window.addEventListener('keyup', function(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
    if (blockSearchKeyup) {
      e.stopPropagation();
      blockSearchKeyup = false;
    }
  }
}, true);

document.addEventListener('keydown', function(e) {
  if (e.target.tagName !== 'INPUT') return;
  const activeDropdown = Array.from(document.querySelectorAll('.search-dropdown, [id$="-dropdown"]')).find(d => d.style.display === 'block');
  if (!activeDropdown) { globalSearchFocus = -1; return; }
  const items = activeDropdown.getElementsByClassName('search-dropdown-item');
  if (items.length === 0) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
    e.preventDefault();
    blockSearchKeyup = true;
    if (e.key === 'ArrowDown') { globalSearchFocus++; updateGlobalSearchFocus(items); }
    else if (e.key === 'ArrowUp') { globalSearchFocus--; updateGlobalSearchFocus(items); }
    else if (e.key === 'Enter') {
      const targetIndex = globalSearchFocus > -1 ? globalSearchFocus : 0;
      if (items[targetIndex]) {
        items[targetIndex].click();
        globalSearchFocus = -1;
      }
    }
  } else {
    globalSearchFocus = -1;
  }
});

function updateGlobalSearchFocus(items) {
  for (let i = 0; i < items.length; i++) { items[i].style.backgroundColor = ''; }
  if (globalSearchFocus >= items.length) globalSearchFocus = 0;
  if (globalSearchFocus < 0) globalSearchFocus = (items.length - 1);
  items[globalSearchFocus].style.backgroundColor = '#e2e3e5';
  items[globalSearchFocus].scrollIntoView({ block: 'nearest' });
}
