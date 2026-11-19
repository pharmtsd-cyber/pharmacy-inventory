import { WEB_APP_URL, currentDept } from './config.js';
import { updateSyncUI, showToast } from './ui.js';

export let activeUploads = 0;
export let isSyncing = false;

// ==========================================
// 📦 離線佇列管理模組
// ==========================================
export function getOfflineQueue() {
  try { return JSON.parse(localStorage.getItem('femh_offline_queue')) || []; } 
  catch(e) { return []; }
}

function saveOfflineQueue(queue) {
  localStorage.setItem('femh_offline_queue', JSON.stringify(queue));
  updateSyncUI(activeUploads);
}

// ==========================================
// 🚀 背景批次自動同步引擎 (Worker 版)
// ==========================================
export async function syncOfflineData() {
  if (isSyncing || !navigator.onLine) return;
  const queue = getOfflineQueue();
  if (queue.length === 0) return;

  isSyncing = true;
  activeUploads++;
  updateSyncUI(activeUploads);
  showToast(`📡 網路恢復！開始打包同步 ${queue.length} 筆離線資料...`, 'success');

  try {
    const res = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dept: currentDept,
        action: 'syncBatchOfflineData',
        batchArray: queue
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();

    if (result && result.success) {
      saveOfflineQueue([]);
      showToast(`🎉 成功批次上傳 ${queue.length} 筆暫存資料！`, 'success');
      window.dispatchEvent(new CustomEvent('offline-sync-complete'));
    } else {
      throw new Error(result?.message || '同步失敗');
    }
  } catch (err) {
    console.warn('⚠️ 批次同步連線異常，保留至下次：', err);
    showToast('⚠️ 批次同步連線不穩，將於背景自動重試', 'delete');
  } finally {
    activeUploads--;
    updateSyncUI(activeUploads);
    isSyncing = false;
  }
}

// ==========================================
// 🛡️ 支援斷網攔截的 fetchBackend (Worker 版)
// ==========================================
export function fetchBackend(action, data = {}, retryCount = 2) {
  return new Promise((resolve, reject) => {
    const isCriticalWrite = ['submitInventory', 'modifyDailyRecord', 'updateMonthlyRecord', 'modifyMonthlyRecordStatus', 'saveDrugNote', 'saveAdminSortData'].includes(action);

    if (isCriticalWrite) {
      activeUploads++;
      updateSyncUI(activeUploads);
    }

    const payload = {
      dept: currentDept,
      action: action
    };

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      Object.assign(payload, data);
    } else if (data) {
      payload.id = data;
    }

    const fetchOptions = {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    };

    const attemptFetch = (retriesLeft) => {
      if (!navigator.onLine && isCriticalWrite) {
        const queue = getOfflineQueue();
        queue.push({ id: Date.now().toString() + Math.random(), action, data });
        saveOfflineQueue(queue);

        activeUploads--;
        updateSyncUI(activeUploads);
        showToast('📴 目前無網路，資料已暫存於設備中', 'delete');
        return resolve({ success: true, message: '離線暫存成功' });
      }

      fetch(WEB_APP_URL, fetchOptions)
        .then(response => {
          if (!response.ok) throw new Error('網路回應錯誤，狀態碼: ' + response.status);
          return response.json();
        })
        .then(result => {
          if (isCriticalWrite) { activeUploads--; updateSyncUI(activeUploads); }
          resolve(result);
        })
        .catch(error => {
          if (retriesLeft > 0) {
            setTimeout(() => attemptFetch(retriesLeft - 1), 1000);
          } else {
            if (isCriticalWrite) {
              const queue = getOfflineQueue();
              queue.push({ id: Date.now().toString() + Math.random(), action, data });
              saveOfflineQueue(queue);

              activeUploads--;
              updateSyncUI(activeUploads);
              showToast('⚠️ 連線失敗，資料已轉存離線佇列等待重傳', 'delete');
              resolve({ success: true, message: '離線暫存成功' });
            } else {
              if (isCriticalWrite) { activeUploads--; updateSyncUI(activeUploads); }
              console.error('API Fetch 錯誤:', error);
              reject(error);
            }
          }
        });
    };

    attemptFetch(retryCount);
  });
}
