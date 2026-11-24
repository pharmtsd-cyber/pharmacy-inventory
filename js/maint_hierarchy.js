import { fetchBackend } from './api.js';
import { toggleLoader, switchView, showToast } from './ui.js';
import { DEPT_NAME, currentDept } from './config.js';

const UNIT_PREFIX_MAP = { opd: 'BA', ipd: 'BF', erd: 'BE', comp: 'BG' };
const unitPrefix = UNIT_PREFIX_MAP[currentDept] || 'BF';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

let drugMasterSelectList = [];
let hierAreas = [];
let hierTables = [];
let hierLocations = [];
let hierSegments = [];
let selectedAreaId = null;
let selectedTableId = null;
let selectedSegmentNo = 1;
let areaSortable = null;
let tableSortable = null;
let areaModalInstance = null;
let tableModalInstance = null;
let locModalInstance = null;

function indexToAlpha(idx) {
  return ALPHABET[idx] || 'Z';
}

function indexToTwoLetters(majorIdx, minorIdx) {
  return `${ALPHABET[majorIdx] || 'Z'}${ALPHABET[minorIdx] || 'Z'}`;
}

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
