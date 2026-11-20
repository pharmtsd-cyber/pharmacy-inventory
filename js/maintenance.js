import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { DEPT_NAME, currentDept } from './config.js';

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
const unitPrefix = UNIT_PREFIX_MAP[currentDept] || 'BF';

let usersCache = [];
let portalPermsCache = [];
let parsedMasterRows = [];
let parsedSapDailyRows = [];
let parsedSapMonthlyRows = [];

let areasCache = [];
let tablesCache = [];
let locationsCache = [];
let selectedAreaId = null;
let selectedTableId = null;

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

// =====================================================================
// 一、入口專區 1：藥師權限管理 (入口處直接進入)
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
    user_id: userId,
    name: name,
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
  }).catch(err => {
    toggleLoader(false);
    alert('儲存異常：' + err.message);
  });
}

// =====================================================================
// 二、入口專區 2：網站權限管理 (控制各入口誰可進入)
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
  }).catch(err => {
    toggleLoader(false);
    alert('連線失敗：' + err.message);
  });
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
              <option value="department" ${p.auth_mode === 'department' ? 'selected' : ''}>指定單位 + 系統管理員</option>
              <option value="dept_or_all" ${p.auth_mode === 'dept_or_all' ? 'selected' : ''}>指定單位 / 支援單位 + 管理員 (留空=全院可進)</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-bold text-secondary">允許單位名稱 (多個請用逗號分隔)</label>
            <input type="text" id="perm-vals-${p.portal_key}" class="form-control form-control-sm border-secondary" value="${p.allowed_values || ''}" placeholder="例如: 住院藥局,藥品管理組">
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
  }).catch(err => {
    toggleLoader(false);
    alert('儲存異常：' + err.message);
  });
}

// =====================================================================
// 三、入口專區 3：藥品管理組 (5 大獨立分頁)
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
  ['dm-tab-master', 'dm-tab-daily-res', 'dm-tab-monthly-res', 'dm-tab-sap-daily', 'dm-tab-sap-monthly'].forEach(id => {
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
  else if (tabId === 'dm-tab-daily-res') loadDailySnapshots();
  else if (tabId === 'dm-tab-monthly-res') loadMonthlySnapshots();
  else if (tabId === 'dm-tab-sap-daily') loadSapHistoryList('daily');
  else if (tabId === 'dm-tab-sap-monthly') loadSapHistoryList('monthly');
}

// --- 3-1. 更新藥品主檔 (全刪全重建) ---
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
  if (!file) {
    preview.innerText = '尚未選擇檔案';
    btn.disabled = true;
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const sheetName = wb.Sheets['藥品主檔'] ? '藥品主檔' : wb.SheetNames[0];
      const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      if (raw.length <= 1) {
        preview.innerText = 'Excel 中沒有資料';
        btn.disabled = true;
        return;
      }
      const h = raw[0].map(x => String(x).trim());
      const pIdx = h.indexOf('批價代碼');
      const nIdx = h.indexOf('藥品學名');
      const iIdx = h.indexOf('加P');
      const sIdx = h.indexOf('藥檔狀態');

      if (pIdx === -1 || iIdx === -1 || nIdx === -1) {
        preview.innerHTML = '<span class="text-danger fw-bold">欄位格式錯誤：找不到「批價代碼」、「加P」或「藥品學名」欄位</span>';
        btn.disabled = true;
        return;
      }

      const rows = [];
      for (let i = 1; i < raw.length; i++) {
        const r = raw[i];
        const pCode = String(r[pIdx] || '').trim();
        if (!pCode) continue;
        rows.push({
          price_code: pCode,
          inv_code: String(r[iIdx] || '').trim(),
          drug_name: String(r[nIdx] || '').trim(),
          drug_status: sIdx > -1 && r[sIdx] !== '' ? String(r[sIdx]).trim() : '0'
        });
      }
      parsedMasterRows = rows;
      preview.innerHTML = `已解析 <strong>${rows.length}</strong> 筆藥品主檔（工作表：${sheetName}）。<br><span class="text-danger fw-bold">注意：執行後將會清空舊的藥品主檔並全數重建，歷史盤點結果請先確保已存檔快照。</span>`;
      btn.disabled = rows.length === 0;
    } catch (err) {
      preview.innerText = '解析失敗：' + err.message;
      btn.disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

export function submitRebuildDrugMaster() {
  if (parsedMasterRows.length === 0) return;
  if (!confirm(`⚠️ 確定要「全刪全重建」藥品主檔嗎？\n\n本次將清空舊主檔並寫入 ${parsedMasterRows.length} 筆新藥品。`)) return;

  toggleLoader(true, `正在全刪全重建 ${parsedMasterRows.length} 筆藥品主檔...`, true);
  fetchBackend('rebuildDrugMaster', { rows: JSON.stringify(parsedMasterRows) }).then(res => {
    toggleLoader(false, '', true);
    if (!res || !res.success) return alert('重建失敗：' + (res?.message || '未知錯誤'));
    showToast(`藥品主檔重建完成，共 ${res.count} 筆`);
    parsedMasterRows = [];
    document.getElementById('dm-master-file').value = '';
    document.getElementById('dm-master-preview').innerText = '重建完成';
    document.getElementById('dm-master-upload-btn').disabled = true;
    loadDrugMasterStats();
  }).catch(err => {
    toggleLoader(false, '', true);
    alert('重建異常：' + err.message);
  });
}

// --- 3-2. 每日盤點結果快照 ---
export function generateDailySnapshotNow() {
  const unitCode = document.getElementById('dm-daily-unit').value;
  const dateStr = document.getElementById('dm-daily-date').value;
  if (!dateStr) return alert('請選擇日期');

  toggleLoader(true, '正在彙整並鎖存每日盤點結果...');
  fetchBackend('generateDailySnapshot', { unitCode, dateStr }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '存檔失敗');
    showToast(`已成功鎖存 ${res.count} 筆每日盤點結果`);
    loadDailySnapshots();
  }).catch(err => {
    toggleLoader(false);
    alert('存檔異常：' + err.message);
  });
}

export function loadDailySnapshots() {
  const unitCode = document.getElementById('dm-daily-unit')?.value || 'BF';
  const dateStr = document.getElementById('dm-daily-date')?.value || '';
  const tbody = document.getElementById('dm-daily-tbody');
  if (!tbody || !dateStr) return;

  fetchBackend('getDailySnapshots', { unitCode, dateStr }).then(res => {
    const list = res?.data || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">此日期尚未產生盤點結果存檔，請點擊上方「結算並存檔結果」</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(r => {
      const diffCls = r.diff_qty === 0 ? 'text-success' : (r.diff_qty > 0 ? 'text-primary' : 'text-danger');
      return `
        <tr>
          <td class="text-center fw-bold">${r.drug_code}</td>
          <td class="fw-bold">${r.drug_name}</td>
          <td class="text-end">${r.sap_qty}</td>
          <td class="text-end fw-bold">${r.actual_qty}</td>
          <td class="text-end fw-bold ${diffCls}">${r.diff_qty > 0 ? '+' + r.diff_qty : r.diff_qty}</td>
          <td class="text-center small text-muted">${r.created_at || ''}</td>
        </tr>`;
    }).join('');
  });
}

// --- 3-3. 月盤點結果快照 ---
export function generateMonthlySnapshotNow() {
  const unitCode = document.getElementById('dm-monthly-unit').value;
  const monthStr = document.getElementById('dm-monthly-month').value;
  if (!monthStr) return alert('請選擇月份');

  toggleLoader(true, '正在彙整並鎖存月盤點結果...');
  fetchBackend('generateMonthlySnapshot', { unitCode, monthStr }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '存檔失敗');
    showToast(`已成功鎖存 ${res.count} 筆月盤點結果`);
    loadMonthlySnapshots();
  }).catch(err => {
    toggleLoader(false);
    alert('存檔異常：' + err.message);
  });
}

export function loadMonthlySnapshots() {
  const unitCode = document.getElementById('dm-monthly-unit')?.value || 'BF';
  const monthStr = document.getElementById('dm-monthly-month')?.value || '';
  const tbody = document.getElementById('dm-monthly-tbody');
  if (!tbody || !monthStr) return;

  fetchBackend('getMonthlySnapshots', { unitCode, monthStr }).then(res => {
    const list = res?.data || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">此月份尚未產生月盤點結果存檔，請點擊上方「結算並存檔結果」</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(r => {
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
        </tr>`;
    }).join('');
  });
}

// --- 3-4 & 3-5. 上傳每日 SAP / 上傳月 SAP (獨立頁面 + 二次確認 + 更新覆蓋 / 取回刪除) ---
export function handleSapFileSelectV2(sapType, event) {
  const file = event.target.files[0];
  const preview = document.getElementById(`dm-sap-${sapType}-preview`);
  const btn = document.getElementById(`dm-sap-${sapType}-btn`);
  if (sapType === 'daily') parsedSapDailyRows = [];
  else parsedSapMonthlyRows = [];

  if (!file) {
    preview.innerText = '尚未選擇檔案';
    btn.disabled = true;
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (raw.length <= 1) {
        preview.innerText = 'Excel 中沒有資料';
        btn.disabled = true;
        return;
      }
      const h = raw[0].map(x => String(x).trim());
      const dIdx = h.indexOf('SAP日期');
      const mIdx = h.indexOf('物料');
      const nIdx = h.indexOf('物料說明');
      const qIdx = h.indexOf('數量');
      const uIdx = h.indexOf('單位');

      if (dIdx === -1 || mIdx === -1 || qIdx === -1) {
        preview.innerHTML = '<span class="text-danger fw-bold">欄位格式錯誤：找不到「SAP日期」、「物料」或「數量」欄位</span>';
        btn.disabled = true;
        return;
      }

      const rows = [];
      for (let i = 1; i < raw.length; i++) {
        const r = raw[i];
        const sapDate = normalizeExcelDate(r[dIdx]);
        const drugCode = String(r[mIdx] || '').trim();
        if (!sapDate || !drugCode) continue;
        rows.push({
          sap_date: sapDate,
          drug_code: drugCode,
          drug_name: nIdx > -1 ? String(r[nIdx] || '').trim() : '',
          qty: parseFloat(r[qIdx]) || 0,
          unit: uIdx > -1 ? String(r[uIdx] || '').trim() : ''
        });
      }

      if (sapType === 'daily') parsedSapDailyRows = rows;
      else parsedSapMonthlyRows = rows;

      const dates = Array.from(new Set(rows.map(x => x.sap_date))).sort();
      preview.innerHTML = `已解析 <strong>${rows.length}</strong> 筆資料，涵蓋日期：<strong>${dates.join(', ')}</strong>`;
      btn.disabled = rows.length === 0;
    } catch (err) {
      preview.innerText = '解析失敗：' + err.message;
      btn.disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

export function uploadSapWithConfirm(sapType) {
  const rows = sapType === 'daily' ? parsedSapDailyRows : parsedSapMonthlyRows;
  if (rows.length === 0) return;

  const unitSelect = document.getElementById(`dm-sap-${sapType}-unit`);
  const unitCode = unitSelect.value;
  const unitLabel = unitSelect.options[unitSelect.selectedIndex].text;
  const typeLabel = sapType === 'daily' ? '【每日 SAP】' : '【月 SAP】';
  const dates = Array.from(new Set(rows.map(x => x.sap_date))).sort();

  const ok = confirm(
    `📋 上傳前最終確認：\n\n` +
    `• 上傳類型：${typeLabel}\n` +
    `• 目標單位：${unitLabel}\n` +
    `• 資料日期：${dates.join(', ')}\n` +
    `• 總筆數：${rows.length} 筆\n\n` +
    `系統將自動覆蓋該單位同日期的舊 SAP 資料，確定要上傳嗎？`
  );
  if (!ok) return;

  toggleLoader(true, `正在上傳 ${rows.length} 筆 ${typeLabel}...`, true);
  fetchBackend('importSapBatch', {
    unitCode,
    sapType,
    rows: JSON.stringify(rows),
    replaceDate: true
  }).then(res => {
    toggleLoader(false, '', true);
    if (!res || !res.success) return alert('上傳失敗：' + (res?.message || '未知錯誤'));
    showToast(`已成功上傳 ${res.count} 筆至 ${unitLabel}`);
    if (sapType === 'daily') parsedSapDailyRows = [];
    else parsedSapMonthlyRows = [];
    document.getElementById(`dm-sap-${sapType}-file`).value = '';
    document.getElementById(`dm-sap-${sapType}-preview`).innerText = '上傳成功！若上傳有誤，可於下方紀錄點選「取回刪除」或重新選擇正確檔案覆蓋更新。';
    document.getElementById(`dm-sap-${sapType}-btn`).disabled = true;
    loadSapHistoryList(sapType);
  }).catch(err => {
    toggleLoader(false, '', true);
    alert('上傳異常：' + err.message);
  });
}

export function loadSapHistoryList(sapType) {
  const unitCode = document.getElementById(`dm-sap-${sapType}-unit`)?.value || 'BF';
  const tbody = document.getElementById(`dm-sap-${sapType}-tbody`);
  if (!tbody) return;

  fetchBackend('getSapSummary', { unitCode, sapType }).then(res => {
    const list = res?.data || [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-muted">目前尚無上傳紀錄</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(r => `
      <tr>
        <td class="fw-bold">${r.sap_date}</td>
        <td class="text-center">${r.item_count} 筆</td>
        <td class="text-end">${Math.round((r.total_qty || 0) * 100) / 100}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-danger py-0 fw-bold" onclick="rollbackSapDate('${sapType}', '${r.sap_date}')">
            <i class="bi bi-arrow-counterclockwise"></i> 取回刪除
          </button>
        </td>
      </tr>
    `).join('');
  });
}

export function rollbackSapDate(sapType, sapDate) {
  const unitSelect = document.getElementById(`dm-sap-${sapType}-unit`);
  const unitCode = unitSelect.value;
  const unitLabel = unitSelect.options[unitSelect.selectedIndex].text;
  if (!confirm(`⚠️ 確定要「取回並刪除」${unitLabel} 在 ${sapDate} 的所有 SAP 資料嗎？`)) return;

  toggleLoader(true, '正在取回刪除 SAP 資料...');
  fetchBackend('rollbackSapByDate', { unitCode, sapType, sapDate }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('取回失敗：' + (res?.message || '未知錯誤'));
    showToast(`已取回刪除 ${res.deleted} 筆資料`);
    loadSapHistoryList(sapType);
  }).catch(err => {
    toggleLoader(false);
    alert('操作異常：' + err.message);
  });
}

// =====================================================================
// 四、各單位內部：分層儲位維護 (第一層: 區域 -> 第二層: 盤點表 -> 第三層: 儲位)
// =====================================================================
export function initHierarchyMaintenance() {
  switchView('view-maintenance');
  const titleEl = document.getElementById('maint-dept-title');
  if (titleEl) titleEl.innerText = `${DEPT_NAME} — 分層儲位維護`;
  loadHierarchyData();
}

export function loadHierarchyData() {
  toggleLoader(true, '載入區域、盤點表與儲位架構...');
  fetchBackend('getHierarchyData').then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    areasCache = res.areas || [];
    tablesCache = res.tables || [];
    locationsCache = res.locations || [];

    // 若未選取區域或原區域已被刪，自動選第一個
    if (!selectedAreaId || !areasCache.some(a => a.area_id === selectedAreaId)) {
      selectedAreaId = areasCache[0]?.area_id || null;
    }
    renderAreasColumn();
  }).catch(err => {
    toggleLoader(false);
    alert('連線失敗：' + err.message);
  });
}

export function renderAreasColumn() {
  const areaListEl = document.getElementById('hier-area-list');
  if (!areaListEl) return;

  if (areasCache.length === 0) {
    areaListEl.innerHTML = '<div class="text-center text-muted small py-4">尚無區域資料，請點擊右上角新增</div>';
    selectedAreaId = null;
    renderTablesColumn();
    return;
  }

  areaListEl.innerHTML = areasCache.map(a => {
    const active = a.area_id === selectedAreaId;
    const tblCount = tablesCache.filter(t => t.area_code === a.area_id).length;
    return `
      <div class="list-group-item list-group-item-action p-2 ${active ? 'active bg-academic border-academic' : ''}" style="cursor:pointer;" onclick="selectHierArea('${a.area_id}')">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary'} me-1">${a.area_id}</span>
            <span class="fw-bold">${a.area_name}</span>
          </div>
          <span class="badge ${active ? 'bg-warning text-dark' : 'bg-light text-dark border'}">${tblCount} 表</span>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-1">
          <small class="${active ? 'text-light' : 'text-muted'}">${a.area_desc || ''}</small>
          <div onclick="event.stopPropagation()">
            <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-primary'} py-0 px-1" onclick="openAreaModal('${a.area_id}')">編</button>
            <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-danger'} py-0 px-1" onclick="deleteAreaItem('${a.area_id}')">刪</button>
          </div>
        </div>
      </div>`;
  }).join('');

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

  const filteredTables = selectedAreaId ? tablesCache.filter(t => t.area_code === selectedAreaId) : [];
  if (filteredTables.length === 0) {
    tblListEl.innerHTML = '<div class="text-center text-muted small py-4">此區域尚無盤點表</div>';
    selectedTableId = null;
    renderLocationsColumn();
    return;
  }

  if (!selectedTableId || !filteredTables.some(t => t.table_id === selectedTableId)) {
    selectedTableId = filteredTables[0].table_id;
  }

  tblListEl.innerHTML = filteredTables.map(t => {
    const active = t.table_id === selectedTableId;
    const locCount = locationsCache.filter(l => l.table_id === t.table_id).length;
    return `
      <div class="list-group-item list-group-item-action p-2 ${active ? 'active bg-academic border-academic' : ''}" style="cursor:pointer;" onclick="selectHierTable('${t.table_id}')">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary'} me-1">${t.table_id}</span>
            <span class="fw-bold">${t.table_name}</span>
          </div>
          <span class="badge ${active ? 'bg-warning text-dark' : 'bg-light text-dark border'}">${locCount} 儲位</span>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-1">
          <small class="${active ? 'text-light' : 'text-muted'}">${t.table_desc || ''}</small>
          <div onclick="event.stopPropagation()">
            <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-primary'} py-0 px-1" onclick="openTableModal('${t.table_id}')">編</button>
            <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-danger'} py-0 px-1" onclick="deleteTableItem('${t.table_id}')">刪</button>
          </div>
        </div>
      </div>`;
  }).join('');

  renderLocationsColumn();
}

export function selectHierTable(tableId) {
  selectedTableId = tableId;
  renderTablesColumn();
}

export function renderLocationsColumn() {
  const tbody = document.getElementById('hier-loc-tbody');
  const titleEl = document.getElementById('hier-loc-header');
  if (!tbody) return;

  const tblObj = tablesCache.find(t => t.table_id === selectedTableId);
  if (titleEl) {
    titleEl.innerText = tblObj ? `第三層：儲位明細（${tblObj.table_id} - ${tblObj.table_name}）` : '第三層：儲位明細';
  }

  if (!selectedTableId) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">請先於左側選擇盤點表</td></tr>';
    return;
  }

  const kw = (document.getElementById('hier-loc-search')?.value || '').toLowerCase().trim();
  const list = locationsCache.filter(l => {
    if (l.table_id !== selectedTableId) return false;
    if (!kw) return true;
    return (
      (l.loc_code || '').toLowerCase().includes(kw) ||
      (l.drug_code || '').toLowerCase().includes(kw) ||
      (l.drug_name || '').toLowerCase().includes(kw)
    );
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">此盤點表尚無儲位資料</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(l => `
    <tr>
      <td class="text-center fw-bold text-nowrap">${l.row_no || '-'} / ${l.pos_no || '-'}</td>
      <td class="fw-bold text-nowrap">${l.loc_code}</td>
      <td class="small text-nowrap">${l.drug_code}</td>
      <td class="fw-bold">${l.drug_name}</td>
      <td class="small text-secondary">${[l.monthly_desc, l.drug_remark, l.daily_notice].filter(Boolean).join(' / ') || '-'}</td>
      <td class="text-center text-nowrap">
        <button class="btn btn-sm btn-outline-primary py-0 me-1" onclick="openLocEditModal('${l.loc_code}')">編輯</button>
        <button class="btn btn-sm btn-outline-danger py-0" onclick="deleteLocItem('${l.loc_code}')">刪除</button>
      </td>
    </tr>
  `).join('');
}

// --- 區域 Modal ---
export function openAreaModal(areaId = '') {
  const existing = areaId ? areasCache.find(a => a.area_id === areaId) : null;
  document.getElementById('a-area-code').value = existing ? existing.area_code : '';
  document.getElementById('a-area-code').readOnly = !!existing;
  document.getElementById('a-area-id').value = existing ? existing.area_id : '';
  document.getElementById('a-area-name').value = existing ? existing.area_name : '';
  document.getElementById('a-area-desc').value = existing ? existing.area_desc : '';

  if (!areaModalInstance) areaModalInstance = new window.bootstrap.Modal(document.getElementById('areaEditModal'));
  areaModalInstance.show();
}

export function autoPreviewAreaId() {
  const code = document.getElementById('a-area-code').value.trim().toUpperCase();
  document.getElementById('a-area-id').value = code ? `${unitPrefix}${code}` : '';
}

export function submitAreaEdit() {
  const areaCode = document.getElementById('a-area-code').value.trim().toUpperCase();
  const areaName = document.getElementById('a-area-name').value.trim();
  if (!areaCode || !areaName) return alert('請填寫區域代碼與區域名稱');

  toggleLoader(true, '儲存區域...');
  fetchBackend('saveAreaRecord', {
    area: {
      area_id: `${unitPrefix}${areaCode}`,
      area_code: areaCode,
      area_name: areaName,
      area_desc: document.getElementById('a-area-desc').value.trim()
    }
  }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '儲存失敗');
    if (areaModalInstance) areaModalInstance.hide();
    showToast('已儲存區域設定');
    loadHierarchyData();
  }).catch(err => {
    toggleLoader(false);
    alert('異常：' + err.message);
  });
}

export function deleteAreaItem(areaId) {
  if (!confirm(`確定要刪除區域「${areaId}」嗎？`)) return;
  toggleLoader(true, '刪除區域...');
  fetchBackend('deleteAreaRecord', { areaId }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '刪除失敗');
    showToast('已刪除區域');
    loadHierarchyData();
  }).catch(err => {
    toggleLoader(false);
    alert('異常：' + err.message);
  });
}

// --- 盤點表 Modal ---
export function openTableModal(tableId = '') {
  if (!selectedAreaId && !tableId) return alert('請先於第一層選擇所屬區域');
  const existing = tableId ? tablesCache.find(t => t.table_id === tableId) : null;
  const areaId = existing ? existing.area_code : selectedAreaId;

  document.getElementById('t-area-id').value = areaId;
  document.getElementById('t-table-code').value = existing ? existing.table_code : '';
  document.getElementById('t-table-code').readOnly = !!existing;
  document.getElementById('t-table-id').value = existing ? existing.table_id : '';
  document.getElementById('t-table-name').value = existing ? existing.table_name : '';
  document.getElementById('t-table-desc').value = existing ? existing.table_desc : '';

  if (!tableModalInstance) tableModalInstance = new window.bootstrap.Modal(document.getElementById('tableEditModal'));
  tableModalInstance.show();
}

export function autoPreviewTableId() {
  const areaId = document.getElementById('t-area-id').value.trim().toUpperCase();
  const tCode = document.getElementById('t-table-code').value.trim().toUpperCase();
  document.getElementById('t-table-id').value = tCode ? `${areaId}${tCode}` : '';
}

export function submitTableEdit() {
  const areaId = document.getElementById('t-area-id').value.trim().toUpperCase();
  const tableCode = document.getElementById('t-table-code').value.trim().toUpperCase();
  const tableName = document.getElementById('t-table-name').value.trim();
  const tableId = document.getElementById('t-table-id').value.trim().toUpperCase() || `${areaId}${tableCode}`;
  if (!areaId || !tableName || !tableId) return alert('請填寫盤點表代碼與名稱');

  toggleLoader(true, '儲存盤點表...');
  fetchBackend('saveTableRecord', {
    table: {
      table_id: tableId,
      area_code: areaId,
      table_code: tableCode,
      table_name: tableName,
      table_desc: document.getElementById('t-table-desc').value.trim()
    }
  }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '儲存失敗');
    if (tableModalInstance) tableModalInstance.hide();
    showToast('已儲存盤點表設定');
    loadHierarchyData();
  }).catch(err => {
    toggleLoader(false);
    alert('異常：' + err.message);
  });
}

export function deleteTableItem(tableId) {
  if (!confirm(`確定要刪除盤點表「${tableId}」嗎？`)) return;
  toggleLoader(true, '刪除盤點表...');
  fetchBackend('deleteTableRecord', { tableId }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '刪除失敗');
    showToast('已刪除盤點表');
    loadHierarchyData();
  }).catch(err => {
    toggleLoader(false);
    alert('異常：' + err.message);
  });
}

// --- 儲位 Modal (自動組合 盤點表編號 + 排 + 位 = 儲位碼編號) ---
export function openLocEditModal(locCode = '') {
  if (!selectedTableId && !locCode) return alert('請先於第二層選擇盤點表');
  const existing = locCode ? locationsCache.find(l => l.loc_code === locCode) : null;
  const tblId = existing ? existing.table_id : selectedTableId;

  document.getElementById('l-table-id').value = tblId;
  document.getElementById('l-row-no').value = existing ? existing.row_no : '';
  document.getElementById('l-pos-no').value = existing ? existing.pos_no : '';
  document.getElementById('l-row-no').readOnly = !!existing;
  document.getElementById('l-pos-no').readOnly = !!existing;
  document.getElementById('l-loc-code').value = existing ? existing.loc_code : '';
  document.getElementById('l-drug-code').value = existing ? existing.drug_code : '';
  document.getElementById('l-drug-name').value = existing ? existing.drug_name : '';
  document.getElementById('l-monthly-desc').value = existing ? existing.monthly_desc : '';
  document.getElementById('l-drug-remark').value = existing ? existing.drug_remark : '';
  document.getElementById('l-daily-notice').value = existing ? existing.daily_notice : '';

  if (!locModalInstance) locModalInstance = new window.bootstrap.Modal(document.getElementById('locEditModal'));
  locModalInstance.show();
}

export function autoPreviewLocCode() {
  const tblId = document.getElementById('l-table-id').value.trim().toUpperCase();
  const rNo = document.getElementById('l-row-no').value.trim();
  const pNo = document.getElementById('l-pos-no').value.trim();
  document.getElementById('l-loc-code').value = (rNo && pNo) ? `${tblId}${rNo}${pNo}` : '';
}

export function submitLocEdit() {
  const tblId = document.getElementById('l-table-id').value.trim().toUpperCase();
  const rNo = document.getElementById('l-row-no').value.trim();
  const pNo = document.getElementById('l-pos-no').value.trim();
  const locCode = document.getElementById('l-loc-code').value.trim().toUpperCase() || `${tblId}${rNo}${pNo}`;
  const drugCode = document.getElementById('l-drug-code').value.trim();
  const drugName = document.getElementById('l-drug-name').value.trim();

  if (!locCode || !tblId || !drugCode || !drugName) {
    return alert('請填寫排、位、藥品代碼與藥品名稱');
  }

  toggleLoader(true, '儲存儲位資料...');
  fetchBackend('saveLocationRecord', {
    location: {
      loc_code: locCode,
      table_id: tblId,
      row_no: rNo,
      pos_no: pNo,
      drug_code: drugCode,
      drug_name: drugName,
      monthly_desc: document.getElementById('l-monthly-desc').value.trim(),
      drug_remark: document.getElementById('l-drug-remark').value.trim(),
      daily_notice: document.getElementById('l-daily-notice').value.trim()
    }
  }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '儲存失敗');
    if (locModalInstance) locModalInstance.hide();
    showToast('已儲存儲位資料');
    loadHierarchyData();
  }).catch(err => {
    toggleLoader(false);
    alert('異常：' + err.message);
  });
}

export function deleteLocItem(locCode) {
  if (!confirm(`確定要刪除儲位「${locCode}」嗎？`)) return;
  toggleLoader(true, '刪除儲位...');
  fetchBackend('deleteLocationRecord', { locCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert(res?.message || '刪除失敗');
    showToast('已刪除儲位');
    loadHierarchyData();
  }).catch(err => {
    toggleLoader(false);
    alert('異常：' + err.message);
  });
}
