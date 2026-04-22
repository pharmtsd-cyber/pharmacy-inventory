import { WEB_APP_URL } from './config.js';

export function fetchBackend(action, dataPayload = {}) {
  return fetch(WEB_APP_URL, { 
    method: 'POST', 
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
    body: JSON.stringify({ action: action, data: dataPayload }) 
  })
  .then(async res => {
    if (!res.ok) {
      throw new Error(`連線錯誤: HTTP ${res.status}`);
    }
    
    const text = await res.text();
    
    try {
      return JSON.parse(text);
    } catch (err) {
      console.error("伺服器回傳非 JSON 格式:", text);
      throw new Error("伺服器回應異常，請檢查網路狀態或聯繫管理員");
    }
  });
}
