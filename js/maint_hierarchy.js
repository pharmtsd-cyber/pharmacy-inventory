import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { session, DEPT_NAME, currentDept } from './config.js';

const UNIT_PREFIX_MAP = { opd: 'BA', ipd: 'BF', erd: 'BE', comp: 'BG' };
const unitPrefix = UNIT_PREFIX_MAP[currentDept] || 'BF';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AREA_SEG_PREFIX = 'AREA::';

let drugMasterSelectList = [];
let hierAreas = [];
let hierTables = [];
let hierLocations = [];
let hierSegments = [];
let selectedAreaId = null;
let selectedTableId = null;
let selectedTableSegmentNo = 0; // 第二層目前選中的新增分段 (0 = POOL)
let selectedSegmentNo = 0;      // 第三層目前選中的新增分段 (0 = POOL)
let areaSortable = null;
let areaModalInstance = null;
let tableModalInstance = null;
let locModalInstance = null;
let hasUnsavedHierChanges = false;


const collapsedTableSegs = new Set();
const collapsedLocSegs = new Set();

// 在進入分層儲位維護畫面前，先向後端確認是否符合「網站權限管理」的 hierarchy_maint 規則
export async function openHierarchyWithAuth() {
  const userId = session?.userId || session?.id || sessionStorage.getItem('userId') || '';
  if (!userId) return alert('請先登入員工編號');

  toggleLoader(true, '正在驗證權限...');
  try {
    const res = await fetchBackend('checkLogin', { id: userId, portalKey: 'hierarchy_maint' });
    toggleLoader(false);
    if (!res || !res.success) {
      return alert(res?.message || '權限不足，無法進入分層儲位維護');
    }
    // 驗證通過，進入分層儲位維護
    initHierarchyMaintenance();
  } catch (err) {
    toggleLoader(false);
    alert('權限驗證失敗：' + err.message);
  }
}

export function toggleTableSegCollapse(segNo) {
  const key = `${selectedAreaId}_${segNo}`;
  if (collapsedTableSegs.has(key)) collapsedTableSegs.delete(key);
  else collapsedTableSegs.add(key);
  renderTablesColumn();
}

export function toggleLocSegCollapse(segNo) {
  const key = `${selectedTableId}_${segNo}`;
  if (collapsedLocSegs.has(key)) collapsedLocSegs.delete(key);
  else collapsedLocSegs.add(key);
  renderLocationsColumn();
}

// 跨層拖拉狀態（子層拖拉至父層）
let draggingTableId = null;
let draggingLocCode = null;
let droppedOnParent = false;

function segNoToLetter(segNo) {
  const n = Number(segNo) || 0;
  return n > 0 ? (ALPHABET[n - 1] || 'Z') : '0';
}

function findNextAvailableAreaCode(usedIdsSet) {
  for (let i = 0; i < ALPHABET.length; i++) {
    const code = ALPHABET[i];
    const id = `${unitPrefix}${code}`.toUpperCase();
    if (!usedIdsSet.has(id)) return { code, id };
  }
  return { code: 'Z', id: `${unitPrefix}Z` };
}

function findNextAvailableTableCodeInSeg(areaId, segNo, usedIdsSet, startMinorIdx = 0) {
  const majorChar = segNoToLetter(segNo);
  let min = startMinorIdx;
  while (min < ALPHABET.length) {
    const tCode = `${majorChar}${ALPHABET[min]}`;
    const tId = `${areaId}${tCode}`.toUpperCase();
    if (!usedIdsSet.has(tId)) {
      return { tCode, tId, nextMinor: min + 1 };
    }
    min++;
  }
  return { tCode: `${majorChar}Z`, tId: `${areaId}${majorChar}Z`.toUpperCase(), nextMinor: ALPHABET.length };
}

function findNextAvailableLocCode(tableId, segNo, usedLocSet, startSeq = 1) {
  const segChar = String(Math.max(0, Math.min(9, Number(segNo) || 0)));
  let seq = startSeq;
  while (seq <= 999) {
    const posStr = String(seq).padStart(3, '0');
    const code = `${tableId}${segChar}${posStr}`.toUpperCase();
    if (!usedLocSet.has(code)) {
      return { locCode: code, posStr, nextSeq: seq + 1 };
    }
    seq++;
  }
  return { locCode: `${tableId}${segChar}999`.toUpperCase(), posStr: '999', nextSeq: 1000 };
}

function setHierDirtyState(isDirty) {
  hasUnsavedHierChanges = isDirty;
  const badge = document.getElementById('hier-dirty-badge');
  const saveBtn = document.getElementById('btn-hier-manual-save');
  if (badge) badge.classList.toggle('d-none', !isDirty);
  if (saveBtn) {
    saveBtn.className = isDirty
      ? 'btn btn-danger btn-sm fw-bold shadow-sm'
      : 'btn btn-success btn-sm fw-bold shadow-sm';
    saveBtn.innerHTML = isDirty
      ? '<i class="bi bi-exclamation-circle-fill"></i> 存檔並更新*'
      : '<i class="bi bi-cloud-arrow-up"></i> 存檔並更新';
  }
}

export function hasUnsavedHierarchyChanges() {
  return hasUnsavedHierChanges;
}

export function confirmLeaveHierarchy() {
  if (!hasUnsavedHierChanges) return true;
  const ok = confirm('⚠️ 分層儲位維護尚有「未存檔」的變更！\n確定要離開嗎？（未存檔的修改將會遺失）');
  if (ok) setHierDirtyState(false);
  return ok;
}

export function initHierarchyMaintenance() {
  switchView('view-maintenance');
  const titleEl = document.getElementById('maint-dept-title');
  if (titleEl) {
    titleEl.innerHTML = `<i class="bi bi-diagram-3"></i> ${DEPT_NAME}（鎖定前綴：<code>${unitPrefix}</code>）— 分層儲位維護`;
  }
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

    hierAreas = (res.areas || []).map(a => ({ ...a, is_locked: !!a.is_locked }));
    hierTables = (res.tables || []).map(t => ({
      ...t,
      is_locked: !!t.is_locked,
      is_section_start: Number(t.is_section_start) || 0,
      segment_no: Number(t.is_section_start) || 0
    }));
    hierLocations = (res.locations || []).map(l => ({
      ...l,
      is_locked: !!l.is_locked,
      segment_no: Number(l.row_no) || 0
    }));
    hierSegments = (res.segments || []).map(s => ({
      ...s,
      segment_no: Number(s.segment_no) || 1
    }));

    if (!selectedAreaId || !hierAreas.some(a => a.area_id === selectedAreaId)) {
      selectedAreaId = hierAreas[0]?.area_id || null;
    }
    setHierDirtyState(false);
    renderAreasColumn();
  }).catch(err => {
    if (!silent) toggleLoader(false);
    alert('連線失敗：' + err.message);
  });
}

function saveHierarchyOnly(toastMsg = '') {
  setHierDirtyState(true);
  renderAreasColumn();
  if (toastMsg) showToast(`${toastMsg}（尚未寫入資料庫）`, 'delete');
}

export function saveHierarchyManual() {
  toggleLoader(true, '正在存檔並更新分層儲位...');
  const tablesPayload = hierTables.map(t => ({
    ...t,
    is_section_start: Number(t.segment_no ?? t.is_section_start) || 0
  }));

  fetchBackend('saveFullHierarchy', {
    areas: JSON.stringify(hierAreas),
    tables: JSON.stringify(tablesPayload),
    locations: JSON.stringify(hierLocations),
    segments: JSON.stringify(hierSegments)
  }).then(res => {
    toggleLoader(false);
    if (!res || !res.success) return alert('存檔失敗：' + (res?.message || '未知錯誤'));
    setHierDirtyState(false);
    showToast('✅ 已成功存檔並更新！');
    loadHierarchyData(true);
  }).catch(err => {
    toggleLoader(false);
    alert('存檔異常：' + err.message);
  });
}

export function runAutoEncodeHierarchy() {
  if (!confirm('確定要執行「自動編碼」嗎？\n\n• 未上鎖的區域、盤點表與儲位將依目前分段與排序重新編碼\n• 已上鎖 (🔒) 的項目將維持原始編碼，系統會自動避開重複\n• 執行後請記得點擊「存檔並更新」寫入資料庫')) return;

  const areaIdMap = {};
  const tableIdMap = {};
  const newSegments = [];

  // 1. 第一層：區域 (前綴2碼 + A-Z)
  const usedAreaIds = new Set(
    hierAreas.filter(a => a.is_locked && a.area_id).map(a => String(a.area_id).toUpperCase())
  );
  const newAreas = hierAreas.map(a => {
    if (a.is_locked && a.area_id) {
      areaIdMap[a.area_id] = a.area_id;
      return { ...a, is_locked: true };
    }
    const picked = findNextAvailableAreaCode(usedAreaIds);
    usedAreaIds.add(picked.id);
    areaIdMap[a.area_id] = picked.id;
    return { ...a, area_code: picked.code, area_id: picked.id, is_locked: false };
  });

  // 2. 第二層：盤點表 (區域編號 + 分段碼A-Z(或0=POOL) + 代號A-Z)
  const usedTableIds = new Set(
    hierTables.filter(t => t.is_locked && t.table_id).map(t => String(t.table_id).toUpperCase())
  );
  const newTables = [];

  for (const a of newAreas) {
    const oldAreaIds = Object.keys(areaIdMap).filter(k => areaIdMap[k] === a.area_id);
    const oldAreaSegKeys = new Set(oldAreaIds.map(id => `${AREA_SEG_PREFIX}${id}`));
    oldAreaSegKeys.add(`${AREA_SEG_PREFIX}${a.area_id}`);

    const areaSegs = hierSegments.filter(s => oldAreaSegKeys.has(s.table_id));
    const segNos = Array.from(new Set(areaSegs.map(s => Number(s.segment_no)).filter(n => n > 0))).sort((x, y) => x - y);
    const areaSegRemap = {};
    segNos.forEach((sNo, sIdx) => {
      const targetSegNo = sIdx + 1;
      areaSegRemap[sNo] = targetSegNo;
      const segObj = areaSegs.find(x => Number(x.segment_no) === sNo);
      newSegments.push({
        segment_id: `AREA_${a.area_id}_SEG_${targetSegNo}`,
        unit_code: unitPrefix,
        table_id: `${AREA_SEG_PREFIX}${a.area_id}`,
        segment_no: targetSegNo,
        segment_name: segObj?.segment_name || `分段 ${segNoToLetter(targetSegNo)}`
      });
    });

    const groupTables = hierTables.filter(t => oldAreaIds.includes(t.area_code) || t.area_code === a.area_id);
    const minorIdxBySeg = {};

    groupTables.forEach(t => {
      const rawSeg = Number(t.segment_no ?? t.is_section_start) || 0;
      const mappedSegNo = rawSeg > 0 && areaSegRemap[rawSeg] ? areaSegRemap[rawSeg] : 0;

      if (t.is_locked && t.table_id) {
        tableIdMap[t.table_id] = t.table_id;
        newTables.push({
          ...t,
          area_code: a.area_id,
          segment_no: mappedSegNo,
          is_section_start: mappedSegNo,
          is_locked: true
        });
      } else {
        const startMinor = minorIdxBySeg[mappedSegNo] || 0;
        const picked = findNextAvailableTableCodeInSeg(a.area_id, mappedSegNo, usedTableIds, startMinor);
        usedTableIds.add(picked.tId);
        minorIdxBySeg[mappedSegNo] = picked.nextMinor;
        tableIdMap[t.table_id] = picked.tId;
        newTables.push({
          ...t,
          area_code: a.area_id,
          table_code: picked.tCode,
          table_id: picked.tId,
          segment_no: mappedSegNo,
          is_section_start: mappedSegNo,
          is_locked: false
        });
      }
    });
  }

  // 3. 第三層：儲位 (盤點表編號 + 分段碼0-9 + 001起3碼)
  const usedLocCodes = new Set(
    hierLocations.filter(l => l.is_locked && l.loc_code).map(l => String(l.loc_code).toUpperCase())
  );
  const newLocations = [];

  for (const t of newTables) {
    const oldTblIds = Object.keys(tableIdMap).filter(k => tableIdMap[k] === t.table_id);
    const groupLocs = hierLocations.filter(l => oldTblIds.includes(l.table_id) || l.table_id === t.table_id);
    const segsForTbl = hierSegments.filter(s => !s.table_id.startsWith(AREA_SEG_PREFIX) && (oldTblIds.includes(s.table_id) || s.table_id === t.table_id));

    const segNos = Array.from(new Set(segsForTbl.map(s => Number(s.segment_no)).filter(n => n > 0))).sort((x, y) => x - y);
    const segNoRemap = {};
    segNos.forEach((sNo, sIdx) => {
      const targetSegNo = sIdx + 1;
      segNoRemap[sNo] = targetSegNo;
      const segObj = segsForTbl.find(x => Number(x.segment_no) === sNo);
      newSegments.push({
        segment_id: `${t.table_id}_SEG_${targetSegNo}`,
        unit_code: unitPrefix,
        table_id: t.table_id,
        segment_no: targetSegNo,
        segment_name: segObj?.segment_name || `第 ${targetSegNo} 分段`
      });
    });

    const seqBySeg = {};
    groupLocs.forEach(l => {
      const rawSeg = Number(l.segment_no ?? l.row_no) || 0;
      const mappedSegNo = rawSeg > 0 && segNoRemap[rawSeg] ? segNoRemap[rawSeg] : 0;
      const rowNoStr = String(mappedSegNo);

      if (l.is_locked && l.loc_code) {
        newLocations.push({
          ...l,
          table_id: t.table_id,
          row_no: rowNoStr,
          segment_no: mappedSegNo,
          loc_code: l.loc_code,
          is_locked: true
        });
      } else {
        const startSeq = seqBySeg[mappedSegNo] || 1;
        const picked = findNextAvailableLocCode(t.table_id, mappedSegNo, usedLocCodes, startSeq);
        usedLocCodes.add(picked.locCode);
        seqBySeg[mappedSegNo] = picked.nextSeq;
        newLocations.push({
          ...l,
          table_id: t.table_id,
          row_no: rowNoStr,
          pos_no: picked.posStr,
          segment_no: mappedSegNo,
          loc_code: picked.locCode,
          is_locked: false
        });
      }
    });
  }

  hierAreas = newAreas;
  hierTables = newTables;
  hierLocations = newLocations;
  hierSegments = newSegments;
  if (selectedAreaId && areaIdMap[selectedAreaId]) selectedAreaId = areaIdMap[selectedAreaId];
  if (selectedTableId && tableIdMap[selectedTableId]) selectedTableId = tableIdMap[selectedTableId];

  setHierDirtyState(true);
  renderAreasColumn();
  showToast('已完成自動編碼預覽，請點擊「存檔並更新」寫入資料庫', 'delete');
}

// ==========================================
// 跨層拖拉事件（子層拖拉至父層 -> 進入該父層未分配池）
// ==========================================
export function handleAreaDragOver(e) {
  if (!draggingTableId) return;
  e.preventDefault();
  e.currentTarget.classList.add('border-warning', 'border-3');
}

export function handleAreaDragLeave(e) {
  e.currentTarget.classList.remove('border-warning', 'border-3');
}

export function handleAreaDrop(e, targetAreaId) {
  e.currentTarget.classList.remove('border-warning', 'border-3');
  if (!draggingTableId) return;
  e.preventDefault();
  const t = hierTables.find(x => x.table_id === draggingTableId);
  if (t && t.area_code !== targetAreaId) {
    droppedOnParent = true;
    t.area_code = targetAreaId;
    t.segment_no = 0;
    t.is_section_start = 0;
    if (selectedTableId === t.table_id) selectedTableId = null;
    draggingTableId = null;
    saveHierarchyOnly(`已將盤點表移至區域 ${targetAreaId} 的未分配池 (POOL)`);
  }
}

export function handleTableDragOver(e) {
  if (!draggingLocCode) return;
  e.preventDefault();
  e.currentTarget.classList.add('border-warning', 'border-3');
}

export function handleTableDragLeave(e) {
  e.currentTarget.classList.remove('border-warning', 'border-3');
}

export function handleTableDrop(e, targetTableId) {
  e.currentTarget.classList.remove('border-warning', 'border-3');
  if (!draggingLocCode) return;
  e.preventDefault();
  const l = hierLocations.find(x => x.loc_code === draggingLocCode);
  if (l && l.table_id !== targetTableId) {
    droppedOnParent = true;
    l.table_id = targetTableId;
    l.segment_no = 0;
    l.row_no = '0';
    draggingLocCode = null;
    saveHierarchyOnly(`已將儲位移至盤點表 ${targetTableId} 的未分配池 (POOL)`);
  }
}

// ==========================================
// 第一層：區域
// ==========================================
export function renderAreasColumn() {
  const areaListEl = document.getElementById('hier-area-list');
  if (!areaListEl) return;
  if (!hierAreas.length) {
    areaListEl.innerHTML = '<div class="text-center text-muted small py-4">尚無區域資料，請點擊右上角新增</div>';
    selectedAreaId = null;
    renderTablesColumn();
    return;
  }

  areaListEl.innerHTML = hierAreas.map(a => {
    const active = a.area_id === selectedAreaId;
    const tblCount = hierTables.filter(t => t.area_code === a.area_id).length;

    return `
      <div class="list-group-item list-group-item-action p-2 hier-area-item ${active ? 'active bg-academic border-academic' : ''}"
           data-area-id="${a.area_id}" style="cursor:pointer;"
           onclick="selectHierArea('${a.area_id}')"
           ondragover="handleAreaDragOver(event)"
           ondragleave="handleAreaDragLeave(event)"
           ondrop="handleAreaDrop(event, '${a.area_id}')">
        <div class="d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-1">
            <i class="bi bi-grip-vertical area-drag-handle opacity-75" style="cursor:grab;"></i>
            <span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary'} me-1">${a.is_locked ? '🔒 ' : ''}${a.area_id}</span>
            <span class="fw-bold">${a.area_name}</span>
          </div>
          <span class="badge ${active ? 'bg-light text-dark' : 'bg-light text-dark border'}">${tblCount} 表</span>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-1 ps-3">
          <small class="${active ? 'text-light' : 'text-muted'}">${a.area_desc || ''}</small>
          <div onclick="event.stopPropagation()">
            <button class="btn btn-sm ${a.is_locked ? 'btn-dark' : (active ? 'btn-outline-light' : 'btn-outline-secondary')} py-0 px-1" title="鎖定/解鎖區域編號" onclick="toggleAreaLock('${a.area_id}')">${a.is_locked ? '🔒' : '🔓'}</button>
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
        saveHierarchyOnly('已更新區域排序');
      }
    });
  }

  renderTablesColumn();
}

export function selectHierArea(areaId) {
  selectedAreaId = areaId;
  selectedTableId = null;
  selectedTableSegmentNo = 0;
  renderAreasColumn();
}

export function toggleAreaLock(areaId) {
  const a = hierAreas.find(x => x.area_id === areaId);
  if (!a) return;
  a.is_locked = !a.is_locked;
  saveHierarchyOnly(a.is_locked ? `已鎖定區域 ${areaId} 原始編碼` : `已解除區域 ${areaId} 鎖定`);
}

// ==========================================
// 第二層：盤點表（POOL 暫存池 + 分段框 + 取消分段）
// ==========================================
export function createNewTableSegmentBox() {
  if (!selectedAreaId) return alert('請先選擇所屬區域');
  const segKey = `${AREA_SEG_PREFIX}${selectedAreaId}`;
  const existingSegs = hierSegments.filter(s => s.table_id === segKey);
  const usedNos = new Set(existingSegs.map(s => Number(s.segment_no) || 0));

  let nextNo = 1;
  while (usedNos.has(nextNo) && nextNo <= 26) nextNo++;
  if (nextNo > 26) return alert('單一區域最多支援 A～Z 分段');

  const letter = segNoToLetter(nextNo);
  const customName = prompt(`建立盤點表分段【${letter}】，請輸入分段名稱（可留空）:`, `分段 ${letter}`);
  if (customName === null) return;

  hierSegments.push({
    segment_id: `AREA_${selectedAreaId}_SEG_${Date.now()}`,
    unit_code: unitPrefix,
    table_id: segKey,
    segment_no: nextNo,
    segment_name: customName.trim() || `分段 ${letter}`
  });

  // 自動把目前在 POOL 中、且盤點表代碼第一個字母符合此分段（例如 A -> AA/AB/AC）的盤點表歸類進來
  let autoMoved = 0;
  hierTables.forEach(t => {
    const curSeg = Number(t.segment_no ?? t.is_section_start) || 0;
    const tCode = String(t.table_code || '').trim().toUpperCase();
    if (t.area_code === selectedAreaId && curSeg === 0 && tCode.startsWith(letter)) {
      t.segment_no = nextNo;
      t.is_section_start = nextNo;
      autoMoved++;
    }
  });

  selectedTableSegmentNo = nextNo;
  const msg = autoMoved > 0
    ? `已建立「分段 ${letter}」，並自動歸類 ${autoMoved} 張盤點表`
    : `已建立盤點表「分段 ${letter}」`;
  saveHierarchyOnly(msg);
}

export function deleteTableSegmentBox(segNo) {
  if (!selectedAreaId) return;
  const letter = segNoToLetter(segNo);
  if (!confirm(`確定要取消盤點表「分段 ${letter}」嗎？\n此分段內的盤點表將全部退回未分配池 (POOL)。`)) return;

  const segKey = `${AREA_SEG_PREFIX}${selectedAreaId}`;
  hierSegments = hierSegments.filter(s => !(s.table_id === segKey && Number(s.segment_no) === Number(segNo)));
  hierTables.forEach(t => {
    if (t.area_code === selectedAreaId && Number(t.segment_no ?? t.is_section_start) === Number(segNo)) {
      t.segment_no = 0;
      t.is_section_start = 0;
    }
  });
  if (Number(selectedTableSegmentNo) === Number(segNo)) selectedTableSegmentNo = 0;
  saveHierarchyOnly(`已取消分段 ${letter}，盤點表已退回未分配池`);
}

export function selectTableSegment(segNo) {
  selectedTableSegmentNo = Number(segNo) || 0;
  renderTablesColumn();
}

export function renderTablesColumn() {
  const tblListEl = document.getElementById('hier-table-list');
  if (!tblListEl) return;

  if (!selectedAreaId) {
    tblListEl.innerHTML = '<div class="text-center text-muted small py-4">請先於左側選擇區域</div>';
    selectedTableId = null;
    renderLocationsColumn();
    return;
  }

  const areaTables = hierTables.filter(t => t.area_code === selectedAreaId);
  if (areaTables.length > 0 && (!selectedTableId || !areaTables.some(t => t.table_id === selectedTableId))) {
    selectedTableId = areaTables[0].table_id;
  } else if (areaTables.length === 0) {
    selectedTableId = null;
  }

  const segKey = `${AREA_SEG_PREFIX}${selectedAreaId}`;
  const segs = hierSegments
    .filter(s => s.table_id === segKey && Number(s.segment_no) > 0)
    .sort((a, b) => Number(a.segment_no) - Number(b.segment_no));
  const validSegNos = new Set(segs.map(s => Number(s.segment_no)));

  const poolTables = areaTables.filter(t => {
    const sNo = Number(t.segment_no ?? t.is_section_start) || 0;
    return sNo === 0 || !validSegNos.has(sNo);
  });

  const renderTableCards = (items) => {
    if (!items.length) return '<div class="text-center text-muted small py-2">無盤點表（可拖拉至此）</div>';
    return items.map(t => {
      const active = t.table_id === selectedTableId;
      const locCount = hierLocations.filter(l => l.table_id === t.table_id).length;
      return `
        <div class="list-group-item list-group-item-action p-2 hier-table-item ${active ? 'active bg-academic border-academic' : ''}"
             data-table-id="${t.table_id}" style="cursor:pointer;"
             onclick="selectHierTable('${t.table_id}')"
             ondragover="handleTableDragOver(event)"
             ondragleave="handleTableDragLeave(event)"
             ondrop="handleTableDrop(event, '${t.table_id}')">
          <div class="d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center gap-1 text-truncate">
              <i class="bi bi-grip-vertical table-drag-handle opacity-75" style="cursor:grab;"></i>
              <span class="badge ${active ? 'bg-light text-dark' : 'bg-secondary'} me-1">${t.is_locked ? '🔒 ' : ''}${t.table_id}</span>
              <span class="fw-bold text-truncate">${t.table_name}</span>
            </div>
            <span class="badge ${active ? 'bg-light text-dark' : 'bg-light text-dark border'}">${locCount} 儲</span>
          </div>
          <div class="d-flex justify-content-between align-items-center mt-1 ps-3">
            <select class="form-select form-select-sm py-0 px-1" style="font-size:0.7rem; width:auto;" onclick="event.stopPropagation()" onchange="moveTableToArea('${t.table_id}', this.value)">
              ${hierAreas.map(a => `<option value="${a.area_id}" ${a.area_id === selectedAreaId ? 'selected' : ''}>移至 ${a.area_id}</option>`).join('')}
            </select>
            <div onclick="event.stopPropagation()">
              <button class="btn btn-sm ${t.is_locked ? 'btn-dark' : (active ? 'btn-outline-light' : 'btn-outline-secondary')} py-0 px-1" title="鎖定/解鎖盤點表編號" onclick="toggleTableLock('${t.table_id}')">${t.is_locked ? '🔒' : '🔓'}</button>
              <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-primary'} py-0 px-1" onclick="openTableModal('${t.table_id}')">編</button>
              <button class="btn btn-sm ${active ? 'btn-outline-light' : 'btn-outline-danger'} py-0 px-1" onclick="deleteTableItem('${t.table_id}')">刪</button>
            </div>
          </div>
        </div>`;
    }).join('');
  };

  const isPoolCollapsed = collapsedTableSegs.has(`${selectedAreaId}_0`);
  const poolHtml = `
    <div class="card border ${selectedTableSegmentNo === 0 ? 'border-warning border-2' : 'border-warning'} mb-2 shadow-xs">
      <div class="card-header py-1 px-2 d-flex justify-content-between align-items-center bg-warning bg-opacity-25" style="cursor:pointer;" onclick="selectTableSegment(0)">
        <div class="fw-bold small text-dark d-flex align-items-center gap-1">
          <button type="button" class="btn btn-sm btn-link text-dark p-0 text-decoration-none fw-bold" style="width:18px;" onclick="event.stopPropagation(); toggleTableSegCollapse(0)" title="收合/展開">${isPoolCollapsed ? '▸' : '▾'}</button>
          <span class="badge bg-warning text-dark">POOL</span>
          <span>未分配暫存池 (${poolTables.length})</span>
        </div>
        <span class="small ${selectedTableSegmentNo === 0 ? 'text-dark fw-bold' : 'text-muted'}">${selectedTableSegmentNo === 0 ? '● 新增目標' : ''}</span>
      </div>
      <div class="list-group list-group-flush hier-tbl-seg-list ${isPoolCollapsed ? 'd-none' : ''}" data-seg-no="0">
        ${renderTableCards(poolTables)}
      </div>
    </div>`;

  const segsHtml = segs.map((seg, idx) => {
    const sNo = Number(seg.segment_no);
    const letter = segNoToLetter(idx + 1);
    const isSel = Number(selectedTableSegmentNo) === sNo;
    const isCol = collapsedTableSegs.has(`${selectedAreaId}_${sNo}`);
    const itemsInSeg = areaTables.filter(t => (Number(t.segment_no ?? t.is_section_start) || 0) === sNo);
    return `
      <div class="card border ${isSel ? 'border-primary border-2' : 'border-secondary-subtle'} mb-2 shadow-xs">
        <div class="card-header py-1 px-2 d-flex justify-content-between align-items-center ${isSel ? 'bg-primary bg-opacity-10' : 'bg-light'}" style="cursor:pointer;" onclick="selectTableSegment(${sNo})">
          <div class="fw-bold small text-dark text-truncate d-flex align-items-center gap-1">
            <button type="button" class="btn btn-sm btn-link text-dark p-0 text-decoration-none fw-bold" style="width:18px;" onclick="event.stopPropagation(); toggleTableSegCollapse(${sNo})" title="收合/展開">${isCol ? '▸' : '▾'}</button>
            <span class="badge bg-primary">段 ${letter}</span>
            <span class="text-truncate">${seg.segment_name || `分段 ${letter}`} (${itemsInSeg.length})</span>
          </div>
          <div class="d-flex align-items-center gap-1 flex-shrink-0" onclick="event.stopPropagation()">
            <button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size:0.7rem;" onclick="deleteTableSegmentBox(${sNo})">取消分段</button>
          </div>
        </div>
        <div class="list-group list-group-flush hier-tbl-seg-list ${isCol ? 'd-none' : ''}" data-seg-no="${sNo}">
          ${renderTableCards(itemsInSeg)}
        </div>
      </div>`;
  }).join('');

  tblListEl.innerHTML = poolHtml + segsHtml;

  if (window.Sortable) {
    tblListEl.querySelectorAll('.hier-tbl-seg-list').forEach(listEl => {
      new window.Sortable(listEl, {
        group: 'hier-table-group',
        handle: '.table-drag-handle',
        draggable: '.hier-table-item',
        animation: 150,
        onStart: (evt) => {
          draggingTableId = evt.item.getAttribute('data-table-id');
          droppedOnParent = false;
        },
        onEnd: (evt) => {
          draggingTableId = null;
          if (droppedOnParent) {
            droppedOnParent = false;
            return;
          }
          const newOrderedInArea = [];
          tblListEl.querySelectorAll('.hier-tbl-seg-list').forEach(box => {
            const sNo = Number(box.getAttribute('data-seg-no')) || 0;
            box.querySelectorAll('.hier-table-item').forEach(itemEl => {
              const id = itemEl.getAttribute('data-table-id');
              const found = hierTables.find(t => t.table_id === id);
              if (found) {
                found.segment_no = sNo;
                found.is_section_start = sNo;
                newOrderedInArea.push(found);
              }
            });
          });
          const others = hierTables.filter(t => t.area_code !== selectedAreaId);
          hierTables = [...others, ...newOrderedInArea];
          saveHierarchyOnly('已更新盤點表分段與排序');
        }
      });
    });
  }

  renderLocationsColumn();
}

export function selectHierTable(tableId) {
  selectedTableId = tableId;
  selectedSegmentNo = 0;
  renderTablesColumn();
}

export function toggleTableLock(tableId) {
  const t = hierTables.find(x => x.table_id === tableId);
  if (!t) return;
  t.is_locked = !t.is_locked;
  saveHierarchyOnly(t.is_locked ? `已鎖定盤點表 ${tableId} 原始編碼` : `已解除盤點表 ${tableId} 鎖定`);
}

export function moveTableToArea(tableId, newAreaId) {
  const t = hierTables.find(x => x.table_id === tableId);
  if (!t || t.area_code === newAreaId) return;
  t.area_code = newAreaId;
  t.segment_no = 0;
  t.is_section_start = 0;
  if (selectedTableId === tableId) selectedTableId = null;
  saveHierarchyOnly(`已將盤點表移至區域 ${newAreaId} 的未分配池 (POOL)`);
}

// ==========================================
// 第三層：儲位（POOL 暫存池 + 分段框 + 取消分段 + 複製儲位）
// ==========================================
export function createNewSegmentBox() {
  if (!selectedTableId) return alert('請先選擇盤點表');
  const segs = hierSegments.filter(s => s.table_id === selectedTableId);
  const usedNos = new Set(segs.map(s => Number(s.segment_no) || 0));
  let nextNo = 1;
  while (usedNos.has(nextNo) && nextNo <= 9) nextNo++;
  if (nextNo > 9) return alert('單一盤點表最多支援 1～9 分段');

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
  saveHierarchyOnly(`已建立「第 ${nextNo} 分段框」`);
}

export function deleteLocSegmentBox(segNo) {
  if (!selectedTableId) return;
  if (!confirm(`確定要取消「第 ${segNo} 分段」嗎？\n此分段內的儲位將全部退回未分配池 (POOL)。`)) return;

  hierSegments = hierSegments.filter(s => !(s.table_id === selectedTableId && Number(s.segment_no) === Number(segNo)));
  hierLocations.forEach(l => {
    if (l.table_id === selectedTableId && Number(l.segment_no ?? l.row_no) === Number(segNo)) {
      l.segment_no = 0;
      l.row_no = '0';
    }
  });
  if (Number(selectedSegmentNo) === Number(segNo)) selectedSegmentNo = 0;
  saveHierarchyOnly(`已取消分段 #${segNo}，儲位已退回未分配池`);
}

export function selectLocSegment(segNo) {
  selectedSegmentNo = Number(segNo) || 0;
  renderLocationsColumn();
}

export function duplicateLocItem(locCode) {
  const orig = hierLocations.find(l => l.loc_code === locCode);
  if (!orig) return;
  const usedLocSet = new Set(hierLocations.map(l => String(l.loc_code || '').toUpperCase()));
  const picked = findNextAvailableLocCode(orig.table_id, 0, usedLocSet, 1);

  hierLocations.push({
    loc_code: picked.locCode,
    unit_code: unitPrefix,
    table_id: orig.table_id,
    row_no: '0',
    pos_no: picked.posStr,
    segment_no: 0,
    is_locked: false,
    drug_code: orig.drug_code,
    drug_name: orig.drug_name,
    monthly_desc: orig.monthly_desc || '',
    drug_remark: orig.drug_remark || '',
    daily_notice: orig.daily_notice || ''
  });
  saveHierarchyOnly(`已複製儲位至未分配池 (${picked.locCode})`);
}

export function renderLocationsColumn() {
  const container = document.getElementById('hier-segments-container');
  const titleEl = document.getElementById('hier-loc-header');
  if (!container) return;

  const tblObj = hierTables.find(t => t.table_id === selectedTableId);
  if (titleEl) {
    titleEl.innerText = tblObj ? `第三層：POOL、分段框與儲位（${tblObj.table_id} - ${tblObj.table_name}）` : '第三層：POOL、分段框與儲位';
  }

  if (!selectedTableId) {
    container.innerHTML = '<div class="text-center py-4 text-muted">請先於左側選擇盤點表</div>';
    return;
  }

  const kw = (document.getElementById('hier-loc-search')?.value || '').toLowerCase().trim();
  const segs = hierSegments
    .filter(s => s.table_id === selectedTableId && Number(s.segment_no) > 0)
    .sort((a, b) => Number(a.segment_no) - Number(b.segment_no));
  const validSegNos = new Set(segs.map(s => Number(s.segment_no)));
  const tableLocs = hierLocations.filter(l => l.table_id === selectedTableId);

  const filterKw = (arr) => {
    if (!kw) return arr;
    return arr.filter(l =>
      (l.loc_code || '').toLowerCase().includes(kw) ||
      (l.drug_code || '').toLowerCase().includes(kw) ||
      (l.drug_name || '').toLowerCase().includes(kw)
    );
  };

  const poolItems = filterKw(tableLocs.filter(l => {
    const sNo = Number(l.segment_no ?? l.row_no) || 0;
    return sNo === 0 || !validSegNos.has(sNo);
  }));

  const renderLocRows = (items, displaySegLabel, segNumForBadge) => {
    return items.map(l => `
      <tr class="hier-loc-row" data-loc-code="${l.loc_code}">
        <td class="text-center text-nowrap">
          <i class="bi bi-grip-vertical loc-drag-handle text-secondary me-1" style="cursor:grab;"></i>
          <span class="badge ${segNumForBadge === 0 ? 'bg-warning text-dark' : 'bg-info text-dark'}">${displaySegLabel}</span>
        </td>
        <td class="fw-bold text-nowrap">
          ${l.is_locked ? '<span class="badge bg-dark me-1">🔒</span>' : ''}${l.loc_code}
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
            <button class="btn btn-sm btn-outline-success py-0 px-1" title="複製儲位至未分配池" onclick="duplicateLocItem('${l.loc_code}')">複</button>
            <button class="btn btn-sm btn-outline-primary py-0 px-1" onclick="openLocEditModal('${l.loc_code}')">編</button>
            <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="deleteLocItem('${l.loc_code}')">刪</button>
          </div>
        </td>
      </tr>`).join('');
  };

  const isLocPoolCollapsed = collapsedLocSegs.has(`${selectedTableId}_0`);
  const poolCardHtml = `
    <div class="card border ${selectedSegmentNo === 0 ? 'border-warning border-2' : 'border-warning'} mb-3 shadow-xs">
      <div class="card-header py-1 px-2 d-flex justify-content-between align-items-center bg-warning bg-opacity-25" style="cursor:pointer;" onclick="selectLocSegment(0)">
        <div class="fw-bold small text-dark d-flex align-items-center gap-1">
          <button type="button" class="btn btn-sm btn-link text-dark p-0 text-decoration-none fw-bold" style="width:18px;" onclick="event.stopPropagation(); toggleLocSegCollapse(0)" title="收合/展開">${isLocPoolCollapsed ? '▸' : '▾'}</button>
          <span class="badge bg-warning text-dark">POOL</span>
          <span>未分配分段暫存池（分段碼 0）</span>
          <span class="text-muted">(${poolItems.length} 筆)</span>
        </div>
        <span class="small text-dark fw-semibold">${selectedSegmentNo === 0 ? '● 目前新增目標' : '暫存區'}</span>
      </div>
      <div class="table-responsive ${isLocPoolCollapsed ? 'd-none' : ''}">
        <table class="table table-hover table-sm align-middle mb-0">
          <thead class="table-light">
            <tr><th class="text-center">池別</th><th>儲位碼</th><th>藥品代碼</th><th>藥品名稱</th><th>說明/備註/注意</th><th class="text-center">操作</th></tr>
          </thead>
          <tbody class="hier-seg-tbody" data-seg-no="0">
            ${renderLocRows(poolItems, 'POOL', 0) || '<tr><td colspan="6" class="text-center py-2 text-muted small">目前無未分配至分段的儲位</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  const segCardsHtml = segs.length > 0
    ? segs.map((seg, sIdx) => {
        const segNo = Number(seg.segment_no) || (sIdx + 1);
        const displaySegNum = sIdx + 1;
        const isSelSeg = segNo === Number(selectedSegmentNo);
        const isCol = collapsedLocSegs.has(`${selectedTableId}_${segNo}`);
        const itemsInSeg = filterKw(tableLocs.filter(l => (Number(l.segment_no ?? l.row_no) || 0) === segNo));

        return `
          <div class="card border ${isSelSeg ? 'border-primary border-2' : 'border-secondary-subtle'} mb-2 shadow-xs">
            <div class="card-header py-1 px-2 d-flex justify-content-between align-items-center ${isSelSeg ? 'bg-primary bg-opacity-10' : 'bg-light'}" onclick="selectLocSegment(${segNo})" style="cursor:pointer;">
              <div class="fw-bold small text-dark d-flex align-items-center gap-1">
                <button type="button" class="btn btn-sm btn-link text-dark p-0 text-decoration-none fw-bold" style="width:18px;" onclick="event.stopPropagation(); toggleLocSegCollapse(${segNo})" title="收合/展開">${isCol ? '▸' : '▾'}</button>
                <span class="badge bg-primary">分段 #${displaySegNum}</span>
                <span>${seg.segment_name || `第 ${displaySegNum} 分段`}</span>
                <span class="text-muted">(${itemsInSeg.length} 筆)</span>
              </div>
              <div class="d-flex align-items-center gap-2" onclick="event.stopPropagation()">
                <span class="small ${isSelSeg ? 'text-primary fw-bold' : 'text-muted'}">${isSelSeg ? '● 新增目標' : ''}</span>
                <button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size:0.7rem;" onclick="deleteLocSegmentBox(${segNo})">取消分段</button>
              </div>
            </div>
            <div class="table-responsive ${isCol ? 'd-none' : ''}">
              <table class="table table-hover table-sm align-middle mb-0">
                <thead class="table-light">
                  <tr><th class="text-center">分段</th><th>儲位碼</th><th>藥品代碼</th><th>藥品名稱</th><th>說明/備註/注意</th><th class="text-center">操作</th></tr>
                </thead>
                <tbody class="hier-seg-tbody" data-seg-no="${segNo}">
                  ${renderLocRows(itemsInSeg, `段 ${displaySegNum}`, displaySegNum) || '<tr><td colspan="6" class="text-center py-3 text-muted small">拖拉 POOL 或其他分段藥品到此分段箱，或點擊「+ 新增儲位」</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>`;
      }).join('')
    : '<div class="alert alert-secondary small py-2 mb-0">尚未建立分段框，請點擊上方「+ 新增分段框」建立分段箱後再拖拉 POOL 儲位進入。</div>';

  container.innerHTML = poolCardHtml + segCardsHtml;

  if (window.Sortable && !kw) {
    container.querySelectorAll('.hier-seg-tbody').forEach(tb => {
      new window.Sortable(tb, {
        group: 'hier-loc-group',
        handle: '.loc-drag-handle',
        draggable: '.hier-loc-row',
        animation: 150,
        onStart: (evt) => {
          draggingLocCode = evt.item.getAttribute('data-loc-code');
          droppedOnParent = false;
        },
        onEnd: (evt) => {
          draggingLocCode = null;
          if (droppedOnParent) {
            droppedOnParent = false;
            return;
          }
          const newOrderedInTable = [];
          container.querySelectorAll('.hier-seg-tbody').forEach(box => {
            const sNo = Number(box.getAttribute('data-seg-no')) || 0;
            box.querySelectorAll('.hier-loc-row').forEach(rowEl => {
              const code = rowEl.getAttribute('data-loc-code');
              const found = hierLocations.find(x => x.loc_code === code);
              if (found) {
                found.segment_no = sNo;
                found.row_no = String(sNo);
                newOrderedInTable.push(found);
              }
            });
          });

          const others = hierLocations.filter(l => l.table_id !== selectedTableId);
          hierLocations = [...others, ...newOrderedInTable];
          saveHierarchyOnly('已更新儲位分段與排序');
        }
      });
    });
  }
}

export function toggleLocLock(locCode) {
  const l = hierLocations.find(x => x.loc_code === locCode);
  if (!l) return;
  l.is_locked = !l.is_locked;
  saveHierarchyOnly(l.is_locked ? `已鎖定儲位碼 ${locCode}` : `已解除儲位碼 ${locCode} 鎖定`);
}

export function moveLocToTable(locCode, newTableId) {
  const l = hierLocations.find(x => x.loc_code === locCode);
  if (!l || l.table_id === newTableId) return;
  l.table_id = newTableId;
  l.segment_no = 0;
  l.row_no = '0';
  saveHierarchyOnly(`已將儲位移至盤點表 ${newTableId} 的未分配池 (POOL)`);
}

// ==========================================
// Modals（區域 / 盤點表 / 儲位）
// ==========================================
export function syncAreaIdPreview() {
  const code = (document.getElementById('a-area-code')?.value || '').trim().toUpperCase();
  const idEl = document.getElementById('a-area-id');
  if (idEl && code) idEl.value = `${unitPrefix}${code}`;
}

export function openAreaModal(areaId = '') {
  const existing = areaId ? hierAreas.find(a => a.area_id === areaId) : null;
  document.getElementById('a-editing-id').value = existing ? existing.area_id : '';
  const usedIds = new Set(hierAreas.map(a => String(a.area_id || '').toUpperCase()));
  const nextObj = existing ? { code: existing.area_code, id: existing.area_id } : findNextAvailableAreaCode(usedIds);
  document.getElementById('a-area-code').value = nextObj.code;
  document.getElementById('a-area-id').value = nextObj.id;
  document.getElementById('a-area-name').value = existing ? existing.area_name : '';
  document.getElementById('a-area-desc').value = existing ? existing.area_desc : '';
  const lockChk = document.getElementById('a-is-locked');
  if (lockChk) lockChk.checked = existing ? !!existing.is_locked : false;

  if (!areaModalInstance) areaModalInstance = new window.bootstrap.Modal(document.getElementById('areaEditModal'));
  areaModalInstance.show();
}

export function submitAreaEdit() {
  const editingId = document.getElementById('a-editing-id').value.trim().toUpperCase();
  const areaCode = document.getElementById('a-area-code').value.trim().toUpperCase();
  const areaId = document.getElementById('a-area-id').value.trim().toUpperCase();
  const areaName = document.getElementById('a-area-name').value.trim();
  const areaDesc = document.getElementById('a-area-desc').value.trim();
  const isLocked = !!document.getElementById('a-is-locked')?.checked;

  if (!areaCode || !areaId || !areaName) return alert('請填寫區域代碼、區域編號與區域名稱');

  const dup = hierAreas.find(a =>
    String(a.area_id || '').toUpperCase() === areaId &&
    String(a.area_id || '').toUpperCase() !== editingId
  );
  if (dup) return alert(`❌ 區域編號重複！\n「${areaId}」已被區域【${dup.area_name}】使用，請更換其他編號。`);

  if (editingId) {
    const t = hierAreas.find(a => a.area_id.toUpperCase() === editingId);
    if (t) {
      t.area_code = areaCode;
      t.area_id = areaId;
      t.area_name = areaName;
      t.area_desc = areaDesc;
      t.is_locked = isLocked;
      if (editingId !== areaId) {
        hierTables.forEach(tb => { if (tb.area_code.toUpperCase() === editingId) tb.area_code = areaId; });
        hierSegments.forEach(s => { if (s.table_id === `${AREA_SEG_PREFIX}${editingId}`) s.table_id = `${AREA_SEG_PREFIX}${areaId}`; });
        if (selectedAreaId === editingId) selectedAreaId = areaId;
      }
    }
  } else {
    hierAreas.push({
      area_id: areaId,
      unit_code: unitPrefix,
      area_code: areaCode,
      area_name: areaName,
      area_desc: areaDesc,
      is_locked: isLocked
    });
    selectedAreaId = areaId;
  }
  if (areaModalInstance) areaModalInstance.hide();
  saveHierarchyOnly('已更新區域設定');
}

export function deleteAreaItem(areaId) {
  if (hierTables.some(t => t.area_code === areaId)) return alert('此區域底下尚有盤點表，請先移走或刪除盤點表');
  if (!confirm(`確定要刪除區域「${areaId}」嗎？`)) return;
  hierAreas = hierAreas.filter(a => a.area_id !== areaId);
  hierSegments = hierSegments.filter(s => s.table_id !== `${AREA_SEG_PREFIX}${areaId}`);
  if (selectedAreaId === areaId) selectedAreaId = hierAreas[0]?.area_id || null;
  saveHierarchyOnly('已刪除區域');
}

export function syncTableIdPreview() {
  const areaId = (document.getElementById('t-area-id')?.value || '').trim().toUpperCase();
  const code = (document.getElementById('t-table-code')?.value || '').trim().toUpperCase();
  const idEl = document.getElementById('t-table-id');
  if (idEl && areaId && code) idEl.value = `${areaId}${code}`;
}

export function openTableModal(tableId = '') {
  if (!selectedAreaId && !tableId) return alert('請先選擇所屬區域');
  const existing = tableId ? hierTables.find(t => t.table_id === tableId) : null;
  const areaId = existing ? existing.area_code : selectedAreaId;
  document.getElementById('t-editing-id').value = existing ? existing.table_id : '';
  document.getElementById('t-area-id').value = areaId;
  const usedIds = new Set(hierTables.map(t => String(t.table_id || '').toUpperCase()));
  const nextObj = existing
    ? { tCode: existing.table_code, tId: existing.table_id }
    : findNextAvailableTableCodeInSeg(areaId, selectedTableSegmentNo, usedIds, 0);
  document.getElementById('t-table-code').value = nextObj.tCode;
  document.getElementById('t-table-id').value = nextObj.tId;
  document.getElementById('t-table-name').value = existing ? existing.table_name : '';
  document.getElementById('t-table-desc').value = existing ? existing.table_desc : '';
  const lockChk = document.getElementById('t-is-locked');
  if (lockChk) lockChk.checked = existing ? !!existing.is_locked : false;

  if (!tableModalInstance) tableModalInstance = new window.bootstrap.Modal(document.getElementById('tableEditModal'));
  tableModalInstance.show();
}

export function submitTableEdit() {
  const editingId = document.getElementById('t-editing-id').value.trim().toUpperCase();
  const areaId = document.getElementById('t-area-id').value.trim().toUpperCase();
  let tableCode = document.getElementById('t-table-code').value.trim().toUpperCase();
  const tableId = document.getElementById('t-table-id').value.trim().toUpperCase();
  // 若直接修改「盤點表編號」，自動從編號反推盤點表代碼
  if (tableId.startsWith(areaId) && tableId.length > areaId.length) {
    tableCode = tableId.slice(areaId.length);
  }
  const tableName = document.getElementById('t-table-name').value.trim();
  const tableDesc = document.getElementById('t-table-desc').value.trim();
  const isLocked = !!document.getElementById('t-is-locked')?.checked;

  if (!tableCode || !tableId || !tableName) return alert('請填寫盤點表代碼、編號與名稱');

  const dup = hierTables.find(t =>
    String(t.table_id || '').toUpperCase() === tableId &&
    String(t.table_id || '').toUpperCase() !== editingId
  );
  if (dup) return alert(`❌ 盤點表編號重複！\n「${tableId}」已被盤點表【${dup.table_name}】使用，請更換其他編號。`);

  // 依盤點表代碼第一個字母（A-Z）自動對應分段編號（0 = POOL）
  const firstChar = tableCode.charAt(0);
  const alphaIdx = ALPHABET.indexOf(firstChar);
  const targetSegNo = alphaIdx >= 0 ? (alphaIdx + 1) : 0;

  // 若目標分段（如 C -> 3）尚未建立，自動幫此區域建立該分段框
  if (targetSegNo > 0) {
    const segKey = `${AREA_SEG_PREFIX}${areaId}`;
    const hasSeg = hierSegments.some(s => s.table_id === segKey && Number(s.segment_no) === targetSegNo);
    if (!hasSeg) {
      hierSegments.push({
        segment_id: `AREA_${areaId}_SEG_${Date.now()}`,
        unit_code: unitPrefix,
        table_id: segKey,
        segment_no: targetSegNo,
        segment_name: `分段 ${firstChar}`
      });
    }
  }

  if (editingId) {
    const t = hierTables.find(x => x.table_id.toUpperCase() === editingId);
    if (t) {
      t.table_code = tableCode;
      t.table_id = tableId;
      t.table_name = tableName;
      t.table_desc = tableDesc;
      t.is_locked = isLocked;
      t.segment_no = targetSegNo;
      t.is_section_start = targetSegNo;
      if (editingId !== tableId) {
        hierLocations.forEach(l => { if (l.table_id.toUpperCase() === editingId) l.table_id = tableId; });
        hierSegments.forEach(s => { if (s.table_id.toUpperCase() === editingId) s.table_id = tableId; });
        if (selectedTableId === editingId) selectedTableId = tableId;
      }
    }
  } else {
    hierTables.push({
      table_id: tableId,
      unit_code: unitPrefix,
      area_code: areaId,
      table_code: tableCode,
      table_name: tableName,
      table_desc: tableDesc,
      segment_no: targetSegNo,
      is_section_start: targetSegNo,
      is_locked: isLocked
    });
    selectedTableId = tableId;
  }
  if (tableModalInstance) tableModalInstance.hide();
  saveHierarchyOnly(targetSegNo > 0 ? `已更新盤點表並歸類至「分段 ${firstChar}」` : '已更新盤點表設定');
}

export function deleteTableItem(tableId) {
  if (hierLocations.some(l => l.table_id === tableId)) return alert('此盤點表底下尚有儲位，請先移走或刪除儲位');
  if (!confirm(`確定要刪除盤點表「${tableId}」嗎？`)) return;
  hierTables = hierTables.filter(t => t.table_id !== tableId);
  hierSegments = hierSegments.filter(s => s.table_id !== tableId);
  if (selectedTableId === tableId) selectedTableId = null;
  saveHierarchyOnly('已刪除盤點表');
}

export function openLocEditModal(locCode = '') {
  if (!selectedTableId && !locCode) return alert('請先選擇盤點表');
  const existing = locCode ? hierLocations.find(l => l.loc_code === locCode) : null;
  const tblId = existing ? existing.table_id : selectedTableId;
  const defaultSeg = existing ? (Number(existing.segment_no ?? existing.row_no) || 0) : (Number(selectedSegmentNo) || 0);
  const usedLocSet = new Set(hierLocations.map(l => String(l.loc_code || '').toUpperCase()));
  const suggestedCode = existing ? existing.loc_code : findNextAvailableLocCode(tblId, defaultSeg, usedLocSet, 1).locCode;

  document.getElementById('l-editing-code').value = existing ? existing.loc_code : '';
  document.getElementById('l-table-id').value = tblId;
  document.getElementById('l-loc-code').value = suggestedCode;
  document.getElementById('l-segment-no').value = defaultSeg;
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
  const editingCode = document.getElementById('l-editing-code').value.trim().toUpperCase();
  const tblId = document.getElementById('l-table-id').value.trim().toUpperCase();
  const newLocCode = document.getElementById('l-loc-code').value.trim().toUpperCase();
  const inputSegNo = Number(document.getElementById('l-segment-no').value) || 0;
  const isLocked = !!document.getElementById('l-is-locked').checked;
  const drugCode = document.getElementById('l-drug-code').value.trim();
  const drugName = document.getElementById('l-drug-name').value.trim();

  if (!newLocCode) return alert('請輸入儲位碼');
  if (!drugCode || !drugName) return alert('請填寫或從藥品主檔選取藥品代碼與藥品名稱');

  const dup = hierLocations.find(l =>
    String(l.loc_code || '').toUpperCase() === newLocCode &&
    String(l.loc_code || '').toUpperCase() !== editingCode
  );
  if (dup) {
    return alert(`❌ 儲位碼重複！\n「${newLocCode}」已被藥品【${dup.drug_code} - ${dup.drug_name}】使用（盤點表：${dup.table_id}），請更換其他編號。`);
  }

  // 自動判斷目標盤點表與分段碼
  let targetTableId = tblId;
  let targetSegNo = inputSegNo;

  // 若有修改儲位碼，依新儲位碼前綴自動對應盤點表與分段碼(0-9)
  if (newLocCode !== editingCode) {
    const sortedTables = [...hierTables].sort((a, b) => (b.table_id || '').length - (a.table_id || '').length);
    const matchedTbl = sortedTables.find(t => t.table_id && newLocCode.startsWith(t.table_id.toUpperCase()));
    if (matchedTbl) {
      targetTableId = matchedTbl.table_id.toUpperCase();
      const rest = newLocCode.slice(targetTableId.length);
      if (/^[0-9]/.test(rest)) {
        targetSegNo = Number(rest.charAt(0));
      }
    }
  }

  // 若目標分段 (1~9) 尚未建立，自動建立該分段框避免掉回 POOL
  if (targetSegNo > 0) {
    const hasSeg = hierSegments.some(s => s.table_id === targetTableId && Number(s.segment_no) === targetSegNo);
    if (!hasSeg) {
      hierSegments.push({
        segment_id: `${targetTableId}_SEG_${Date.now()}`,
        unit_code: unitPrefix,
        table_id: targetTableId,
        segment_no: targetSegNo,
        segment_name: `第 ${targetSegNo} 分段`
      });
    }
  }

  const monthlyDesc = document.getElementById('l-monthly-desc').value.trim();
  const drugRemark = document.getElementById('l-drug-remark').value.trim();
  const dailyNotice = document.getElementById('l-daily-notice').value.trim();

  if (editingCode) {
    const target = hierLocations.find(l => l.loc_code.toUpperCase() === editingCode);
    if (target) {
      target.loc_code = newLocCode;
      target.table_id = targetTableId;
      target.segment_no = targetSegNo;
      target.row_no = String(targetSegNo);
      target.pos_no = newLocCode.slice(-3) || target.pos_no || '001';
      target.is_locked = isLocked;
      target.drug_code = drugCode;
      target.drug_name = drugName;
      target.monthly_desc = monthlyDesc;
      target.drug_remark = drugRemark;
      target.daily_notice = dailyNotice;
    }
  } else {
    hierLocations.push({
      loc_code: newLocCode,
      unit_code: unitPrefix,
      table_id: targetTableId,
      row_no: String(targetSegNo),
      pos_no: newLocCode.slice(-3) || '001',
      segment_no: targetSegNo,
      is_locked: isLocked,
      drug_code: drugCode,
      drug_name: drugName,
      monthly_desc: monthlyDesc,
      drug_remark: drugRemark,
      daily_notice: dailyNotice
    });
  }

  if (locModalInstance) locModalInstance.hide();
  const destMsg = targetSegNo === 0
    ? `已移至 ${targetTableId} 的未分配池 (POOL)`
    : `已歸類至 ${targetTableId} 的「第 ${targetSegNo} 分段」`;
  saveHierarchyOnly(destMsg);
}

export function deleteLocItem(locCode) {
  if (!confirm(`確定要刪除儲位「${locCode}」嗎？`)) return;
  hierLocations = hierLocations.filter(l => l.loc_code !== locCode);
  saveHierarchyOnly('已刪除儲位');
}
