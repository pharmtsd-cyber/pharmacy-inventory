/**
 * ui.js - 負責畫面切換、載入動畫與提示訊息 
 */
import { session, DEPT_NAME, currentDept } from './config.js';

let syncTimeout = null;

export function updateSyncUI(activeCount) {
  const syncBadge = document.getElementById('nav-sync-status');
  if (!syncBadge) return;

  const offlineQueue = JSON.parse(localStorage.getItem('femh_offline_queue')) || [];
  const offlineCount = offlineQueue.length;
  const totalPending = activeCount + offlineCount;

  if (totalPending > 0) {
    clearTimeout(syncTimeout);
    syncBadge.style.display = 'inline-block';
    
    if (offlineCount > 0 && !navigator.onLine) {
      syncBadge.className = 'badge bg-danger text-white shadow-sm ms-2';
      syncBadge.innerHTML = `<i class="bi bi-wifi-off"></i> 離線暫存 ${offlineCount} 筆`;
    } else {
      syncBadge.className = 'badge bg-warning text-dark shadow-sm ms-2';
      syncBadge.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="width: 10px; height: 10px;"></span> 處理中 ${totalPending} 筆`;
    }
  } else {
    syncBadge.className = 'badge bg-success text-white shadow-sm ms-2';
    syncBadge.innerHTML = `<i class="bi bi-cloud-check-fill"></i> 已全數同步`;
    
    syncTimeout = setTimeout(() => {
      if (document.getElementById('nav-sync-status').innerHTML.includes('已全數同步')) {
        syncBadge.style.display = 'none';
      }
    }, 2000);
  }
}

let progressInterval = null;

export function toggleLoader(show, text = '系統處理中...', isBatch = false) {
  const loader = document.getElementById('loader');
  if (!loader) return;

  const loaderText = document.getElementById('loader-text');
  const spinner = document.getElementById('loader-spinner');
  const progressContainer = document.getElementById('loader-progress-container');
  const progressBar = document.getElementById('loader-progress-bar');
  
  if (show) {
    if (loaderText) loaderText.innerText = text;
    if (isBatch && progressContainer) {
      if (spinner) spinner.classList.add('d-none');
      progressContainer.classList.remove('d-none');
      progressBar.classList.remove('bg-success');
      progressBar.classList.add('bg-academic');
      progressBar.style.width = '0%';
      progressBar.innerText = '0%';
      
      let currentProgress = 0;
      clearInterval(progressInterval);
      progressInterval = setInterval(() => {
        if (currentProgress < 90) {
          currentProgress += Math.floor(Math.random() * 15) + 5; 
          if (currentProgress > 90) currentProgress = 90;
          progressBar.style.width = currentProgress + '%';
          progressBar.innerText = currentProgress + '%';
        }
      }, 400);
    } else {
      if (spinner) spinner.classList.remove('d-none');
      if (progressContainer) progressContainer.classList.add('d-none');
    }
    loader.style.display = 'flex';
  } else {
    clearInterval(progressInterval);
    if (isBatch && progressContainer && !progressContainer.classList.contains('d-none')) {
       progressBar.classList.remove('bg-academic');
       progressBar.classList.add('bg-success');
       progressBar.style.width = '100%';
       progressBar.innerText = '100%';
       setTimeout(() => {
         loader.style.display = 'none';
       }, 600);
    } else {
       loader.style.display = 'none';
    }
  }
}

export function applyDarkGrayTheme() {
  document.documentElement.style.setProperty('--academic-primary', '#495057');
}

export function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach(el => {
    el.classList.remove('active');
  });
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
  }

  // 藥品主檔、網站權限管理、月盤點調帳專區 進入後主色統一深灰色
  if (['view-drug-master-list', 'view-portal-perm', 'view-monthly-adj'].includes(viewId)) {
    applyDarkGrayTheme();
  }

  const idEl = document.getElementById('nav-user-id');
  const nameEl = document.getElementById('nav-user-name');
  const modeEl = document.getElementById('nav-mode-name');
  const actionGroup = document.getElementById('nav-action-buttons');
  const prevBtn = document.getElementById('nav-prev-btn');

  if (!idEl || !actionGroup) return;

  // 網站入口（view-lobby）不顯示導覽列返回按鈕
  if (viewId === 'view-lobby') {
    idEl.style.display = 'none';
    nameEl.style.display = 'none';
    modeEl.style.display = 'none';
    actionGroup.style.display = 'none';
    return;
  }

  // 除網站入口外，每一層皆顯示「回到上一層」與「回到網站入口」
  actionGroup.style.display = 'flex';

  if (viewId === 'view-login') {
    idEl.style.display = 'none';
    nameEl.style.display = 'none';
    modeEl.style.display = 'none';
    if (prevBtn) prevBtn.setAttribute('onclick', 'backToLobby()');
    return;
  }

  idEl.innerText = session.id || '';
  nameEl.innerText = session.name ? `${session.name} 藥師` : '';
  idEl.style.display = session.id ? 'inline-block' : 'none';
  nameEl.style.display = session.name ? 'inline-block' : 'none';

  const modeLabelMap = {
    'view-mode-select': '作業模式',
    'view-daily-app': '每日盤點',
    'view-monthly-app': '月盤點',
    'view-history-app': '對帳分析',
    'view-drug-mgmt': '藥品管理組',
    'view-portal-perm': '網站權限管理',
    'view-monthly-adj': '月盤點調帳專區',
    'view-maintenance': '分層儲位維護',
    'view-drug-master-list': '藥品主檔'
  };
  modeEl.innerText = modeLabelMap[viewId] || '作業中';
  modeEl.style.display = 'inline-block';

  // 設定各層「回到上一層」的精準目標
  if (prevBtn) {
    if (viewId === 'view-mode-select') {
      prevBtn.setAttribute('onclick', 'backToLobby()');
    } else if (viewId === 'view-history-app') {
      prevBtn.setAttribute('onclick', "switchView('view-daily-app')");
    } else if (viewId === 'view-monthly-app') {
      prevBtn.setAttribute('onclick', 'handleMonthlyBack()');
    } else if (['view-daily-app', 'view-maintenance'].includes(viewId)) {
      prevBtn.setAttribute('onclick', 'backToModeSelect()');
    } else if (viewId === 'view-monthly-adj') {
      prevBtn.setAttribute('onclick', 'handleMonthlyAdjPrevLayer()');
    } else {
      // view-user-mgmt / view-drug-mgmt / view-portal-perm / view-drug-master-list
      prevBtn.setAttribute('onclick', 'backToLobby()');
    }
  }
}

export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  let bgClass = 'bg-success';
  if (type === 'error') bgClass = 'bg-danger';
  if (type === 'delete') bgClass = 'bg-warning text-dark';
  
  toast.className = `custom-toast ${bgClass}`;
  toast.innerText = message;
  container.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.frequency.value = 800; 
    osc.start();
    osc.stop(ctx.currentTime + 0.1); 
  } catch(e) {}
}

let wakeLock = null;

export async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('Wake Lock error:', err);
  }
}

export function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => {
      wakeLock = null;
    });
  }
}
