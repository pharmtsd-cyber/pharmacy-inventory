import { session } from './config.js';
import { switchView } from './ui.js';
import { handleLogin, handleLogout } from './auth.js';

import { 
  initDailyMode, changeDailyDate, switchDailyTab, submitDailyOne, 
  editDailyQty, toggleDailyStatus, // 🌟 新增這兩個
  openAdminSort, toggleVisibility, highlightSearchItem, rebuildAdminList, saveAdminDataToServer 
} from './daily.js';

import { 
  initMonthlyMode, switchMonthlyTab, switchStockSubTab, switchDeskSubTab, switchOnlineSubTab, 
  handleStockSearch, handleOnlineSearch, selectStockDrug, selectOnlineDrug, 
  handleTableSelectChange, submitMonthlyDeskOne, submitMonthlyStock, submitMonthlyOnline, 
  updateOnlineUI, startLiveScanner, closeLiveScanner, parseBarcodeAndSubmit, 
  loadUserRecords, handleRecordFilterSearch, clearRecordFilter, applyRecordFilter, 
  editRecord, toggleMonthlyRecordStatus, refreshMonthlyData, // 👈 補在這裡
  refreshDashboardData, renderMonthlyDashboard, showTableDetailModal
} from './monthly.js';

import { 
  initHistoryMode, loadHistoryData, handleDrugSearch, selectDrugFilter, clearDrugFilter, 
  renderHistoryTable, openDetailsModal, toggleModalCol 
} from './history.js';

window.switchView = switchView;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;

window.selectMode = function(modeName) {
  session.mode = modeName;
  if(modeName === '每日盤點') initDailyMode();
  else if (modeName === '月盤點') initMonthlyMode();
};

window.refreshMonthlyData = refreshMonthlyData;
window.initDailyMode = initDailyMode;
window.changeDailyDate = changeDailyDate;
window.switchDailyTab = switchDailyTab;
window.submitDailyOne = submitDailyOne;
window.openAdminSort = openAdminSort;
window.toggleVisibility = toggleVisibility;
window.highlightSearchItem = highlightSearchItem;
window.rebuildAdminList = rebuildAdminList;
window.saveAdminDataToServer = saveAdminDataToServer;

window.initMonthlyMode = initMonthlyMode;
window.switchMonthlyTab = switchMonthlyTab;
window.switchStockSubTab = switchStockSubTab;
window.switchDeskSubTab = switchDeskSubTab;
window.switchOnlineSubTab = switchOnlineSubTab;
window.handleStockSearch = handleStockSearch;
window.handleOnlineSearch = handleOnlineSearch;
window.selectStockDrug = selectStockDrug;
window.selectOnlineDrug = selectOnlineDrug;
window.handleTableSelectChange = handleTableSelectChange;
window.submitMonthlyDeskOne = submitMonthlyDeskOne;
window.submitMonthlyStock = submitMonthlyStock;
window.submitMonthlyOnline = submitMonthlyOnline;
window.updateOnlineUI = updateOnlineUI;
window.startLiveScanner = startLiveScanner;
window.closeLiveScanner = closeLiveScanner;
window.parseBarcodeAndSubmit = parseBarcodeAndSubmit;
window.loadUserRecords = loadUserRecords;
window.handleRecordFilterSearch = handleRecordFilterSearch;
window.clearRecordFilter = clearRecordFilter;
window.applyRecordFilter = applyRecordFilter;
window.editRecord = editRecord;
window.editDailyQty = editDailyQty;
window.toggleDailyStatus = toggleDailyStatus;
window.toggleMonthlyRecordStatus = toggleMonthlyRecordStatus;

window.refreshDashboardData = refreshDashboardData;
window.renderMonthlyDashboard = renderMonthlyDashboard;
window.showTableDetailModal = showTableDetailModal;

window.initHistoryMode = initHistoryMode;
window.loadHistoryData = loadHistoryData;
window.handleDrugSearch = handleDrugSearch;
window.selectDrugFilter = selectDrugFilter;
window.clearDrugFilter = clearDrugFilter;
window.renderHistoryTable = renderHistoryTable;
window.openDetailsModal = openDetailsModal;
window.toggleModalCol = toggleModalCol;
