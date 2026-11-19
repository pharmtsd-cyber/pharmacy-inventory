// ==========================================
// ⚙️ 全院多藥局系統 - 核心設定與路由分流 (純 Cloudflare 版)
// ==========================================

// 1. 自動讀取網址列後方的參數 (opd / ipd / erd / comp)
const urlParams = new URLSearchParams(window.location.search);
export const currentDept = urlParams.get('dept');

// 2. 統一的 Cloudflare Worker API 網址 (務必加上 https://)
export const WEB_APP_URL = "https://femh-inventory-api.femhpwise.com";

// 3. 保留空物件防止 main.js 報錯 (待前端維護頁完成後替換)
export const MAINTENANCE_LINK_MAP = {};

// 4. 各單位的「顯示名稱」對照表
const DEPT_NAME_MAP = {
  ipd: "住院藥局",
  opd: "門診藥局",
  erd: "急診藥局",
  comp: "調配藥局"
};

// 5. 各單位的「環境主題色」對照表
const DEPT_COLOR_MAP = {
  ipd: "#1E4D2B",   // 海軍綠
  opd: "#1A365D",   // 海軍藍
  erd: "#7A1717",   // 海軍紅
  comp: "#4E342E"   // 海軍棕
};

export const DEPT_NAME = currentDept ? (DEPT_NAME_MAP[currentDept] || '亞東紀念醫院藥學部') : '亞東紀念醫院藥學部';
export const DEPT_COLOR = currentDept ? (DEPT_COLOR_MAP[currentDept] || '#495057') : '#495057';

export let session = { id: '', name: '', mode: '', isAdmin: false };
