/**
 * ui.js - 負責畫面切換、載入動畫與提示訊息
 */
import { session, DEPT_NAME } from './config.js';


// ==========================================
// 🌟 背景同步狀態視覺回饋
// ==========================================
let syncTimeout = null;

export function updateSyncUI(activeCount) {
  const syncBadge = document.getElementById('nav-sync-status');
  if (!syncBadge) return;

  // 為了避免與 api.js 的循環依賴，這裡直接讀取 localStorage
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

// 切換全螢幕載入動畫 (支援進度條模式)
export function toggleLoader(show, text = '系統處理中...', isBatch = false) {
  const loader = document.getElementById('loader');
  if (!loader) return;

  const loaderText = document.getElementById('loader-text');
  const spinner = document.getElementById('loader-spinner');
  const progressContainer = document.getElementById('loader-progress-container');
  const progressBar = document.getElementById('loader-progress-bar');
  
  if (show) {
    if (loaderText) loaderText.innerText = text;
    
    // 如果是批次處理，顯示進度條並隱藏轉圈圈
    if (isBatch && progressContainer) {
      if (spinner) spinner.classList.add('d-none');
      progressContainer.classList.remove('d-none');
      progressBar.classList.remove('bg-success'); // 重置顏色
      progressBar.classList.add('bg-academic');
      progressBar.style.width = '0%';
      progressBar.innerText = '0%';
      
      let currentProgress = 0;
      clearInterval(progressInterval);
      // 模擬進度推進，跑到 90% 會停住等待伺服器
      progressInterval = setInterval(() => {
        if (currentProgress < 90) {
          currentProgress += Math.floor(Math.random() * 15) + 5; 
          if (currentProgress > 90) currentProgress = 90;
          progressBar.style.width = currentProgress + '%';
          progressBar.innerText = currentProgress + '%';
        }
      }, 400);
    } else {
      // 一般的轉圈圈模式
      if (spinner) spinner.classList.remove('d-none');
      if (progressContainer) progressContainer.classList.add('d-none');
    }
    loader.style.display = 'flex';
  } else {
    clearInterval(progressInterval);
    // 關閉時，如果是進度條模式，先填滿 100% 展現成功感再消失
    if (isBatch && progressContainer && !progressContainer.classList.contains('d-none')) {
       progressBar.classList.remove('bg-academic');
       progressBar.classList.add('bg-success');
       progressBar.style.width = '100%';
       progressBar.innerText = '100%';
       setTimeout(() => {
         loader.style.display = 'none';
       }, 600); // 留 0.6 秒讓使用者看到 100% 成功
    } else {
       loader.style.display = 'none';
    }
  }
}

/**
 * 切換主畫面 View，並自動動態渲染頂部 Navbar 資訊欄位
 */
export function switchView(viewId) {
  // 1. 切換各節點的 active 狀態
  document.querySelectorAll('.view-section').forEach(el => {
    el.classList.remove('active');
  });
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
  }

  // 2. 抓取 Navbar 所有新設計的獨立動態欄位元件
  const idEl = document.getElementById('nav-user-id');
  const nameEl = document.getElementById('nav-user-name');
  const modeEl = document.getElementById('nav-mode-name');
  const backBtn = document.getElementById('nav-back-btn');
  const logoutBtn = document.getElementById('nav-logout-btn');

  // 🌟 安全防呆，確保程式絕對不中斷
  if (!idEl) return; 

  // 3. 動態路由分流排版引擎
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

    if (viewId === 'view-daily-app') {
      modeEl.innerText = '每日盤點';
    } else if (viewId === 'view-monthly-app') {
      modeEl.innerText = '月盤點';
    } else if (viewId === 'view-history-app') {
      modeEl.innerText = '對帳分析';
    } else {
      modeEl.innerText = '作業中';
    }
    
    modeEl.style.display = 'inline-block';      
    backBtn.style.display = 'inline-block';     
    logoutBtn.style.display = 'inline-block';   
  }
}

// 顯示提示訊息 (Toast)
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

// 掃描條碼成功時的提示音
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

// ==========================================
// 🌟 螢幕長亮控制 (防止盤點時手機自動休眠)
// ==========================================
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
