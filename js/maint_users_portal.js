import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';

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
let portalPermsCache = [];
let userModalInstance = null;

function fillSelect(id, list, selectedVal) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = list.map(v => `<option value="${v}" ${v === selectedVal ? 'selected' : ''}>${v}</option>`).join('');
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
