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

export function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach(el => {
    el.classList.remove('active');
  });
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
  }

  const idEl = document.getElementById('nav-user-id');
  const nameEl = document.getElementById('nav-user-name');
  const modeEl = document.getElementById('nav-mode-name');
  const backBtn = document.getElementById('nav-back-btn');
  const logoutBtn = document.getElementById('nav-logout-btn');

  if (!idEl) return; 

  if (viewId === 'view-lobby' || viewId === 'view-login') {
    idEl.style.display = 'none';
    nameEl.style.display = 'none';
    modeEl.style.display = 'none';
    backBtn.style.display = 'none';
    logoutBtn.style.display = 'none';
  } else if (viewId === 'view-mode-select') {
    idEl.innerText = session.id || '';
    nameEl.innerText = session.name ? `${session.name} 藥師` : '';
    idEl.style.display = session.id ? 'inline-block' : 'none';
    nameEl.style.display = session.name ? 'inline-block' : 'none';
    modeEl.style.display = 'none'; 
    backBtn.style.display = 'none'; 
    logoutBtn.style.display = 'inline-block'; 
  } else {
    idEl.innerText = session.id || '';
    nameEl.innerText = session.name ? `${session.name} 藥師` : '';
    idEl.style.display = session.id ? 'inline-block' : 'none';
    nameEl.style.display = session.name ? 'inline-block' : 'none';

    const isGlobalPortal = ['user_mgmt', 'drug_mgmt', 'portal_perm', 'monthly_adj'].includes(currentDept);
    if (viewId === 'view-daily-app') {
      modeEl.innerText = '每日盤點';
    } else if (viewId === 'view-monthly-app') {
      modeEl.innerText = '月盤點';
    } else if (viewId === 'view-history-app') {
      modeEl.innerText = '對帳分析';
    } else if (viewId === 'view-user-mgmt') {
      modeEl.innerText = '藥師權限管理';
    } else if (viewId === 'view-drug-mgmt') {
      modeEl.innerText = '藥品管理組';
    } else if (viewId === 'view-portal-perm') {
      modeEl.innerText = '網站權限管理';
    } else if (viewId === 'view-monthly-adj') {
      modeEl.innerText = '月盤點調帳專區';
    } else if (viewId === 'view-maintenance') {
      modeEl.innerText = '分層儲位維護';
    } else {
      modeEl.innerText = '作業中';
    }

    if (isGlobalPortal) {
      backBtn.setAttribute('onclick', 'backToLobby()');
      backBtn.innerHTML = '<i class="bi bi-arrow-left"></i> 回入口';
    } else {
      backBtn.setAttribute('onclick', 'backToModeSelect()');
      backBtn.innerHTML = '<i class="bi bi-arrow-left"></i> 返回';
    }
    
    modeEl.style.display = 'inline-block';      
    backBtn.style.display = 'inline-block';     
    logoutBtn.style.display = 'inline-block';   
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
