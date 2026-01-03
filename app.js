/* Box Board (3-file version)
   - Shift+Click multi-select boxes
   - Drag selected boxes to move
   - Drag waiter to box to assign (existing assigned -> back to waiting)
   - Double click assigned name in box or assigned list to unassign
   - Align / Distribute buttons
   - Zoom buttons + Ctrl/⌘ wheel zoom
   - LocalStorage persistence + '저장됨' pulse
*/

const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));

/** ---------- DOM ---------- */
const layout = $("#layout");
const side = $("#side");
const toggleSideBtn = $("#toggleSide");

const tabBtns = $$(".tab");
const tabPanes = $$(".tabpane");

const waitListEl = $("#waitList");
const assignedListEl = $("#assignedList");
const boxListEl = $("#boxList");

const waitNameInput = $("#waitName");
const addWaitBtn = $("#addWait");
const waitSearchInput = $("#waitSearch");
const clearWaitSearchBtn = $("#clearWaitSearch");

const assignedSearchInput = $("#assignedSearch");
const clearAssignedSearchBtn = $("#clearAssignedSearch");

const boxNameInput = $("#boxName");
const addBoxBtn = $("#addBox");
const boxSearchInput = $("#boxSearch");
const clearBoxSearchBtn = $("#clearBoxSearch");

const boardOuter = $("#boardOuter");
const board = $("#board");
const gridEl = $("#grid");

const saveHintEl = $("#saveHint");

const alignHBtn = $("#alignH");
const alignVBtn = $("#alignV");
const spaceHBtn = $("#spaceH");
const spaceVBtn = $("#spaceV");
const selectModeBtn = $("#selectMode");

const zoomPctEl = $("#zoomPct");
const zoomOutBtn = $("#zoomOut");
const zoomInBtn = $("#zoomIn");
const zoomResetBtn = $("#zoomReset");

/** ---------- STATE ---------- */
const LS_KEY = "box_board_state_v1";
const now = () => Date.now();

let state = {
  zoom: 1,
  selectMode: true,
  waiters: [], // {id,name,createdAt,assignedBoxId:null|boxId}
  boxes: [],   // {id,label,x,y,w,h,assignedWaiterId:null|waiterId}
  ui: {
    tab: "wait",
    waitSearch: "",
    assignedSearch: "",
    boxSearch: "",
  }
};

let selectedBoxIds = new Set();
let drag = { active:false, startX:0, startY:0, base:[] }; // base: [{id,x,y}]
let rafTimer = null;

/** ---------- UTIL ---------- */
const uid = () => Math.random().toString(36).slice(2,10) + "-" + Math.random().toString(36).slice(2,6);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function fmtTime(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const hh = String(Math.floor(s/3600)).padStart(2,"0");
  const mm = String(Math.floor((s%3600)/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
}
function saveSoon(){
  saveHintEl.classList.add("saving");
  clearTimeout(saveSoon._t);
  saveSoon._t = setTimeout(() => {
    try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){}
    saveHintEl.classList.remove("saving");
  }, 200);
}
function load(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && typeof parsed === "object") state = { ...state, ...parsed };
    }
  }catch(e){}
  // minimal sanity
  state.zoom = clamp(Number(state.zoom)||1, 0.25, 2.5);
  state.waiters = Array.isArray(state.waiters)? state.waiters : [];
  state.boxes = Array.isArray(state.boxes)? state.boxes : [];
  state.ui = state.ui || {tab:"wait",waitSearch:"",assignedSearch:"",boxSearch:""};
}
function setTab(name){
  state.ui.tab = name;
  tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab===name));
  tabPanes.forEach(p => p.classList.toggle("active", p.dataset.pane===name));
  saveSoon();
}
function boardPoint(evt){
  const rect = boardOuter.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / state.zoom;
  const y = (evt.clientY - rect.top) / state.zoom;
  return {x,y};
}
function ensureDefaultBoxes(){
  if(state.boxes.length) return;
  const w=220, h=110, gap=16;
  const startX=60, startY=40;
  for(let i=1;i<=3;i++){
    state.boxes.push({id:uid(), label:String(i), x:startX+(i-1)*(w+gap), y:startY, w, h, assignedWaiterId:null});
  }
}

/** ---------- RENDER ---------- */
function render(){
  // zoom
  board.style.transform = `scale(${state.zoom})`;
  zoomPctEl.textContent = `${Math.round(state.zoom*100)}%`;
  // grid visibility always on for now
  gridEl.style.display = "block";

  renderWait();
  renderAssigned();
  renderBoxList();
  renderBoard();
}

function renderWait(){
  const q = (state.ui.waitSearch||"").trim().toLowerCase();
  const waiters = state.waiters.filter(w => !w.assignedBoxId);
  const list = q ? waiters.filter(w => w.name.toLowerCase().includes(q)) : waiters;

  waitListEl.innerHTML = "";
  list.forEach((w, idx) => {
    const el = document.createElement("div");
    el.className = "item";
    el.draggable = true;
    el.dataset.waiterId = w.id;

    el.addEventListener("dragstart", (e)=>{
      el.classList.add("dragging");
      e.dataTransfer.setData("text/plain", JSON.stringify({type:"waiter", id:w.id}));
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", ()=> el.classList.remove("dragging"));

    el.innerHTML = `
      <input class="chk" type="checkbox" />
      <div class="badgeNum">${idx+1}</div>
      <div class="itemName">${escapeHtml(w.name)}</div>
      <div class="timePill">대기 <span data-t="w-${w.id}">00:00:00</span></div>
      <button class="delBtn" data-del="${w.id}">삭제</button>
    `;
    el.querySelector("[data-del]").addEventListener("click", ()=>{
      deleteWaiter(w.id);
    });
    waitListEl.appendChild(el);
  });
}

function renderAssigned(){
  const q = (state.ui.assignedSearch||"").trim().toLowerCase();
  const assigned = state.waiters.filter(w => w.assignedBoxId);
  const list = q ? assigned.filter(w => w.name.toLowerCase().includes(q)) : assigned;

  assignedListEl.innerHTML = "";
  list.forEach((w, idx)=>{
    const el = document.createElement("div");
    el.className = "item";
    el.dataset.waiterId = w.id;
    const box = state.boxes.find(b => b.id === w.assignedBoxId);
    const boxLabel = box ? box.label : "?";
    el.innerHTML = `
      <div class="badgeNum">${boxLabel}</div>
      <div class="itemName" title="더블클릭: 대기로">${escapeHtml(w.name)}</div>
      <div class="timePill assigned">배치 <span data-t="a-${w.id}">00:00:00</span></div>
      <button class="delBtn" data-un="${w.id}">대기</button>
    `;
    el.querySelector(".itemName").addEventListener("dblclick", ()=> unassignWaiter(w.id));
    el.querySelector("[data-un]").addEventListener("click", ()=> unassignWaiter(w.id));
    assignedListEl.appendChild(el);
  });
}

function renderBoxList(){
  const q = (state.ui.boxSearch||"").trim().toLowerCase();
  const list = q ? state.boxes.filter(b => String(b.label).toLowerCase().includes(q)) : state.boxes;

  boxListEl.innerHTML = "";
  list.forEach((b)=>{
    const el = document.createElement("div");
    el.className = "item";
    el.dataset.boxId = b.id;

    const isSel = selectedBoxIds.has(b.id);
    el.innerHTML = `
      <input class="chk" type="checkbox" ${isSel ? "checked":""}/>
      <div class="badgeNum">${escapeHtml(String(b.label))}</div>
      <div class="itemName">${escapeHtml(String(b.label))}</div>
      <button class="delBtn" data-delbox="${b.id}">삭제</button>
    `;
    el.querySelector(".chk").addEventListener("change", (e)=>{
      if(e.target.checked) selectedBoxIds.add(b.id);
      else selectedBoxIds.delete(b.id);
      renderBoard();
    });
    el.addEventListener("click", (e)=>{
      if(e.target.closest("button")) return;
      if(e.shiftKey) toggleSelectBox(b.id);
      else setSingleSelect(b.id);
    });
    el.querySelector("[data-delbox]").addEventListener("click", ()=>{
      deleteBox(b.id);
    });

    boxListEl.appendChild(el);
  });
}

function renderBoard(){
  // clear existing box nodes (keep grid)
  $$(".box", board).forEach(n => n.remove());

  state.boxes.forEach((b)=>{
    const el = document.createElement("div");
    el.className = "box";
    el.dataset.boxId = b.id;
    el.style.left = b.x + "px";
    el.style.top = b.y + "px";
    el.style.width = b.w + "px";
    el.style.height = b.h + "px";
    el.classList.toggle("selected", selectedBoxIds.has(b.id));

    // drop target for waiters
    el.addEventListener("dragover", (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect="move"; });
    el.addEventListener("drop", (e)=>{
      e.preventDefault();
      try{
        const payload = JSON.parse(e.dataTransfer.getData("text/plain")||"{}");
        if(payload.type==="waiter") assignWaiterToBox(payload.id, b.id);
      }catch(err){}
    });

    const waiter = b.assignedWaiterId ? state.waiters.find(w=>w.id===b.assignedWaiterId) : null;
    const name = waiter ? waiter.name : "";
    el.innerHTML = `
      <div class="water">${escapeHtml(String(b.label))}</div>
      <div class="mini">
        <button class="miniBtn" data-mini="edit" title="이름/박스명 수정">✎</button>
        <button class="miniBtn" data-mini="clear" title="대기로">↩</button>
        <button class="miniBtn" data-mini="del" title="삭제">×</button>
      </div>
      <div class="inner">
        <div class="assignedName" title="더블클릭: 대기로">${name ? escapeHtml(name) : "&nbsp;"}</div>
        <div class="timePill boxTime">${waiter ? "배치 " : "대기 "} <span data-t="${waiter ? "ab-" + waiter.id : ""}">${waiter ? "00:00:00" : "00:00:00"}</span></div>
      </div>
    `;

    // select + move
    el.addEventListener("pointerdown", (e)=>{
      if(e.button!==0) return;
      if(!e.shiftKey && !selectedBoxIds.has(b.id)) setSingleSelect(b.id);
      if(e.shiftKey) toggleSelectBox(b.id);

      // begin drag selected
      drag.active = true;
      const p = boardPoint(e);
      drag.startX = p.x;
      drag.startY = p.y;
      drag.base = Array.from(selectedBoxIds).map(id=>{
        const bx = state.boxes.find(bb=>bb.id===id);
        return {id, x:bx.x, y:bx.y};
      });
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e)=>{
      if(!drag.active) return;
      const p = boardPoint(e);
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      drag.base.forEach(item=>{
        const bx = state.boxes.find(bb=>bb.id===item.id);
        if(!bx) return;
        bx.x = item.x + dx;
        bx.y = item.y + dy;
      });
      saveSoon();
      renderBoard(); // acceptable for small counts
    });
    el.addEventListener("pointerup", ()=>{
      drag.active = false;
      drag.base = [];
    });

    // mini buttons
    el.querySelector('[data-mini="del"]').addEventListener("click", (e)=>{ e.stopPropagation(); deleteBox(b.id); });
    el.querySelector('[data-mini="clear"]').addEventListener("click", (e)=>{ e.stopPropagation(); if(b.assignedWaiterId) unassignWaiter(b.assignedWaiterId); });
    el.querySelector('[data-mini="edit"]').addEventListener("click", (e)=>{
      e.stopPropagation();
      const newLabel = prompt("박스 이름(표시)을 입력", String(b.label));
      if(newLabel===null) return;
      b.label = newLabel.trim() || b.label;
      saveSoon(); render();
    });

    el.querySelector(".assignedName").addEventListener("dblclick", (e)=>{
      e.stopPropagation();
      if(b.assignedWaiterId) unassignWaiter(b.assignedWaiterId);
    });

    board.appendChild(el);
  });

  // sync box list checkbox state quickly
  $$(".item", boxListEl).forEach(item=>{
    const id = item.dataset.boxId;
    const chk = $(".chk", item);
    if(chk) chk.checked = selectedBoxIds.has(id);
  });
}

/** ---------- ACTIONS ---------- */
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function addWaiter(name){
  const n = (name||"").trim();
  if(!n) return;
  state.waiters.unshift({id:uid(), name:n, createdAt: now(), assignedBoxId:null});
  waitNameInput.value = "";
  saveSoon(); render();
}

function deleteWaiter(waiterId){
  const w = state.waiters.find(x=>x.id===waiterId);
  if(!w) return;
  if(w.assignedBoxId){
    const b = state.boxes.find(bb=>bb.id===w.assignedBoxId);
    if(b) b.assignedWaiterId = null;
  }
  state.waiters = state.waiters.filter(x=>x.id!==waiterId);
  saveSoon(); render();
}

function addBox(label){
  const t = (label||"").trim();
  if(!t) return;
  const x = 60 + (state.boxes.length%4)*240;
  const y = 40 + Math.floor(state.boxes.length/4)*140;
  state.boxes.push({id:uid(), label:t, x, y, w:220, h:110, assignedWaiterId:null});
  boxNameInput.value = "";
  saveSoon(); render();
}

function deleteBox(boxId){
  const b = state.boxes.find(x=>x.id===boxId);
  if(!b) return;
  if(b.assignedWaiterId){
    const w = state.waiters.find(ww=>ww.id===b.assignedWaiterId);
    if(w) w.assignedBoxId = null;
  }
  state.boxes = state.boxes.filter(x=>x.id!==boxId);
  selectedBoxIds.delete(boxId);
  saveSoon(); render();
}

function assignWaiterToBox(waiterId, boxId){
  const w = state.waiters.find(x=>x.id===waiterId);
  const b = state.boxes.find(x=>x.id===boxId);
  if(!w || !b) return;

  // if waiter already assigned somewhere -> clear old box
  if(w.assignedBoxId){
    const oldBox = state.boxes.find(x=>x.id===w.assignedBoxId);
    if(oldBox) oldBox.assignedWaiterId = null;
  }

  // if box already has someone -> move that person back to waiting
  if(b.assignedWaiterId){
    const prev = state.waiters.find(x=>x.id===b.assignedWaiterId);
    if(prev) prev.assignedBoxId = null;
  }

  b.assignedWaiterId = w.id;
  w.assignedBoxId = b.id;

  saveSoon();
  render();
}

function unassignWaiter(waiterId){
  const w = state.waiters.find(x=>x.id===waiterId);
  if(!w) return;
  if(w.assignedBoxId){
    const b = state.boxes.find(bb=>bb.id===w.assignedBoxId);
    if(b) b.assignedWaiterId = null;
  }
  w.assignedBoxId = null;
  saveSoon(); render();
}

function toggleSelectBox(boxId){
  if(selectedBoxIds.has(boxId)) selectedBoxIds.delete(boxId);
  else selectedBoxIds.add(boxId);
  saveSoon(); renderBoard();
}
function setSingleSelect(boxId){
  selectedBoxIds = new Set([boxId]);
  saveSoon(); render();
}

function alignHorizontal(){
  const ids = Array.from(selectedBoxIds);
  if(ids.length<2) return;
  const first = state.boxes.find(b=>b.id===ids[0]);
  if(!first) return;
  const y = first.y;
  ids.forEach(id=>{
    const b = state.boxes.find(bb=>bb.id===id);
    if(b) b.y = y;
  });
  saveSoon(); renderBoard();
}
function alignVertical(){
  const ids = Array.from(selectedBoxIds);
  if(ids.length<2) return;
  const first = state.boxes.find(b=>b.id===ids[0]);
  if(!first) return;
  const x = first.x;
  ids.forEach(id=>{
    const b = state.boxes.find(bb=>bb.id===id);
    if(b) b.x = x;
  });
  saveSoon(); renderBoard();
}
function distributeHoriz(){
  const ids = Array.from(selectedBoxIds);
  if(ids.length<3) return;
  const boxes = ids.map(id=>state.boxes.find(b=>b.id===id)).filter(Boolean).sort((a,b)=>a.x-b.x);
  const left = boxes[0].x;
  const right = boxes[boxes.length-1].x;
  const step = (right-left)/(boxes.length-1);
  boxes.forEach((b,i)=>{ b.x = left + step*i; });
  saveSoon(); renderBoard();
}
function distributeVert(){
  const ids = Array.from(selectedBoxIds);
  if(ids.length<3) return;
  const boxes = ids.map(id=>state.boxes.find(b=>b.id===id)).filter(Boolean).sort((a,b)=>a.y-b.y);
  const top = boxes[0].y;
  const bot = boxes[boxes.length-1].y;
  const step = (bot-top)/(boxes.length-1);
  boxes.forEach((b,i)=>{ b.y = top + step*i; });
  saveSoon(); renderBoard();
}

/** ---------- EVENTS ---------- */
function wire(){
  // sidebar toggle (null safe)
  const toggleSide = () => layout.classList.toggle("sideCollapsed");
  if(toggleSideBtn) toggleSideBtn.addEventListener("click", toggleSide);

  tabBtns.forEach(btn=>{
    btn.addEventListener("click", ()=> setTab(btn.dataset.tab));
  });

  addWaitBtn.addEventListener("click", ()=> addWaiter(waitNameInput.value));
  waitNameInput.addEventListener("keydown", (e)=>{ if(e.key==="Enter") addWaiter(waitNameInput.value); });

  waitSearchInput.addEventListener("input", ()=>{ state.ui.waitSearch = waitSearchInput.value; renderWait(); saveSoon(); });
  clearWaitSearchBtn.addEventListener("click", ()=>{ waitSearchInput.value=""; state.ui.waitSearch=""; renderWait(); saveSoon(); });

  assignedSearchInput.addEventListener("input", ()=>{ state.ui.assignedSearch = assignedSearchInput.value; renderAssigned(); saveSoon(); });
  clearAssignedSearchBtn.addEventListener("click", ()=>{ assignedSearchInput.value=""; state.ui.assignedSearch=""; renderAssigned(); saveSoon(); });

  addBoxBtn.addEventListener("click", ()=> addBox(boxNameInput.value));
  boxNameInput.addEventListener("keydown", (e)=>{ if(e.key==="Enter") addBox(boxNameInput.value); });

  boxSearchInput.addEventListener("input", ()=>{ state.ui.boxSearch = boxSearchInput.value; renderBoxList(); saveSoon(); });
  clearBoxSearchBtn.addEventListener("click", ()=>{ boxSearchInput.value=""; state.ui.boxSearch=""; renderBoxList(); saveSoon(); });

  alignHBtn.addEventListener("click", alignHorizontal);
  alignVBtn.addEventListener("click", alignVertical);
  spaceHBtn.addEventListener("click", distributeHoriz);
  spaceVBtn.addEventListener("click", distributeVert);

  selectModeBtn.addEventListener("click", ()=>{
    state.selectMode = !state.selectMode;
    selectModeBtn.classList.toggle("danger", state.selectMode);
    saveSoon();
  });

  zoomOutBtn.addEventListener("click", ()=>{ state.zoom = clamp(state.zoom - 0.05, 0.25, 2.5); saveSoon(); render(); });
  zoomInBtn.addEventListener("click", ()=>{ state.zoom = clamp(state.zoom + 0.05, 0.25, 2.5); saveSoon(); render(); });
  zoomResetBtn.addEventListener("click", ()=>{ state.zoom = 1; saveSoon(); render(); });

  // wheel zoom with ctrl/cmd
  boardOuter.addEventListener("wheel", (e)=>{
    if(!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    state.zoom = clamp(state.zoom + dir*0.06, 0.25, 2.5);
    saveSoon();
    render();
  }, {passive:false});

  // hotkeys
  window.addEventListener("keydown", (e)=>{
    if(e.key === "Tab"){
      e.preventDefault();
      toggleSide();
      return;
    }
    if(e.key === "Delete" || e.key === "Backspace"){
      if(selectedBoxIds.size){
        const ids = Array.from(selectedBoxIds);
        ids.forEach(id=> deleteBox(id));
      }
    }
    if(e.key === "Escape"){
      selectedBoxIds.clear();
      render();
    }
  });
}

/** ---------- TIMER TICK ---------- */
function tick(){
  const t = now();
  // update waiter timers in lists
  $$("[data-t]").forEach(span=>{
    const key = span.getAttribute("data-t");
    if(!key) return;
    if(key.startsWith("w-")){
      const id = key.slice(2);
      const w = state.waiters.find(x=>x.id===id);
      if(w) span.textContent = fmtTime(t - w.createdAt);
    }else if(key.startsWith("a-")){
      const id = key.slice(2);
      const w = state.waiters.find(x=>x.id===id);
      if(w) span.textContent = fmtTime(t - w.createdAt);
    }else if(key.startsWith("ab-")){
      const id = key.slice(3);
      const w = state.waiters.find(x=>x.id===id);
      if(w) span.textContent = fmtTime(t - w.createdAt);
    }
  });

  rafTimer = requestAnimationFrame(tick);
}

/** ---------- INIT ---------- */
function init(){
  load();
  ensureDefaultBoxes();

  // restore UI fields
  waitSearchInput.value = state.ui.waitSearch || "";
  assignedSearchInput.value = state.ui.assignedSearch || "";
  boxSearchInput.value = state.ui.boxSearch || "";
  setTab(state.ui.tab || "wait");

  wire();
  render();
  tick();
}
document.addEventListener("DOMContentLoaded", init);
