/* Box Board (Stable)
   - 위치 밀림 방지: BOX 이동은 left/top 금지, transform(translate3d)만 사용
   - 줌(scale) 상태에서도 좌표 보정: (client - rect) / zoom
*/

const $ = (sel) => document.querySelector(sel);
const boardOuter = $("#boardOuter");
const board = $("#board");
const waitListEl = $("#waitList");
const boxListEl = $("#boxList");
const saveHintEl = $("#saveHint");

const zoomPctEl = $("#zoomPct");
const zoomOutBtn = $("#zoomOut");
const zoomInBtn = $("#zoomIn");
const zoomResetBtn = $("#zoomReset");

const addWaitBtn = $("#addWait");
const waitNameInput = $("#waitName");

const addBoxBtn = $("#addBox");
const boxNameInput = $("#boxName");

const STORAGE_KEY = "box_board_stable_v1";

let state = loadState() ?? { zoom: 1, waiters: [], boxes: [] };

let dragWaiterId = null;
let dragBoxId = null;
let dragBoxStart = null;

function uid(prefix="id"){
  return prefix + "_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function now(){ return Date.now(); }

function fmtTime(ms){
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2,"0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2,"0");
  const ss = String(s % 60).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
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

/** client 좌표 -> board 로컬 좌표(줌 보정) */
function getBoardPointFromClient(clientX, clientY){
  const rect = board.getBoundingClientRect();
  const z = state.zoom || 1;
  return { x: (clientX - rect.left) / z, y: (clientY - rect.top) / z };
}

/** Zoom */
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

/** Waiting */
addWaitBtn.addEventListener("click", ()=>{
  const name = (waitNameInput.value || "").trim();
  if(!name) return;
  state.waiters.unshift({ id: uid("w"), name, createdAt: now() });
  waitNameInput.value = "";
  render();
  saveState();
});
waitNameInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") addWaitBtn.click(); });

/** Boxes */
addBoxBtn.addEventListener("click", ()=>{
  const name = (boxNameInput.value || "").trim() || `BOX ${state.boxes.length+1}`;
  const colors = ["green","blue","olive","pink"];
  const color = colors[state.boxes.length % colors.length];
  const baseX = 120 + (state.boxes.length % 3) * 390;
  const baseY = 120 + Math.floor(state.boxes.length / 3) * 260;

  state.boxes.push({ id: uid("b"), name, x: baseX, y: baseY, color, assigned: null });
  boxNameInput.value = "";
  render();
  saveState();
});
boxNameInput.addEventListener("keydown", (e)=>{ if(e.key === "Enter") addBoxBtn.click(); });

function deleteBox(boxId){
  state.boxes = state.boxes.filter(b => b.id !== boxId);
  render();
  saveState();
}

function assignWaiterToBox(waiterId, boxId){
  const wIdx = state.waiters.findIndex(w => w.id === waiterId);
  const b = state.boxes.find(b => b.id === boxId);
  if(wIdx < 0 || !b) return;

  const w = state.waiters[wIdx];

  if(b.assigned){
    state.waiters.unshift({
      id: uid("w"),
      name: b.assigned.name,
      createdAt: b.assigned.assignedAt ?? now(),
    });
  }
  b.assigned = { id: uid("a"), name: w.name, assignedAt: now() };
  state.waiters.splice(wIdx, 1);

  render();
  saveState();
}

function unassignBoxToWaiting(boxId){
  const b = state.boxes.find(b => b.id === boxId);
  if(!b || !b.assigned) return;

  state.waiters.unshift({ id: uid("w"), name: b.assigned.name, createdAt: now() });
  b.assigned = null;

  render();
  saveState();
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/** Render */
function render(){
  renderWaiters();
  renderBoxList();
  renderBoardBoxes();
}

function renderWaiters(){
  waitListEl.innerHTML = "";
  if(state.waiters.length === 0){
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="left">
      <div class="name" style="opacity:.7">대기 없음</div>
      <div class="meta">이름을 추가해 주세요</div>
    </div>`;
    waitListEl.appendChild(empty);
    return;
  }

  for(const w of state.waiters){
    const el = document.createElement("div");
    el.className = "item";
    el.draggable = true;
    el.dataset.waiterId = w.id;
    el.innerHTML = `
      <div class="left">
        <div class="name">${escapeHtml(w.name)}</div>
        <div class="meta">대기 ${fmtTime(now() - (w.createdAt || now()))}</div>
      </div>
      <div class="pill warn">드래그</div>
    `;

    el.addEventListener("dragstart", (e)=>{
      dragWaiterId = w.id;
      try{ e.dataTransfer.setData("text/plain", w.id); }catch{}
    });
    el.addEventListener("dragend", ()=>{ dragWaiterId = null; });

    waitListEl.appendChild(el);
  }
}

function renderBoxList(){
  boxListEl.innerHTML = "";
  if(state.boxes.length === 0){
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div class="left">
      <div class="name" style="opacity:.7">박스 없음</div>
      <div class="meta">박스를 추가해 주세요</div>
    </div>`;
    boxListEl.appendChild(empty);
    return;
  }

  for(const b of state.boxes){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="left">
        <div class="name">${escapeHtml(b.name)}</div>
        <div class="meta">${b.assigned ? `배치: ${escapeHtml(b.assigned.name)}` : "비어있음"}</div>
      </div>
      <button class="btn danger" data-del="${b.id}">삭제</button>
    `;
    el.querySelector(`[data-del="${b.id}"]`).addEventListener("click", ()=> deleteBox(b.id));
    boxListEl.appendChild(el);
  }
}

function renderBoardBoxes(){
  const grid = board.querySelector(".grid");
  board.innerHTML = "";
  board.appendChild(grid);

  for(const b of state.boxes){
    const boxEl = document.createElement("div");
    boxEl.className = "box";
    boxEl.dataset.boxId = b.id;
    boxEl.dataset.color = b.color || "green";
    boxEl.style.setProperty("--x", `${b.x}px`);
    boxEl.style.setProperty("--y", `${b.y}px`);

    boxEl.innerHTML = `
      <div class="boxInner">
        <div class="watermark">${escapeHtml(b.name)}</div>

        <div class="boxTop">
          <div class="boxTitle">${escapeHtml(b.name)}</div>
          <button class="iconBtn" title="이 박스 삭제" data-delete>×</button>
        </div>

        <div class="slot" data-dropzone>
          <div class="slotLeft">
            ${
              b.assigned
                ? `<div class="slotName">${escapeHtml(b.assigned.name)}</div>
                   <div class="slotTime">
                     <span class="badgeTime" data-timer>${fmtTime(now() - b.assigned.assignedAt)}</span>
                     <span style="color:rgba(169,176,214,.9)">배치 시간</span>
                   </div>`
                : `<div class="dropHint">여기에 대기자를 드롭</div>`
            }
          </div>

          <div class="slotActions">
            ${
              b.assigned
                ? `<button class="smallBtn" data-unassign>대기로</button>`
                : `<span class="pill good">DROP</span>`
            }
          </div>
        </div>
      </div>
    `;

    boxEl.querySelector("[data-delete]").addEventListener("click", (e)=>{
      e.stopPropagation();
      deleteBox(b.id);
    });

    const unBtn = boxEl.querySelector("[data-unassign]");
    if(unBtn){
      unBtn.addEventListener("click", (e)=>{
        e.stopPropagation();
        unassignBoxToWaiting(b.id);
      });
    }

    const dropZone = boxEl.querySelector("[data-dropzone]");
    dropZone.addEventListener("dragover", (e)=>{ e.preventDefault(); boxEl.classList.add("dropOver"); });
    dropZone.addEventListener("dragleave", ()=> boxEl.classList.remove("dropOver"));
    dropZone.addEventListener("drop", (e)=>{
      e.preventDefault();
      boxEl.classList.remove("dropOver");
      const idFromDT = (()=>{ try{return e.dataTransfer.getData("text/plain");}catch{return "";} })();
      const wid = dragWaiterId || idFromDT;
      if(wid) assignWaiterToBox(wid, b.id);
    });

    attachBoxMoveHandlers(boxEl, b.id);
    board.appendChild(boxEl);
  }
}

/** Box move (pointer) */
function attachBoxMoveHandlers(boxEl, boxId){
  boxEl.addEventListener("pointerdown", (e)=>{
    const tag = (e.target?.tagName || "").toLowerCase();
    if(tag === "button") return;

    e.preventDefault();
    boxEl.setPointerCapture(e.pointerId);

    dragBoxId = boxId;
    const b = state.boxes.find(bb => bb.id === boxId);
    if(!b) return;

    const p = getBoardPointFromClient(e.clientX, e.clientY);
    dragBoxStart = { x: b.x, y: b.y, pointerX: p.x, pointerY: p.y };
    boxEl.style.opacity = "0.95";
  });

  boxEl.addEventListener("pointermove", (e)=>{
    if(dragBoxId !== boxId || !dragBoxStart) return;
    const b = state.boxes.find(bb => bb.id === boxId);
    if(!b) return;

    const p = getBoardPointFromClient(e.clientX, e.clientY);
    const dx = p.x - dragBoxStart.pointerX;
    const dy = p.y - dragBoxStart.pointerY;

    b.x = Math.round(dragBoxStart.x + dx);
    b.y = Math.round(dragBoxStart.y + dy);

    boxEl.style.setProperty("--x", `${b.x}px`);
    boxEl.style.setProperty("--y", `${b.y}px`);
  });

  const end = ()=>{
    if(dragBoxId !== boxId) return;
    dragBoxId = null;
    dragBoxStart = null;
    boxEl.style.opacity = "1";
    saveState();
  };
  boxEl.addEventListener("pointerup", end);
  boxEl.addEventListener("pointercancel", end);
}

/** Timers */
function tickTimers(){
  const boxes = board.querySelectorAll(".box");
  boxes.forEach(boxEl=>{
    const boxId = boxEl.dataset.boxId;
    const b = state.boxes.find(bb=>bb.id===boxId);
    if(!b || !b.assigned) return;
    const t = boxEl.querySelector("[data-timer]");
    if(t) t.textContent = fmtTime(now() - b.assigned.assignedAt);
  });

  const items = waitListEl.querySelectorAll(".item");
  items.forEach(item=>{
    const wid = item.dataset.waiterId;
    if(!wid) return;
    const w = state.waiters.find(ww=>ww.id===wid);
    if(!w) return;
    const meta = item.querySelector(".meta");
    if(meta) meta.textContent = `대기 ${fmtTime(now() - (w.createdAt||now()))}`;
  });
}

/** init */
applyZoom();
render();
setInterval(tickTimers, 500);
window.addEventListener("beforeunload", ()=>{ try{ saveState(); }catch{} });
