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
const UNIT_LABEL_MAP = { BA: '門診藥局(BA)', BF: '住院藥局(BF)', BE: '急診藥局(BE)', BG: '調配藥局(BG)' };
const unitPrefix = UNIT_PREFIX_MAP[currentDept] || 'BF';

let usersCache = [];
let portalPermsCache = [];
let parsedMasterRows = [];
let parsedSapDailyRows = [];
let parsedSapMonthlyRows = [];
let dailySnapCache = [];
let monthlySnapCache = [];

let hierAreas = [];
let hierTables = [];
let hierLocations = [];
let selectedAreaId = null;
let selectedTableId = null;
let hierDirty = false;
let areaSortable = null;
let tableSortable = null;
let locSortable = null;

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
  }).catch(err => {
    toggleLoader(false);
    alert('儲存異常：' + err.message);
  });
}

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
  let rows = [];
  let filename = 'template.xlsx';
  let sheetName = 'Sheet1';

  if (type === 'master') {
    sheetName = '藥品主檔';
    filename = '範本_藥品主檔更新.xlsx';
    rows = [
      ['批價代碼', '加P', '藥品學名', '藥檔狀態'],
      ['BAMIN0', 'PBAMIN0', 'Amino Acid 7% 250ml/bot (Nephrosteril)', '0'],
      ['OACET5', 'POACET5', 'Acetaminophen (Acetal) 500mg/tab', '0']
    ];
  } else if (type === 'daily_sap') {
    sheetName = '導入每日SAP';
    filename = '範本_每日SAP上傳.xlsx';
    rows = [
      ['SAP日期', '物料', '物料說明', '數量', '單位'],
      ['2026-11-20', 'POTAC01', 'PR-Tacrolimus (Advagraf) <1mg> /cap', 120, 'CAP'],
      ['2026-11-20', 'POACET5', 'Acetaminophen (Acetal) 500mg/tab', 500, 'TAB']
    ];
  } else if (type === 'monthly_sap') {
    sheetName = '導入月SAP';
    filename = '範本_月SAP上傳.xlsx';
    rows = [
      ['SAP日期', '物料', '物料說明', '數量', '單位'],
      ['2026-11-30', 'PBAMIN0', 'Amino Acid 7% (Nephrosteril) 250ml/bot', 82, 'BOT'],
      ['2026-11-30', 'POACET5', 'Acetaminophen (Acetal) 500mg/tab', 1500, 'TAB']
    ];
  }

  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
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
        preview.innerHTML = `<span class="text-danger fw-bold">❌ 欄位格式不符！必須包含「批價代碼」、「加P」、「藥品學名」三個欄位名稱（目前讀到：${h.filter(Boolean).join(', ')}）</span>`;
        btn.disabled = true;
        return;
      }

      const rows = [];
      for (let i = 1; i < raw.length; i++) {
        const r = raw[i];
        const pCode = String(r[pIdx] || '').trim();
        const invCode = String(r[iIdx] || '').trim();
        const dName = String(r[nIdx] || '').trim();
        if (!pCode || !invCode) continue;
        rows.push({
          price_code: pCode,
          inv_code: invCode,
          drug_name: dName,
          drug_status: sIdx > -1 && r[sIdx] !== '' ? String(r[sIdx]).trim() : '0'
        });
      }
      parsedMasterRows = rows;
      const sampleHtml = rows.slice(0, 3).map(x => `<li><code>${x.price_code}</code> ➔ <code>${x.inv_code}</code>：${x.drug_name}</li>`).join('');
      preview.innerHTML = `
        <div class="text-success fw-bold mb-1">✅ 格式驗證通過！共解析 ${rows.length} 筆藥品主檔（工作表：${sheetName}）</div>
        <div class="small text-muted mb-1">前三筆預覽（批價代碼 ➔ 藥品代碼：藥品名稱）：</div>
        <ul class="small mb-2">${sampleHtml}</ul>
        <div class="text-danger fw-bold small">⚠️ 執行後將會清空舊的藥品主檔並全數重建，舊盤點結果請先至「每日/月盤點結果」鎖存快照。</div>`;
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
  if (!confirm(`⚠️ 確定要「全刪全重建」藥品主檔嗎？\n\n本次將清空舊主檔並寫入 ${parsedMasterRows.length} 筆新藥品對應資料。`)) return;

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
        preview.innerHTML = `<span class="text-danger fw-bold">❌ 欄位格式不符！必須包含「SAP日期」、「物料」、「數量」欄位（目前讀到：${h.filter(Boolean).join(', ')}）</span>`;
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
      const sampleHtml = rows.slice(0, 3).map(x => `<li>[${x.sap_date}] <code>${x.drug_code}</code> ${x.drug_name} ➔ 數量：<strong>${x.qty}</strong> ${x.unit}</li>`).join('');
      preview.innerHTML = `
        <div class="text-success fw-bold mb-1">✅ 格式驗證通過！共 ${rows.length} 筆資料，涵蓋日期：${dates.join(', ')}</div>
        <ul class="small mb-0">${sampleHtml}</ul>`;
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

export function generateDailySnapshotNow() {
  const unitCode = document.getElementById('dm-daily-unit').value;
  const dateStr = document.getElementById('dm-daily-date').value;
  if (!dateStr) return alert('請選擇日期');

  toggleLoader(true, '正在彙整並鎖存每日盤點結果...');
  fetchBackend('generateDailySnapshotAll', { unitCode, dateStr }).then(res => {
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
  const unitCode = document.getElementById('dm-daily-unit')?.value || 'ALL';
  const dateStr = document.getElementById('dm-daily-date')?.value || '';
  const tbody = document.getElementById('dm-daily-tbody');
  if (!tbody || !dateStr) return;

  fetchBackend('getDailySnapshotsAll', { unitCode, dateStr }).then(res => {
    dailySnapCache = res?.data || [];
    if (dailySnapCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">此日期尚未產生盤點結果存檔，請點擊上方「結算並存檔結果」</td></tr>';
      return;
    }
    tbody.innerHTML = dailySnapCache.map(r => {
      const diffCls = r.diff_qty === 0 ? 'text-success' : (r.diff_qty > 0 ? 'text-primary' : 'text-danger');
      return `
        <tr>
          <td class="text-center"><span class="badge bg-secondary">${UNIT_LABEL_MAP[r.unit_code] || r.unit_code}</span></td>
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

export function exportDailySnapshotsExcel() {
  if (!window.XLSX) return alert('Excel 套件尚未載入');
  if (dailySnapCache.length === 0) return alert('目前畫面無資料可匯出，請先查詢或結算存檔');

  const unitCode = document.getElementById('dm-daily-unit')?.value || 'ALL';
  const dateStr = document.getElementById('dm-daily-date')?.value || '';
  const rows = [
    ['單位代碼', '單位名稱', '盤點日期', '藥品代碼', '藥品名稱', 'SAP數量', '實際盤點', '差異', '存檔時間']
  ];
  dailySnapCache.forEach(r => {
    rows.push([
      r.unit_code,
      UNIT_LABEL_MAP[r.unit_code] || r.unit_code,
      r.record_date,
      r.drug_code,
      r.drug_name,
      r.sap_qty,
      r.actual_qty,
      r.diff_qty,
      r.created_at || ''
    ]);
  });

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  window.XLSX.utils.book_append_sheet(wb, ws, '每日盤點結果');
  window.XLSX.writeFile(wb, `每日盤點結果_${unitCode}_${dateStr}.xlsx`);
}

export function generateMonthlySnapshotNow() {
  const unitCode = document.getElementById('dm-monthly-unit').value;
  const monthStr = document.getElementById('dm-monthly-month').value;
  if (!monthStr) return alert('請選擇月份');

  toggleLoader(true, '正在彙整並鎖存月盤點結果...');
  fetchBackend('generateMonthlySnapshotAll', { unitCode, monthStr }).then(res => {
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
          <th class="text-center text-white" colspan="3" style="background-color:#1A365D;">門診藥局 (BA)</th>
          <th class="text-center text-white" colspan="3" style="background-color:#1E4D2B;">住院藥局 (BF)</th>
          <th class="text-center text-white" colspan="3" style="background-color:#7A1717;">急診藥局 (BE)</th>
          <th class="text-center text-white" colspan="3" style="background-color:#4E342E;">調配藥局 (BG)</th>
          <th class="text-center bg-dark text-white" colspan="3">全院加總</th>
        </tr>
        <tr>
          <th class="text-end small" style="background-color:#e8eef7;">SAP</th><th class="text-end small" style="background-color:#e8eef7;">實盤</th><th class="text-end small" style="background-color:#e8eef7;">帳差</th>
          <th class="text-end small" style="background-color:#e8f3ec;">SAP</th><th class="text-end small" style="background-color:#e8f3ec;">實盤</th><th class="text-end small" style="background-color:#e8f3ec;">帳差</th>
          <th class="text-end small" style="background-color:#f9eaea;">SAP</th><th class="text-end small" style="background-color:#f9eaea;">實盤</th><th class="text-end small" style="background-color:#f9eaea;">帳差</th>
          <th class="text-end small" style="background-color:#f2ecea;">SAP</th><th class="text-end small" style="background-color:#f2ecea;">實盤</th><th class="text-end small" style="background-color:#f2ecea;">帳差</th>
          <th class="text-end small bg-light">總SAP</th><th class="text-end small bg-light">總實盤</th><th class="text-end small bg-light">總帳差</th>
        </tr>`;

      if (monthlySnapCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="17" class="text-center py-4 text-muted">此月份尚未產生月盤點結果存檔，請點擊上方「結算並存檔結果」</td></tr>';
        return;
      }

      const pivot = {};
      for (const r of monthlySnapCache) {
        if (!pivot[r.drug_code]) {
          pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
        }
        pivot[r.drug_code].units[r.unit_code] = r;
      }

      const fmtCell = (obj, bg) => {
        if (!obj) return `<td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td><td class="text-end text-muted" style="background-color:${bg};">-</td>`;
        const dc = obj.diff_qty === 0 ? 'text-success' : (obj.diff_qty > 0 ? 'text-primary' : 'text-danger');
        return `<td class="text-end" style="background-color:${bg};">${obj.sap_qty}</td><td class="text-end fw-bold" style="background-color:${bg};">${obj.total_actual_qty}</td><td class="text-end fw-bold ${dc}" style="background-color:${bg};">${obj.diff_qty > 0 ? '+' + obj.diff_qty : obj.diff_qty}</td>`;
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
            ${fmtCell(item.units['BA'], '#f4f7fc')}
            ${fmtCell(item.units['BF'], '#f3faf5')}
            ${fmtCell(item.units['BE'], '#fdf4f4')}
            ${fmtCell(item.units['BG'], '#f8f5f4')}
            <td class="text-end bg-light">${totSap}</td>
            <td class="text-end fw-bold bg-light">${totAct}</td>
            <td class="text-end fw-bold bg-light ${tdc}">${totDiff > 0 ? '+' + totDiff : totDiff}</td>
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
        </tr>`;

      if (monthlySnapCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">此月份尚未產生月盤點結果存檔，請點擊上方「結算並存檔結果」</td></tr>';
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
          </tr>`;
      }).join('');
    }
  });
}

export function exportMonthlySnapshotsExcel() {
  if (!window.XLSX) return alert('Excel 套件尚未載入');
  if (monthlySnapCache.length === 0) return alert('目前畫面無資料可匯出，請先查詢或結算存檔');

  const unitCode = document.getElementById('dm-monthly-unit')?.value || 'ALL';
  const monthStr = document.getElementById('dm-monthly-month')?.value || '';
  const wb = window.XLSX.utils.book_new();

  if (unitCode === 'ALL') {
    const pivot = {};
    for (const r of monthlySnapCache) {
      if (!pivot[r.drug_code]) pivot[r.drug_code] = { drug_code: r.drug_code, drug_name: r.drug_name, units: {} };
      pivot[r.drug_code].units[r.unit_code] = r;
    }

    const summaryRows = [
      ['藥品代碼', '藥品名稱', '門診SAP', '門診實盤', '門診帳差', '住院SAP', '住院實盤', '住院帳差', '急診SAP', '急診實盤', '急診帳差', '調配SAP', '調配實盤', '調配帳差', '全院總SAP', '全院總實盤', '全院總帳差']
    ];
    Object.values(pivot).sort((a, b) => a.drug_code.localeCompare(b.drug_code)).forEach(item => {
      const getU = (u) => item.units[u] || { sap_qty: 0, total_actual_qty: 0, diff_qty: 0 };
      const ba = getU('BA'), bf = getU('BF'), be = getU('BE'), bg = getU('BG');
      summaryRows.push([
        item.drug_code, item.drug_name,
        ba.sap_qty, ba.total_actual_qty, ba.diff_qty,
        bf.sap_qty, bf.total_actual_qty, bf.diff_qty,
        be.sap_qty, be.total_actual_qty, be.diff_qty,
        bg.sap_qty, bg.total_actual_qty, bg.diff_qty,
        ba.sap_qty + bf.sap_qty + be.sap_qty + bg.sap_qty,
        ba.total_actual_qty + bf.total_actual_qty + be.total_actual_qty + bg.total_actual_qty,
        ba.diff_qty + bf.diff_qty + be.diff_qty + bg.diff_qty
      ]);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(summaryRows), '全院月盤點總表');
  } else {
    const rows = [
      ['單位代碼', '單位名稱', '盤點月份', '藥品代碼', '藥品名稱', '月SAP', '調劑台', '庫存', '線上調整', '盤點總量', '帳差']
    ];
    monthlySnapCache.forEach(r => {
      rows.push([
        r.unit_code, UNIT_LABEL_MAP[r.unit_code] || r.unit_code, r.record_month,
        r.drug_code, r.drug_name, r.sap_qty, r.desk_qty, r.stock_qty, r.online_qty, r.total_actual_qty, r.diff_qty
      ]);
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '月盤點結果');
  }

  window.XLSX.writeFile(wb, `月盤點結果_${unitCode}_${monthStr}.xlsx`);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function indexToAlpha(idx) {
  return ALPHABET[idx] || 'Z';
}

function indexToTwoLetters(majorIdx, minorIdx) {
  const first = ALPHABET[majorIdx] || 'Z';
  const second = ALPHABET[minorIdx] || 'Z';
  return `${first}${second}`;
}

export function initHierarchyMaintenance() {
  switchView('view-maintenance');
  const titleEl = document.getElementById('maint-dept-title');
  if (titleEl) titleEl.innerHTML = `<i class="bi bi-diagram-3"></i> ${DEPT_NAME}（鎖定前綴：<code>${unitPrefix}</code>）— 分層儲位維護`;
  loadHierarchyData();
}

export function loadHierarchyData() {
  toggleLoader(true, '載入區域、盤點表與儲位架構...');
  fetchBackend('getHierarchyData').then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入失敗：' + (res?.message || '未知錯誤'));
    hierAreas = res.areas || [];
    hierTables = res.tables || [];
    hierLocations = res.locations || [];
    hierDirty = false;
    updateDirtyBanner();

    if (!selectedAreaId || !hierAreas.some(a => a.area_id === selectedAreaId)) {
      selectedAreaId = hierAreas[0]?.area_id || null;
    }
    renderAreasColumn();
  }).catch(err => {
    toggleLoader(false);
    alert('連線失敗：' + err.message);
  });
}

function markHierDirty() {
  hierDirty = true;
  updateDirtyBanner();
}

function updateDirtyBanner() {
  const banner = document.getElementById('hier-dirty-banner');
  if (banner) banner.classList.toggle('d-none', !hierDirty);
}

export function renumberAndSaveHierarchy() {
  if (hierAreas.length === 0) return alert('目前沒有任何區域資料');
  if (!confirm(`確定要依照目前的拖拉順序與分段，全部重新編碼（前綴鎖定 ${unitPrefix}）並儲存至資料庫嗎？`)) return;

  const areaIdMap = {};
  const tableIdMap = {};

  const newAreas = hierAreas.map((a, idx) => {
    const newCode = indexToAlpha(idx);
    const newId = `${unitPrefix}${newCode}`;
    areaIdMap[a.area_id] = newId;
    return {
      ...a,
      area_code: newCode,
      area_id: newId
    };
  });

  const newTables = [];
  for (const a of newAreas) {
    const oldAreaIds = Object.keys(areaIdMap).filter(k => areaIdMap[k] === a.area_id);
    const groupTables = hierTables.filter(t => oldAreaIds.includes(t.area_code) || t.area_code === a.area_id);

    let majorIdx = 0;
    let minorIdx = 0;
    groupTables.forEach((t, idx) => {
      const isLockedSystemTable = (t.table_id === `${unitPrefix}YYY` || t.table_id === `${unitPrefix}ZZZ`);
      if (isLockedSystemTable) {
        tableIdMap[t.table_id] = t.table_id;
        newTables.push({
          ...t,
          area_code: t.area_code || a.area_id
        });
        return;
      }
      if (idx > 0 && t.is_section_start) {
        majorIdx++;
        minorIdx = 0;
      }
      const newTCode = indexToTwoLetters(majorIdx, minorIdx);
      minorIdx++;
      const newTId = `${a.area_id}${newTCode}`;
      tableIdMap[t.table_id] = newTId;
      newTables.push({
        ...t,
        area_code: a.area_id,
        table_code: newTCode,
        table_id: newTId
      });
    });
  }

  const newLocations = [];
  for (const t of newTables) {
    const oldTblIds = Object.keys(tableIdMap).filter(k => tableIdMap[k] === t.table_id);
    const groupLocs = hierLocations.filter(l => oldTblIds.includes(l.table_id) || l.table_id === t.table_id);

    let rowNo = 1;
    let posSeq = 1001;
    groupLocs.forEach((l, idx) => {
      if (idx > 0 && l.is_section_start) {
        rowNo++;
        posSeq = 1001;
      }
      const rowStr = String(rowNo);
      const posStr = String(posSeq);
      posSeq += 2;
      const newLocCode = `${t.table_id}${rowStr}${posStr}`;
      newLocations.push({
        ...l,
        table_id: t.table_id,
        row_no: rowStr,
        pos_no: posStr,
        loc_code: newLocCode
      });
    });
  }

  toggleLoader(true, '正在重新編碼並儲存至 D1 資料庫...');
  fetchBackend('saveFullHierarchy', {
    areas: JSON.stringify(newAreas),
    tables: JSON.stringify(newTables),
    locations: JSON.stringify(newLocations)
  }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('儲存失敗：' + (res?.message || '未知錯誤'));
    if (selectedAreaId && areaIdMap[selectedAreaId]) selectedAreaId = areaIdMap[selectedAreaId];
    if (selectedTableId && tableIdMap[selectedTableId]) selectedTableId = tableIdMap[selectedTableId];
    showToast(`重編碼完成！共 ${res.areaCount} 區、${res.tableCount} 表、${res.locCount} 儲位`);
    loadHierarchyData();
  }).catch(err => {
    toggleLoader(false);
    alert('儲存異常：' + err.message);
  });
}

export function renderAreasColumn() {
  const areaListEl = document.getElementById('hier-area-list');
  if (!areaListEl) return;

  if (hierAreas.length === 0) {
    areaListEl.innerHTML = '<div class="text-center text-muted small py-4">尚無區域資料，請點擊右上角新增</div>';
    selectedAreaId = null;
    renderTablesColumn();
    return;
  }

  areaListEl.innerHTML = hierAreas.map((a, idx) => {
    const active = a.area_id === selectedAreaId;
    const tblCount = hierTables.filter(t => t.area_code === a.area_id).length;
    const previewId = `${unitPrefix}${indexToAlpha(idx)}`;
    const codeBadge = previewId !== a.area_id
      ? `<span class="badge bg-secondary text-decoration-line-through me-1">${a.area_id}</span><span class="badge bg-warning text-dark me-1">➔ ${previewId}</span>`
      : `<span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary'} me-1">${a.area_id}</span>`;

    return `
      <div class="list-group-item list-group-item-action p-2 hier-area-item ${active ? 'active bg-academic border-academic' : ''}" data-area-id="${a.area_id}" style="cursor:pointer;" onclick="selectHierArea('${a.area_id}')">
        <div class="d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-1">
            <i class="bi bi-grip-vertical area-drag-handle opacity-75" style="cursor:grab;"></i>
            ${codeBadge}
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
        markHierDirty();
        renderAreasColumn();
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
  if (filteredTables.length === 0) {
    tblListEl.innerHTML = '<div class="text-center text-muted small py-4">此區域尚無盤點表（可從其他區域拖拉盤點表到此區域）</div>';
    selectedTableId = null;
    renderLocationsColumn();
    return;
  }

  if (!selectedTableId || !filteredTables.some(t => t.table_id === selectedTableId)) {
    selectedTableId = filteredTables[0].table_id;
  }

  let majorIdx = 0, minorIdx = 0;
  tblListEl.innerHTML = filteredTables.map((t, idx) => {
    const isLockedSystemTable = (t.table_id === `${unitPrefix}YYY` || t.table_id === `${unitPrefix}ZZZ`);
    let previewTId = t.table_id;
    if (!isLockedSystemTable) {
      if (idx > 0 && t.is_section_start) { majorIdx++; minorIdx = 0; }
      const previewTCode = indexToTwoLetters(majorIdx, minorIdx);
      minorIdx++;
      previewTId = `${selectedAreaId}${previewTCode}`;
    }
    const active = t.table_id === selectedTableId;
    const locCount = hierLocations.filter(l => l.table_id === t.table_id).length;

    const sectionTag = (idx > 0 && t.is_section_start)
      ? `<div class="bg-warning bg-opacity-25 text-dark small fw-bold px-2 py-0 mb-1 rounded border-start border-3 border-warning">✂️ 新分段 (${ALPHABET[majorIdx]}段)</div>`
      : '';

    const codeBadge = previewTId !== t.table_id
      ? `<span class="badge bg-secondary text-decoration-line-through me-1">${t.table_id}</span><span class="badge bg-warning text-dark me-1">➔ ${previewTId}</span>`
      : `<span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary'} me-1">${t.table_id}</span>`;

    return `
      <div class="list-group-item list-group-item-action p-2 hier-table-item ${active ? 'active bg-academic border-academic' : ''}" data-table-id="${t.table_id}" style="cursor:pointer;" onclick="selectHierTable('${t.table_id}')">
        ${sectionTag}
        <div class="d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-1">
            <i class="bi bi-grip-vertical table-drag-handle opacity-75" style="cursor:grab;"></i>
            ${codeBadge}
            <span class="fw-bold">${t.table_name}</span>
          </div>
          <span class="badge ${active ? 'bg-light text-dark' : 'bg-light text-dark border'}">${locCount} 儲</span>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-1 ps-3">
          ${isLockedSystemTable
            ? `<span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary bg-opacity-75'}">🔒 系統內建鎖定 (${t.table_id})</span>`
            : `<div class="d-flex align-items-center gap-1" onclick="event.stopPropagation()">
                <select class="form-select form-select-sm py-0 px-1" style="font-size:0.72rem; width:auto;" title="跨區移動" onchange="moveTableToArea('${t.table_id}', this.value)">
                  ${hierAreas.map(a => `<option value="${a.area_id}" ${a.area_id === selectedAreaId ? 'selected' : ''}>移至 ${a.area_id}</option>`).join('')}
                </select>
                ${idx > 0 ? `<button class="btn btn-sm ${t.is_section_start ? 'btn-warning text-dark' : 'btn-outline-secondary'} py-0 px-1" style="font-size:0.7rem;" onclick="toggleTableSection('${t.table_id}')">${t.is_section_start ? '取消分段' : '設為分段'}</button>` : ''}
              </div>
              <div onclick="event.stopPropagation()">
                <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-primary'} py-0 px-1" onclick="openTableModal('${t.table_id}')">編</button>
                <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-danger'} py-0 px-1" onclick="deleteTableItem('${t.table_id}')">刪</button>
              </div>`
          }
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
        markHierDirty();
        renderTablesColumn();
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
  markHierDirty();
  renderTablesColumn();
}

export function moveTableToArea(tableId, newAreaId) {
  const t = hierTables.find(x => x.table_id === tableId);
  if (!t || t.area_code === newAreaId) return;
  t.area_code = newAreaId;
  markHierDirty();
  renderAreasColumn();
  showToast(`已將盤點表移至 ${newAreaId}（請記得按右上角「儲存並重新編碼」）`);
}

export function renderLocationsColumn() {
  const tbody = document.getElementById('hier-loc-tbody');
  const titleEl = document.getElementById('hier-loc-header');
  if (!tbody) return;

  const tblObj = hierTables.find(t => t.table_id === selectedTableId);
  if (titleEl) {
    titleEl.innerText = tblObj ? `第三層：儲位明細（${tblObj.table_id} - ${tblObj.table_name}）` : '第三層：儲位明細';
  }

  if (!selectedTableId) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">請先於左側選擇盤點表</td></tr>';
    return;
  }

  const kw = (document.getElementById('hier-loc-search')?.value || '').toLowerCase().trim();
  const tableLocs = hierLocations.filter(l => l.table_id === selectedTableId);

  let rowNo = 1, posSeq = 1001;
  const enriched = tableLocs.map((l, idx) => {
    if (idx > 0 && l.is_section_start) { rowNo++; posSeq = 1001; }
    const pRow = String(rowNo);
    const pPos = String(posSeq);
    posSeq += 2;
    const pCode = `${selectedTableId}${pRow}${pPos}`;
    return { ...l, idxInTable: idx, previewRow: pRow, previewPos: pPos, previewCode: pCode };
  });

  const filtered = kw ? enriched.filter(l =>
    (l.loc_code || '').toLowerCase().includes(kw) ||
    (l.previewCode || '').toLowerCase().includes(kw) ||
    (l.drug_code || '').toLowerCase().includes(kw) ||
    (l.drug_name || '').toLowerCase().includes(kw)
  ) : enriched;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">此盤點表尚無儲位資料</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(l => {
    const codeHtml = l.previewCode !== l.loc_code
      ? `<span class="text-muted text-decoration-line-through small">${l.loc_code}</span><br><span class="badge bg-warning text-dark">➔ ${l.previewCode}</span>`
      : `<span class="fw-bold">${l.loc_code}</span>`;

    const secBadge = (l.idxInTable > 0 && l.is_section_start)
      ? `<span class="badge bg-warning text-dark me-1">第 ${l.previewRow} 排分段</span>`
      : '';

    return `
      <tr class="hier-loc-row" data-loc-code="${l.loc_code}">
        <td class="text-center text-nowrap">
          <i class="bi bi-grip-vertical loc-drag-handle text-secondary me-1" style="cursor:grab;"></i>
          <span class="fw-bold">${l.previewRow}</span> / ${l.previewPos}
        </td>
        <td class="text-nowrap">${codeHtml}</td>
        <td class="small text-nowrap">${l.drug_code}</td>
        <td class="fw-bold">${secBadge}${l.drug_name}</td>
        <td class="small text-secondary">${[l.monthly_desc, l.drug_remark, l.daily_notice].filter(Boolean).join(' / ') || '-'}</td>
        <td class="text-center text-nowrap">
          <div class="d-inline-flex gap-1 align-items-center">
            <select class="form-select form-select-sm py-0 px-1" style="font-size:0.72rem; width:auto;" title="跨表移動儲位" onchange="moveLocToTable('${l.loc_code}', this.value)">
              ${hierTables.map(t => `<option value="${t.table_id}" ${t.table_id === selectedTableId ? 'selected' : ''}>移至 ${t.table_id}</option>`).join('')}
            </select>
            ${l.idxInTable > 0 ? `<button class="btn btn-sm ${l.is_section_start ? 'btn-warning text-dark' : 'btn-outline-secondary'} py-0 px-1" style="font-size:0.7rem;" onclick="toggleLocSection('${l.loc_code}')">${l.is_section_start ? '取消分段' : '分段'}</button>` : ''}
            <button class="btn btn-sm btn-outline-primary py-0 px-1" onclick="openLocEditModal('${l.loc_code}')">編</button>
            <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="deleteLocItem('${l.loc_code}')">刪</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  if (locSortable) locSortable.destroy();
  if (window.Sortable && !kw) {
    locSortable = new window.Sortable(tbody, {
      handle: '.loc-drag-handle',
      animation: 150,
      onEnd: () => {
        const orderedCodes = Array.from(tbody.querySelectorAll('.hier-loc-row')).map(el => el.getAttribute('data-loc-code'));
        const others = hierLocations.filter(l => l.table_id !== selectedTableId);
        const reordered = orderedCodes.map(c => hierLocations.find(l => l.loc_code === c)).filter(Boolean);
        hierLocations = [...others, ...reordered];
        markHierDirty();
        renderLocationsColumn();
      }
    });
  }
}

export function toggleLocSection(locCode) {
  const l = hierLocations.find(x => x.loc_code === locCode);
  if (!l) return;
  l.is_section_start = !l.is_section_start;
  markHierDirty();
  renderLocationsColumn();
}

export function moveLocToTable(locCode, newTableId) {
  const l = hierLocations.find(x => x.loc_code === locCode);
  if (!l || l.table_id === newTableId) return;
  l.table_id = newTableId;
  markHierDirty();
  renderTablesColumn();
  showToast(`已將儲位移至 ${newTableId}（請記得按右上角「儲存並重新編碼」）`);
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
    const target = hierAreas.find(a => a.area_id === editingId);
    if (target) { target.area_name = areaName; target.area_desc = areaDesc; }
  } else {
    const newCode = indexToAlpha(hierAreas.length);
    const newId = `${unitPrefix}${newCode}`;
    hierAreas.push({ area_id: newId, unit_code: unitPrefix, area_code: newCode, area_name: areaName, area_desc: areaDesc });
    selectedAreaId = newId;
  }

  if (areaModalInstance) areaModalInstance.hide();
  markHierDirty();
  renderAreasColumn();
}

export function deleteAreaItem(areaId) {
  const childCount = hierTables.filter(t => t.area_code === areaId).length;
  if (childCount > 0) return alert(`此區域底下尚有 ${childCount} 張盤點表，請先移走或刪除盤點表`);
  if (!confirm(`確定要移除區域「${areaId}」嗎？`)) return;
  hierAreas = hierAreas.filter(a => a.area_id !== areaId);
  if (selectedAreaId === areaId) selectedAreaId = hierAreas[0]?.area_id || null;
  markHierDirty();
  renderAreasColumn();
}

export function openTableModal(tableId = '') {
  if (!selectedAreaId && !tableId) return alert('請先於第一層選擇所屬區域');
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
    const target = hierTables.find(t => t.table_id === editingId);
    if (target) { target.table_name = tableName; target.table_desc = tableDesc; }
  } else {
    const tempId = `${areaId}_NEW_${Date.now()}`;
    hierTables.push({ table_id: tempId, unit_code: unitPrefix, area_code: areaId, table_code: 'NEW', table_name: tableName, table_desc: tableDesc });
    selectedTableId = tempId;
  }

  if (tableModalInstance) tableModalInstance.hide();
  markHierDirty();
  renderAreasColumn();
}

export function deleteTableItem(tableId) {
  const childCount = hierLocations.filter(l => l.table_id === tableId).length;
  if (childCount > 0) return alert(`此盤點表底下尚有 ${childCount} 個儲位，請先移走或刪除儲位`);
  if (!confirm(`確定要移除盤點表「${tableId}」嗎？`)) return;
  hierTables = hierTables.filter(t => t.table_id !== tableId);
  if (selectedTableId === tableId) selectedTableId = null;
  markHierDirty();
  renderAreasColumn();
}

export function openLocEditModal(locCode = '') {
  if (!selectedTableId && !locCode) return alert('請先於第二層選擇盤點表');
  const existing = locCode ? hierLocations.find(l => l.loc_code === locCode) : null;
  const tblId = existing ? existing.table_id : selectedTableId;

  document.getElementById('l-editing-code').value = existing ? existing.loc_code : '';
  document.getElementById('l-table-id').value = tblId;
  document.getElementById('l-row-no').value = existing ? existing.row_no : '自動';
  document.getElementById('l-pos-no').value = existing ? existing.pos_no : '自動';
  document.getElementById('l-loc-code').value = existing ? existing.loc_code : `${tblId}(存檔自動重編)`;
  document.getElementById('l-drug-code').value = existing ? existing.drug_code : '';
  document.getElementById('l-drug-name').value = existing ? existing.drug_name : '';
  document.getElementById('l-monthly-desc').value = existing ? existing.monthly_desc : '';
  document.getElementById('l-drug-remark').value = existing ? existing.drug_remark : '';
  document.getElementById('l-daily-notice').value = existing ? existing.daily_notice : '';

  if (!locModalInstance) locModalInstance = new window.bootstrap.Modal(document.getElementById('locEditModal'));
  locModalInstance.show();
}

export function submitLocEdit() {
  const editingCode = document.getElementById('l-editing-code').value;
  const tblId = document.getElementById('l-table-id').value;
  const drugCode = document.getElementById('l-drug-code').value.trim();
  const drugName = document.getElementById('l-drug-name').value.trim();
  if (!drugCode || !drugName) return alert('請填寫藥品代碼與藥品名稱');

  const monthlyDesc = document.getElementById('l-monthly-desc').value.trim();
  const drugRemark = document.getElementById('l-drug-remark').value.trim();
  const dailyNotice = document.getElementById('l-daily-notice').value.trim();

  if (editingCode) {
    const target = hierLocations.find(l => l.loc_code === editingCode);
    if (target) {
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
      row_no: '1',
      pos_no: '1001',
      drug_code: drugCode,
      drug_name: drugName,
      monthly_desc: monthlyDesc,
      drug_remark: drugRemark,
      daily_notice: dailyNotice
    });
  }

  if (locModalInstance) locModalInstance.hide();
  markHierDirty();
  renderTablesColumn();
}

export function deleteLocItem(locCode) {
  if (!confirm(`確定要移除儲位「${locCode}」嗎？`)) return;
  hierLocations = hierLocations.filter(l => l.loc_code !== locCode);
  markHierDirty();
  renderTablesColumn();
}

let adjInitData = { headers: [], rows: [], dates: { D1: '', F1: '' }, state: { availableSymbols: [] } };
let adjFilteredRows = [];
let adjSort = { colIndex: -1, order: 'none' };
let adjNeedsRefresh = false;

let adjVerHeaders = [];
let adjVerRecords = [];
let adjVerFiltered = [];

let adjAppHeaders = [];
let adjAppRecords = [];
let adjTableMap = {};
let adjHiddenAppCols = new Set([0, 5, 8, 9, 10, 11, 13, 14, 15, 16]);

let adjMarkerData = { masterList: [], trackedItems: [], availableSymbols: [] };

function setAdjSaveStatus(msg, color = '#6c757d') {
  const el = document.getElementById('adj-save-status');
  if (el) { el.innerText = msg; el.style.color = color; }
}

export function initMonthlyAdjPortal() {
  switchView('view-monthly-adj');
  const unitSel = document.getElementById('adj-unit-select');
  if (unitSel && !unitSel.value) {
    unitSel.value = unitPrefix;
  }
  switchAdjTab('adj-tab-inventory');
  loadAdjInventoryData();
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

  if (tabId === 'adj-tab-inventory' && adjNeedsRefresh) {
    adjNeedsRefresh = false;
    loadAdjInventoryData(true);
  } else if (tabId === 'adj-tab-records') {
    loadAdjAppRecords();
  } else if (tabId === 'adj-tab-marker') {
    loadAdjMarkers();
  } else if (tabId === 'adj-tab-version') {
    loadAdjVersionRecords();
  }
}

export function toggleAdjColGroup(groupNum) {
  const tbl = document.getElementById('adj-data-table');
  if (!tbl) return;
  if (groupNum === 1) tbl.classList.toggle('hide-g1');
  else if (groupNum === 2) tbl.classList.toggle('hide-g2');
  else if (groupNum === 3) tbl.classList.toggle('hide-g3');
}

export function loadAdjInventoryData(silent = false) {
  const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;
  const fDate = document.getElementById('adj-param-forecast')?.value || '';
  const rDate = document.getElementById('adj-param-reference')?.value || '';

  if (!silent) toggleLoader(true, '載入月盤點調帳總表...');
  fetchBackend('getMonthlyAdjInitData', {
    unitCode,
    forecastDate: fDate,
    referenceDate: rDate
  }).then(res => {
    if (!silent) toggleLoader(false);
    if (!res || !res.success) return alert('載入調帳資料失敗：' + (res?.message || '未知錯誤'));

    adjInitData = res;
    const fInput = document.getElementById('adj-param-forecast');
    const rInput = document.getElementById('adj-param-reference');
    if (fInput) fInput.value = res.dates?.D1 || '';
    if (rInput) rInput.value = res.dates?.F1 || '';

    const recStart = document.getElementById('adj-rec-start');
    const recEnd = document.getElementById('adj-rec-end');
    if (recStart && !recStart.value) recStart.value = res.dates?.D1 || '';
    if (recEnd && !recEnd.value) recEnd.value = res.dates?.F1 || '';

    const symSel = document.getElementById('adj-filter-symbol');
    if (symSel) {
      const prevSym = symSel.value;
      symSel.innerHTML = '<option value="ALL">全部符號</option>';
      (res.state?.availableSymbols || []).forEach(s => {
        symSel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
      });
      if (Array.from(symSel.options).some(o => o.value === prevSym)) symSel.value = prevSym;
    }

    if (!silent) setAdjSaveStatus('載入完成，尚未修改', 'green');
    applyAdjFilters();
  }).catch(err => {
    if (!silent) toggleLoader(false);
    alert('載入失敗：' + err.message);
  });
}

export function handleAdjSortClick(colIndex) {
  if (adjSort.colIndex === colIndex) {
    if (adjSort.order === 'none') adjSort.order = 'desc';
    else if (adjSort.order === 'desc') adjSort.order = 'asc';
    else adjSort.order = 'none';
  } else {
    adjSort.colIndex = colIndex;
    adjSort.order = 'desc';
  }
  applyAdjFilters();
}

function getAdjSortValue(row, colIndex) {
  if (colIndex === 7) return Number(row.rawF) || 0;
  if (colIndex === 11) return Number(row.rawJ) || 0;
  if (colIndex === 18) return Number(row.rawQ) || 0;
  const v = row.rowData[colIndex];
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return isNaN(n) ? String(v) : n;
}

export function applyAdjFilters() {
  let rows = [...(adjInitData.rows || [])];
  const kw = (document.getElementById('adj-search-input')?.value || '').toLowerCase().trim();
  const sym = document.getElementById('adj-filter-symbol')?.value || 'ALL';
  const fltPrev = document.getElementById('adj-filter-prev')?.value || 'ALL';
  const fltCurr = document.getElementById('adj-filter-curr')?.value || 'HAS_VALUE';

  if (kw) {
    const terms = kw.split(/\s+/);
    rows = rows.filter(r => terms.every(t => (`${r.rowData[0]} ${r.rowData[1]}`).toLowerCase().includes(t)));
  }
  if (sym !== 'ALL') {
    rows = rows.filter(r => String(r.rowData[12] || '').trim() === sym);
  }
  if (fltPrev !== 'ALL') {
    rows = rows.filter(r => {
      const hasVal = (Number(r.rowData[2]) !== 0 || Number(r.rowData[3]) !== 0 || Number(r.rowData[5]) !== 0);
      return fltPrev === 'HAS_VALUE' ? hasVal : !hasVal;
    });
  }
  if (fltCurr !== 'ALL') {
    rows = rows.filter(r => {
      const hasVal = (Number(r.rowData[8]) !== 0 || Number(r.rowData[9]) !== 0);
      return fltCurr === 'HAS_VALUE' ? hasVal : !hasVal;
    });
  }

  if (adjSort.colIndex !== -1 && adjSort.order !== 'none') {
    rows.sort((a, b) => {
      const vA = getAdjSortValue(a, adjSort.colIndex);
      const vB = getAdjSortValue(b, adjSort.colIndex);
      if (typeof vA === 'number' && typeof vB === 'number') return adjSort.order === 'desc' ? vB - vA : vA - vB;
      return adjSort.order === 'desc' ? String(vB).localeCompare(String(vA)) : String(vA).localeCompare(String(vB));
    });
  } else {
    rows.sort((a, b) => String(a.rowData[0]).localeCompare(String(b.rowData[0])));
  }

  adjFilteredRows = rows;
  renderAdjTable(rows);
}

function renderAdjTable(rowsToRender) {
  const thead = document.getElementById('adj-thead');
  const tbody = document.getElementById('adj-tbody');
  if (!thead || !tbody) return;

  const headers = adjInitData.headers || [];
  let headHtml = '<tr>';
  headers.forEach((h, i) => {
    let icon = ' <span class="text-muted" style="font-size:0.75em;">↕</span>';
    if (adjSort.colIndex === i) {
      if (adjSort.order === 'asc') icon = ' 🔼';
      else if (adjSort.order === 'desc') icon = ' 🔽';
    }
    let grpCls = '';
    if (i >= 2 && i <= 7) grpCls = 'head-g1 col-g1';
    else if (i >= 8 && i <= 11) grpCls = 'head-g2 col-g2';
    else if (i >= 13 && i <= 18) grpCls = 'head-g3 col-g3';
    headHtml += `<th class="${grpCls} text-nowrap" style="cursor:pointer;" onclick="handleAdjSortClick(${i})">${h}${icon}</th>`;
  });
  headHtml += '<th class="text-center text-nowrap">盤點明細</th></tr>';
  thead.innerHTML = headHtml;

  if (!rowsToRender || rowsToRender.length === 0) {
    tbody.innerHTML = '<tr><td colspan="20" class="text-center py-4 text-muted fw-bold">查無符合條件的藥品</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  rowsToRender.forEach(r => {
    const tr = document.createElement('tr');
    if (r.rowData[12]) tr.classList.add('table-warning');

    r.rowData.forEach((cellData, i) => {
      const td = document.createElement('td');
      if (i >= 2 && i <= 7) td.classList.add('col-g1');
      else if (i >= 8 && i <= 11) td.classList.add('col-g2');
      else if (i >= 13 && i <= 18) td.classList.add('col-g3');

      if ((i === 7 || i === 11 || i === 18) && !isNaN(parseFloat(cellData))) {
        const numVal = parseFloat(cellData);
        if (numVal > 0.1) { td.style.color = 'red'; td.style.fontWeight = 'bold'; }
        else if (numVal < -0.1) { td.style.color = 'green'; td.style.fontWeight = 'bold'; }
      }

      if (i === 3) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-control form-control-sm border-primary';
        input.style.width = '85px';
        input.value = cellData;
        input.oninput = () => {
          r.rowData[3] = input.value;
          input.style.backgroundColor = '#fff9c4';
          setAdjSaveStatus('⚠️ 有變更未存檔', '#dc3545');

          const sapVal = Number(r.rowData[2]) || 0;
          const salesVal = (input.value !== '' && !isNaN(input.value)) ? Number(input.value) : 0;
          const theoryVal = sapVal - salesVal;
          const appVal = Number(r.rowData[5]) || 0;
          const diff = appVal - theoryVal;
          const pct = (theoryVal <= 0) ? diff : (diff / theoryVal);

          r.rowData[4] = theoryVal;
          r.rowData[6] = diff;
          r.rowData[7] = (pct * 100).toFixed(2) + '%';
          r.rawF = pct;

          if (tr.children[4]) tr.children[4].innerText = theoryVal;
          if (tr.children[6]) tr.children[6].innerText = diff;
          if (tr.children[7]) {
            tr.children[7].innerText = r.rowData[7];
            tr.children[7].style.color = pct > 0.1 ? 'red' : (pct < -0.1 ? 'green' : '');
            tr.children[7].style.fontWeight = Math.abs(pct) > 0.1 ? 'bold' : '';
          }
        };
        td.appendChild(input);
      } else if (i === 12) {
        const btn = document.createElement('button');
        const curSym = String(cellData || '').trim();
        btn.className = 'btn btn-sm ' + (curSym ? 'btn-warning text-dark fw-bold' : 'btn-outline-secondary');
        btn.innerText = curSym || '+ 標記';
        btn.onclick = () => {
          const nextSym = prompt(`設定 [${r.rowData[0]}] 標記（留空則移除）:`, curSym);
          if (nextSym === null) return;
          const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;
          toggleLoader(true, '更新標記...');
          const act = nextSym.trim() === ''
            ? fetchBackend('removeMonthlyAdjMarker', { unitCode, code: r.rowData[0] })
            : fetchBackend('saveMonthlyAdjMarker', { unitCode, code: r.rowData[0], name: r.rowData[1], symbol: nextSym.trim(), note: '', creator: r.rowData[0] });
          act.then(() => {
            toggleLoader(false);
            r.rowData[12] = nextSym.trim();
            adjNeedsRefresh = true;
            applyAdjFilters();
          }).catch(() => toggleLoader(false));
        };
        td.appendChild(btn);
      } else if (i === 13) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-control form-control-sm border-primary';
        input.style.width = '85px';
        input.value = cellData;
        input.oninput = () => {
          r.rowData[13] = input.value;
          input.style.backgroundColor = '#fff9c4';
          setAdjSaveStatus('⚠️ 有變更未存檔', '#dc3545');

          const appDayVal = Number(r.rowData[8]) || 0;
          const sapDayVal = Number(r.rowData[9]) || 0;
          const adjVal = (input.value !== '' && !isNaN(input.value)) ? Number(input.value) : appDayVal;
          const declareDiff = adjVal - sapDayVal;
          const declarePct = (sapDayVal <= 0) ? declareDiff : (declareDiff / sapDayVal);

          r.rowData[15] = adjVal;
          r.rowData[17] = declareDiff;
          r.rowData[18] = (declarePct * 100).toFixed(2) + '%';
          r.rawQ = declarePct;

          if (tr.children[15]) tr.children[15].innerText = adjVal;
          if (tr.children[17]) tr.children[17].innerText = declareDiff;
          if (tr.children[18]) {
            tr.children[18].innerText = r.rowData[18];
            tr.children[18].style.color = declarePct > 0.1 ? 'red' : (declarePct < -0.1 ? 'green' : '');
            tr.children[18].style.fontWeight = Math.abs(declarePct) > 0.1 ? 'bold' : '';
          }
        };
        td.appendChild(input);
      } else if (i === 14) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-control form-control-sm border-secondary';
        input.style.width = '120px';
        input.value = cellData;
        input.oninput = () => {
          r.rowData[14] = input.value;
          input.style.backgroundColor = '#fff9c4';
          setAdjSaveStatus('⚠️ 有變更未存檔', '#dc3545');
        };
        td.appendChild(input);
      } else {
        td.innerText = cellData;
      }

      tr.appendChild(td);
    });

    const tdAct = document.createElement('td');
    tdAct.className = 'text-center';
    const btnDet = document.createElement('button');
    btnDet.className = 'btn btn-sm btn-outline-info fw-bold py-0';
    btnDet.innerText = '📄 紀錄';
    btnDet.onclick = () => {
      const sInput = document.getElementById('adj-rec-start');
      const eInput = document.getElementById('adj-rec-end');
      if (sInput) sInput.value = adjInitData.dates?.D1 || '';
      if (eInput) eInput.value = adjInitData.dates?.F1 || '';
      const searchEl = document.getElementById('adj-rec-search');
      if (searchEl) searchEl.value = r.rowData[0];
      switchAdjTab('adj-tab-records');
    };
    tdAct.appendChild(btnDet);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

export function handleAdjSaveVersion() {
  const reportDate = document.getElementById('adj-param-reference')?.value || '';
  if (!reportDate) return alert('請先選取盤點基準日！');
  const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;

  if (!confirm(`即將將調帳總表鎖定並儲存為 ${reportDate.substring(0, 7)} 月份版本（若該月份已有版本將被覆蓋），確定嗎？`)) return;

  toggleLoader(true, '正在儲存月盤點調帳版本...');
  fetchBackend('saveMonthlyAdjVersion', {
    unitCode,
    reportDate,
    rows: JSON.stringify(adjInitData.rows || [])
  }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('存檔失敗：' + (res?.message || '未知錯誤'));
    const now = new Date();
    const tStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    setAdjSaveStatus(`✔️ 最後存檔: ${tStr}`, 'green');
    showToast(res.message || '已儲存版本');
    loadAdjInventoryData(true);
  }).catch(err => {
    toggleLoader(false);
    alert('存檔異常：' + err.message);
  });
}

export function loadAdjAppRecords() {
  const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;
  const startDate = document.getElementById('adj-rec-start')?.value || '';
  const endDate = document.getElementById('adj-rec-end')?.value || '';

  toggleLoader(true, '載入月盤點輸入區紀錄...');
  fetchBackend('getMonthlyAdjAppRecords', { unitCode, startDate, endDate }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入紀錄失敗：' + (res?.message || '未知錯誤'));
    adjAppHeaders = res.headers || [];
    adjAppRecords = res.records || [];
    adjTableMap = res.tableMap || {};
    renderAdjAppColToggles();
    applyAdjAppRecordFilters();
  }).catch(err => {
    toggleLoader(false);
    alert('載入異常：' + err.message);
  });
}

function renderAdjAppColToggles() {
  const box = document.getElementById('adj-rec-col-toggles');
  if (!box) return;
  const toggleCols = [0, 5, 8, 9, 10, 11, 13, 14, 15, 16];
  box.innerHTML = toggleCols.map(idx => {
    if (!adjAppHeaders[idx]) return '';
    const isHidden = adjHiddenAppCols.has(idx);
    return `<button class="btn btn-sm ${isHidden ? 'btn-outline-secondary' : 'btn-secondary'} py-0" style="font-size:0.75rem;" onclick="toggleAdjAppCol(${idx})">${isHidden ? '＋展開 ' : '－隱藏 '}${adjAppHeaders[idx]}</button>`;
  }).join('');
}

export function toggleAdjAppCol(idx) {
  if (adjHiddenAppCols.has(idx)) adjHiddenAppCols.delete(idx);
  else adjHiddenAppCols.add(idx);
  renderAdjAppColToggles();
  applyAdjAppRecordFilters();
}

export function applyAdjAppRecordFilters() {
  const kw = (document.getElementById('adj-rec-search')?.value || '').toLowerCase().trim();
  let rows = [...adjAppRecords];
  if (kw) {
    const terms = kw.split(/\s+/);
    rows = rows.filter(r => terms.every(t => (`${r[1] || ''} ${r[2] || ''} ${r[12] || ''}`).toLowerCase().includes(t)));
  }

  const thead = document.getElementById('adj-rec-thead');
  const tbody = document.getElementById('adj-rec-tbody');
  if (!thead || !tbody) return;

  let hHtml = '<tr>';
  adjAppHeaders.forEach((h, i) => {
    if (adjHiddenAppCols.has(i)) return;
    hHtml += `<th class="text-nowrap">${h}</th>`;
    if (h.includes('盤點表') || h === '盤點表 ID') hHtml += '<th class="text-nowrap">盤點表名稱</th>';
  });
  hHtml += '</tr>';
  thead.innerHTML = hHtml;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="20" class="text-center py-4 text-muted">此日期區間無盤點紀錄</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    let tds = '';
    r.forEach((cell, i) => {
      if (adjHiddenAppCols.has(i)) return;
      const style = i === 1 ? 'font-weight:bold;color:#007bff;' : (i === 3 ? 'font-weight:bold;color:#d9534f;' : '');
      tds += `<td style="${style}">${cell}</td>`;
      const hName = adjAppHeaders[i] || '';
      if (hName.includes('盤點表') || hName === '盤點表 ID') {
        const tName = adjTableMap[String(cell || '').trim()] || '未知名稱';
        tds += `<td><strong>${tName}</strong></td>`;
      }
    });
    return `<tr>${tds}</tr>`;
  }).join('');
}

export function loadAdjMarkers() {
  const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;
  toggleLoader(true, '載入標記追蹤藥品...');
  fetchBackend('getMonthlyAdjMarkers', { unitCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入標記失敗：' + (res?.message || '未知錯誤'));
    adjMarkerData = res;
    const symSel = document.getElementById('adj-marker-sym-filter');
    if (symSel) {
      const cur = symSel.value;
      symSel.innerHTML = '<option value="ALL">全部顯示</option>';
      (res.availableSymbols || []).forEach(s => symSel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));
      if (Array.from(symSel.options).some(o => o.value === cur)) symSel.value = cur;
    }
    applyAdjMarkerFilters();
  }).catch(err => {
    toggleLoader(false);
    alert('載入異常：' + err.message);
  });
}

export function handleAdjMarkerAutocomplete() {
  const val = (document.getElementById('adj-mk-code')?.value || '').toLowerCase().trim();
  const listEl = document.getElementById('adj-mk-autocomplete');
  if (!listEl) return;
  if (!val) { listEl.style.display = 'none'; return; }

  const matches = (adjMarkerData.masterList || []).filter(m => m.code.toLowerCase().includes(val) || m.name.toLowerCase().includes(val)).slice(0, 20);
  if (matches.length === 0) { listEl.style.display = 'none'; return; }

  listEl.innerHTML = matches.map(m => `
    <div class="search-dropdown-item" onclick="selectAdjMarkerDrug('${m.code}', '${m.name.replace(/'/g, "\\'")}')">
      <strong>${m.code}</strong> - ${m.name}
    </div>`).join('');
  listEl.style.display = 'block';
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

  const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;
  toggleLoader(true, '儲存標記...');
  fetchBackend('saveMonthlyAdjMarker', {
    unitCode, code, name, symbol, note, creator: document.getElementById('nav-user-id')?.innerText || ''
  }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('儲存失敗：' + (res?.message || '未知錯誤'));
    adjNeedsRefresh = true;
    document.getElementById('adj-mk-code').value = '';
    document.getElementById('adj-mk-name').value = '';
    document.getElementById('adj-mk-symbol').value = '';
    document.getElementById('adj-mk-note').value = '';
    showToast('標記已儲存');
    loadAdjMarkers();
  }).catch(err => {
    toggleLoader(false);
    alert('儲存異常：' + err.message);
  });
}

export function applyAdjMarkerFilters() {
  const kw = (document.getElementById('adj-marker-search')?.value || '').toLowerCase().trim();
  const sym = document.getElementById('adj-marker-sym-filter')?.value || 'ALL';
  const tbody = document.getElementById('adj-marker-tbody');
  if (!tbody) return;

  let list = (adjMarkerData.trackedItems || []).filter(item => {
    if (sym !== 'ALL' && item.symbol !== sym) return false;
    if (!kw) return true;
    const terms = kw.split(/\s+/);
    return terms.every(t => (`${item.code} ${item.name}`).toLowerCase().includes(t));
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">無追蹤藥品紀錄</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(item => `
    <tr>
      <td class="fw-bold">${item.code}</td>
      <td>${item.name} ${item.isMissing ? '<span class="badge bg-danger">查無主檔</span>' : ''}</td>
      <td><input type="text" class="form-control form-control-sm" id="mk-sym-${item.code}" value="${item.symbol}"></td>
      <td><input type="text" class="form-control form-control-sm" id="mk-note-${item.code}" value="${item.note}"></td>
      <td class="small">${item.creator || ''}</td>
      <td class="small text-muted">${item.updateTime || ''}</td>
      <td class="text-center text-nowrap">
        <button class="btn btn-sm btn-primary py-0 me-1" onclick="updateExistingAdjMarker('${item.code}', '${item.name.replace(/'/g, "\\'")}')">更新</button>
        <button class="btn btn-sm btn-outline-danger py-0" onclick="deleteExistingAdjMarker('${item.code}')">移除</button>
      </td>
    </tr>`).join('');
}

export function updateExistingAdjMarker(code, name) {
  const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;
  const symbol = document.getElementById(`mk-sym-${code}`)?.value || '';
  const note = document.getElementById(`mk-note-${code}`)?.value || '';
  toggleLoader(true, '更新標記...');
  fetchBackend('saveMonthlyAdjMarker', {
    unitCode, code, name, symbol, note, creator: document.getElementById('nav-user-id')?.innerText || ''
  }).then(() => {
    toggleLoader(false);
    adjNeedsRefresh = true;
    showToast('已更新標記');
    loadAdjMarkers();
  }).catch(() => toggleLoader(false));
}

export function deleteExistingAdjMarker(code) {
  if (!confirm(`確定移除 [${code}] 的標記嗎？`)) return;
  const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;
  toggleLoader(true, '移除標記...');
  fetchBackend('removeMonthlyAdjMarker', { unitCode, code }).then(() => {
    toggleLoader(false);
    adjNeedsRefresh = true;
    showToast('已移除標記');
    loadAdjMarkers();
  }).catch(() => toggleLoader(false));
}

export function loadAdjVersionRecords() {
  const unitCode = document.getElementById('adj-unit-select')?.value || unitPrefix;
  toggleLoader(true, '載入盤點表版本紀錄...');
  fetchBackend('getMonthlyAdjVersionRecords', { unitCode }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('載入版本紀錄失敗：' + (res?.message || '未知錯誤'));
    adjVerHeaders = res.headers || [];
    adjVerRecords = res.records || [];

    const mSel = document.getElementById('adj-ver-month-filter');
    if (mSel) {
      const months = Array.from(new Set(adjVerRecords.map(r => String(r[0] || '').trim()).filter(Boolean))).sort().reverse();
      mSel.innerHTML = '<option value="ALL">全部月份</option>' + months.map(m => `<option value="${m}">${m}</option>`).join('');
    }
    applyAdjVersionFilters();
  }).catch(err => {
    toggleLoader(false);
    alert('載入異常：' + err.message);
  });
}

export function applyAdjVersionFilters() {
  const monthVal = document.getElementById('adj-ver-month-filter')?.value || 'ALL';
  const kw = (document.getElementById('adj-ver-search')?.value || '').toLowerCase().trim();
  let rows = [...adjVerRecords];
  if (monthVal !== 'ALL') rows = rows.filter(r => String(r[0] || '').trim() === monthVal);
  if (kw) {
    const terms = kw.split(/\s+/);
    rows = rows.filter(r => terms.every(t => (`${r[1] || ''} ${r[2] || ''}`).toLowerCase().includes(t)));
  }
  adjVerFiltered = rows;

  const thead = document.getElementById('adj-ver-thead');
  const tbody = document.getElementById('adj-ver-tbody');
  if (!thead || !tbody) return;

  thead.innerHTML = '<tr>' + adjVerHeaders.map(h => `<th class="text-nowrap">${h}</th>`).join('') + '</tr>';
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="21" class="text-center py-4 text-muted">無版本紀錄</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r =>
    '<tr>' + r.map((cell, i) => `<td ${i === 1 ? 'style="font-weight:bold;color:#007bff;"' : ''}>${cell}</td>`).join('') + '</tr>'
  ).join('');
}

export function exportAdjVersionExcel() {
  if (!adjVerFiltered || adjVerFiltered.length === 0) return alert('目前畫面上沒有可下載的版本資料');
  if (window.XLSX) {
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet([adjVerHeaders, ...adjVerFiltered]);
    window.XLSX.utils.book_append_sheet(wb, ws, '盤點表版本紀錄');
    const selM = document.getElementById('adj-ver-month-filter')?.value || 'ALL';
    window.XLSX.writeFile(wb, `盤點表版本紀錄_${selM}.xlsx`);
  }
}
