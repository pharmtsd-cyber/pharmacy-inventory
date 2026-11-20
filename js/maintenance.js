import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { DEPT_NAME } from './config.js';

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

let usersCache = [];
let locationsCache = [];
let tablesCache = [];
let parsedSapRows = [];
let userModalInstance = null;
let locModalInstance = null;

function fillSelect(id, list, selectedVal) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = list.map(v => `<option value="${v}" ${v === selectedVal ? 'selected' : ''}>${v}</option>`).join('');
}

// ==========================================
// 進入維護中心
// ==========================================
export function initMaintenanceMode() {
  switchView('view-maintenance');
  const titleEl = document.getElementById('maint-dept-title');
  if (titleEl) titleEl.innerText = `${DEPT_NAME} — 資料庫維護中心`;
  switchMaintTab('maint-tab-users');
  loadUsersList();
}

export function switchMaintTab(tabId) {
  ['maint-tab-users', 'maint-tab-sap', 'maint-tab-locations'].forEach(id => {
    const sec = document.getElementById(id);
    if (sec) sec.classList.toggle('d-none', id !== tabId);
  });
  document.querySelectorAll('#maint-tabs .nav-link').forEach(btn => {
    const active = btn.getAttribute('data-target') === tabId;
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-academic', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-white', !active);
    btn.classList.toggle('text-academic', !active);
  });

  if (tabId === 'maint-tab-users') loadUsersList();
  else if (tabId === 'maint-tab-locations') loadLocationsList();
}

// ==========================================
// 1. 藥師權限管理 (含自動生成醫院帳號)
// ==========================================
export function autoGenerateUserEmail() {
  const idInput = document.getElementById('u-user-id');
  const emailInput = document.getElementById('u-email');
  if (!idInput || !emailInput) return;
  const cleanId = idInput.value.trim().toLowerCase();
  emailInput.value = cleanId ? `femh${cleanId}@femh.org.tw` : '';
}

export function loadUsersList() {
  toggleLoader(true, '載入人員權限資料...');
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
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted fw-bold">查無符合的人員資料</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(u => {
    const stBadge = u.status === '在職' ? 'bg-success' : (u.status === '離職' ? 'bg-secondary' : 'bg-warning text-dark');
    const adminBadge = u.is_admin === '是' ? '<span class="badge bg-danger">管理員</span>' : '<span class="badge bg-light text-dark border">否</span>';
    return `
      <tr>
        <td class="text-center fw-bold">${u.user_id}</td>
        <td class="fw-bold">${u.name}</td>
        <td class="small text-secondary">${u.email || ''}</td>
        <td class="text-center"><span class="badge ${stBadge}">${u.status}</span></td>
        <td class="small">${u.department || '-'}</td>
        <td class="small">${u.mgmt_role} / 權限 ${u.info_level}</td>
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

  toggleLoader(true, '儲存人員資料...');
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

// ==========================================
// 2. 上傳每日 / 月 SAP Excel
// ==========================================
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

export function handleSapFileSelect(event) {
  const file = event.target.files[0];
  parsedSapRows = [];
  const previewEl = document.getElementById('maint-sap-preview');
  const uploadBtn = document.getElementById('maint-sap-upload-btn');
  if (!file) {
    if (previewEl) previewEl.innerText = '尚未選擇檔案';
    if (uploadBtn) uploadBtn.disabled = true;
    return;
  }
  if (!window.XLSX) {
    alert('尚未載入 Excel 解析套件 (XLSX)');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const wb = window.XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
      if (rawRows.length <= 1) {
        previewEl.innerText = '檔案中沒有資料列';
        uploadBtn.disabled = true;
        return;
      }

      const headers = rawRows[0].map(h => String(h).trim());
      const dIdx = headers.indexOf('SAP日期');
      const mIdx = headers.indexOf('物料');
      const nIdx = headers.indexOf('物料說明');
      const qIdx = headers.indexOf('數量');
      const uIdx = headers.indexOf('單位');

      const rows = [];
      for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        const sapDate = dIdx > -1 ? normalizeExcelDate(r[dIdx]) : '';
        const drugCode = mIdx > -1 ? String(r[mIdx] || '').trim() : '';
        if (!sapDate || !drugCode) continue;
        rows.push({
          sap_date: sapDate,
          drug_code: drugCode,
          drug_name: nIdx > -1 ? String(r[nIdx] || '').trim() : '',
          qty: qIdx > -1 ? (parseFloat(r[qIdx]) || 0) : 0,
          unit: uIdx > -1 ? String(r[uIdx] || '').trim() : ''
        });
      }

      parsedSapRows = rows;
      const dates = Array.from(new Set(rows.map(x => x.sap_date))).sort();
      previewEl.innerHTML = `已解析 <strong>${rows.length}</strong> 筆有效 SAP 資料（日期範圍：${dates[0] || '-'} ～ ${dates[dates.length - 1] || '-'}）`;
      uploadBtn.disabled = rows.length === 0;
    } catch (err) {
      previewEl.innerText = '解析失敗：' + err.message;
      uploadBtn.disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

export function uploadParsedSap() {
  if (parsedSapRows.length === 0) return alert('請先選擇有效的 SAP Excel 檔案！');
  const sapType = document.getElementById('maint-sap-type').value;
  const replaceDate = !!document.getElementById('maint-sap-replace-date').checked;

  toggleLoader(true, `正在匯入 ${parsedSapRows.length} 筆 SAP 資料...`, true);
  fetchBackend('importSapBatch', {
    sapType,
    rows: JSON.stringify(parsedSapRows),
    replaceDate
  }).then(res => {
    toggleLoader(false, '', true);
    if (!res || !res.success) return alert('匯入失敗：' + (res?.message || '未知錯誤'));
    showToast(`成功匯入 ${res.count} 筆 SAP 資料`);
    parsedSapRows = [];
    document.getElementById('maint-sap-file').value = '';
    document.getElementById('maint-sap-preview').innerText = '匯入完成，可繼續選擇下一個檔案';
    document.getElementById('maint-sap-upload-btn').disabled = true;
  }).catch(err => {
    toggleLoader(false, '', true);
    alert('匯入異常：' + err.message);
  });
}

// ==========================================
// 3. 儲位維護
// ==========================================
export function loadLocationsList() {
  toggleLoader(true, '載入儲位資料...');
  fetchBackend('getLocationsList').then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入儲位失敗：' + (res?.message || '未知錯誤'));
    locationsCache = res.locations || [];
    tablesCache = res.tables || [];
    renderLocationsTable();
  }).catch(err => {
    toggleLoader(false);
    alert('連線失敗：' + err.message);
  });
}

export function renderLocationsTable() {
  const tbody = document.getElementById('maint-loc-tbody');
  if (!tbody) return;
  const kw = (document.getElementById('maint-loc-search')?.value || '').toLowerCase().trim();

  const list = locationsCache.filter(l => {
    if (!kw) return true;
    return (
      (l.loc_code || '').toLowerCase().includes(kw) ||
      (l.table_id || '').toLowerCase().includes(kw) ||
      (l.drug_code || '').toLowerCase().includes(kw) ||
      (l.drug_name || '').toLowerCase().includes(kw)
    );
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted fw-bold">查無符合的儲位資料</td></tr>';
    return;
  }

  tbody.innerHTML = list.slice(0, 200).map(l => `
    <tr>
      <td class="fw-bold text-nowrap">${l.loc_code}</td>
      <td class="small text-nowrap">${l.table_id}</td>
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

export function openLocEditModal(locCode = '') {
  const existing = locCode ? locationsCache.find(l => l.loc_code === locCode) : null;
  const locEl = document.getElementById('l-loc-code');
  locEl.value = existing ? existing.loc_code : '';
  locEl.readOnly = !!existing;

  const tblSelect = document.getElementById('l-table-id');
  tblSelect.innerHTML = tablesCache.map(t => `<option value="${t.table_id}" ${(existing?.table_id === t.table_id) ? 'selected' : ''}>${t.table_id} - ${t.table_name}</option>`).join('');

  document.getElementById('l-row-no').value = existing ? existing.row_no : '';
  document.getElementById('l-pos-no').value = existing ? existing.pos_no : '';
  document.getElementById('l-drug-code').value = existing ? existing.drug_code : '';
  document.getElementById('l-drug-name').value = existing ? existing.drug_name : '';
  document.getElementById('l-monthly-desc').value = existing ? existing.monthly_desc : '';
  document.getElementById('l-drug-remark').value = existing ? existing.drug_remark : '';
  document.getElementById('l-daily-notice').value = existing ? existing.daily_notice : '';

  if (!locModalInstance) locModalInstance = new window.bootstrap.Modal(document.getElementById('locEditModal'));
  locModalInstance.show();
}

export function submitLocEdit() {
  const locPayload = {
    loc_code: document.getElementById('l-loc-code').value.trim(),
    table_id: document.getElementById('l-table-id').value.trim(),
    row_no: document.getElementById('l-row-no').value.trim(),
    pos_no: document.getElementById('l-pos-no').value.trim(),
    drug_code: document.getElementById('l-drug-code').value.trim(),
    drug_name: document.getElementById('l-drug-name').value.trim(),
    monthly_desc: document.getElementById('l-monthly-desc').value.trim(),
    drug_remark: document.getElementById('l-drug-remark').value.trim(),
    daily_notice: document.getElementById('l-daily-notice').value.trim()
  };

  if (!locPayload.loc_code || !locPayload.table_id || !locPayload.drug_code || !locPayload.drug_name) {
    return alert('請填寫儲位碼、盤點表、藥品代碼與藥品名稱！');
  }

  toggleLoader(true, '儲存儲位資料...');
  fetchBackend('saveLocationRecord', { location: locPayload }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('儲存失敗：' + (res?.message || '未知錯誤'));
    if (locModalInstance) locModalInstance.hide();
    showToast('已儲存儲位資料');
    loadLocationsList();
  }).catch(err => {
    toggleLoader(false);
    alert('儲存異常：' + err.message);
  });
}

export function deleteLocItem(locCode) {
  if (!confirm(`確定要刪除儲位「${locCode}」嗎？`)) return;
  toggleLoader(true, '刪除儲位...');
  fetchBackend('deleteLocationRecord', { locCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('刪除失敗：' + (res?.message || '未知錯誤'));
    showToast('已刪除儲位');
    loadLocationsList();
  }).catch(err => {
    toggleLoader(false);
    alert('刪除異常：' + err.message);
  });
}
