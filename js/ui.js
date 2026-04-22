/**
 * ui.js - 負責畫面切換、載入動畫與提示訊息
 */

// 切換全螢幕載入動畫
export function toggleLoader(show) {
  const loader = document.getElementById('loader');
  if (loader) {
    loader.style.display = show ? 'flex' : 'none';
  }
}

// 切換主畫面 View
export function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach(el => {
    el.classList.remove('active');
  });
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
  }
}

// 顯示提示訊息 (Toast)
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  
  // 根據 type 決定顏色
  let bgClass = 'bg-success';
  if (type === 'error') bgClass = 'bg-danger';
  if (type === 'delete') bgClass = 'bg-warning text-dark';
  
  toast.className = `custom-toast ${bgClass}`;
  toast.innerText = message;
  
  container.appendChild(toast);
  
  // 動畫效果
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
    osc.frequency.value = 800; // 頻率
    osc.start();
    osc.stop(ctx.currentTime + 0.1); // 短促音
  } catch(e) {
    // 瀏覽器不支援時忽略
  }
}

// 掃描時保持螢幕常亮 (防止休眠)
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
    wakeLock.release().then(() => wakeLock = null);
  }
}
