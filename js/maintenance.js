import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { DEPT_NAME, currentDept, session } from './config.js';

const USER_STATUS_LIST = ['在職', '待確認', '調任', '離職', '留停'];
const INFO_LEVEL_LIST = ['C', 'B', 'A', 'S'];
const MGMT_ROLE_LIST = ['一般藥師', '部主管', '科主管', '單位主管', '單位代表', '行政助理', '其他'];
const STUDENT_ROLE_LIST = ['非學員', '一年期 PGY 藥師', '兩年期 PGY 藥師', '新進藥師', '其他'];
const TEACHER_ROLE_LIST = ['非教師', '指導藥師', '專任藥師', '單位主管', '藥學教育組', '部科主任', '計畫主持人', '其他', '外部教師'];
const DEPT_OPTIONS = [
  '門診藥局', '住院藥局', '急診藥局', '調配藥局',
  '藥品管理組', '藥事照護組', '藥學教育組', '藥物諮詢組',
  '臨床藥學科', '試驗用藥管理組', '智能運管組', '部本部', '藥品調劑科'
];

const UNIT_PREFIX_MAP = { opd: 'BA', ipd: 'BF', erd: 'BE', comp: 'BG' };
const UNIT_LABEL_MAP = { BA: '門診藥局(BA)', BF: '住院藥局(BF)', BE: '急診藥局(BE)', BG: '調配藥局(BG)' };
const unitPrefix = UNIT_PREFIX_MAP[currentDept] || 'BF';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

let usersCache = [];
let portalPermsCache = [];
let drugMasterSelectList = [];
let parsedMasterRows = [];
let parsedSapDailyRows = [];
let parsedSapMonthlyRows = [];
let dailySnapCache = [];
let monthlySnapCache = [];

// 分層儲位維護狀態 (即時自動存檔 + 鎖定儲位碼 + 分段框拖拉)
let hierAreas = [];
let hierTables = [];
let hierLocations = [];
let hierSegments = [];
let selectedAreaId = null;
let selectedTableId = null;
let selectedSegmentNo = 1;
let areaSortable = null;
let tableSortable = null;

let userModalInstance = null;
let areaModalInstance = null;
let tableModalInstance = null;
let locModalInstance = null;

function fillSelect(id, list, selectedVal) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = list.map(v => `<option value="${v}" ${v === selectedVal ? 'selected' : ''}>${v}</option>`).join('');
}

function normalizeExcelDate(v) {
  if (!v) return '';
  if (typeof v === 'number' && window.XLSX) {
    const d = window.XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim().replace(/\//g, '-');
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : s.substring(0, 10);
}

function indexToAlpha(idx) {
  return ALPHABET[idx] || 'Z';
}

function indexToTwoLetters(majorIdx, minorIdx) {
  return `${ALPHABET[majorIdx] || 'Z'}${ALPHABET[minorIdx] || 'Z'}`;
}

function calcDiffPct(diff, sap) {
  const d = Number(diff) || 0;
  const s = Number(sap) || 0;
  if (s === 0) return d === 0 ? '0.00%' : (d > 0 ? '+100.00%' : '-100.00%');
  const pct = (d / Math.abs(s)) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

// =====================================================================
// 一、藥師權限管理
// =====================================================================
export function initUserMgmtPortal() {
  switchView('view-user-mgmt');
  loadUsersList();
}

export function autoGenerateUserEmail() {
  const idInput = document.getElementById('u-user-id');
  const emailInput = document.getElementById('u-email');
  if (!idInput || !emailInput) return;
  const cleanId = idInput.value.trim().toLowerCase();
  emailInput.value = cleanId ? `femh${cleanId}@femh.org.tw` : '';
}

export function loadUsersList() {
  toggleLoader(true, '載入藥師權限資料...');
  fetchBackend('getUsersList').then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入人員失敗：' + (res?.message || '未知錯誤'));
    usersCache = res.data || [];
    renderUsersTable();
  }).catch(err => {
    toggleLoader(false);
    alert('連線失敗：' + err.message);
  });
}

export function renderUsersTable() {
  const tbody = document.getElementById('maint-users-tbody');
  if (!tbody) return;
  const kw = (document.getElementById('maint-user-search')?.value || '').toLowerCase().trim();
  const stFilter = document.getElementById('maint-user-status-filter')?.value || 'ALL';

  const list = usersCache.filter(u => {
    if (stFilter !== 'ALL' && u.status !== stFilter) return false;
    if (!kw) return true;
    return (
      (u.user_id || '').toLowerCase().includes(kw) ||
      (u.name || '').toLowerCase().includes(kw) ||
      (u.email || '').toLowerCase().includes(kw) ||
      (u.department || '').toLowerCase().includes(kw)
    );
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted fw-bold">查無符合的人員資料</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(u => {
    const stBadge = u.status === '在職' ? 'bg-success' : (u.status === '離職' ? 'bg-secondary' : 'bg-warning text-dark');
    const adminBadge = u.is_admin === '是' ? '<span class="badge bg-danger">是</span>' : '<span class="badge bg-light text-dark border">否</span>';
    return `
      <tr>
        <td class="text-center fw-bold">${u.user_id}</td>
        <td class="fw-bold text-nowrap">${u.name}</td>
        <td class="small text-secondary">${u.email || ''}</td>
        <td class="text-center"><span class="badge ${stBadge}">${u.status}</span></td>
        <td class="small text-nowrap">${u.department || '-'}</td>
        <td class="small">${u.mgmt_role} / 權限 ${u.info_level}</td>
        <td class="small">${u.student_role} / ${u.teacher_role}</td>
        <td class="text-center">${adminBadge}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary py-0" onclick="openUserEditModal('${u.user_id}')">編輯</button>
        </td>
      </tr>`;
  }).join('');
}

export function openUserEditModal(userId = '') {
  const existing = userId ? usersCache.find(u => u.user_id === userId) : null;
  const idEl = document.getElementById('u-user-id');
  idEl.value = existing ? existing.user_id : '';
  idEl.readOnly = !!existing;
  document.getElementById('u-name').value = existing ? existing.name : '';
  document.getElementById('u-email').value = existing ? existing.email : '';
  document.getElementById('u-join-date').value = existing ? existing.join_date : '';
  document.getElementById('u-leave-date').value = existing ? existing.leave_date : '';
  document.getElementById('u-last-seen').value = existing ? existing.last_seen_in_group : '';
  fillSelect('u-status', USER_STATUS_LIST, existing ? existing.status : '在職');
  fillSelect('u-info-level', INFO_LEVEL_LIST, existing ? existing.info_level : 'C');
  fillSelect('u-mgmt-role', MGMT_ROLE_LIST, existing ? existing.mgmt_role : '一般藥師');
  fillSelect('u-student-role', STUDENT_ROLE_LIST, existing ? existing.student_role : '非學員');
  fillSelect('u-teacher-role', TEACHER_ROLE_LIST, existing ? existing.teacher_role : '非教師');
  fillSelect('u-is-admin', ['否', '是'], existing ? existing.is_admin : '否');
  fillSelect('u-department', DEPT_OPTIONS, existing ? existing.department : '住院藥局');
  if (!existing) autoGenerateUserEmail();
  if (!userModalInstance) userModalInstance = new window.bootstrap.Modal(document.getElementById('userEditModal'));
  userModalInstance.show();
}

export function submitUserEdit() {
  const userId = document.getElementById('u-user-id').value.trim().toUpperCase();
  const name = document.getElementById('u-name').value.trim();
  if (!userId || !name) return alert('請填寫員工編號與姓名！');
  autoGenerateUserEmail();
  const userPayload = {
    user_id: userId, name,
    email: document.getElementById('u-email').value.trim(),
    status: document.getElementById('u-status').value,
    join_date: document.getElementById('u-join-date').value.trim(),
    leave_date: document.getElementById('u-leave-date').value.trim(),
    last_seen_in_group: document.getElementById('u-last-seen').value.trim(),
    info_level: document.getElementById('u-info-level').value,
    mgmt_role: document.getElementById('u-mgmt-role').value,
    student_role: document.getElementById('u-student-role').value,
    teacher_role: document.getElementById('u-teacher-role').value,
    is_admin: document.getElementById('u-is-admin').value,
    department: document.getElementById('u-department').value
  };
  toggleLoader(true, '儲存藥師權限...');
  fetchBackend('saveUserRecord', { user: userPayload }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('儲存失敗：' + (res?.message || '未知錯誤'));
    if (userModalInstance) userModalInstance.hide();
    showToast('已儲存人員權限資料');
    loadUsersList();
  }).catch(err => { toggleLoader(false); alert('儲存異常：' + err.message); });
}

// =====================================================================
// 二、網站權限管理
// =====================================================================
export function initPortalPermPortal() {
  switchView('view-portal-perm');
  loadPortalPermissions();
}

export function loadPortalPermissions() {
  toggleLoader(true, '載入網站入口權限設定...');
  fetchBackend('getPortalPermissions').then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    portalPermsCache = res.data || [];
    renderPortalPermsList();
  }).catch(err => { toggleLoader(false); alert('連線失敗：' + err.message); });
}

export function renderPortalPermsList() {
  const area = document.getElementById('portal-perm-list');
  if (!area) return;
  area.innerHTML = portalPermsCache.map(p => `
    <div class="card border-0 shadow-sm mb-3 bg-white">
      <div class="card-body p-3">
        <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
          <div>
            <span class="fw-bold fs-5 text-dark">${p.portal_name}</span>
            <span class="badge bg-secondary ms-2">${p.portal_key}</span>
          </div>
          <button class="btn btn-sm btn-academic fw-bold px-3" onclick="savePortalPermRow('${p.portal_key}')">
            <i class="bi bi-check2-circle"></i> 儲存規則
          </button>
        </div>
        <div class="row g-2">
          <div class="col-md-4">
            <label class="form-label small fw-bold text-secondary">驗證模式</label>
            <select id="perm-mode-${p.portal_key}" class="form-select form-select-sm border-secondary fw-bold">
              <option value="is_admin" ${p.auth_mode === 'is_admin' ? 'selected' : ''}>僅限系統管理員 (is_admin=是)</option>
              <option value="mgmt_role" ${p.auth_mode === 'mgmt_role' ? 'selected' : ''}>指定管理角色 + 系統管理員 (如: 單位主管)</option>
              <option value="department" ${p.auth_mode === 'department' ? 'selected' : ''}>指定單位 + 系統管理員</option>
              <option value="dept_or_all" ${p.auth_mode === 'dept_or_all' ? 'selected' : ''}>指定單位 / 支援單位 + 管理員 (留空=全院可進)</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-bold text-secondary">允許單位 / 角色名稱 (逗號分隔)</label>
            <input type="text" id="perm-vals-${p.portal_key}" class="form-control form-control-sm border-secondary" value="${p.allowed_values || ''}" placeholder="例如: 單位主管 或 住院藥局">
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-bold text-secondary">額外白名單員工編號 (逗號分隔)</label>
            <input type="text" id="perm-extra-${p.portal_key}" class="form-control form-control-sm border-secondary" value="${p.extra_user_ids || ''}" placeholder="例如: 93397,88076">
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

export function savePortalPermRow(portalKey) {
  const payload = {
    portal_key: portalKey,
    auth_mode: document.getElementById(`perm-mode-${portalKey}`).value,
    allowed_values: document.getElementById(`perm-vals-${portalKey}`).value,
    extra_user_ids: document.getElementById(`perm-extra-${portalKey}`).value
  };
  toggleLoader(true, '儲存權限規則...');
  fetchBackend('savePortalPermission', { perm: payload }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('儲存失敗：' + (res?.message || '未知錯誤'));
    showToast('已更新網站入口權限規則');
    loadPortalPermissions();
  }).catch(err => { toggleLoader(false); alert('儲存異常：' + err.message); });
}

// =====================================================================
// 三、藥品管理組 (含每日/月盤點結果一致分色呈現 + 帳差百分比)
// =====================================================================
export function initDrugMgmtPortal() {
  switchView('view-drug-mgmt');
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const dEl = document.getElementById('dm-daily-date'); if (dEl) dEl.value = todayStr;
  const mEl = document.getElementById('dm-monthly-month'); if (mEl) mEl.value = monthStr;
  switchDrugMgmtTab('dm-tab-master');
}

export function switchDrugMgmtTab(tabId) {
  ['dm-tab-master', 'dm-tab-sap-daily', 'dm-tab-sap-monthly', 'dm-tab-daily-res', 'dm-tab-monthly-res'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('d-none', id !== tabId);
  });
  document.querySelectorAll('#dm-tabs .nav-link').forEach(btn => {
    const active = btn.getAttribute('data-target') === tabId;
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-academic', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-white', !active);
    btn.classList.toggle('text-academic', !active);
  });

  if (tabId === 'dm-tab-master') loadDrugMasterStats();
  else if (tabId === 'dm-tab-sap-daily') loadSapHistoryList('daily');
  else if (tabId === 'dm-tab-sap-monthly') loadSapHistoryList('monthly');
  else if (tabId === 'dm-tab-daily-res') loadDailySnapshots();
  else if (tabId === 'dm-tab-monthly-res') loadMonthlySnapshots();
}

export function downloadExcelTemplate(type) {
  if (!window.XLSX) return alert('Excel 套件尚未載入完成');
  const wb = window.XLSX.utils.book_new();
  let rows = [], filename = 'template.xlsx', sheetName = 'Sheet1';
  if (type === 'master') {
    sheetName = '藥品主檔'; filename = '範本_藥品主檔更新.xlsx';
    rows = [['批價代碼', '加P', '藥品學名', '藥檔狀態'], ['BAMIN0', 'PBAMIN0', 'Amino Acid 7% 250ml/bot (Nephrosteril)', '0']];
  } else if (type === 'daily_sap') {
    sheetName = '導入每日SAP'; filename = '範本_每日SAP上傳.xlsx';
    rows = [['SAP日期', '物料', '物料說明', '數量', '單位'], ['2026-11-20', 'POTAC01', 'PR-Tacrolimus (Advagraf) <1mg> /cap', 120, 'CAP']];
  } else if (type === 'monthly_sap') {
    sheetName = '導入月SAP'; filename = '範本_月SAP上傳.xlsx';
    rows = [['SAP日期', '物料', '物料說明', '數量', '單位'], ['2026-11-30', 'PBAMIN0', 'Amino Acid 7% (Nephrosteril) 250ml/bot', 82, 'BOT']];
  }
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), sheetName);
  window.XLSX.writeFile(wb, filename);
}

export function loadDrugMasterStats() {
  fetchBackend('getDrugMasterStats').then(res => {
    if (res && res.success) {
      const el = document.getElementById('dm-master-stats');
      if (el) el.innerText = `目前資料庫藥品主檔筆數：${res.count} 筆（最後更新：${res.lastUpdated}）`;
    }
  }).catch(() => {});
}

export function handleMasterFileSelect(event) {
  const file = event.target.files[0];
  parsedMasterRows = [];
  const preview = document.getElementById('dm-master-preview');
  const btn = document.getElementById('dm-master-upload-btn');
  if (!file) { preview.innerText = '尚未選擇檔案'; btn.disabled = true; return; }
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const sheetName = wb.Sheets['藥品主檔'] ? '藥品主檔' : wb.SheetNames[0];
      const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      if (raw.length <= 1) { preview.innerText = 'Excel 中沒有資料'; btn.disabled = true; return; }
      const h = raw[0].map(x => String(x).trim());
      const pIdx = h.indexOf('批價代碼'), nIdx = h.indexOf('藥品學名'), iIdx = h.indexOf('加P'), sIdx = h.indexOf('藥檔狀態');
      if (pIdx === -1 || iIdx === -1 || nIdx === -1) {
        preview.innerHTML = `<span class="text-danger fw-bold">❌ 欄位格式不符！必須包含「批價代碼」、「加P」、「藥品學名」</span>`;
        btn.disabled = true; return;
      }
      const rows = [];
      for (let i = 1; i < raw.length; i++) {
        const r = raw[i], pCode = String(r[pIdx] || '').trim(), invCode = String(r[iIdx] || '').trim();
        if (!pCode || !invCode) continue;
        rows.push({ price_code: pCode, inv_code: invCode, drug_name: String(r[nIdx] || '').trim(), drug_status: sIdx > -1 && r[sIdx] !== '' ? String(r[sIdx]).trim() : '0' });
      }
      parsedMasterRows = rows;
      preview.innerHTML = `<div class="text-success fw-bold">✅ 格式驗證通過！共解析 ${rows.length} 筆藥品主檔</div>`;
      btn.disabled = rows.length === 0;
    } catch (err) { preview.innerText = '解析失敗：' + err.message; btn.disabled = true; }
  };
  reader.readAsArrayBuffer(file);
}

export function submitRebuildDrugMaster() {
  if (!parsedMasterRows.length || !confirm(`確定要「全刪全重建」藥品主檔（${parsedMasterRows.length} 筆）嗎？`)) return;
  toggleLoader(true, `正在全刪全重建 ${parsedMasterRows.length} 筆藥品主檔...`, true);
  fetchBackend('rebuildDrugMaster', { rows: JSON.stringify(parsedMasterRows) }).then(res => {
    toggleLoader(false, '', true);
    if (!res || !res.success) return alert('重建失敗：' + (res?.message || '未知錯誤'));
    showToast(`藥品主檔重建完成，共 ${res.count} 筆`);
    parsedMasterRows = [];
    document.getElementById('dm-master-file').value = '';
    document.getElementById('dm-master-upload-btn').disabled = true;
    loadDrugMasterStats();
  }).catch(err => { toggleLoader(false, '', true); alert('重建異常：' + err.message); });
}

export function handleSapFileSelectV2(sapType, event) {
  const file = event.target.files[0];
  const preview = document.getElementById(`dm-sap-${sapType}-preview`);
  const btn = document.getElementById(`dm-sap-${sapType}-btn`);
  if (sapType === 'daily') parsedSapDailyRows = []; else parsedSapMonthlyRows = [];
  if (!file) { preview.innerText = '尚未選擇檔案'; btn.disabled = true; return; }
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (raw.length <= 1) { preview.innerText = 'Excel 中沒有資料'; btn.disabled = true; return; }
      const h = raw[0].map(x => String(x).trim());
      const dIdx = h.indexOf('SAP日期'), mIdx = h.indexOf('物料'), nIdx = h.indexOf('物料說明'), qIdx = h.indexOf('數量'), uIdx = h.indexOf('單位');
      if (dIdx === -1 || mIdx === -1 || qIdx === -1) {
        preview.innerHTML = `<span class="text-danger fw-bold">❌ 欄位格式不符！必須包含「SAP日期」、「物料」、「數量」</span>`;
        btn.disabled = true; return;
      }
      const rows = [];
      for (let i = 1; i < raw.length; i++) {
        const r = raw[i], sapDate = normalizeExcelDate(r[dIdx]), drugCode = String(r[mIdx] || '').trim();
        if (!sapDate || !drugCode) continue;
        rows.push({ sap_date: sapDate, drug_code: drugCode, drug_name: nIdx > -1 ? String(r[nIdx] || '').trim() : '', qty: parseFloat(r[qIdx]) || 0, unit: uIdx > -1 ? String(r[uIdx] || '').trim() : '' });
      }
      if (sapType === 'daily') parsedSapDailyRows = rows; else parsedSapMonthlyRows = rows;
      preview.innerHTML = `<div class="text-success fw-bold">✅ 格式驗證通過！共 ${rows.length} 筆資料</div>`;
      btn.disabled = rows.length === 0;
    } catch (err) { preview.innerText = '解析失敗：' + err.message; btn.disabled = true; }
  };
  reader.readAsArrayBuffer(file);
}

export function uploadSapWithConfirm(sapType) {
  const rows = sapType === 'daily' ? parsedSapDailyRows : parsedSapMonthlyRows;
  if (!rows.length) return;
  const unitSelect = document.getElementById(`dm-sap-${sapType}-unit`);
  const unitCode = unitSelect.value, unitLabel = unitSelect.options[unitSelect.selectedIndex].text;
  const dates = Array.from(new Set(rows.map(x => x.sap_date))).sort();
  if (!confirm(`📋 最終確認：\n• 單位：${unitLabel}\n• 日期：${dates.join(', ')}\n• 筆數：${rows.length} 筆\n\n確定上傳並覆蓋同日資料嗎？`)) return;
  toggleLoader(true, `正在上傳 ${rows.length} 筆 SAP...`, true);
  fetchBackend('importSapBatch', { unitCode, sapType, rows: JSON.stringify(rows), replaceDate: true }).then(res => {
    toggleLoader(false, '', true);
    if (!res || !res.success) return alert('上傳失敗：' + (res?.message || '未知錯誤'));
    showToast(`已成功上傳 ${res.count} 筆至 ${unitLabel}`);
    if (sapType === 'daily') parsedSapDailyRows = []; else parsedSapMonthlyRows = [];
    document.getElementById(`dm-sap-${sapType}-file`).value = '';
    document.getElementById(`dm-sap-${sapType}-btn`).disabled = true;
    loadSapHistoryList(sapType);
  }).catch(err => { toggleLoader(false, '', true); alert('上傳異常：' + err.message); });
}

export function loadSapHistoryList(sapType) {
  const unitCode = document.getElementById(`dm-sap-${sapType}-unit`)?.value || 'BF';
  const tbody = document.getElementById(`dm-sap-${sapType}-tbody`);
  if (!tbody) return;
  fetchBackend('getSapSummary', { unitCode, sapType }).then(res => {
    const list = res?.data || [];
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-muted">目前尚無上傳紀錄</td></tr>'; return; }
    tbody.innerHTML = list.map(r => `
      <tr>
        <td class="fw-bold">${r.sap_date}</td>
        <td class="text-center">${r.item_count} 筆</td>
        <td class="text-end">${Math.round((r.total_qty || 0) * 100) / 100}</td>
        <td class="text-center"><button class="btn btn-sm btn-outline-danger py-0 fw-bold" onclick="rollbackSapDate('${sapType}', '${r.sap_date}')">取回刪除</button></td>
      </tr>`).join('');
  });
}

export function rollbackSapDate(sapType, sapDate) {
  const unitCode = document.getElementById(`dm-sap-${sapType}-unit`).value;
  if (!confirm(`確定要「取回並刪除」${unitCode} 在 ${sapDate} 的 SAP 資料嗎？`)) return;
  fetchBackend('rollbackSapByDate', { unitCode, sapType, sapDate }).then(res => {
    if (res?.success) { showToast(`已取回刪除 ${res.deleted} 筆`); loadSapHistoryList(sapType); }
  });
}

// --- 每日盤點結果 (比照月盤點結果分色呈現 + 帳差百分比) ---
export function generateDailySnapshotNow() {
  const unitCode = document.getElementById('dm-daily-unit').value;
  const dateStr = document.getElementById('dm-daily-date').value;
  if (!dateStr) return alert('請選擇日期');
  toggleLoader(true, '正在結算並存檔每日盤點結果...');
  fetchBackend('generateDailySnapshotAll', { unitCode, dateStr }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '存檔失敗');
    showToast(`已成功鎖存 ${res.count} 筆每日盤點結果`);
    loadDailySnapshots();
  }).catch(err => { toggleLoader(false); alert('存檔異常：' + err.message); });
}

export function loadDailySnapshots() {
  const unitCode = document.getElementById('dm-daily-unit')?.value || 'ALL';
  const dateStr = document.getElementById('dm-daily-date')?.value || '';
  const thead = document.getElementById('dm-daily-thead');
  const tbody = document.getElementById('dm-daily-tbody');
  if (!tbody || !thead || !dateStr) return;

  fetchBackend('getDailySnapshotsAll', { unitCode, dateStr }).then(res => {
    dailySnapCache = res?.data || [];
    if (unitCode === 'ALL') {
      thead.innerHTML = `
        <tr>
          <th class="text-center align-middle" rowspan="2">藥品代碼</th>
          <th class="align-middle" rowspan="2">藥品名稱 (鎖存快照)</th>
          <th class="text-center text-white" colspan="4" style="background-color:#1A365D;">門診藥局 (BA)</th>
          <th class="text-center text-white" colspan="4" style="background-color:#1E4D2B;">住院藥局 (BF)</th>
          <th class="text-center text-white" colspan="4" style="background-color:#7A1717;">急診藥局 (BE)</th>
          <th class="text-center text-white" colspan="4" style="background-color:#4E342E;">調配藥局 (BG)</th>
          <th class="text-center bg-dark text-white" colspan="4">全院加總</th>
        </tr>
        <tr>
          <th class="text-end small" style="background-color:#e8eef7;">SAP</th><th class="text-end small" style="background-color:#e8eef7;">實盤</th><th class="text-end small" style="background-color:#e8eef7;">帳差</th><th class="text-end small" style="background-color:#e8eef7;">帳差%</th>
          <th class="text-end small" style="background-color:#e8f3ec;">SAP</th><th class="text-end small" style="background-color:#e8f3ec;">實盤</th><th class="text-end small" style="background-color:#e8f3ec;">帳差</th><th class="text-end small" style="background-color:#e8f3ec;">帳差%</th>
          <th class="text-end small" style="background-color:#f9eaea;">SAP</th><th class="text-end small" style="background-color:#f9eaea;">實盤</th><th class="text-end small" style="background-color:#f9eaea;">帳差</th><th class="text-end small" style="background-color:#f9eaea;">帳差%</th>
          <th class="text-end small" style="background-color:#f2ecea;">SAP</th><th class="text-end small" style="background-color:#f2ecea;">實盤</th><th class="text-end small" style="background-color:#f2ecea;">帳差</th><th class="text-end small" style="background-color:#f2ecea;">帳差%</th>
          <th class="text-end small bg-light">總SAP</th><th class="text-end small bg-light">總實盤</th><th class="text-end small bg-light">總帳差</th><th class="text-end small bg-light">總帳差%</th>
        </tr>`;

      if (!dailySnapCache.length) {
        tbody.innerHTML = '<tr><td colspan="22" class="text-center py-4 text-muted">此日期尚無每日盤點結果存檔</td></tr>';
        return;
      }

      const pivot = {};
      for (const r of dailySnapCache) {
        if (!pivot[r.drug_code]) pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
        pivot[r.drug_code].units[r.unit_code] = r;
      }

      const fmtCell4 = (obj, bg) => {
        if (!obj) return `<td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td>`;
        const dc = obj.diff_qty === 0 ? 'text-success' : (obj.diff_qty > 0 ? 'text-primary' : 'text-danger');
        return `<td class="text-end" style="background-color:${bg};">${obj.sap_qty}</td><td class="text-end fw-bold" style="background-color:${bg};">${obj.actual_qty}</td><td class="text-end fw-bold ${dc}" style="background-color:${bg};">${obj.diff_qty > 0 ? '+' + obj.diff_qty : obj.diff_qty}</td><td class="text-end fw-bold ${dc}" style="background-color:${bg};">${calcDiffPct(obj.diff_qty, obj.sap_qty)}</td>`;
      };

      tbody.innerHTML = Object.values(pivot).sort((a, b) => a.drug_code.localeCompare(b.drug_code)).map(item => {
        let totSap = 0, totAct = 0, totDiff = 0;
        ['BA', 'BF', 'BE', 'BG'].forEach(u => {
          if (item.units[u]) {
            totSap += Number(item.units[u].sap_qty) || 0;
            totAct += Number(item.units[u].actual_qty) || 0;
            totDiff += Number(item.units[u].diff_qty) || 0;
          }
        });
        const tdc = totDiff === 0 ? 'text-success' : (totDiff > 0 ? 'text-primary' : 'text-danger');
        return `
          <tr>
            <td class="text-center fw-bold text-nowrap">${item.drug_code}</td>
            <td class="fw-bold text-nowrap">${item.drug_name}</td>
            ${fmtCell4(item.units['BA'], '#f4f7fc')}
            ${fmtCell4(item.units['BF'], '#f3faf5')}
            ${fmtCell4(item.units['BE'], '#fdf4f4')}
            ${fmtCell4(item.units['BG'], '#f8f5f4')}
            <td class="text-end bg-light">${totSap}</td>
            <td class="text-end fw-bold bg-light">${totAct}</td>
            <td class="text-end fw-bold bg-light ${tdc}">${totDiff > 0 ? '+' + totDiff : totDiff}</td>
            <td class="text-end fw-bold bg-light ${tdc}">${calcDiffPct(totDiff, totSap)}</td>
          </tr>`;
      }).join('');
    } else {
      thead.innerHTML = `
        <tr>
          <th class="text-center">藥品代碼</th>
          <th>藥品名稱 (鎖存快照)</th>
          <th class="text-end">SAP數量</th>
          <th class="text-end">實際盤點</th>
          <th class="text-end">帳差</th>
          <th class="text-end">帳差百分比</th>
          <th class="text-center">存檔時間</th>
        </tr>`;
      if (!dailySnapCache.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">此日期尚無每日盤點結果存檔</td></tr>';
        return;
      }
      tbody.innerHTML = dailySnapCache.map(r => {
        const diffCls = r.diff_qty === 0 ? 'text-success' : (r.diff_qty > 0 ? 'text-primary' : 'text-danger');
        return `
          <tr>
            <td class="text-center fw-bold">${r.drug_code}</td>
            <td class="fw-bold">${r.drug_name}</td>
            <td class="text-end">${r.sap_qty}</td>
            <td class="text-end fw-bold">${r.actual_qty}</td>
            <td class="text-end fw-bold ${diffCls}">${r.diff_qty > 0 ? '+' + r.diff_qty : r.diff_qty}</td>
            <td class="text-end fw-bold ${diffCls}">${calcDiffPct(r.diff_qty, r.sap_qty)}</td>
            <td class="text-center small text-muted">${r.created_at || ''}</td>
          </tr>`;
      }).join('');
    }
  });
}

export function exportDailySnapshotsExcel() {
  if (!window.XLSX || !dailySnapCache.length) return alert('無資料可匯出');
  const unitCode = document.getElementById('dm-daily-unit')?.value || 'ALL';
  const dateStr = document.getElementById('dm-daily-date')?.value || '';
  const wb = window.XLSX.utils.book_new();
  if (unitCode === 'ALL') {
    const pivot = {};
    for (const r of dailySnapCache) {
      if (!pivot[r.drug_code]) pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
      pivot[r.drug_code].units[r.unit_code] = r;
    }
    const rows = [['藥品代碼', '藥品名稱', '門診SAP', '門診實盤', '門診帳差', '門診帳差%', '住院SAP', '住院實盤', '住院帳差', '住院帳差%', '急診SAP', '急診實盤', '急診帳差', '急診帳差%', '調配SAP', '調配實盤', '調配帳差', '調配帳差%', '全院總SAP', '全院總實盤', '全院總帳差', '全院總帳差%']];
    Object.values(pivot).sort((a, b) => a.drug_code.localeCompare(b.drug_code)).forEach(item => {
      const g = (u) => item.units[u] || { sap_qty: 0, actual_qty: 0, diff_qty: 0 };
      const ba = g('BA'), bf = g('BF'), be = g('BE'), bg = g('BG');
      const ts = (ba.sap_qty||0)+(bf.sap_qty||0)+(be.sap_qty||0)+(bg.sap_qty||0);
      const ta = (ba.actual_qty||0)+(bf.actual_qty||0)+(be.actual_qty||0)+(bg.actual_qty||0);
      const td = (ba.diff_qty||0)+(bf.diff_qty||0)+(be.diff_qty||0)+(bg.diff_qty||0);
      rows.push([item.drug_code, item.drug_name, ba.sap_qty, ba.actual_qty, ba.diff_qty, calcDiffPct(ba.diff_qty, ba.sap_qty), bf.sap_qty, bf.actual_qty, bf.diff_qty, calcDiffPct(bf.diff_qty, bf.sap_qty), be.sap_qty, be.actual_qty, be.diff_qty, calcDiffPct(be.diff_qty, be.sap_qty), bg.sap_qty, bg.actual_qty, bg.diff_qty, calcDiffPct(bg.diff_qty, bg.sap_qty), ts, ta, td, calcDiffPct(td, ts)]);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '全院每日盤點結果');
  } else {
    const rows = [['單位代碼', '單位名稱', '盤點日期', '藥品代碼', '藥品名稱', 'SAP數量', '實際盤點', '帳差', '帳差百分比', '存檔時間']];
    dailySnapCache.forEach(r => rows.push([r.unit_code, UNIT_LABEL_MAP[r.unit_code] || r.unit_code, r.record_date, r.drug_code, r.drug_name, r.sap_qty, r.actual_qty, r.diff_qty, calcDiffPct(r.diff_qty, r.sap_qty), r.created_at || '']));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '每日盤點結果');
  }
  window.XLSX.writeFile(wb, `每日盤點結果_${unitCode}_${dateStr}.xlsx`);
}

// --- 月盤點結果 (分色呈現 + 帳差百分比) ---
export function generateMonthlySnapshotNow() {
  const unitCode = document.getElementById('dm-monthly-unit').value;
  const monthStr = document.getElementById('dm-monthly-month').value;
  if (!monthStr) return alert('請選擇月份');
  toggleLoader(true, '正在結算並存檔月盤點結果...');
  fetchBackend('generateMonthlySnapshotAll', { unitCode, monthStr }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '存檔失敗');
    showToast(`已成功鎖存 ${res.count} 筆月盤點結果`);
    loadMonthlySnapshots();
  }).catch(err => { toggleLoader(false); alert('存檔異常：' + err.message); });
}

export function loadMonthlySnapshots() {
  const unitCode = document.getElementById('dm-monthly-unit')?.value || 'ALL';
  const monthStr = document.getElementById('dm-monthly-month')?.value || '';
  const thead = document.getElementById('dm-monthly-thead');
  const tbody = document.getElementById('dm-monthly-tbody');
  if (!tbody || !thead || !monthStr) return;

  fetchBackend('getMonthlySnapshotsAll', { unitCode, monthStr }).then(res => {
    monthlySnapCache = res?.data || [];
    if (unitCode === 'ALL') {
      thead.innerHTML = `
        <tr>
          <th class="text-center align-middle" rowspan="2">藥品代碼</th>
          <th class="align-middle" rowspan="2">藥品名稱 (鎖存快照)</th>
          <th class="text-center text-white" colspan="4" style="background-color:#1A365D;">門診藥局 (BA)</th>
          <th class="text-center text-white" colspan="4" style="background-color:#1E4D2B;">住院藥局 (BF)</th>
          <th class="text-center text-white" colspan="4" style="background-color:#7A1717;">急診藥局 (BE)</th>
          <th class="text-center text-white" colspan="4" style="background-color:#4E342E;">調配藥局 (BG)</th>
          <th class="text-center bg-dark text-white" colspan="4">全院加總</th>
        </tr>
        <tr>
          <th class="text-end small" style="background-color:#e8eef7;">SAP</th><th class="text-end small" style="background-color:#e8eef7;">實盤</th><th class="text-end small" style="background-color:#e8eef7;">帳差</th><th class="text-end small" style="background-color:#e8eef7;">帳差%</th>
          <th class="text-end small" style="background-color:#e8f3ec;">SAP</th><th class="text-end small" style="background-color:#e8f3ec;">實盤</th><th class="text-end small" style="background-color:#e8f3ec;">帳差</th><th class="text-end small" style="background-color:#e8f3ec;">帳差%</th>
          <th class="text-end small" style="background-color:#f9eaea;">SAP</th><th class="text-end small" style="background-color:#f9eaea;">實盤</th><th class="text-end small" style="background-color:#f9eaea;">帳差</th><th class="text-end small" style="background-color:#f9eaea;">帳差%</th>
          <th class="text-end small" style="background-color:#f2ecea;">SAP</th><th class="text-end small" style="background-color:#f2ecea;">實盤</th><th class="text-end small" style="background-color:#f2ecea;">帳差</th><th class="text-end small" style="background-color:#f2ecea;">帳差%</th>
          <th class="text-end small bg-light">總SAP</th><th class="text-end small bg-light">總實盤</th><th class="text-end small bg-light">總帳差</th><th class="text-end small bg-light">總帳差%</th>
        </tr>`;
      if (!monthlySnapCache.length) {
        tbody.innerHTML = '<tr><td colspan="22" class="text-center py-4 text-muted">此月份尚無月盤點結果存檔</td></tr>';
        return;
      }
      const pivot = {};
      for (const r of monthlySnapCache) {
        if (!pivot[r.drug_code]) pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
        pivot[r.drug_code].units[r.unit_code] = r;
      }
      const fmtCell4 = (obj, bg) => {
        if (!obj) return `<td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td>`;
        const dc = obj.diff_qty === 0 ? 'text-success' : (obj.diff_qty > 0 ? 'text-primary' : 'text-danger');
        return `<td class="text-end" style="background-color:${bg};">${obj.sap_qty}</td><td class="text-end fw-bold" style="background-color:${bg};">${obj.total_actual_qty}</td><td class="text-end fw-bold ${dc}" style="background-color:${bg};">${obj.diff_qty > 0 ? '+' + obj.diff_qty : obj.diff_qty}</td><td class="text-end fw-bold ${dc}" style="background-color:${bg};">${calcDiffPct(obj.diff_qty, obj.sap_qty)}</td>`;
      };
      tbody.innerHTML = Object.values(pivot).sort((a, b) => a.drug_code.localeCompare(b.drug_code)).map(item => {
        let totSap = 0, totAct = 0, totDiff = 0;
        ['BA', 'BF', 'BE', 'BG'].forEach(u => {
          if (item.units[u]) {
            totSap += Number(item.units[u].sap_qty) || 0;
            totAct += Number(item.units[u].total_actual_qty) || 0;
            totDiff += Number(item.units[u].diff_qty) || 0;
          }
        });
        const tdc = totDiff === 0 ? 'text-success' : (totDiff > 0 ? 'text-primary' : 'text-danger');
        return `
          <tr>
            <td class="text-center fw-bold text-nowrap">${item.drug_code}</td>
            <td class="fw-bold text-nowrap">${item.drug_name}</td>
            ${fmtCell4(item.units['BA'], '#f4f7fc')}
            ${fmtCell4(item.units['BF'], '#f3faf5')}
            ${fmtCell4(item.units['BE'], '#fdf4f4')}
            ${fmtCell4(item.units['BG'], '#f8f5f4')}
            <td class="text-end bg-light">${totSap}</td>
            <td class="text-end fw-bold bg-light">${totAct}</td>
            <td class="text-end fw-bold bg-light ${tdc}">${totDiff > 0 ? '+' + totDiff : totDiff}</td>
            <td class="text-end fw-bold bg-light ${tdc}">${calcDiffPct(totDiff, totSap)}</td>
          </tr>`;
      }).join('');
    } else {
      thead.innerHTML = `
        <tr>
          <th class="text-center">藥品代碼</th>
          <th>藥品名稱 (鎖存快照)</th>
          <th class="text-end">月SAP</th>
          <th class="text-end">調劑台</th>
          <th class="text-end">庫存</th>
          <th class="text-end">線上調整</th>
          <th class="text-end">盤點總量</th>
          <th class="text-end">帳差</th>
          <th class="text-end">帳差百分比</th>
        </tr>`;
      if (!monthlySnapCache.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">此月份尚無月盤點結果存檔</td></tr>';
        return;
      }
      tbody.innerHTML = monthlySnapCache.map(r => {
        const diffCls = r.diff_qty === 0 ? 'text-success' : (r.diff_qty > 0 ? 'text-primary' : 'text-danger');
        return `
          <tr>
            <td class="text-center fw-bold">${r.drug_code}</td>
            <td class="fw-bold">${r.drug_name}</td>
            <td class="text-end">${r.sap_qty}</td>
            <td class="text-end">${r.desk_qty}</td>
            <td class="text-end">${r.stock_qty}</td>
            <td class="text-end">${r.online_qty}</td>
            <td class="text-end fw-bold">${r.total_actual_qty}</td>
            <td class="text-end fw-bold ${diffCls}">${r.diff_qty > 0 ? '+' + r.diff_qty : r.diff_qty}</td>
            <td class="text-end fw-bold ${diffCls}">${calcDiffPct(r.diff_qty, r.sap_qty)}</td>
          </tr>`;
      }).join('');
    }
  });
}

export function exportMonthlySnapshotsExcel() {
  if (!window.XLSX || !monthlySnapCache.length) return alert('無資料可匯出');
  const unitCode = document.getElementById('dm-monthly-unit')?.value || 'ALL';
  const monthStr = document.getElementById('dm-monthly-month')?.value || '';
  const wb = window.XLSX.utils.book_new();
  if (unitCode === 'ALL') {
    const pivot = {};
    for (const r of monthlySnapCache) {
      if (!pivot[r.drug_code]) pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
      pivot[r.drug_code].units[r.unit_code] = r;
    }
    const rows = [['藥品代碼', '藥品名稱', '門診SAP', '門診實盤', '門診帳差', '門診帳差%', '住院SAP', '住院實盤', '住院帳差', '住院帳差%', '急診SAP', '急診實盤', '急診帳差', '急診帳差%', '調配SAP', '調配實盤', '調配帳差', '調配帳差%', '全院總SAP', '全院總實盤', '全院總帳差', '全院總帳差%']];
    Object.values(pivot).sort((a, b) => a.drug_code.localeCompare(b.drug_code)).forEach(item => {
      const g = (u) => item.units[u] || { sap_qty: 0, total_actual_qty: 0, diff_qty: 0 };
      const ba = g('BA'), bf = g('BF'), be = g('BE'), bg = g('BG');
      const ts = (ba.sap_qty||0)+(bf.sap_qty||0)+(be.sap_qty||0)+(bg.sap_qty||0);
      const ta = (ba.total_actual_qty||0)+(bf.total_actual_qty||0)+(be.total_actual_qty||0)+(bg.total_actual_qty||0);
      const td = (ba.diff_qty||0)+(bf.diff_qty||0)+(be.diff_qty||0)+(bg.diff_qty||0);
      rows.push([item.drug_code, item.drug_name, ba.sap_qty, ba.total_actual_qty, ba.diff_qty, calcDiffPct(ba.diff_qty, ba.sap_qty), bf.sap_qty, bf.total_actual_qty, bf.diff_qty, calcDiffPct(bf.diff_qty, bf.sap_qty), be.sap_qty, be.total_actual_qty, be.diff_qty, calcDiffPct(be.diff_qty, be.sap_qty), bg.sap_qty, bg.total_actual_qty, bg.diff_qty, calcDiffPct(bg.diff_qty, bg.sap_qty), ts, ta, td, calcDiffPct(td, ts)]);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '全院月盤點總表');
  } else {
    const rows = [['單位代碼', '單位名稱', '盤點月份', '藥品代碼', '藥品名稱', '月SAP', '調劑台', '庫存', '線上調整', '盤點總量', '帳差', '帳差百分比']];
    monthlySnapCache.forEach(r => rows.push([r.unit_code, UNIT_LABEL_MAP[r.unit_code] || r.unit_code, r.record_month, r.drug_code, r.drug_name, r.sap_qty, r.desk_qty, r.stock_qty, r.online_qty, r.total_actual_qty, r.diff_qty, calcDiffPct(r.diff_qty, r.sap_qty)]));
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '月盤點結果');
  }
  window.XLSX.writeFile(wb, `月盤點結果_${unitCode}_${monthStr}.xlsx`);
}

// =====================================================================
// 四、分層儲位維護 (每次更動立即存檔 + 鎖定儲位碼 + 分段框拖拉 + 主檔模糊篩選)
// =====================================================================
export function initHierarchyMaintenance() {
  switchView('view-maintenance');
  const titleEl = document.getElementById('maint-dept-title');
  if (titleEl) titleEl.innerHTML = `<i class="bi bi-diagram-3"></i> ${DEPT_NAME}（鎖定前綴：<code>${unitPrefix}</code>）— 分層儲位維護`;
  fetchBackend('getDrugMasterSearchList').then(res => {
    if (res?.success) drugMasterSelectList = res.data || [];
  }).catch(() => {});
  loadHierarchyData();
}

export function loadHierarchyData(silent = false) {
  if (!silent) toggleLoader(true, '載入區域、盤點表、分段與儲位...');
  fetchBackend('getHierarchyData').then(res => {
    if (!silent) toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    hierAreas = res.areas || [];
    hierTables = res.tables || [];
    hierLocations = (res.locations || []).map(l => ({
      ...l,
      is_locked: !!l.is_locked,
      segment_no: Number(l.row_no) || 1
    }));
    hierSegments = res.segments || [];

    if (!selectedAreaId || !hierAreas.some(a => a.area_id === selectedAreaId)) {
      selectedAreaId = hierAreas[0]?.area_id || null;
    }
    renderAreasColumn();
  }).catch(err => {
    if (!silent) toggleLoader(false);
    alert('連線失敗：' + err.message);
  });
}

// 計算重編碼並「立即寫入 D1」
function commitImmediateHierarchy(toastMsg = '已即時儲存並更新編碼') {
  const areaIdMap = {};
  const tableIdMap = {};

  const newAreas = hierAreas.map((a, idx) => {
    const newCode = indexToAlpha(idx);
    const newId = `${unitPrefix}${newCode}`;
    areaIdMap[a.area_id] = newId;
    return { ...a, area_code: newCode, area_id: newId };
  });

  const newTables = [];
  for (const a of newAreas) {
    const oldAreaIds = Object.keys(areaIdMap).filter(k => areaIdMap[k] === a.area_id);
    const groupTables = hierTables.filter(t => oldAreaIds.includes(t.area_code) || t.area_code === a.area_id);

    let majorIdx = 0, minorIdx = 0;
    groupTables.forEach((t, idx) => {
      if (t.is_locked) {
        tableIdMap[t.table_id] = t.table_id;
        newTables.push({ ...t, area_code: t.area_code || a.area_id });
        return;
      }
      if (idx > 0 && t.is_section_start) { majorIdx++; minorIdx = 0; }
      const newTCode = indexToTwoLetters(majorIdx, minorIdx);
      minorIdx++;
      const newTId = `${a.area_id}${newTCode}`;
      tableIdMap[t.table_id] = newTId;
      newTables.push({ ...t, area_code: a.area_id, table_code: newTCode, table_id: newTId });
    });
  }

  const newLocations = [];
  const newSegments = [];

  for (const t of newTables) {
    const oldTblIds = Object.keys(tableIdMap).filter(k => tableIdMap[k] === t.table_id);
    const groupLocs = hierLocations.filter(l => oldTblIds.includes(l.table_id) || l.table_id === t.table_id);
    const segsForTbl = hierSegments.filter(s => oldTblIds.includes(s.table_id) || s.table_id === t.table_id);

    // 收集該盤點表所有分段編號
    const segNos = Array.from(new Set([
      1,
      ...segsForTbl.map(s => Number(s.segment_no) || 1),
      ...groupLocs.map(l => Number(l.segment_no || l.row_no) || 1)
    ])).sort((a, b) => a - b);

    segNos.forEach((sNo, sIdx) => {
      const segObj = segsForTbl.find(x => Number(x.segment_no) === sNo);
      newSegments.push({
        segment_id: `${t.table_id}_SEG_${sIdx + 1}`,
        unit_code: unitPrefix,
        table_id: t.table_id,
        segment_no: sIdx + 1,
        segment_name: segObj?.segment_name || `第 ${sIdx + 1} 分段`
      });
    });

    let posSeq = 1001;
    groupLocs.forEach(l => {
      const rawSeg = Number(l.segment_no || l.row_no) || 1;
      const mappedSegIdx = segNos.indexOf(rawSeg);
      const rowNoStr = String(mappedSegIdx >= 0 ? mappedSegIdx + 1 : 1);

      if (l.is_locked && l.loc_code) {
        newLocations.push({
          ...l,
          table_id: t.table_id,
          row_no: l.row_no || rowNoStr,
          pos_no: l.pos_no || '1001',
          loc_code: l.loc_code
        });
      } else {
        const posStr = String(posSeq);
        posSeq += 2;
        newLocations.push({
          ...l,
          table_id: t.table_id,
          row_no: rowNoStr,
          pos_no: posStr,
          loc_code: `${t.table_id}${rowNoStr}${posStr}`
        });
      }
    });
  }

  fetchBackend('saveFullHierarchy', {
    areas: JSON.stringify(newAreas),
    tables: JSON.stringify(newTables),
    locations: JSON.stringify(newLocations),
    segments: JSON.stringify(newSegments)
  }).then(res => {
    if (!res || !res.success) return alert('即時存檔失敗：' + (res?.message || '未知錯誤'));
    if (selectedAreaId && areaIdMap[selectedAreaId]) selectedAreaId = areaIdMap[selectedAreaId];
    if (selectedTableId && tableIdMap[selectedTableId]) selectedTableId = tableIdMap[selectedTableId];
    showToast(toastMsg);
    loadHierarchyData(true);
  }).catch(err => alert('即時存檔異常：' + err.message));
}

export function renderAreasColumn() {
  const areaListEl = document.getElementById('hier-area-list');
  if (!areaListEl) return;

  if (!hierAreas.length) {
    areaListEl.innerHTML = '<div class="text-center text-muted small py-4">尚無區域資料，請點擊右上角新增</div>';
    selectedAreaId = null;
    renderTablesColumn();
    return;
  }

  areaListEl.innerHTML = hierAreas.map((a, idx) => {
    const active = a.area_id === selectedAreaId;
    const tblCount = hierTables.filter(t => t.area_code === a.area_id).length;
    const targetId = `${unitPrefix}${indexToAlpha(idx)}`;
    return `
      <div class="list-group-item list-group-item-action p-2 hier-area-item ${active ? 'active bg-academic border-academic' : ''}" data-area-id="${a.area_id}" style="cursor:pointer;" onclick="selectHierArea('${a.area_id}')">
        <div class="d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-1">
            <i class="bi bi-grip-vertical area-drag-handle opacity-75" style="cursor:grab;"></i>
            <span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary'} me-1">${targetId}</span>
            <span class="fw-bold">${a.area_name}</span>
          </div>
          <span class="badge ${active ? 'bg-light text-dark' : 'bg-light text-dark border'}">${tblCount} 表</span>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-1 ps-3">
          <small class="${active ? 'text-light' : 'text-muted'}">${a.area_desc || ''}</small>
          <div onclick="event.stopPropagation()">
            <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-primary'} py-0 px-1" onclick="openAreaModal('${a.area_id}')">編</button>
            <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-danger'} py-0 px-1" onclick="deleteAreaItem('${a.area_id}')">刪</button>
          </div>
        </div>
      </div>`;
  }).join('');

  if (areaSortable) areaSortable.destroy();
  if (window.Sortable) {
    areaSortable = new window.Sortable(areaListEl, {
      handle: '.area-drag-handle',
      animation: 150,
      onEnd: () => {
        const orderedIds = Array.from(areaListEl.querySelectorAll('.hier-area-item')).map(el => el.getAttribute('data-area-id'));
        hierAreas.sort((a, b) => orderedIds.indexOf(a.area_id) - orderedIds.indexOf(b.area_id));
        commitImmediateHierarchy('已更新區域排序並自動重編碼');
      }
    });
  }

  renderTablesColumn();
}

export function selectHierArea(areaId) {
  selectedAreaId = areaId;
  selectedTableId = null;
  renderAreasColumn();
}

export function renderTablesColumn() {
  const tblListEl = document.getElementById('hier-table-list');
  if (!tblListEl) return;

  const filteredTables = selectedAreaId ? hierTables.filter(t => t.area_code === selectedAreaId) : [];
  if (!filteredTables.length) {
    tblListEl.innerHTML = '<div class="text-center text-muted small py-4">此區域尚無盤點表</div>';
    selectedTableId = null;
    renderLocationsColumn();
    return;
  }

  if (!selectedTableId || !filteredTables.some(t => t.table_id === selectedTableId)) {
    selectedTableId = filteredTables[0].table_id;
  }

  let majorIdx = 0, minorIdx = 0;
  tblListEl.innerHTML = filteredTables.map((t, idx) => {
    let targetTId = t.table_id;
    if (!t.is_locked) {
      if (idx > 0 && t.is_section_start) { majorIdx++; minorIdx = 0; }
      targetTId = `${selectedAreaId}${indexToTwoLetters(majorIdx, minorIdx)}`;
      minorIdx++;
    }
    const active = t.table_id === selectedTableId;
    const locCount = hierLocations.filter(l => l.table_id === t.table_id).length;

    return `
      <div class="list-group-item list-group-item-action p-2 hier-table-item ${active ? 'active bg-academic border-academic' : ''}" data-table-id="${t.table_id}" style="cursor:pointer;" onclick="selectHierTable('${t.table_id}')">
        <div class="d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-1">
            <i class="bi bi-grip-vertical table-drag-handle opacity-75" style="cursor:grab;"></i>
            <span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary'} me-1">${targetTId}</span>
            <span class="fw-bold">${t.table_name}</span>
          </div>
          <span class="badge ${active ? 'bg-light text-dark' : 'bg-light text-dark border'}">${locCount} 儲</span>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-1 ps-3">
          <div class="d-flex align-items-center gap-1" onclick="event.stopPropagation()">
            <select class="form-select form-select-sm py-0 px-1" style="font-size:0.72rem; width:auto;" onchange="moveTableToArea('${t.table_id}', this.value)">
              ${hierAreas.map(a => `<option value="${a.area_id}" ${a.area_id === selectedAreaId ? 'selected' : ''}>移至 ${a.area_id}</option>`).join('')}
            </select>
            ${idx > 0 && !t.is_locked ? `<button class="btn btn-sm ${t.is_section_start ? 'btn-warning text-dark' : 'btn-outline-secondary'} py-0 px-1" style="font-size:0.7rem;" onclick="toggleTableSection('${t.table_id}')">${t.is_section_start ? '取消分段' : '分段'}</button>` : ''}
          </div>
          <div onclick="event.stopPropagation()">
            <button class="btn btn-sm ${t.is_locked ? 'btn-dark' : (active ? 'btn-outline-light' : 'btn-outline-secondary')} py-0 px-1" title="鎖定編碼" onclick="toggleTableLock('${t.table_id}')">${t.is_locked ? '🔒' : '🔓'}</button>
            <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-primary'} py-0 px-1" onclick="openTableModal('${t.table_id}')">編</button>
            <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-danger'} py-0 px-1" onclick="deleteTableItem('${t.table_id}')">刪</button>
          </div>
        </div>
      </div>`;
  }).join('');

  if (tableSortable) tableSortable.destroy();
  if (window.Sortable) {
    tableSortable = new window.Sortable(tblListEl, {
      handle: '.table-drag-handle',
      animation: 150,
      onEnd: () => {
        const orderedIds = Array.from(tblListEl.querySelectorAll('.hier-table-item')).map(el => el.getAttribute('data-table-id'));
        const others = hierTables.filter(t => t.area_code !== selectedAreaId);
        const reordered = orderedIds.map(id => hierTables.find(t => t.table_id === id)).filter(Boolean);
        hierTables = [...others, ...reordered];
        commitImmediateHierarchy('已更新盤點表排序並即時存檔');
      }
    });
  }

  renderLocationsColumn();
}

export function selectHierTable(tableId) {
  selectedTableId = tableId;
  renderTablesColumn();
}

export function toggleTableSection(tableId) {
  const t = hierTables.find(x => x.table_id === tableId);
  if (!t) return;
  t.is_section_start = !t.is_section_start;
  commitImmediateHierarchy('已更新盤點表分段並即時存檔');
}

export function toggleTableLock(tableId) {
  const t = hierTables.find(x => x.table_id === tableId);
  if (!t) return;
  t.is_locked = !t.is_locked;
  commitImmediateHierarchy(t.is_locked ? `已鎖定盤點表 ${tableId} 編碼` : `已解除盤點表 ${tableId} 編碼鎖定`);
}

export function moveTableToArea(tableId, newAreaId) {
  const t = hierTables.find(x => x.table_id === tableId);
  if (!t || t.area_code === newAreaId) return;
  t.area_code = newAreaId;
  commitImmediateHierarchy(`已將盤點表移至 ${newAreaId} 並即時存檔`);
}

// --- 第三層：先建立分段數字與框 -> 管理者拖拉藥品進去 -> 自動標籤儲位 ---
export function createNewSegmentBox() {
  if (!selectedTableId) return alert('請先選擇盤點表');
  const segs = hierSegments.filter(s => s.table_id === selectedTableId);
  const nextNo = segs.length > 0 ? Math.max(...segs.map(s => Number(s.segment_no) || 1)) + 1 : 1;
  const customName = prompt(`建立第 ${nextNo} 分段框，請輸入分段名稱（可留空）:`, `第 ${nextNo} 分段`);
  if (customName === null) return;

  hierSegments.push({
    segment_id: `${selectedTableId}_SEG_${Date.now()}`,
    unit_code: unitPrefix,
    table_id: selectedTableId,
    segment_no: nextNo,
    segment_name: customName.trim() || `第 ${nextNo} 分段`
  });
  selectedSegmentNo = nextNo;
  commitImmediateHierarchy(`已建立「第 ${nextNo} 分段框」`);
}

export function renderLocationsColumn() {
  const container = document.getElementById('hier-segments-container');
  const titleEl = document.getElementById('hier-loc-header');
  if (!container) return;

  const tblObj = hierTables.find(t => t.table_id === selectedTableId);
  if (titleEl) {
    titleEl.innerText = tblObj ? `第三層：分段框與儲位（${tblObj.table_id} - ${tblObj.table_name}）` : '第三層：分段框與儲位';
  }

  if (!selectedTableId) {
    container.innerHTML = '<div class="text-center py-4 text-muted">請先於左側選擇盤點表</div>';
    return;
  }

  const kw = (document.getElementById('hier-loc-search')?.value || '').toLowerCase().trim();
  const segs = hierSegments.filter(s => s.table_id === selectedTableId).sort((a, b) => Number(a.segment_no) - Number(b.segment_no));
  const segList = segs.length > 0 ? segs : [{ segment_no: 1, segment_name: '第 1 分段' }];
  if (!segList.some(s => Number(s.segment_no) === Number(selectedSegmentNo))) {
    selectedSegmentNo = Number(segList[0].segment_no) || 1;
  }

  const tableLocs = hierLocations.filter(l => l.table_id === selectedTableId);
  let posSeq = 1001;

  container.innerHTML = segList.map((seg, sIdx) => {
    const segNo = Number(seg.segment_no) || (sIdx + 1);
    const displaySegNum = sIdx + 1;
    const isSelSeg = segNo === Number(selectedSegmentNo);
    let itemsInSeg = tableLocs.filter(l => (Number(l.segment_no || l.row_no) || 1) === segNo);

    if (kw) {
      itemsInSeg = itemsInSeg.filter(l =>
        (l.loc_code || '').toLowerCase().includes(kw) ||
        (l.drug_code || '').toLowerCase().includes(kw) ||
        (l.drug_name || '').toLowerCase().includes(kw)
      );
    }

    const rowsHtml = itemsInSeg.map(l => {
      const autoCode = `${selectedTableId}${displaySegNum}${posSeq}`;
      const finalCode = l.is_locked && l.loc_code ? l.loc_code : autoCode;
      if (!l.is_locked) posSeq += 2;

      return `
        <tr class="hier-loc-row" data-loc-code="${l.loc_code}">
          <td class="text-center text-nowrap">
            <i class="bi bi-grip-vertical loc-drag-handle text-secondary me-1" style="cursor:grab;"></i>
            <span class="badge bg-info text-dark">段 ${displaySegNum}</span>
          </td>
          <td class="fw-bold text-nowrap">
            ${l.is_locked ? '<span class="badge bg-dark me-1">🔒</span>' : ''}${finalCode}
          </td>
          <td class="small text-nowrap">${l.drug_code}</td>
          <td class="fw-bold">${l.drug_name}</td>
          <td class="small text-secondary">${[l.monthly_desc, l.drug_remark, l.daily_notice].filter(Boolean).join(' / ') || '-'}</td>
          <td class="text-center text-nowrap">
            <div class="d-inline-flex gap-1 align-items-center">
              <select class="form-select form-select-sm py-0 px-1" style="font-size:0.7rem; width:auto;" onchange="moveLocToTable('${l.loc_code}', this.value)">
                ${hierTables.map(t => `<option value="${t.table_id}" ${t.table_id === selectedTableId ? 'selected' : ''}>表 ${t.table_id}</option>`).join('')}
              </select>
              <button class="btn btn-sm ${l.is_locked ? 'btn-dark' : 'btn-outline-secondary'} py-0 px-1" style="font-size:0.7rem;" title="鎖定/解鎖儲位碼" onclick="toggleLocLock('${l.loc_code}')">${l.is_locked ? '🔒' : '🔓'}</button>
              <button class="btn btn-sm btn-outline-primary py-0 px-1" onclick="openLocEditModal('${l.loc_code}')">編</button>
              <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="deleteLocItem('${l.loc_code}')">刪</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    return `
      <div class="card border ${isSelSeg ? 'border-primary' : 'border-secondary-subtle'} mb-2 shadow-xs">
        <div class="card-header py-1 px-2 d-flex justify-content-between align-items-center ${isSelSeg ? 'bg-primary bg-opacity-10' : 'bg-light'}" onclick="selectedSegmentNo=${segNo}; renderLocationsColumn();" style="cursor:pointer;">
          <div class="fw-bold small text-dark">
            <span class="badge bg-primary me-1">分段 #${displaySegNum}</span>
            <span>${seg.segment_name || `第 ${displaySegNum} 分段`}</span>
            <span class="text-muted ms-1">(${itemsInSeg.length} 筆)</span>
          </div>
          <span class="small ${isSelSeg ? 'text-primary fw-bold' : 'text-muted'}">${isSelSeg ? '● 目前新增目標分段' : '點擊選為新增分段'}</span>
        </div>
        <div class="table-responsive">
          <table class="table table-hover table-sm align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th class="text-center">分段</th>
                <th>儲位碼</th>
                <th>藥品代碼</th>
                <th>藥品名稱</th>
                <th>說明/備註/注意</th>
                <th class="text-center">操作</th>
              </tr>
            </thead>
            <tbody class="hier-seg-tbody" data-seg-no="${segNo}">
              ${rowsHtml || '<tr><td colspan="6" class="text-center py-3 text-muted small">拖拉藥品到此分段框，或點擊上方「+ 新增儲位」加入此分段</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  // 讓所有分段框互相支援跨框拖拉
  if (window.Sortable && !kw) {
    container.querySelectorAll('.hier-seg-tbody').forEach(tb => {
      new window.Sortable(tb, {
        group: 'hier-loc-group',
        handle: '.loc-drag-handle',
        animation: 150,
        onEnd: (evt) => {
          const movedCode = evt.item.getAttribute('data-loc-code');
          const targetSegNo = Number(evt.to.getAttribute('data-seg-no')) || 1;
          const locObj = hierLocations.find(x => x.loc_code === movedCode);
          if (locObj) locObj.segment_no = targetSegNo;

          // 依畫面上各分段框的順序重新排列該盤點表的儲位陣列
          const newOrderedInTable = [];
          container.querySelectorAll('.hier-seg-tbody').forEach(box => {
            const sNo = Number(box.getAttribute('data-seg-no')) || 1;
            box.querySelectorAll('.hier-loc-row').forEach(rowEl => {
              const code = rowEl.getAttribute('data-loc-code');
              const found = hierLocations.find(x => x.loc_code === code);
              if (found) {
                found.segment_no = sNo;
                newOrderedInTable.push(found);
              }
            });
          });

          const others = hierLocations.filter(l => l.table_id !== selectedTableId);
          hierLocations = [...others, ...newOrderedInTable];
          commitImmediateHierarchy('已拖拉更新分段與儲位並即時存檔');
        }
      });
    });
  }
}

export function toggleLocLock(locCode) {
  const l = hierLocations.find(x => x.loc_code === locCode);
  if (!l) return;
  l.is_locked = !l.is_locked;
  commitImmediateHierarchy(l.is_locked ? `已鎖定儲位碼 ${locCode}` : `已解除儲位碼 ${locCode} 鎖定`);
}

export function moveLocToTable(locCode, newTableId) {
  const l = hierLocations.find(x => x.loc_code === locCode);
  if (!l || l.table_id === newTableId) return;
  l.table_id = newTableId;
  commitImmediateHierarchy(`已將儲位移至 ${newTableId} 並即時存檔`);
}

export function openAreaModal(areaId = '') {
  const existing = areaId ? hierAreas.find(a => a.area_id === areaId) : null;
  document.getElementById('a-editing-id').value = existing ? existing.area_id : '';
  const nextCode = existing ? existing.area_code : indexToAlpha(hierAreas.length);
  document.getElementById('a-area-code').value = nextCode;
  document.getElementById('a-area-id').value = existing ? existing.area_id : `${unitPrefix}${nextCode}`;
  document.getElementById('a-area-name').value = existing ? existing.area_name : '';
  document.getElementById('a-area-desc').value = existing ? existing.area_desc : '';
  if (!areaModalInstance) areaModalInstance = new window.bootstrap.Modal(document.getElementById('areaEditModal'));
  areaModalInstance.show();
}

export function submitAreaEdit() {
  const editingId = document.getElementById('a-editing-id').value;
  const areaName = document.getElementById('a-area-name').value.trim();
  const areaDesc = document.getElementById('a-area-desc').value.trim();
  if (!areaName) return alert('請填寫區域名稱');
  if (editingId) {
    const t = hierAreas.find(a => a.area_id === editingId);
    if (t) { t.area_name = areaName; t.area_desc = areaDesc; }
  } else {
    const newCode = indexToAlpha(hierAreas.length);
    const newId = `${unitPrefix}${newCode}`;
    hierAreas.push({ area_id: newId, unit_code: unitPrefix, area_code: newCode, area_name: areaName, area_desc: areaDesc });
    selectedAreaId = newId;
  }
  if (areaModalInstance) areaModalInstance.hide();
  commitImmediateHierarchy('已即時儲存區域設定');
}

export function deleteAreaItem(areaId) {
  if (hierTables.some(t => t.area_code === areaId)) return alert('此區域底下尚有盤點表，請先移走或刪除盤點表');
  if (!confirm(`確定要刪除區域「${areaId}」嗎？`)) return;
  hierAreas = hierAreas.filter(a => a.area_id !== areaId);
  if (selectedAreaId === areaId) selectedAreaId = hierAreas[0]?.area_id || null;
  commitImmediateHierarchy('已刪除區域並即時存檔');
}

export function openTableModal(tableId = '') {
  if (!selectedAreaId && !tableId) return alert('請先選擇所屬區域');
  const existing = tableId ? hierTables.find(t => t.table_id === tableId) : null;
  const areaId = existing ? existing.area_code : selectedAreaId;
  document.getElementById('t-editing-id').value = existing ? existing.table_id : '';
  document.getElementById('t-area-id').value = areaId;
  const countInArea = hierTables.filter(t => t.area_code === areaId).length;
  const previewCode = existing ? existing.table_code : indexToTwoLetters(0, countInArea);
  document.getElementById('t-table-code').value = previewCode;
  document.getElementById('t-table-id').value = existing ? existing.table_id : `${areaId}${previewCode}`;
  document.getElementById('t-table-name').value = existing ? existing.table_name : '';
  document.getElementById('t-table-desc').value = existing ? existing.table_desc : '';
  if (!tableModalInstance) tableModalInstance = new window.bootstrap.Modal(document.getElementById('tableEditModal'));
  tableModalInstance.show();
}

export function submitTableEdit() {
  const editingId = document.getElementById('t-editing-id').value;
  const areaId = document.getElementById('t-area-id').value;
  const tableName = document.getElementById('t-table-name').value.trim();
  const tableDesc = document.getElementById('t-table-desc').value.trim();
  if (!tableName) return alert('請填寫盤點表名稱');
  if (editingId) {
    const t = hierTables.find(x => x.table_id === editingId);
    if (t) { t.table_name = tableName; t.table_desc = tableDesc; }
  } else {
    const tempId = `${areaId}_NEW_${Date.now()}`;
    hierTables.push({ table_id: tempId, unit_code: unitPrefix, area_code: areaId, table_code: 'NEW', table_name: tableName, table_desc: tableDesc, is_locked: false });
    selectedTableId = tempId;
  }
  if (tableModalInstance) tableModalInstance.hide();
  commitImmediateHierarchy('已即時儲存盤點表設定');
}

export function deleteTableItem(tableId) {
  if (hierLocations.some(l => l.table_id === tableId)) return alert('此盤點表底下尚有儲位，請先移走或刪除儲位');
  if (!confirm(`確定要刪除盤點表「${tableId}」嗎？`)) return;
  hierTables = hierTables.filter(t => t.table_id !== tableId);
  if (selectedTableId === tableId) selectedTableId = null;
  commitImmediateHierarchy('已刪除盤點表並即時存檔');
}

// --- 新增/編輯儲位 Modal (支援藥品主檔模糊篩選自動帶入代碼與名稱) ---
export function openLocEditModal(locCode = '') {
  if (!selectedTableId && !locCode) return alert('請先選擇盤點表');
  const existing = locCode ? hierLocations.find(l => l.loc_code === locCode) : null;
  const tblId = existing ? existing.table_id : selectedTableId;
  document.getElementById('l-editing-code').value = existing ? existing.loc_code : '';
  document.getElementById('l-table-id').value = tblId;
  document.getElementById('l-segment-no').value = existing ? (existing.segment_no || 1) : selectedSegmentNo;
  document.getElementById('l-is-locked').checked = existing ? !!existing.is_locked : false;
  document.getElementById('l-drug-search').value = existing ? `${existing.drug_code} - ${existing.drug_name}` : '';
  document.getElementById('l-drug-code').value = existing ? existing.drug_code : '';
  document.getElementById('l-drug-name').value = existing ? existing.drug_name : '';
  document.getElementById('l-monthly-desc').value = existing ? existing.monthly_desc : '';
  document.getElementById('l-drug-remark').value = existing ? existing.drug_remark : '';
  document.getElementById('l-daily-notice').value = existing ? existing.daily_notice : '';
  const dd = document.getElementById('l-drug-dropdown');
  if (dd) dd.style.display = 'none';

  if (!locModalInstance) locModalInstance = new window.bootstrap.Modal(document.getElementById('locEditModal'));
  locModalInstance.show();
}

export function handleLocDrugFuzzySearch() {
  const kw = (document.getElementById('l-drug-search')?.value || '').toLowerCase().trim();
  const dd = document.getElementById('l-drug-dropdown');
  if (!dd) return;
  if (!kw) { dd.style.display = 'none'; return; }

  const terms = kw.split(/\s+/);
  const matches = drugMasterSelectList.filter(d => {
    const str = `${d.inv_code || ''} ${d.price_code || ''} ${d.drug_name || ''}`.toLowerCase();
    return terms.every(t => str.includes(t));
  }).slice(0, 20);

  if (!matches.length) {
    dd.innerHTML = '<div class="p-2 small text-muted">藥品主檔查無相符藥品（可直接於下方手動輸入）</div>';
    dd.style.display = 'block';
    return;
  }

  dd.innerHTML = matches.map(d => `
    <div class="search-dropdown-item" onclick="pickDrugFromMaster('${(d.inv_code || d.price_code || '').replace(/'/g, "\\'")}', '${(d.drug_name || '').replace(/'/g, "\\'")}')">
      <div class="fw-bold text-primary">${d.inv_code || d.price_code} <span class="badge bg-light text-dark border ms-1">批價: ${d.price_code || '-'}</span></div>
      <div class="small text-dark">${d.drug_name}</div>
    </div>`).join('');
  dd.style.display = 'block';
}

export function pickDrugFromMaster(code, name) {
  document.getElementById('l-drug-code').value = code;
  document.getElementById('l-drug-name').value = name;
  document.getElementById('l-drug-search').value = `${code} - ${name}`;
  const dd = document.getElementById('l-drug-dropdown');
  if (dd) dd.style.display = 'none';
}

export function submitLocEdit() {
  const editingCode = document.getElementById('l-editing-code').value;
  const tblId = document.getElementById('l-table-id').value;
  const segNo = Number(document.getElementById('l-segment-no').value) || 1;
  const isLocked = !!document.getElementById('l-is-locked').checked;
  const drugCode = document.getElementById('l-drug-code').value.trim();
  const drugName = document.getElementById('l-drug-name').value.trim();
  if (!drugCode || !drugName) return alert('請填寫或從藥品主檔選取藥品代碼與藥品名稱');

  const monthlyDesc = document.getElementById('l-monthly-desc').value.trim();
  const drugRemark = document.getElementById('l-drug-remark').value.trim();
  const dailyNotice = document.getElementById('l-daily-notice').value.trim();

  if (editingCode) {
    const target = hierLocations.find(l => l.loc_code === editingCode);
    if (target) {
      target.segment_no = segNo;
      target.is_locked = isLocked;
      target.drug_code = drugCode;
      target.drug_name = drugName;
      target.monthly_desc = monthlyDesc;
      target.drug_remark = drugRemark;
      target.daily_notice = dailyNotice;
    }
  } else {
    hierLocations.push({
      loc_code: `${tblId}_NEW_${Date.now()}`,
      unit_code: unitPrefix,
      table_id: tblId,
      row_no: String(segNo),
      pos_no: '1001',
      segment_no: segNo,
      is_locked: isLocked,
      drug_code: drugCode,
      drug_name: drugName,
      monthly_desc: monthlyDesc,
      drug_remark: drugRemark,
      daily_notice: dailyNotice
    });
  }

  if (locModalInstance) locModalInstance.hide();
  commitImmediateHierarchy('已即時儲存儲位資料');
}

export function deleteLocItem(locCode) {
  if (!confirm(`確定要刪除儲位「${locCode}」嗎？`)) return;
  hierLocations = hierLocations.filter(l => l.loc_code !== locCode);
  commitImmediateHierarchy('已刪除儲位並即時存檔');
}

// =====================================================================
// 五、月盤點調帳專區 (進入後先選各單位色塊面板，各自獨立權限驗證)
// =====================================================================
let adjInitData = { headers: [], rows: [], dates: { D1: '', F1: '' }, state: { availableSymbols: [] } };
let adjFilteredRows = [];
let adjSort = { colIndex: -1, order: 'none' };
let adjNeedsRefresh = false;
let adjVerHeaders = [], adjVerRecords = [], adjVerFiltered = [];
let adjAppHeaders = [], adjAppRecords = [], adjTableMap = {};
let adjHiddenAppCols = new Set([0, 5, 8, 9, 10, 11, 13, 14, 15, 16]);
let adjMarkerData = { masterList: [], trackedItems: [], availableSymbols: [] };
let activeAdjUnitCode = null;
let pendingAdjUnitTarget = null;

function setAdjSaveStatus(msg, color = '#6c757d') {
  const el = document.getElementById('adj-save-status');
  if (el) { el.innerText = msg; el.style.color = color; }
}

export function initMonthlyAdjPortal() {
  activeAdjUnitCode = null;
  pendingAdjUnitTarget = null;
  switchView('view-monthly-adj');
  document.getElementById('adj-unit-picker-panel')?.classList.remove('d-none');
  document.getElementById('adj-workspace-panel')?.classList.add('d-none');
}

export function selectAdjUnitCard(uCode, uName, portalKey) {
  // 若已登入且具備權限可直接進入；否則彈出該單位專屬工號權限驗證框
  pendingAdjUnitTarget = { uCode, uName, portalKey };
  const empInput = document.getElementById('adj-unit-auth-id');
  const titleEl = document.getElementById('adj-unit-auth-title');
  if (titleEl) titleEl.innerText = `【${uName}】調帳權限驗證`;
  if (empInput) empInput.value = session.id || '';
  new window.bootstrap.Modal(document.getElementById('adjUnitAuthModal')).show();
}

export function confirmAdjUnitAuth() {
  if (!pendingAdjUnitTarget) return;
  const empId = (document.getElementById('adj-unit-auth-id')?.value || '').trim();
  if (!empId) return alert('請輸入員工編號');

  toggleLoader(true, `驗證 ${pendingAdjUnitTarget.uName} 調帳權限...`);
  fetchBackend('checkLogin', { id: empId, portalKey: pendingAdjUnitTarget.portalKey }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('❌ 權限驗證失敗：' + (res?.message || '無權限'));

    window.bootstrap.Modal.getInstance(document.getElementById('adjUnitAuthModal'))?.hide();
    activeAdjUnitCode = pendingAdjUnitTarget.uCode;
    const badgeEl = document.getElementById('adj-active-unit-badge');
    if (badgeEl) {
      const colorMap = { BA: '#1A365D', BF: '#1E4D2B', BE: '#7A1717', BG: '#4E342E' };
      badgeEl.style.backgroundColor = colorMap[activeAdjUnitCode] || '#6F42C1';
      badgeEl.innerText = `${pendingAdjUnitTarget.uName} (${res.userName})`;
    }
    document.getElementById('adj-unit-picker-panel')?.classList.add('d-none');
    document.getElementById('adj-workspace-panel')?.classList.remove('d-none');
    switchAdjTab('adj-tab-inventory');
    loadAdjInventoryData();
  }).catch(err => { toggleLoader(false); alert('驗證異常：' + err.message); });
}

export function switchAdjTab(tabId) {
  ['adj-tab-inventory', 'adj-tab-records', 'adj-tab-marker', 'adj-tab-version'].forEach(id => {
    const sec = document.getElementById(id);
    if (sec) sec.classList.toggle('d-none', id !== tabId);
  });
  document.querySelectorAll('#adj-main-tabs .nav-link').forEach(btn => {
    const active = btn.getAttribute('data-target') === tabId;
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-academic', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-white', !active);
    btn.classList.toggle('text-academic', !active);
  });
  if (tabId === 'adj-tab-inventory' && adjNeedsRefresh) { adjNeedsRefresh = false; loadAdjInventoryData(true); }
  else if (tabId === 'adj-tab-records') loadAdjAppRecords();
  else if (tabId === 'adj-tab-marker') loadAdjMarkers();
  else if (tabId === 'adj-tab-version') loadAdjVersionRecords();
}

export function toggleAdjColGroup(groupNum) {
  const tbl = document.getElementById('adj-data-table');
  if (!tbl) return;
  if (groupNum === 1) tbl.classList.toggle('hide-g1');
  else if (groupNum === 2) tbl.classList.toggle('hide-g2');
  else if (groupNum === 3) tbl.classList.toggle('hide-g3');
}

export function loadAdjInventoryData(silent = false) {
  const unitCode = activeAdjUnitCode || unitPrefix;
  const fDate = document.getElementById('adj-param-forecast')?.value || '';
  const rDate = document.getElementById('adj-param-reference')?.value || '';
  if (!silent) toggleLoader(true, '載入月盤點調帳總表...');
  fetchBackend('getMonthlyAdjInitData', { unitCode, forecastDate: fDate, referenceDate: rDate }).then(res => {
    if (!silent) toggleLoader(false);
    if (!res || !res.success) return alert('載入調帳資料失敗：' + (res?.message || '未知錯誤'));
    adjInitData = res;
    if (document.getElementById('adj-param-forecast')) document.getElementById('adj-param-forecast').value = res.dates?.D1 || '';
    if (document.getElementById('adj-param-reference')) document.getElementById('adj-param-reference').value = res.dates?.F1 || '';
    const symSel = document.getElementById('adj-filter-symbol');
    if (symSel) {
      const prev = symSel.value;
      symSel.innerHTML = '<option value="ALL">全部符號</option>';
      (res.state?.availableSymbols || []).forEach(s => symSel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));
      if (Array.from(symSel.options).some(o => o.value === prev)) symSel.value = prev;
    }
    if (!silent) setAdjSaveStatus('載入完成，尚未修改', 'green');
    applyAdjFilters();
  }).catch(err => { if (!silent) toggleLoader(false); alert('載入失敗：' + err.message); });
}

export function handleAdjSortClick(colIndex) {
  if (adjSort.colIndex === colIndex) adjSort.order = adjSort.order === 'none' ? 'desc' : (adjSort.order === 'desc' ? 'asc' : 'none');
  else { adjSort.colIndex = colIndex; adjSort.order = 'desc'; }
  applyAdjFilters();
}

function getAdjSortValue(row, colIndex) {
  if (colIndex === 7) return Number(row.rawF) || 0;
  if (colIndex === 11) return Number(row.rawJ) || 0;
  if (colIndex === 18) return Number(row.rawQ) || 0;
  const v = row.rowData[colIndex];
  const n = Number(v);
  return (v !== '' && v !== null && !isNaN(n)) ? n : String(v ?? '');
}

export function applyAdjFilters() {
  let rows = [...(adjInitData.rows || [])];
  const kw = (document.getElementById('adj-search-input')?.value || '').toLowerCase().trim();
  const sym = document.getElementById('adj-filter-symbol')?.value || 'ALL';
  const fltPrev = document.getElementById('adj-filter-prev')?.value || 'ALL';
  const fltCurr = document.getElementById('adj-filter-curr')?.value || 'HAS_VALUE';
  if (kw) rows = rows.filter(r => kw.split(/\s+/).every(t => (`${r.rowData[0]} ${r.rowData[1]}`).toLowerCase().includes(t)));
  if (sym !== 'ALL') rows = rows.filter(r => String(r.rowData[12] || '').trim() === sym);
  if (fltPrev !== 'ALL') rows = rows.filter(r => { const hv = (Number(r.rowData[2]) !== 0 || Number(r.rowData[3]) !== 0 || Number(r.rowData[5]) !== 0); return fltPrev === 'HAS_VALUE' ? hv : !hv; });
  if (fltCurr !== 'ALL') rows = rows.filter(r => { const hv = (Number(r.rowData[8]) !== 0 || Number(r.rowData[9]) !== 0); return fltCurr === 'HAS_VALUE' ? hv : !hv; });
  if (adjSort.colIndex !== -1 && adjSort.order !== 'none') {
    rows.sort((a, b) => {
      const vA = getAdjSortValue(a, adjSort.colIndex), vB = getAdjSortValue(b, adjSort.colIndex);
      return (typeof vA === 'number' && typeof vB === 'number') ? (adjSort.order === 'desc' ? vB - vA : vA - vB) : (adjSort.order === 'desc' ? String(vB).localeCompare(String(vA)) : String(vA).localeCompare(String(vB)));
    });
  } else rows.sort((a, b) => String(a.rowData[0]).localeCompare(String(b.rowData[0])));
  adjFilteredRows = rows;
  renderAdjTable(rows);
}

function renderAdjTable(rowsToRender) {
  const thead = document.getElementById('adj-thead'), tbody = document.getElementById('adj-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = '<tr>' + (adjInitData.headers || []).map((h, i) => {
    const icon = adjSort.colIndex === i ? (adjSort.order === 'asc' ? ' 🔼' : (adjSort.order === 'desc' ? ' 🔽' : '')) : ' ↕';
    const grp = i >= 2 && i <= 7 ? 'head-g1 col-g1' : (i >= 8 && i <= 11 ? 'head-g2 col-g2' : (i >= 13 && i <= 18 ? 'head-g3 col-g3' : ''));
    return `<th class="${grp} text-nowrap" style="cursor:pointer;" onclick="handleAdjSortClick(${i})">${h}${icon}</th>`;
  }).join('') + '<th class="text-center text-nowrap">盤點明細</th></tr>';
  tbody.innerHTML = '';
  (rowsToRender || []).forEach(r => {
    const tr = document.createElement('tr');
    if (r.rowData[12]) tr.classList.add('table-warning');
    r.rowData.forEach((cellData, i) => {
      const td = document.createElement('td');
      if (i >= 2 && i <= 7) td.classList.add('col-g1');
      else if (i >= 8 && i <= 11) td.classList.add('col-g2');
      else if (i >= 13 && i <= 18) td.classList.add('col-g3');
      if (i === 3 || i === 13 || i === 14) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'form-control form-control-sm border-primary';
        inp.style.width = i === 14 ? '120px' : '85px';
        inp.value = cellData;
        inp.oninput = () => {
          r.rowData[i] = inp.value; inp.style.backgroundColor = '#fff9c4'; setAdjSaveStatus('⚠️ 有變更未存檔', '#dc3545');
          if (i === 3) {
            const theory = (Number(r.rowData[2]) || 0) - ((inp.value !== '' && !isNaN(inp.value)) ? Number(inp.value) : 0);
            const diff = (Number(r.rowData[5]) || 0) - theory;
            const pct = theory <= 0 ? diff : diff / theory;
            r.rowData[4] = theory; r.rowData[6] = diff; r.rowData[7] = (pct * 100).toFixed(2) + '%'; r.rawF = pct;
            if (tr.children[4]) tr.children[4].innerText = theory; if (tr.children[6]) tr.children[6].innerText = diff; if (tr.children[7]) tr.children[7].innerText = r.rowData[7];
          } else if (i === 13) {
            const adjVal = (inp.value !== '' && !isNaN(inp.value)) ? Number(inp.value) : (Number(r.rowData[8]) || 0);
            const sapDay = Number(r.rowData[9]) || 0;
            const dDiff = adjVal - sapDay;
            const dPct = sapDay <= 0 ? dDiff : dDiff / sapDay;
            r.rowData[15] = adjVal; r.rowData[17] = dDiff; r.rowData[18] = (dPct * 100).toFixed(2) + '%'; r.rawQ = dPct;
            if (tr.children[15]) tr.children[15].innerText = adjVal; if (tr.children[17]) tr.children[17].innerText = dDiff; if (tr.children[18]) tr.children[18].innerText = r.rowData[18];
          }
        };
        td.appendChild(inp);
      } else if (i === 12) {
        const btn = document.createElement('button');
        const curSym = String(cellData || '').trim();
        btn.className = 'btn btn-sm ' + (curSym ? 'btn-warning text-dark fw-bold' : 'btn-outline-secondary');
        btn.innerText = curSym || '+ 標記';
        btn.onclick = () => {
          const nextSym = prompt(`設定 [${r.rowData[0]}] 標記（留空則移除）:`, curSym);
          if (nextSym === null) return;
          const unitCode = activeAdjUnitCode || unitPrefix;
          const req = nextSym.trim() === '' ? fetchBackend('removeMonthlyAdjMarker', { unitCode, code: r.rowData[0] }) : fetchBackend('saveMonthlyAdjMarker', { unitCode, code: r.rowData[0], name: r.rowData[1], symbol: nextSym.trim(), note: '', creator: r.rowData[0] });
          req.then(() => { r.rowData[12] = nextSym.trim(); adjNeedsRefresh = true; applyAdjFilters(); });
        };
        td.appendChild(btn);
      } else td.innerText = cellData;
      tr.appendChild(td);
    });
    const tdAct = document.createElement('td'); tdAct.className = 'text-center';
    const bDet = document.createElement('button'); bDet.className = 'btn btn-sm btn-outline-info py-0'; bDet.innerText = '📄 紀錄';
    bDet.onclick = () => { if (document.getElementById('adj-rec-search')) document.getElementById('adj-rec-search').value = r.rowData[0]; switchAdjTab('adj-tab-records'); };
    tdAct.appendChild(bDet); tr.appendChild(tdAct); tbody.appendChild(tr);
  });
}

export function handleAdjSaveVersion() {
  const reportDate = document.getElementById('adj-param-reference')?.value || '';
  if (!reportDate) return alert('請先選取盤點基準日！');
  const unitCode = activeAdjUnitCode || unitPrefix;
  if (!confirm(`即將儲存為 ${reportDate.substring(0, 7)} 月份版本（同月將覆蓋），確定嗎？`)) return;
  toggleLoader(true, '正在儲存月盤點調帳版本...');
  fetchBackend('saveMonthlyAdjVersion', { unitCode, reportDate, rows: JSON.stringify(adjInitData.rows || []) }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('存檔失敗：' + (res?.message || '未知錯誤'));
    setAdjSaveStatus(`✔️ 已存檔 (${reportDate.substring(0, 7)})`, 'green');
    showToast(res.message || '已儲存版本');
    loadAdjInventoryData(true);
  }).catch(err => { toggleLoader(false); alert('存檔異常：' + err.message); });
}

export function loadAdjAppRecords() {
  const unitCode = activeAdjUnitCode || unitPrefix;
  const startDate = document.getElementById('adj-rec-start')?.value || '';
  const endDate = document.getElementById('adj-rec-end')?.value || '';
  toggleLoader(true, '載入月盤點輸入區紀錄...');
  fetchBackend('getMonthlyAdjAppRecords', { unitCode, startDate, endDate }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    adjAppHeaders = res.headers || []; adjAppRecords = res.records || []; adjTableMap = res.tableMap || {};
    applyAdjAppRecordFilters();
  }).catch(err => { toggleLoader(false); alert('載入異常：' + err.message); });
}

export function applyAdjAppRecordFilters() {
  const kw = (document.getElementById('adj-rec-search')?.value || '').toLowerCase().trim();
  let rows = kw ? adjAppRecords.filter(r => kw.split(/\s+/).every(t => (`${r[1] || ''} ${r[2] || ''} ${r[12] || ''}`).toLowerCase().includes(t))) : [...adjAppRecords];
  const thead = document.getElementById('adj-rec-thead'), tbody = document.getElementById('adj-rec-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = '<tr>' + adjAppHeaders.map((h, i) => adjHiddenAppCols.has(i) ? '' : `<th class="text-nowrap">${h}</th>`).join('') + '</tr>';
  tbody.innerHTML = rows.map(r => '<tr>' + r.map((c, i) => adjHiddenAppCols.has(i) ? '' : `<td>${c}</td>`).join('') + '</tr>').join('');
}

export function loadAdjMarkers() {
  const unitCode = activeAdjUnitCode || unitPrefix;
  toggleLoader(true, '載入標記追蹤藥品...');
  fetchBackend('getMonthlyAdjMarkers', { unitCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    adjMarkerData = res;
    applyAdjMarkerFilters();
  }).catch(err => { toggleLoader(false); alert('載入異常：' + err.message); });
}

export function handleAdjMarkerAutocomplete() {
  const val = (document.getElementById('adj-mk-code')?.value || '').toLowerCase().trim();
  const listEl = document.getElementById('adj-mk-autocomplete');
  if (!listEl || !val) { if (listEl) listEl.style.display = 'none'; return; }
  const matches = (adjMarkerData.masterList || []).filter(m => m.code.toLowerCase().includes(val) || m.name.toLowerCase().includes(val)).slice(0, 20);
  listEl.innerHTML = matches.map(m => `<div class="search-dropdown-item" onclick="selectAdjMarkerDrug('${m.code}', '${m.name.replace(/'/g, "\\'")}')"><strong>${m.code}</strong> - ${m.name}</div>`).join('');
  listEl.style.display = matches.length ? 'block' : 'none';
}

export function selectAdjMarkerDrug(code, name) {
  document.getElementById('adj-mk-code').value = code;
  document.getElementById('adj-mk-name').value = name;
  document.getElementById('adj-mk-autocomplete').style.display = 'none';
}

export function saveAdjMarkerItem() {
  const code = (document.getElementById('adj-mk-code')?.value || '').trim();
  const name = (document.getElementById('adj-mk-name')?.value || '').trim();
  const symbol = (document.getElementById('adj-mk-symbol')?.value || '').trim();
  const note = (document.getElementById('adj-mk-note')?.value || '').trim();
  if (!code) return alert('請輸入藥品代碼');
  const unitCode = activeAdjUnitCode || unitPrefix;
  fetchBackend('saveMonthlyAdjMarker', { unitCode, code, name, symbol, note, creator: document.getElementById('nav-user-id')?.innerText || '' }).then(() => {
    adjNeedsRefresh = true; showToast('標記已儲存'); loadAdjMarkers();
  });
}

export function applyAdjMarkerFilters() {
  const kw = (document.getElementById('adj-marker-search')?.value || '').toLowerCase().trim();
  const sym = document.getElementById('adj-marker-sym-filter')?.value || 'ALL';
  const tbody = document.getElementById('adj-marker-tbody');
  if (!tbody) return;
  const list = (adjMarkerData.trackedItems || []).filter(item => (sym === 'ALL' || item.symbol === sym) && (!kw || kw.split(/\s+/).every(t => (`${item.code} ${item.name}`).toLowerCase().includes(t))));
  tbody.innerHTML = list.map(item => `<tr><td class="fw-bold">${item.code}</td><td>${item.name}</td><td>${item.symbol}</td><td>${item.note}</td><td>${item.creator || ''}</td><td>${item.updateTime || ''}</td><td><button class="btn btn-sm btn-outline-danger py-0" onclick="deleteExistingAdjMarker('${item.code}')">移除</button></td></tr>`).join('');
}

export function deleteExistingAdjMarker(code) {
  if (!confirm(`確定移除 [${code}] 的標記嗎？`)) return;
  const unitCode = activeAdjUnitCode || unitPrefix;
  fetchBackend('removeMonthlyAdjMarker', { unitCode, code }).then(() => { adjNeedsRefresh = true; showToast('已移除'); loadAdjMarkers(); });
}

export function loadAdjVersionRecords() {
  const unitCode = activeAdjUnitCode || unitPrefix;
  toggleLoader(true, '載入版本紀錄...');
  fetchBackend('getMonthlyAdjVersionRecords', { unitCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    adjVerHeaders = res.headers || []; adjVerRecords = res.records || [];
    const mSel = document.getElementById('adj-ver-month-filter');
    if (mSel) {
      const months = Array.from(new Set(adjVerRecords.map(r => String(r[0] || '').trim()).filter(Boolean))).sort().reverse();
      mSel.innerHTML = '<option value="ALL">全部月份</option>' + months.map(m => `<option value="${m}">${m}</option>`).join('');
    }
    applyAdjVersionFilters();
  }).catch(err => { toggleLoader(false); alert('載入異常：' + err.message); });
}

export function applyAdjVersionFilters() {
  const monthVal = document.getElementById('adj-ver-month-filter')?.value || 'ALL';
  const kw = (document.getElementById('adj-ver-search')?.value || '').toLowerCase().trim();
  let rows = [...adjVerRecords];
  if (monthVal !== 'ALL') rows = rows.filter(r => String(r[0] || '').trim() === monthVal);
  if (kw) rows = rows.filter(r => kw.split(/\s+/).every(t => (`${r[1] || ''} ${r[2] || ''}`).toLowerCase().includes(t)));
  adjVerFiltered = rows;
  const thead = document.getElementById('adj-ver-thead'), tbody = document.getElementById('adj-ver-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = '<tr>' + adjVerHeaders.map(h => `<th class="text-nowrap">${h}</th>`).join('') + '</tr>';
  tbody.innerHTML = rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('');
}

export function exportAdjVersionExcel() {
  if (!adjVerFiltered.length || !window.XLSX) return alert('無可匯出的版本資料');
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([adjVerHeaders, ...adjVerFiltered]), '盤點表版本紀錄');
  window.XLSX.writeFile(wb, `盤點表版本紀錄_${document.getElementById('adj-ver-month-filter')?.value || 'ALL'}.xlsx`);
}
