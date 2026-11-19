import { WEB_APP_URL } from './config.js';
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
// 🚀 升級版：背景批次自動同步引擎
// ==========================================
export async function syncOfflineData() {
  if (isSyncing || !navigator.onLine) return;
  const queue = getOfflineQueue();
  if (queue.length === 0) return;

  isSyncing = true;
  activeUploads++; // 整個批次算作 1 個大型任務
  updateSyncUI(activeUploads);
  showToast(`📡 網路恢復！開始打包同步 ${queue.length} 筆離線資料...`, 'success');

  try {
    // 🌟 將整個陣列打包成一個 POST 包裹
    const fetchOptions = {
      method: 'POST',
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ 
        action: 'syncBatchOfflineData', 
        batchArray: queue 
      })
    };

    // 只需要發送一次請求！
    const res = await fetch(WEB_APP_URL, fetchOptions);
    
    // 解決 GAS POST 回傳時可能產生的 CORS 導向錯誤 (TypeError)
    if (res.ok || res.type === 'opaque') {
       saveOfflineQueue([]);
       showToast(`🎉 成功批次上傳 ${queue.length} 筆暫存資料！`, 'success');
       window.dispatchEvent(new CustomEvent('offline-sync-complete'));
    }
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
       saveOfflineQueue([]);
       showToast(`🎉 成功批次上傳 ${queue.length} 筆暫存資料！`, 'success');
       window.dispatchEvent(new CustomEvent('offline-sync-complete'));
    } else {
       console.warn('⚠️ 批次同步連線異常，保留至下次：', err);
       showToast('⚠️ 批次同步連線不穩，將於背景自動重試', 'delete');
    }
  } finally {
    activeUploads--;
    updateSyncUI(activeUploads);
    isSyncing = false;
  }
}

// ==========================================
// 🛡️ 升級版：支援斷網攔截的 fetchBackend
// ==========================================
export function fetchBackend(action, data = {}, retryCount = 3) {
  return new Promise((resolve, reject) => {
    // 💡 只有這些會改變資料庫的動作，才允許進入離線佇列
    const isCriticalWrite = ['submitInventory', 'modifyDailyRecord', 'updateMonthlyRecord', 'modifyMonthlyRecordStatus', 'saveDrugNote', 'saveAdminSortData'].includes(action);

    if (isCriticalWrite) {
      activeUploads++;
      updateSyncUI(activeUploads);
    }

    const payload = { action: action };
    
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      Object.assign(payload, data);
    } else if (data) {
      payload.id = data;
    }

    const isLargeData = (action === 'saveAdminSortData' || action === 'syncBatchOfflineData');
    let finalUrl = WEB_APP_URL;
    let fetchOptions = { redirect: 'follow' };

    if (isLargeData) {
      fetchOptions.method = 'POST';
      fetchOptions.headers = { "Content-Type": "text/plain;charset=utf-8" };
      fetchOptions.body = JSON.stringify(payload);
    } else {
      fetchOptions.method = 'GET';
      const params = new URLSearchParams();
      for (const key in payload) {
        params.append(key, payload[key]);
      }
      finalUrl = `${WEB_APP_URL}?${params.toString()}`;
    }

    const attemptFetch = (retriesLeft) => {
      // 🌟 【防線 1】：如果系統判定已經沒有網路，直接進入離線佇列
      if (!navigator.onLine && isCriticalWrite) {
        const queue = getOfflineQueue();
        queue.push({ id: Date.now().toString() + Math.random(), action, data });
        saveOfflineQueue(queue);
        
        activeUploads--;
        updateSyncUI(activeUploads);
        showToast('📴 目前無網路，資料已暫存於設備中', 'delete');
        return resolve({ success: true, message: '離線暫存成功' }); 
      }

      fetch(finalUrl, fetchOptions)
      .then(response => {
        if (!response.ok) throw new Error('網路回應錯誤，狀態碼: ' + response.status);
        return response.json();
      })
      .then(result => {
        if (!result.success && result.message && result.message.includes('忙線中')) {
          if (retriesLeft > 0) {
            setTimeout(() => attemptFetch(retriesLeft - 1), 1000 + Math.random() * 1000);
          } else {
            if (isCriticalWrite) { activeUploads--; updateSyncUI(activeUploads); }
            resolve(result); 
          }
        } else {
          if (isCriticalWrite) { activeUploads--; updateSyncUI(activeUploads); }
          resolve(result); 
        }
      })
        .catch(error => {
        // 🌟 只有 saveAdminSortData 忽略導向錯誤；打包盤點必須拿到真實的 JSON 回應才算數！
        if (action === 'saveAdminSortData' && error.name === 'TypeError' && error.message.includes('fetch')) {
          if (isCriticalWrite) { activeUploads--; updateSyncUI(activeUploads); }
          return resolve({ success: true, message: '寫入成功 (已忽略導向錯誤)' });
        }

        if (retriesLeft > 0) {
          setTimeout(() => attemptFetch(retriesLeft - 1), 1500);
        } else {
          // 🌟 【防線 2】：重試 3 次還是失敗（可能遇到醫院死角），進入離線佇列
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
