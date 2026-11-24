// ==========================================
// ⚙️ 全院多藥局與管理入口 - 核心設定與路由分流 (Cloudflare 版 v4)
// ==========================================

const urlParams = new URLSearchParams(window.location.search);
export const currentDept = urlParams.get('dept');

// 統一的 Cloudflare Worker API 網址
export const WEB_APP_URL = "https://femh-inventory-api.femhpwise.com";

export const MAINTENANCE_LINK_MAP = {};

// 入口顯示名稱對照表 (包含 4 個藥局 + 4 個管理專區)
const DEPT_NAME_MAP = {
  opd: "門診藥局",
  ipd: "住院藥局",
  erd: "急診藥局",
  comp: "調配藥局",
  drug_mgmt: "藥品管理組",
  user_mgmt: "藥師權限管理",
  portal_perm: "網站權限管理",
  monthly_adj: "月盤點調帳專區"
};

// 入口環境主題色對照表
const DEPT_COLOR_MAP = {
  opd: "#1A365D",         // 海軍藍
  ipd: "#1E4D2B",         // 海軍綠
  erd: "#7A1717",         // 海軍紅
  comp: "#4E342E",        // 海軍棕
  drug_mgmt: "#6F42C1",   // 藥品管理組：紫色
  user_mgmt: "#2B2D42",   // 權限深靛
  portal_perm: "#3D405B", // 系統管理藍灰
  monthly_adj: "#212529"  // 月盤點調帳專區：黑白色
};

export const DEPT_NAME = currentDept ? (DEPT_NAME_MAP[currentDept] || '亞東紀念醫院藥學部') : '亞東紀念醫院藥學部';
export const DEPT_COLOR = currentDept ? (DEPT_COLOR_MAP[currentDept] || '#1A365D') : '#1A365D';

export let session = {
  id: '',
  name: '',
  email: '',
  department: '',
  infoLevel: 'C',
  mgmtRole: '一般藥師',
  mode: '',
  isAdmin: false
};
