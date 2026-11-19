import { fetchBackend } from './api.js'; 
import { toggleLoader, switchView } from './ui.js'; 
import { session } from './config.js';

export function handleLogin() {
  const inputElement = document.getElementById('login-id');
  if (!inputElement) return alert('找不到輸入框元件');
  
  const id = inputElement.value.trim(); 
  if(!id) return alert('請輸入員工編號');
  
  toggleLoader(true);
  
  // 🌟 直接傳送 { id: id }，把剛剛報錯的 payload 變數拿掉！
  fetchBackend('checkLogin', { id: id }).then(res => {
    toggleLoader(false);
    
    if(res.success) {
      session.id = res.userId || res.id; 
      session.name = res.userName || res.name; 
      session.isAdmin = res.isAdmin;
      
      // 🌟 終極防呆：先檢查畫面上有沒有 'nav-info' 這個標籤，有才放名字，沒有就跳過不當機！
      const navInfoElement = document.getElementById('nav-info');
      if (navInfoElement) {
        navInfoElement.innerText = session.name;
      }
      
      // 順利切換到選單畫面
      switchView('view-mode-select'); 
      
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
  if(confirm('確定要登出嗎？')) {
    // 💡 修改：拔除網址列參數，回到乾淨的大廳首頁
    window.location.href = window.location.pathname; 
  }
}
