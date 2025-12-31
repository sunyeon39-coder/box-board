/* Box Board (Full)
   - 위치 밀림 방지: BOX는 transform translate3d만 사용 (left/top 금지)
   - 줌(scale) 상태에서 포인터 좌표 보정: (client - rect) / zoom
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const layout = $("#layout");
const boardOuter = $("#boardOuter");
const board = $("#board");
const gridEl = $("#grid");

const waitListEl = $("#waitList");
const assignedListEl = $("#assignedList");
const boxListEl = $("#boxList");
const saveHintEl = $("#saveHint");

const zoomPctEl = $("#zoomPct");
const zoomOutBtn = $("#zoomOut");
const zoomInBtn = $("#zoomIn");
const zoomResetBtn = $("#zoomReset");

const snapToggle = $("#snapToggle");
const gridToggle = $("#gridToggle");

const addWaitBtn = $("#addWait");
const waitNameInput = $("#waitName");
const waitSearchInput = $("#waitSearch");
const clearWaitSearchBtn = $("#clearWaitSearch");

const addBoxBtn = $("#addBox");
const boxNameInput = $("#boxName");
const boxSearchInput = $("#boxSearch");
const clearBoxSearchBtn = $("#clearBoxSearch");

const assignedSearchInput = $("#assignedSearch");
const clearAssignedSearchBtn = $("#clearAssignedSearch");

const toggleSideBtn = $("#toggleSide");

const alignHBtn = $("#alignH");
const alignVBtn = $("#alignV");
const distributeHBtn = $("#distributeH");
const distributeVBtn = $("#distributeV");
const deleteSelectedBtn = $("#deleteSelected");

const ctxMenu = $("#ctxMenu");
const colorPop = $("#colorPop");

const STORAGE_KEY = "box_board_full_v2";

let state = loadState() ?? {
  zoom: 1,
  snap: true,
  showGrid: true,
  waiters: [], // {id,name,createdAt}
  boxes: [],   // {id,name,x,y,color, assigned: {id,name,assignedAt}|null}
};

let ui = {
  activeTab: "wait",
  waitFilter: "",
  assignedFilter: "",
  boxFilter: "",
  selected: new Set(),
  // drag: {pointerId, startPoint:{x,y}, startBoxes:[{id,x,y}]}
  drag: null,
  dragWaiterId: null,
  ctxTargetBoxId: null,
};

const boxEls = new Map(); // boxId -> element (for fast updates)

/* ---------- Utils ---------- */
function uid(prefix="id"){
  return prefix + "_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function now(){ return Date.now(); }
function snapVal(n, step){ return Math.round(n/step)*step; }
function fmtTime(ms){
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2,"0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2,"0");
  const ss = String(s % 60).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
}
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function setSaveHint(text="저장됨"){
  if(!saveHintEl) return;
  saveHintEl.textContent = text;
  saveHintEl.style.opacity = "1";
  clearTimeout(setSaveHint._t);
  setSaveHint._t = setTimeout(()=>{ saveHintEl.style.opacity = ".75"; }, 900);
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setSaveHint("저장됨");
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){
    console.warn("loadState failed", e);
    return null;
  }
}
function getBoxById(id){ return state.boxes.find(b=>b.id===id); }

/* client -> board local (zoom corrected) */
function getBoardPointFromClient(clientX, clientY){
  const rect = board.getBoundingClientRect();
  const z = state.zoom || 1;
  return { x: (clientX - rect.left) / z, y: (clientY - rect.top) / z };
}

/* ---------- Tabs ---------- */
$$(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=> setTab(btn.dataset.tab));
});
function setTab(tab){
  ui.activeTab = tab;
  $$(".tab").forEach(b=>{
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$(".tabPanel").forEach(p=>{
    p.classList.toggle("hidden", p.dataset.panel !== tab);
  });
}

/* ---------- Sidebar ---------- */
function toggleSide(){ layout.classList.toggle("sideCollapsed"); }
toggleSideBtn.addEventListener("click", toggleSide);
window.addEventListener("keydown", (e)=>{
  if(e.key === "Tab"){
    e.preventDefault();
    toggleSide();
  }
});

/* ---------- Zoom ---------- */
function applyZoom(){
  const z = clamp(state.zoom ?? 1, 0.4, 2.2);
  state.zoom = z;
  board.style.transform = `scale(${z})`;
  zoomPctEl.textContent = `${Math.round(z*100)}%`;
  saveState();
}
zoomOutBtn.addEventListener("click", ()=>{ state.zoom = +(state.zoom - 0.1).toFixed(2); applyZoom(); });
zoomInBtn.addEventListener("click", ()=>{ state.zoom = +(state.zoom + 0.1).toFixed(2); applyZoom(); });
zoomResetBtn.addEventListener("click", ()=>{ state.zoom = 1; applyZoom(); });

boardOuter.addEventListener("wheel", (e)=>{
  const isZoomGesture = e.ctrlKey || e.metaKey;
  if(!isZoomGesture) return;
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  state.zoom = +(state.zoom + (delta > 0 ? -0.08 : 0.08)).toFixed(2);
  applyZoom();
}, { passive:false });

/* ---------- Grid / Snap ---------- */
function applyGrid(){ gridEl.classList.toggle("hidden", !state.showGrid); }
snapToggle.checked = !!state.snap;
gridToggle.checked = !!state.showGrid;
applyGrid();

snapToggle.addEventListener("change", ()=>{ state.snap = snapToggle.checked; saveState(); });
gridToggle.addEventListener("change", ()=>{ state.showGrid = gridToggle.checked; applyGrid(); saveState(); });

/* ---------- Add / Search ---------- */
addWaitBtn.addEventListener("click", ()=>{
  const name = (waitNameInput.value || "").trim();
  if(!name) return;
  state.waiters.unshift({ id: uid("w"), name, createdAt: now() });
  waitNameInput.value = "";
  render();
  saveState();
});
waitNameInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") addWaitBtn.click(); });

addBoxBtn.addEventListener("click", ()=>{
  const name = (boxNameInput.value || "").trim() || `BOX ${state.boxes.length+1}`;
  const colors = ["green","blue","olive","pink","slate"];
  const color = colors[state.boxes.length % colors.length];
  const baseX = 120 + (state.boxes.length % 4) * 410;
  const baseY = 120 + Math.floor(state.boxes.length / 4) * 260;
  state.boxes.push({ id: uid("b"), name, x: baseX, y: baseY, color, assigned: null });
  boxNameInput.value = "";
  render();
  saveState();
});
boxNameInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") addBoxBtn.click(); });

waitSearchInput.addEventListener("input", ()=>{ ui.waitFilter = (waitSearchInput.value||"").trim().toLowerCase(); renderWaiters(); });
clearWaitSearchBtn.addEventListener("click", ()=>{ waitSearchInput.value=""; ui.waitFilter=""; renderWaiters(); });

assignedSearchInput.addEventListener("input", ()=>{ ui.assignedFilter = (assignedSearchInput.value||"").trim().toLowerCase(); renderAssignedList(); });
clearAssignedSearchBtn.addEventListener("click", ()=>{ assignedSearchInput.value=""; ui.assignedFilter=""; renderAssignedList(); });

boxSearchInput.addEventListener("input", ()=>{ ui.boxFilter = (boxSearchInput.value||"").trim().toLowerCase(); renderBoxList(); });
clearBoxSearchBtn.addEventListener("click", ()=>{ boxSearchInput.value=""; ui.boxFilter=""; renderBoxList(); });

/* ---------- Assign / Unassign ---------- */
function assignWaiterToBox(waiterId, boxId){
  const wIdx = state.waiters.findIndex(w => w.id === waiterId);
  const b = getBoxById(boxId);
  if(wIdx < 0 || !b) return;

  const w = state.waiters[wIdx];

  // 기존 배치자 있으면 대기로 복귀
  if(b.assigned){
    state.waiters.unshift({ id: uid("w"), name: b.assigned.name, createdAt: b.assigned.assignedAt ?? now() });
  }

  b.assigned = { id: uid("a"), name: w.name, assignedAt: now() };
  state.waiters.splice(wIdx, 1);

  render();
  saveState();
}


function moveAssignedToBox(fromBoxId, toBoxId){
  if(fromBoxId === toBoxId) return;
  const from = getBoxById(fromBoxId);
  const to = getBoxById(toBoxId);
  if(!from || !to || !from.assigned) return;

  if(to.assigned){
    state.waiters.unshift({ id: uid("w"), name: to.assigned.name, createdAt: to.assigned.assignedAt ?? now() });
  }

  to.assigned = { id: uid("a"), name: from.assigned.name, assignedAt: now() };
  from.assigned = null;

  render();
  saveState();
}

function editAssignedName(boxId){
  const b = getBoxById(boxId);
  if(!b || !b.assigned) return;
  const next = prompt("이름 수정", b.assigned.name || "");
  if(next == null) return;
  const v = (next || "").trim();
  if(!v) return;
  b.assigned.name = v;
  render();
  saveState();
}

function unassignBoxToWaiting(boxId){
  const b = getBoxById(boxId);
  if(!b || !b.assigned) return;
  state.waiters.unshift({ id: uid("w"), name: b.assigned.name, createdAt: now() });
  b.assigned = null;
  render();
  saveState();
}

/* ---------- Delete ---------- */
function deleteBox(boxId){
  ui.selected.delete(boxId);
  state.boxes = state.boxes.filter(b => b.id !== boxId);
  render();
  saveState();
}
function deleteSelected(){
  if(ui.selected.size === 0) return;
  const ids = new Set(ui.selected);
  state.boxes = state.boxes.filter(b => !ids.has(b.id));
  ui.selected.clear();
  render();
  saveState();
}
deleteSelectedBtn.addEventListener("click", deleteSelected);

/* Delete key */
window.addEventListener("keydown", (e)=>{
  if(e.key === "Delete" || e.key === "Backspace"){
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if(tag === "input" || tag === "textarea") return;
    deleteSelected();
  }
});

/* ---------- Selection ---------- */
function updateSelectionStyles(){
  boxEls.forEach((el, id)=>{
    el.classList.toggle("selected", ui.selected.has(id));
  });
}
function selectOnly(id){
  ui.selected.clear();
  ui.selected.add(id);
  updateSelectionStyles();
}
function toggleSelect(id){
  if(ui.selected.has(id)) ui.selected.delete(id);
  else ui.selected.add(id);
  updateSelectionStyles();
}
function clearSelection(){
  ui.selected.clear();
  updateSelectionStyles();
}

/* click empty space */
board.addEventListener("pointerdown", (e)=>{
  if(e.target === board || e.target === gridEl){
    hideCtx();
    hideColorPop();
    clearSelection();
  }
});

/* ---------- Align / Distribute ---------- */
function getSelectedBoxes(){
  return state.boxes.filter(b => ui.selected.has(b.id));
}
function withSnap(v){ return state.snap ? snapVal(v, 20) : v; }

alignHBtn.addEventListener("click", ()=>{
  const bs = getSelectedBoxes();
  if(bs.length < 2) return;
  const y = Math.round(bs.reduce((a,b)=>a+b.y,0)/bs.length);
  bs.forEach(b=> b.y = withSnap(y));
  updateAllBoxPositions();
  saveState();
});
alignVBtn.addEventListener("click", ()=>{
  const bs = getSelectedBoxes();
  if(bs.length < 2) return;
  const x = Math.round(bs.reduce((a,b)=>a+b.x,0)/bs.length);
  bs.forEach(b=> b.x = withSnap(x));
  updateAllBoxPositions();
  saveState();
});
distributeHBtn.addEventListener("click", ()=>{
  const bs = getSelectedBoxes().slice().sort((a,b)=>a.x-b.x);
  if(bs.length < 3) return;
  const min = bs[0].x, max = bs[bs.length-1].x;
  const step = (max-min)/(bs.length-1);
  bs.forEach((b,i)=> b.x = withSnap(Math.round(min + step*i)));
  updateAllBoxPositions();
  saveState();
});
distributeVBtn.addEventListener("click", ()=>{
  const bs = getSelectedBoxes().slice().sort((a,b)=>a.y-b.y);
  if(bs.length < 3) return;
  const min = bs[0].y, max = bs[bs.length-1].y;
  const step = (max-min)/(bs.length-1);
  bs.forEach((b,i)=> b.y = withSnap(Math.round(min + step*i)));
  updateAllBoxPositions();
  saveState();
});

/* ---------- Context Menu ---------- */
function showCtx(x,y, boxId){
  ui.ctxTargetBoxId = boxId;
  hideColorPop();
  ctxMenu.classList.remove("hidden");
  const w = 190, h = 210;
  ctxMenu.style.left = clamp(x, 8, window.innerWidth - w - 8) + "px";
  ctxMenu.style.top  = clamp(y, 8, window.innerHeight - h - 8) + "px";
}
function hideCtx(){ ui.ctxTargetBoxId = null; ctxMenu.classList.add("hidden"); }
function showColorPop(x,y, boxId){
  ui.ctxTargetBoxId = boxId;
  colorPop.classList.remove("hidden");
  const w = 200, h = 110;
  colorPop.style.left = clamp(x, 8, window.innerWidth - w - 8) + "px";
  colorPop.style.top  = clamp(y, 8, window.innerHeight - h - 8) + "px";
}
function hideColorPop(){ colorPop.classList.add("hidden"); }

window.addEventListener("pointerdown", (e)=>{
  if(!ctxMenu.classList.contains("hidden") && !ctxMenu.contains(e.target)) hideCtx();
  if(!colorPop.classList.contains("hidden") && !colorPop.contains(e.target)) hideColorPop();
});

ctxMenu.addEventListener("click", (e)=>{
  const btn = e.target.closest("[data-action]");
  if(!btn) return;
  const action = btn.dataset.action;
  const boxId = ui.ctxTargetBoxId;
  const b = getBoxById(boxId);
  if(!b) return;

  if(action === "rename"){
    const name = prompt("BOX 이름 변경", b.name);
    if(name && name.trim()){
      b.name = name.trim();
      render();
      saveState();
    }
  }else if(action === "color"){
    const rect = ctxMenu.getBoundingClientRect();
    showColorPop(rect.right + 8, rect.top, boxId);
  }else if(action === "unassign"){
    unassignBoxToWaiting(boxId);
  }else if(action === "delete"){
    deleteBox(boxId);
  }
  hideCtx();
});

colorPop.addEventListener("click", (e)=>{
  const sw = e.target.closest(".swatch");
  if(!sw) return;
  const color = sw.dataset.color;
  const boxId = ui.ctxTargetBoxId;
  const b = getBoxById(boxId);
  if(!b) return;
  b.color = color;
  const el = boxEls.get(boxId);
  if(el) el.dataset.color = color;
  saveState();
  hideColorPop();
});

/* ---------- Render helpers ---------- */
function updateBoxPosition(box){
  const el = boxEls.get(box.id);
  if(!el) return;
  el.style.setProperty("--x", `${box.x}px`);
  el.style.setProperty("--y", `${box.y}px`);
}
function updateAllBoxPositions(){
  state.boxes.forEach(updateBoxPosition);
}

/* ---------- Render panels ---------- */
function render(){
  renderWaiters();
  renderAssignedList();
  renderBoxList();
  renderBoardBoxes();
}

function renderWaiters(){
  waitListEl.innerHTML = "";
  const f = ui.waitFilter;
  const items = state.waiters.filter(w => !f || (w.name||"").toLowerCase().includes(f));

  if(items.length === 0){
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="left">
      <div class="name" style="opacity:.7">${state.waiters.length? "검색 결과 없음" : "대기 없음"}</div>
      <div class="meta">${state.waiters.length? "검색어를 바꿔보세요" : "이름을 추가해 주세요"}</div>
    </div>`;
    waitListEl.appendChild(empty);
    return;
  }

  for(const w of items){
    const el = document.createElement("div");
    el.className = "item";
    el.dataset.id = w.id;
    el.draggable = true;
    el.dataset.waiterId = w.id;

    el.innerHTML = `
      <div class="waitLine">
        <div class="waitName">${escapeHtml(w.name)}</div>
        <div class="waitTime">대기 ${fmtTime(now() - (w.createdAt || now()))}</div>
      </div>
      <div class="itemActions">
        <button class="itemBtn" data-wedit>수정</button>
        <button class="itemBtn danger" data-wdel>삭제</button>
      </div>
    `;

    el.addEventListener("dragstart", (e)=>{
      ui.dragWaiterId = w.id;
      try{ e.dataTransfer.setData("text/plain", w.id); }catch{}
    });
    el.addEventListener("dragend", ()=>{ ui.dragWaiterId = null; });

    waitListEl.appendChild(el);
  }
}

function renderAssignedList(){
  assignedListEl.innerHTML = "";
  const f = ui.assignedFilter;

  const assigned = state.boxes
    .filter(b=>b.assigned)
    .map(b=>({ boxId:b.id, boxName:b.name, name:b.assigned.name, assignedAt:b.assigned.assignedAt }))
    .filter(a=> !f || (a.name||"").toLowerCase().includes(f) || (a.boxName||"").toLowerCase().includes(f))
    .sort((a,b)=> a.assignedAt - b.assignedAt);

  if(assigned.length === 0){
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="left">
      <div class="name" style="opacity:.7">${state.boxes.some(b=>b.assigned) ? "검색 결과 없음" : "배치 없음"}</div>
      <div class="meta">${state.boxes.some(b=>b.assigned) ? "검색어를 바꿔보세요" : "대기에서 BOX로 드롭해 주세요"}</div>
    </div>`;
    assignedListEl.appendChild(empty);
    return;
  }

  for(const a of assigned){
    const el = document.createElement("div");
    el.className = "item clickable";
    el.dataset.boxId = a.boxId;
    el.innerHTML = `
      <div class="left rowInline">
        <div class="name">${escapeHtml(a.name)} <span style="opacity:.85">${escapeHtml(a.boxName)}</span></div>
        <div class="timeInline">배치 ${fmtTime(now() - a.assignedAt)}</div>
      </div>
      <div class="pill blue">이동</div>
    `;
    el.addEventListener("click", ()=> focusBox(a.boxId));
    assignedListEl.appendChild(el);
  }
}

function renderBoxList(){
  boxListEl.innerHTML = "";
  const f = ui.boxFilter;
  const items = state.boxes
    .filter(b=> !f || (b.name||"").toLowerCase().includes(f))
    .slice()
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ko"));

  if(items.length === 0){
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="left">
      <div class="name" style="opacity:.7">${state.boxes.length? "검색 결과 없음" : "박스 없음"}</div>
      <div class="meta">${state.boxes.length? "검색어를 바꿔보세요" : "박스를 추가해 주세요"}</div>
    </div>`;
    boxListEl.appendChild(empty);
    return;
  }

  for(const b of items){
    const el = document.createElement("div");
    el.className = "item clickable";
    el.dataset.boxId = b.id;
    el.innerHTML = `
      <div class="left">
        <div class="name">${escapeHtml(b.name)}</div>
        <div class="meta">${b.assigned ? `배치: ${escapeHtml(b.assigned.name)}` : "비어있음"} · (${Math.round(b.x)}, ${Math.round(b.y)})</div>
      </div>
      <button class="btn danger" data-del="${b.id}">삭제</button>
    `;
    el.addEventListener("click", (e)=>{
      if(e.target.closest("button")) return;
      focusBox(b.id);
    });
    el.querySelector(`[data-del="${b.id}"]`).addEventListener("click", (e)=>{
      e.stopPropagation();
      deleteBox(b.id);
    });
    boxListEl.appendChild(el);
  }
}

/* ---------- Render board ---------- */
function renderBoardBoxes(){
  // clear existing box nodes
  boxEls.forEach(el=> el.remove());
  boxEls.clear();

  for(const b of state.boxes){
    const boxEl = document.createElement("div");
    boxEl.className = "box";
    boxEl.dataset.boxId = b.id;
    boxEl.dataset.color = b.color || "green";
    boxEl.style.setProperty("--x", `${b.x}px`);
    boxEl.style.setProperty("--y", `${b.y}px`);

    const assignedHtml = b.assigned ? `
      <div class="slotName" data-name>${escapeHtml(b.assigned.name)}</div>
      <div class="slotTime">
        <span class="badgeTime" data-timer>${fmtTime(now() - b.assigned.assignedAt)}</span>
        <span style="color:rgba(169,176,214,.9)">배치 시간</span>
      </div>` : `<div class="dropHint">여기에 대기자를 드롭</div>`;

    const actionHtml = b.assigned
      ? `
          <button class="smallBtn dragBtn" data-drag draggable="true">드래그</button>
          <button class="smallBtn editBtn" data-edit>수정</button>
          <button class="smallBtn danger deleteBtn" data-unassign>삭제</button>
        `
      : `<span class="pill good">DROP</span>`;

    boxEl.innerHTML = `
      <div class="boxInner">
        <div class="watermark">${escapeHtml(b.name)}</div>

        <div class="boxTop">
          <div class="boxTitle">${escapeHtml(b.name)}</div>
          <div class="boxRight">
            <button class="iconBtn" title="메뉴" data-menu>⋯</button>
            <button class="iconBtn" title="삭제" data-delete>×</button>
          </div>
        </div>

        <div class="slot" data-dropzone>
          <div class="slotLeft">${assignedHtml}</div>
          <div class="slotActions">${actionHtml}</div>
        </div>
      </div>
    `;

    boxEls.set(b.id, boxEl);
    boxEl.classList.toggle("selected", ui.selected.has(b.id));

    // delete
    boxEl.querySelector("[data-delete]").addEventListener("click", (e)=>{
      e.stopPropagation();
      deleteBox(b.id);
    });

    // menu
    boxEl.querySelector("[data-menu]").addEventListener("click", (e)=>{
      e.stopPropagation();
      showCtx(e.clientX, e.clientY, b.id);
    });

    // unassign
    const unBtn = boxEl.querySelector("[data-unassign]");
    if(unBtn){
      unBtn.addEventListener("click", (e)=>{
        e.stopPropagation();
        unassignBoxToWaiting(b.id);
      });
    }

    const editBtn = boxEl.querySelector("[data-edit]");
    if(editBtn){
      editBtn.addEventListener("click", (e)=>{
        e.stopPropagation();
        editAssignedName(b.id);
      });
    }

    const dragBtn = boxEl.querySelector("[data-drag]");
    if(dragBtn){
      dragBtn.addEventListener("dragstart", (e)=>{
        e.stopPropagation();
        try{ e.dataTransfer.setData("text/plain", `assigned:${b.id}`); }catch{}
      });
    }

    // dblclick name -> unassign
    const nameEl = boxEl.querySelector("[data-name]");
    if(nameEl){
      nameEl.addEventListener("dblclick", (e)=>{
        e.stopPropagation();
        unassignBoxToWaiting(b.id);
      });
    }

    // dropzone
    const dropZone = boxEl.querySelector("[data-dropzone]");
    dropZone.addEventListener("dragover", (e)=>{ e.preventDefault(); boxEl.classList.add("dropOver"); });
    dropZone.addEventListener("dragleave", ()=> boxEl.classList.remove("dropOver"));
    dropZone.addEventListener("drop", (e)=>{
      e.preventDefault();
      boxEl.classList.remove("dropOver");
      const idFromDT = (()=>{ try{return e.dataTransfer.getData("text/plain");}catch{return "";} })();
      if(idFromDT && idFromDT.startsWith("assigned:")){
        const fromBoxId = idFromDT.split(":")[1];
        if(fromBoxId) moveAssignedToBox(fromBoxId, b.id);
        return;
      }
      const wid = ui.dragWaiterId || idFromDT;
      if(wid) assignWaiterToBox(wid, b.id);
    });

    // click selection (ignore buttons)
    boxEl.addEventListener("click", (e)=>{
      if(e.target.closest("button")) return;
      hideCtx(); hideColorPop();
      if(e.shiftKey) toggleSelect(b.id);
      else{
        if(!ui.selected.has(b.id) || ui.selected.size > 1) selectOnly(b.id);
      }
    });

    // right click
    boxEl.addEventListener("contextmenu", (e)=>{
      e.preventDefault();
      showCtx(e.clientX, e.clientY, b.id);
    });

    // move (multi)
    attachMove(boxEl, b.id);

    board.appendChild(boxEl);
  }

  updateSelectionStyles();
}

/* ---------- Move (multi) ---------- */
function attachMove(boxEl, boxId){
  boxEl.addEventListener("pointerdown", (e)=>{
    if(e.target.closest("button")) return;

    // selection behavior
    if(!e.shiftKey){
      if(!ui.selected.has(boxId)) selectOnly(boxId);
    }else{
      if(!ui.selected.has(boxId)){
        ui.selected.add(boxId);
        updateSelectionStyles();
      }
    }

    e.preventDefault();
    boxEl.setPointerCapture(e.pointerId);

    const p = getBoardPointFromClient(e.clientX, e.clientY);
    const startBoxes = getSelectedBoxes().map(b=>({ id:b.id, x:b.x, y:b.y }));
    ui.drag = { pointerId: e.pointerId, startPoint: p, startBoxes };
  });

  boxEl.addEventListener("pointermove", (e)=>{
    if(!ui.drag || ui.drag.pointerId !== e.pointerId) return;
    const p = getBoardPointFromClient(e.clientX, e.clientY);
    const dx = p.x - ui.drag.startPoint.x;
    const dy = p.y - ui.drag.startPoint.y;

    for(const s of ui.drag.startBoxes){
      const b = getBoxById(s.id);
      if(!b) continue;
      let nx = s.x + dx;
      let ny = s.y + dy;
      if(state.snap){
        nx = snapVal(nx, 20);
        ny = snapVal(ny, 20);
      }
      b.x = Math.round(nx);
      b.y = Math.round(ny);
      updateBoxPosition(b);
    }
  });

  const end = (e)=>{
    if(!ui.drag || ui.drag.pointerId !== e.pointerId) return;
    ui.drag = null;
    saveState();
  };
  boxEl.addEventListener("pointerup", end);
  boxEl.addEventListener("pointercancel", end);
}

/* ---------- Focus box ---------- */
function focusBox(boxId){
  const b = getBoxById(boxId);
  if(!b) return;

  selectOnly(boxId);

  const z = state.zoom || 1;
  const boxW = 360, boxH = 220;
  const targetX = (b.x + boxW/2) * z;
  const targetY = (b.y + boxH/2) * z;

  const viewW = boardOuter.clientWidth;
  const viewH = boardOuter.clientHeight;

  boardOuter.scrollTo({
    left: Math.max(0, targetX - viewW/2),
    top: Math.max(0, targetY - viewH/2),
    behavior: "smooth"
  });

  const el = boxEls.get(boxId);
  if(el){
    el.classList.add("highlight");
    setTimeout(()=> el.classList.remove("highlight"), 1600);
  }
}

/* ---------- Timers ---------- */
function tickTimers(){
  // board timers
  boxEls.forEach((el, id)=>{
    const b = getBoxById(id);
    if(!b || !b.assigned) return;
    const t = el.querySelector("[data-timer]");
    if(t) t.textContent = fmtTime(now() - b.assigned.assignedAt);
  });

  // wait list timers (only visible nodes)
  $$("#waitList .item").forEach(item=>{
    const wid = item.dataset.waiterId;
    if(!wid) return;
    const w = state.waiters.find(ww=>ww.id===wid);
    if(!w) return;
    const meta = item.querySelector(".meta");
    if(meta) meta.textContent = `대기 ${fmtTime(now() - (w.createdAt||now()))}`;
  });

  // assigned list timers
  $$("#assignedList .item").forEach(item=>{
    const boxId = item.dataset.boxId;
    if(!boxId) return;
    const b = getBoxById(boxId);
    if(!b || !b.assigned) return;
    const meta = item.querySelector(".meta");
    if(meta) meta.textContent = `배치 ${fmtTime(now() - b.assigned.assignedAt)}`;
  });
}

/* ---------- Init / Migrate ---------- */
function migrate(){
  state.zoom ??= 1;
  state.snap ??= true;
  state.showGrid ??= true;
  state.waiters ??= [];
  state.boxes ??= [];
}
migrate();
setTab("wait");
applyZoom();
snapToggle.checked = !!state.snap;
gridToggle.checked = !!state.showGrid;
applyGrid();
render();
setInterval(tickTimers, 500);
window.addEventListener("beforeunload", ()=>{ try{ saveState(); }catch{} });

// === Wait list action buttons (edit/delete) ===
let __waitActionsBound = false;
function bindWaitActions(){
  if(__waitActionsBound) return;
  __waitActionsBound = true;

  document.addEventListener("click", (e)=>{
    const btn = e.target;
    if(!(btn instanceof HTMLElement)) return;

    if(btn.hasAttribute("data-wedit") || btn.hasAttribute("data-wdel")){
      e.preventDefault();
      e.stopPropagation();

      const item = btn.closest(".item");
      const wid = item?.getAttribute("data-id");
      if(!wid) return;

      if(btn.hasAttribute("data-wdel")){
        const idx = state.waiters.findIndex(w => w.id === wid);
        if(idx >= 0) state.waiters.splice(idx, 1);
        render();
        saveState();
        return;
      }

      if(btn.hasAttribute("data-wedit")){
        const w = state.waiters.find(w => w.id === wid);
        if(!w) return;
        const next = prompt("이름 수정", w.name || "");
        if(next == null) return;
        const v = (next || "").trim();
        if(!v) return;
        w.name = v;
        render();
        saveState();
      }
    }
  });
}
bindWaitActions();
