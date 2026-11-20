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
      } else if (currentDept === 'monthly_adj') {
        if (typeof window.initMonthlyAdjPortal === 'function') window.initMonthlyAdjPortal();
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
