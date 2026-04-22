import { fetchBackend } from './api.js'; import { toggleLoader, switchView } from './ui.js'; import { session } from './config.js';
export function handleLogin() {
  const id = document.getElementById('login-id').value; const pwd = document.getElementById('login-pwd').value;
  if(!id || !pwd) return alert('請完整輸入帳號與密碼');
  toggleLoader(true);
  fetchBackend('checkLogin', { id: id, pwd: pwd }).then(res => {
    toggleLoader(false);
    if(res.success) {
      session.id = res.userId; session.name = res.userName; session.isAdmin = res.isAdmin;
      document.getElementById('nav-info').innerText = res.userName;
      const btnAdmin = document.getElementById('btn-admin-sort');
      if (btnAdmin) { if (res.isAdmin) btnAdmin.classList.remove('d-none'); else btnAdmin.classList.add('d-none'); }
      switchView('view-mode-select'); 
    } else { alert("❌ 登入失敗：" + (res.message || "未知錯誤")); }
  }).catch(err => { toggleLoader(false); alert('⚠️ 無法連線到伺服器，請檢查網路狀態。'); });
}
export function handleLogout() { if(confirm('確定要登出嗎？')) location.reload(); }
