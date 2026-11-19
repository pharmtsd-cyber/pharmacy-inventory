// ==========================================
// ⚙️ 全院多藥局系統 - 核心設定與路由分流 (Cloudflare Worker 版)
// ==========================================

// 🌟 1. 自動讀取網址列後方的參數 (opd / ipd / erd / comp)
const urlParams = new URLSearchParams(window.location.search);
export const currentDept = urlParams.get('dept');

// 🌟 2. 統一的 Cloudflare Worker API 網址 (請替換成您的真實網址)
export const WEB_APP_URL = "https://femh-inventory-api.您的帳號.workers.dev";

// 🌟 3. 各單位專屬的「盤點表維護連結」對照表 (之後改為前端維護頁前可先保留)
export const MAINTENANCE_LINK_MAP = {
  ipd: "https://docs.google.com/spreadsheets/d/1HXOY5vYQogaruF8hdSr9WqhIhBESYJh7f0l7plR4azs/edit?usp=sharing",
  opd: "https://docs.google.com/spreadsheets/d/19FeUxkDPYJ-G_ggj_HjifKUTWxVfVn30QwZdX8WVIsg/edit?usp=sharing",
  erd: "https://docs.google.com/spreadsheets/d/1sTt9kEmYgyVcUvEwwJWemo1dFImF6sqK4QCOiEZCvO0/edit?usp=sharing",
  comp: "https://docs.google.com/spreadsheets/d/1OoWvEidJVldKy75HI6mwbiaGzyeiw_VP7I0RDgMsuE4/edit?usp=sharing"
};

// 🌟 4. 各單位的「顯示名稱」對照表
const DEPT_NAME_MAP = {
  ipd: "住院藥局",
  opd: "門診藥局",
  erd: "急診藥局",
  comp: "調配藥局"
};

// 🌟 5. 各單位的「環境主題色」對照表
const DEPT_COLOR_MAP = {
  ipd: "#1E4D2B",   // 海軍綠
  opd: "#1A365D",   // 海軍藍
  erd: "#7A1717",   // 海軍紅
  comp: "#4E342E"   // 海軍棕
};

export const DEPT_NAME = currentDept ? (DEPT_NAME_MAP[currentDept] || '亞東紀念醫院藥學部') : '亞東紀念醫院藥學部';
export const DEPT_COLOR = currentDept ? (DEPT_COLOR_MAP[currentDept] || '#495057') : '#495057';

export let session = { id: '', name: '', mode: '', isAdmin: false };
