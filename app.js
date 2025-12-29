/* =========================================================
   Box Board v1.4.9 - app.js (FULL)
   - ✅ Fix: Pointer Events로 박스 이동/리사이즈 (모바일 드래그 OK)
   - Boards Tabs + Reorder + Delete Rule A + Box Resize
   - Snap to Grid (Alt = temporary disable)
   - Search: auto switch board + highlight box + center scroll
========================================================= */

const state = {
  people: [],
  boards: [],
  activeBoardId: null,
  selectedBoxIds: new Set(),
  zoom: 1,
  listCollapsed: false,
  wmOpacity: 0.18,
  wmScale: 1.0,
  snapEnabled: true,
  gridSize: 16,
  search: { query: "", matches: [], idx: -1 },
};

/* =========================================================
   ✅ Realtime Sync (PC ↔ Mobile) + Persistence
========================================================= */
const LS_KEY = "BOX_BOARD_SYNC_STATE_V1";
const CLIENT_ID_KEY = "BOX_BOARD_SYNC_CLIENT_ID_V1";
const clientId = localStorage.getItem(CLIENT_ID_KEY) || (Math.random().toString(36).slice(2)+Date.now().toString(36));
localStorage.setItem(CLIENT_ID_KEY, clientId);

let isApplyingRemote = false;
let lastSerialized = "";
let writeDebounce = null;
let pendingStateForWrite = null;

const bc = ("BroadcastChannel" in window) ? new BroadcastChannel("BOX_BOARD_BC") : null;
if (bc){
  bc.onmessage = (ev)=>{
    const msg = ev.data;
    if (!msg || msg.from === clientId) return;
    if (msg.type === "STATE"){
      applyRemoteState(msg.payload, "BroadcastChannel");
    }
  };
}

function $(sel){ return document.querySelector(sel); }
function $$(sel){ return Array.from(document.querySelectorAll(sel)); }
function now(){ return Date.now(); }
function uid(){ return Math.random().toString(36).slice(2) + now().toString(36); }

function safeStringify(obj){
  try { return JSON.stringify(obj); } catch(e){ return ""; }
}
function toSerializableState(){
  return {
    ...state,
    selectedBoxIds: Array.from(state.selectedBoxIds || []),
  };
}
function applySerializableIntoState(s){
  const next = s || {};
  isApplyingRemote = true;

  state.people = Array.isArray(next.people) ? next.people : [];
  state.boards = Array.isArray(next.boards) ? next.boards : [];
  state.activeBoardId = next.activeBoardId ?? state.activeBoardId;
  state.selectedBoxIds = new Set(Array.isArray(next.selectedBoxIds) ? next.selectedBoxIds : []);
  state.zoom = Number.isFinite(next.zoom) ? next.zoom : 1;
  state.listCollapsed = !!next.listCollapsed;
  state.wmOpacity = Number.isFinite(next.wmOpacity) ? next.wmOpacity : state.wmOpacity;
  state.wmScale = Number.isFinite(next.wmScale) ? next.wmScale : state.wmScale;

  state.snapEnabled = (typeof next.snapEnabled === "boolean") ? next.snapEnabled : state.snapEnabled;
  state.gridSize = Number.isFinite(next.gridSize) ? next.gridSize : state.gridSize;
  state.search = next.search && typeof next.search === "object"
    ? { query: next.search.query || "", matches: Array.isArray(next.search.matches)? next.search.matches : [], idx: Number.isFinite(next.search.idx)? next.search.idx : -1 }
    : state.search;

  try{
    renderBoardsBar?.();
    renderAll?.();
    applyGridUI?.();
  }catch(e){}

  lastSerialized = safeStringify(toSerializableState());
  isApplyingRemote = false;
}
function persistLocal(){
  try{
    localStorage.setItem(LS_KEY, safeStringify(toSerializableState()));
  }catch(e){}
}
function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function applyRemoteState(payload, source){
  if (!payload) return;
  applySerializableIntoState(payload);
  persistLocal();
  const el = document.getElementById("syncLabel");
  if (el) el.textContent = `동기화됨 (${source})`;
}
function broadcastState(payload){
  if (!bc) return;
  bc.postMessage({ type:"STATE", from: clientId, payload });
}

function scheduleWriteAll(payload){
  persistLocal();
  broadcastState(payload);

  if (!window.BB_SYNC || !window.BB_SYNC.enabled) return;
  if (!Firestore.write) return;

  pendingStateForWrite = payload;
  if (writeDebounce) clearTimeout(writeDebounce);
  writeDebounce = setTimeout(async ()=>{
    const p = pendingStateForWrite;
    pendingStateForWrite = null;
    writeDebounce = null;
    try{
      await Firestore.write(p);
    }catch(e){
      console.error("[SYNC] Firestore write failed", e);
    }
  }, 150);
}

const Firestore = {
  ready: false,
  write: null,
  start: async ()=>{
    const cfg = window.BB_SYNC;
    if (!cfg || !cfg.enabled) return;

    try{
      const [appMod, fsMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js"),
      ]);
      const { initializeApp } = appMod;
      const { getFirestore, doc, setDoc, updateDoc, onSnapshot, serverTimestamp } = fsMod;

      const app = initializeApp(cfg.firebaseConfig);
      const db = getFirestore(app);
      const room = (cfg.room || "default-room").trim() || "default-room";
      const ref = doc(db, "boxboards", room);

      await setDoc(ref, { _createdAt: serverTimestamp(), _createdBy: clientId }, { merge:true });

      Firestore.write = async (payload)=>{
        if (isApplyingRemote) return;
        await updateDoc(ref, {
          ...payload,
          _updatedAt: serverTimestamp(),
          _updatedBy: clientId
        });
      };

      onSnapshot(ref, (snap)=>{
        const data = snap.data();
        if (!data) return;
        // ✅ 초기 setDoc(메타만) 또는 불완전 payload가 로컬 state를 덮어쓰지 않게 보호
        const hasCore = Array.isArray(data.boards) || Array.isArray(data.people);
        if (!hasCore) {
          const el = document.getElementById("syncLabel");
          if (el) el.textContent = "연결됨 (Firestore)";
          return;
        }
        applyRemoteState(data, "Firestore");
      });

      Firestore.ready = true;
      const el = document.getElementById("syncLabel");
      if (el) el.textContent = "실시간 연결됨";
    }catch(e){
      console.error("[SYNC] Firestore init failed", e);
      const el = document.getElementById("syncLabel");
      if (el) el.textContent = "실시간 연결 실패(콘솔 확인)";
    }
  }
};

function startStateChangeDetector(){
  lastSerialized = safeStringify(toSerializableState());
  setInterval(()=>{
    if (isApplyingRemote) return;
    const curObj = toSerializableState();
    const curStr = safeStringify(curObj);
    if (!curStr) return;
    if (curStr !== lastSerialized){
      lastSerialized = curStr;
      scheduleWriteAll(curObj);
    }
  }, 250);
}

(function bootstrapPersistence(){
  const loaded = loadLocal();
  if (loaded) applySerializableIntoState(loaded);
})();

const COLORS = [
  "#2b325a","#233a6b","#274e6e","#1f5a52","#2f5c3b","#4b5b2a","#6b4c23","#6b2b2b",
  "#3a2b6b","#5a2b6b","#6b2b4f","#6b2b33","#2b6b66","#2b6b3d","#4a6b2b","#6b6a2b"
];

const DRAG_MIME = "application/x-boxboard-person";

const DEFAULT_TEXT = {
  titleSize: 34,
  titleColor: "#ffffff",
  headerTimeSize: 12,
  headerTimeColor: "#a9b0d6",
  nameSize: 16,
  nameColor: "#e9ecff",
  seatTimeSize: 12,
  seatTimeColor: "#a9b0d6",
};

const DEFAULT_BOX_W = 220;
const DEFAULT_BOX_H = 160;
const MIN_W = 160, MAX_W = 520;
const MIN_H = 120, MAX_H = 420;

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function hexToRgba(hex, a){
  const h = (hex || "#000000").replace("#","");
  const full = h.length === 3 ? h.split("").map(x=>x+x).join("") : h;
  const n = parseInt(full, 16);
  const r = (n>>16)&255, g=(n>>8)&255, b=n&255;
  return `rgba(${r},${g},${b},${a})`;
}
function structuredCloneFallback(obj){
  return JSON.parse(JSON.stringify(obj));
}
const structuredClone = window.structuredClone ? window.structuredClone.bind(window) : structuredCloneFallback;

function ensureBoxText(box){
  if (!box.text) box.text = structuredClone(DEFAULT_TEXT);
  for (const k of Object.keys(DEFAULT_TEXT)){
    if (box.text[k] == null) box.text[k] = DEFAULT_TEXT[k];
  }
}

function getActiveBoard(){
  return state.boards.find(b=>b.id===state.activeBoardId) || state.boards[0] || null;
}
function setActiveBoard(boardId){
  const b = state.boards.find(x=>x.id===boardId);
  if (!b) return;
  state.activeBoardId = boardId;
  state.selectedBoxIds.clear();
  renderBoardsBar();
  renderAll();
}

/* =========================================================
   Seat / Unseat helpers
========================================================= */
function findBox(boardId, boxId){
  const b = state.boards.find(x=>x.id===boardId);
  if (!b) return null;
  return b.boxes.find(x=>x.id===boxId) || null;
}

function unseatBox(boardId, boxId){
  const box = findBox(boardId, boxId);
  if (!box || !box.seat?.personId) return;
  const p = state.people.find(x=>x.id===box.seat.personId);
  box.seat.personId = null;
  box.seat.startedAt = null;
  if (p){
    toWaiting(p);
  }
}

function seatPersonToBox(personId, boardId, boxId){
  const p = state.people.find(x=>x.id===personId);
  const box = findBox(boardId, boxId);
  if (!p || !box) return;

  // 이미 다른 곳에 앉아있으면 먼저 해제
  if (p.status === "assigned" && p.boardId && p.boxId){
    const prev = findBox(p.boardId, p.boxId);
    if (prev && prev.seat?.personId === p.id){
      prev.seat.personId = null;
      prev.seat.startedAt = null;
    }
  }

  // 해당 박스에 누가 있으면 그 사람을 대기로
  if (box.seat?.personId && box.seat.personId !== p.id){
    const other = state.people.find(x=>x.id===box.seat.personId);
    if (other) toWaiting(other);
  }

  box.seat.personId = p.id;
  box.seat.startedAt = now();
  // ✅ 배치 애니메이션 트리거
  box._flash = box.seat.startedAt;

  p.status = "assigned";
  p.boardId = boardId;
  p.boxId = boxId;
  p.assignedStartedAt = box.seat.startedAt;

  renderAll();
}

function computeWmOpacity(z){
  if (z >= 1) return 0.16;
  if (z >= 0.8) return 0.22;
  if (z >= 0.65) return 0.30;
  if (z >= 0.5) return 0.38;
  return 0.46;
}
function computeWmScale(z){
  if (z >= 1) return 1.0;
  if (z >= 0.8) return 1.15;
  if (z >= 0.65) return 1.45;
  if (z >= 0.5) return 1.9;
  return 2.35;
}

/* =========================
   Snap helpers
========================= */
function snap(n, grid){ return Math.round(n / grid) * grid; }
function snapBoxXY(box){
  box.x = snap(box.x, state.gridSize);
  box.y = snap(box.y, state.gridSize);
  // prevent negative coords (can make boxes 'disappear' due to overflow hidden)
  box.x = Math.max(0, box.x);
  box.y = Math.max(0, box.y);
}
function snapBoxWH(box){
  box.w = snap(box.w ?? DEFAULT_BOX_W, state.gridSize);
  box.h = snap(box.h ?? DEFAULT_BOX_H, state.gridSize);
}
function applyGridUI(){
  const vp = $("#boardViewport");
  vp.style.setProperty("--grid", `${state.gridSize}px`);
  vp.classList.toggle("grid-on", !!state.snapEnabled);
  $("#btnSnapToggle").textContent = state.snapEnabled ? "스냅: ON" : "스냅: OFF";
  $("#gridSizeSelect").value = String(state.gridSize);
}

/* =========================================================
   Init default data (첫 실행)
========================================================= */
function initIfEmpty(){
  if (state.boards.length > 0) return;

  const t = now();
  const boardId = uid();
  const boxes = [];
  for (let i=1;i<=6;i++){
    boxes.push({
      id: uid(),
      title: `BOX ${i}`,
      x: 40 + ((i-1)%3)*240,
      y: 40 + (Math.floor((i-1)/3))*200,
      w: DEFAULT_BOX_W,
      h: DEFAULT_BOX_H,
      color: COLORS[(i-1)%COLORS.length],
      createdAt: t,
      seat: { personId: null, startedAt: null },
      text: structuredClone(DEFAULT_TEXT),
    });
  }
  state.boards.push({ id: boardId, name: "배치도 1", createdAt: t, boxes });
  state.activeBoardId = boardId;
}

/* =========================================================
   UI bindings
========================================================= */
function bindUI(){
  // ✅ iOS Safari에서 click/Enter가 간헐적으로 씹히는 케이스가 있어
  // click + touchend(=tap) 둘 다 바인딩하고, 중복 실행은 가드한다.
  const btnAdd = $("#btnAddWaiting");
  let lastAddTapAt = 0;
  const safeAddWaiting = ()=>{
    const t = Date.now();
    // 450ms 이내 중복( touchend 후 click ) 방지
    if (t - lastAddTapAt < 450) return;
    lastAddTapAt = t;
    addWaitingFromInput();
  };

  btnAdd.addEventListener("click", safeAddWaiting);
  btnAdd.addEventListener("touchend", (e)=>{
    e.preventDefault();
    safeAddWaiting();
  }, { passive:false });

  $("#nameInput").addEventListener("keydown", (e)=>{
    if (e.key === "Enter"){
      e.preventDefault();
      safeAddWaiting();
    }
  });

  $("#btnToggleList").addEventListener("click", ()=>{
    applyListCollapsed(!state.listCollapsed);
  });
  $("#btnToggleListBoard").addEventListener("click", ()=>{
    applyListCollapsed(false);
  });
  $("#expandHandle").addEventListener("click", ()=>{
    applyListCollapsed(false);
  });

  document.addEventListener("keydown", (e)=>{
    if (e.key === "Tab"){
      e.preventDefault();
      applyListCollapsed(!state.listCollapsed);
    }
  });

  $("#zoomIn").addEventListener("click", ()=> setZoom(state.zoom + 0.1));
  $("#zoomOut").addEventListener("click", ()=> setZoom(state.zoom - 0.1));
  $("#zoomReset").addEventListener("click", ()=> setZoom(1));

  $("#boardViewport").addEventListener("wheel", (e)=>{
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const next = state.zoom + (delta>0 ? -0.08 : +0.08);
    setZoom(next);
  }, { passive:false });
  // ✅ 빈 공간 클릭 시 선택 해제(PC에서 "잡힘" 표시가 남는 느낌 방지)
  $("#boardCanvas").addEventListener("pointerdown", (e)=>{
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.shiftKey) return;
    if (e.target.closest(".table-box")) return;
    state.selectedBoxIds.clear();
    renderBoardSelectionOnly();
  });


  // Snap/Grid
  $("#btnSnapToggle").addEventListener("click", ()=>{
    state.snapEnabled = !state.snapEnabled;
    applyGridUI();
  });
  $("#gridSizeSelect").addEventListener("change", (e)=>{
    state.gridSize = parseInt(e.target.value, 10) || 16;
    applyGridUI();
  });
  applyGridUI();

  // Search UI (기존 함수들 아래에 있음)
  $("#searchInput").addEventListener("keydown", (e)=>{
    if (e.key === "Enter"){
      e.preventDefault();
      runSearchAndFocusNext();
    }
  });
  $("#btnSearchNext").addEventListener("click", runSearchAndFocusNext);

  // TODO: 나머지 버튼들(정렬/박스추가/컬러/텍스트/삭제) 기존 로직 그대로 아래에 있다고 가정

  // Tabs
  $$(".tab").forEach(t=>{
    t.addEventListener("click", ()=> switchTab(t.dataset.tab));
  });

  // Box actions (기본 기능만)
  const btnAddBox = $("#btnAddBox");
  if (btnAddBox){
    btnAddBox.addEventListener("click", ()=>{
      const board = getActiveBoard();
      if (!board) return;
      const t = now();
      const idx = board.boxes.length + 1;
      board.boxes.push({
        id: uid(),
        title: `BOX ${idx}`,
        x: 40 + (idx%3)*240,
        y: 40 + (Math.floor(idx/3))*200,
        w: DEFAULT_BOX_W,
        h: DEFAULT_BOX_H,
        color: COLORS[(idx-1)%COLORS.length],
        createdAt: t,
        seat: { personId: null, startedAt: null },
        text: structuredClone(DEFAULT_TEXT),
      });
      renderAll();
    });
  }
  const btnDeleteSelected = $("#btnDeleteSelected");
  if (btnDeleteSelected){
    btnDeleteSelected.addEventListener("click", ()=>{
      const board = getActiveBoard();
      if (!board || state.selectedBoxIds.size===0) return;
      // 선택 박스 안의 사람은 대기로
      for (const id of Array.from(state.selectedBoxIds)){
        const box = board.boxes.find(x=>x.id===id);
        if (box?.seat?.personId){
          const p = state.people.find(x=>x.id===box.seat.personId);
          if (p) toWaiting(p);
        }
      }
      board.boxes = board.boxes.filter(x=>!state.selectedBoxIds.has(x.id));
      state.selectedBoxIds.clear();
      renderAll();
    });
  }
}

function switchTab(tab){
  $$(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===tab));
  $("#tab_waiting").style.display  = (tab==="waiting") ? "" : "none";
  $("#tab_assigned").style.display = (tab==="assigned") ? "" : "none";
  $("#tab_boxes").style.display    = (tab==="boxes") ? "" : "none";
}

/* =========================================================
   ✅ Toolbar height → CSS var
   - toolbar가 모바일에서 줄바꿈되면 기존의 62px 가정이 깨져서
     화면이 겹치거나 '큰 빈 패널'처럼 보일 수 있음
========================================================= */
function syncToolbarHeight(){
  const tb = document.getElementById("toolbar");
  if (!tb) return;
  const h = Math.ceil(tb.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--toolbarH", `${h}px`);
}

window.addEventListener("resize", ()=>{
  syncToolbarHeight();
}, { passive:true });

// 최초 1회 + 폰트/레이아웃 안정화 이후 한 번 더
setTimeout(syncToolbarHeight, 0);
setTimeout(syncToolbarHeight, 300);

/* =========================================================
   List collapse
========================================================= */
function applyListCollapsed(collapsed){
  const viewport = $("#boardViewport");
  const keepScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };

  state.listCollapsed = collapsed;

  const app = $("#app");
  const countsBoard = $("#countsLabelBoard");
  const btnBoard = $("#btnToggleListBoard");
  const handle = $("#expandHandle");

  if (collapsed){
    app.classList.add("list-collapsed");
    countsBoard.style.display = "";
    btnBoard.style.display = "";
    handle.style.display = "flex";
  } else {
    app.classList.remove("list-collapsed");
    countsBoard.style.display = "none";
    btnBoard.style.display = "none";
    handle.style.display = "none";
  }

  $("#btnToggleList").textContent = collapsed ? "목록 열기" : "목록 닫기";
  $("#btnToggleListBoard").textContent = "목록 열기";

  requestAnimationFrame(()=>{
    resizeBoardCanvas();
    viewport.scrollLeft = keepScroll.left;
    viewport.scrollTop  = keepScroll.top;
  });

  updateCounts();
}

/* =========================================================
   Zoom
========================================================= */
function setZoom(z){
  state.zoom = Math.max(0.45, Math.min(1.8, z));
  $("#boardCanvas").style.transform = `scale(${state.zoom})`;
  $("#zoomLabel").textContent = `Zoom ${Math.round(state.zoom*100)}%`;

  state.wmOpacity = computeWmOpacity(state.zoom);
  state.wmScale   = computeWmScale(state.zoom);

  resizeBoardCanvas();
  renderBoard();
}

/* =========================================================
   People
========================================================= */
function addWaitingFromInput(){
  const el = $("#nameInput");
  const name = (el.value || "").trim();
  if (!name) return;

  const t = now();
  state.people.push({
    id: uid(),
    name,
    createdAt: t,
    status: "waiting",
    boardId: null,
    boxId: null,
    waitStartedAt: t,
    assignedStartedAt: null
  });

  el.value = "";
  renderAll();
}

/* =========================================================
   Boards Tabs Bar
========================================================= */
function renderBoardsBar(){
  const bar = $("#boardsBar");
  bar.innerHTML = "";

  const activeId = state.activeBoardId;

  state.boards.forEach((b)=>{
    const tab = document.createElement("div");
    tab.className = "btab" + (b.id === activeId ? " active" : "");
    tab.draggable = true;
    tab.dataset.boardId = b.id;

    tab.innerHTML = `
      <div class="name" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</div>
      <div class="actions">
        <div class="bicon" data-act="rename" title="이름변경">✎</div>
        <div class="bicon danger" data-act="delete" title="삭제">×</div>
      </div>
    `;

    tab.addEventListener("click", (e)=>{
      if (e.target.closest('[data-act="rename"], [data-act="delete"]')) return;
      setActiveBoard(b.id);
    });

    tab.querySelector('[data-act="rename"]').addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      const n = prompt("배치도 이름", b.name);
      if (n && n.trim()){
        b.name = n.trim();
        renderBoardsBar();
        renderLists();
        updateCounts();
      }
    });

    tab.querySelector('[data-act="delete"]').addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      deleteBoard_A(b.id);
    });

    // Drag reorder (PC 위주)
    tab.addEventListener("dragstart", (e)=>{
      tab.classList.add("dragging");
      e.dataTransfer.setData("text/plain", b.id);
      e.dataTransfer.effectAllowed = "move";
    });
    tab.addEventListener("dragend", ()=> tab.classList.remove("dragging"));

    tab.addEventListener("dragover", (e)=>{
      e.preventDefault();
      const draggingId = e.dataTransfer.getData("text/plain");
      if (!draggingId || draggingId === b.id) return;

      const from = state.boards.findIndex(x=>x.id===draggingId);
      const to = state.boards.findIndex(x=>x.id===b.id);
      if (from < 0 || to < 0 || from === to) return;

      const moved = state.boards.splice(from, 1)[0];
      state.boards.splice(to, 0, moved);
      renderBoardsBar();
    });

    bar.appendChild(tab);
  });

  const add = document.createElement("div");
  add.className = "btabAdd";
  add.innerHTML = `+ 배치도 추가`;
  add.addEventListener("click", addBoard);
  bar.appendChild(add);
}

function addBoard(){
  const n = state.boards.length + 1;
  const t = now();
  const boardId = uid();

  const boxes = [];
  for (let i=1;i<=6;i++){
    boxes.push({
      id: uid(),
      title: `BOX ${i}`,
      x: 40 + ((i-1)%3)*240,
      y: 40 + (Math.floor((i-1)/3))*200,
      w: DEFAULT_BOX_W,
      h: DEFAULT_BOX_H,
      color: COLORS[(i-1)%COLORS.length],
      createdAt: t,
      seat: { personId: null, startedAt: null },
      text: structuredClone(DEFAULT_TEXT),
    });
  }

  state.boards.push({ id: boardId, name: `배치도 ${n}`, createdAt: t, boxes });
  setActiveBoard(boardId);
}

function deleteBoard_A(boardId){
  if (state.boards.length <= 1){
    alert("배치도는 최소 1개는 있어야 합니다.");
    return;
  }

  const board = state.boards.find(b=>b.id===boardId);
  if (!board) return;

  const ok = confirm(`"${board.name}" 배치도를 삭제할까요?\n\n(A규칙) 이 배치도에 배치된 인원은 모두 '대기'로 돌아갑니다.`);
  if (!ok) return;

  board.boxes.forEach(box=>{
    if (box.seat?.personId){
      const p = state.people.find(x=>x.id===box.seat.personId);
      if (p) toWaiting(p);
      box.seat.personId = null;
      box.seat.startedAt = null;
    }
  });

  state.boards = state.boards.filter(b=>b.id!==boardId);

  if (state.activeBoardId === boardId){
    state.activeBoardId = state.boards[0].id;
  }

  state.selectedBoxIds.clear();
  renderBoardsBar();
  renderAll();
}

/* =========================================================
   Rendering (여기 아래는 기존 v1.4.1 로직이 있다고 가정)
   - renderAll / renderLists / renderBoard / updateCounts / etc...
   - 아래에 "박스 이동/리사이즈"만 Fix된 함수들을 제공
========================================================= */

function renderAll(){
  renderBoardsBar();
  renderLists();
  renderBoard();
  updateCounts();
}

/* =========================================================
   ✅ Pointer drag (Waiting row → Box seat)
   - 모바일 Safari/Chrome에서 HTML5 drag&drop이 거의 동작하지 않아서
     pointer 이벤트로 동일한 UX를 제공
========================================================= */
let waitingPointerDrag = null;
function enablePointerDragWaitingRow(rowEl, personId){
  rowEl.addEventListener("pointerdown", (e)=>{
    // 스크롤 시작/버튼 클릭은 제외
    if (e.target.closest("button, a, input, select, textarea")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // 이미 HTML5 drag가 시작되는 환경(대부분 PC)에서도 pointer drag가 겹칠 수 있어
    // 마우스는 무시하고 터치/펜 위주로 동작하게 한다.
    if (e.pointerType === "mouse") return;

    const p = state.people.find(x=>x.id===personId);
    if (!p) return;

    const pid = e.pointerId;
    rowEl.setPointerCapture(pid);

    const ghost = document.createElement("div");
    ghost.style.position = "fixed";
    ghost.style.left = "0";
    ghost.style.top = "0";
    ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    ghost.style.zIndex = "999999";
    ghost.style.pointerEvents = "none";
    ghost.style.padding = "10px 12px";
    ghost.style.borderRadius = "12px";
    ghost.style.border = "1px solid rgba(255,255,255,.18)";
    ghost.style.background = "rgba(23,26,43,.92)";
    ghost.style.boxShadow = "0 14px 35px rgba(0,0,0,.45)";
    ghost.style.color = "#e9ecff";
    ghost.style.fontWeight = "800";
    ghost.textContent = p.name;
    document.body.appendChild(ghost);

    waitingPointerDrag = {
      pointerId: pid,
      personId,
      ghost,
      overBoxId: null,
    };

    // 드래그 중에는 페이지 스크롤로 먹히지 않게
    e.preventDefault();
  }, { passive:false });
}

function updateWaitingPointerDragOver(x, y){
  if (!waitingPointerDrag) return;
  const el = document.elementFromPoint(x, y);
  const boxEl = el?.closest?.(".table-box");
  const newBoxId = boxEl?.dataset?.boxId || null;

  if (waitingPointerDrag.overBoxId === newBoxId) return;

  // 이전 하이라이트 제거
  document.querySelectorAll(".table-box.drop-over").forEach(n=>n.classList.remove("drop-over"));
  waitingPointerDrag.overBoxId = newBoxId;
  if (newBoxId && boxEl) boxEl.classList.add("drop-over");
}

// 전역에서 pointer move/up로 처리 (row 밖으로 나가도 이어지게)
window.addEventListener("pointermove", (e)=>{
  if (!waitingPointerDrag) return;
  if (e.pointerId !== waitingPointerDrag.pointerId) return;
  waitingPointerDrag.ghost.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;
  updateWaitingPointerDragOver(e.clientX, e.clientY);
  e.preventDefault();
}, { passive:false });

window.addEventListener("pointerup", (e)=>{
  if (!waitingPointerDrag) return;
  if (e.pointerId !== waitingPointerDrag.pointerId) return;

  const { ghost, personId, overBoxId } = waitingPointerDrag;
  waitingPointerDrag = null;
  try{ ghost.remove(); }catch(_){ }
  document.querySelectorAll(".table-box.drop-over").forEach(n=>n.classList.remove("drop-over"));

  if (overBoxId){
    const board = getActiveBoard();
    if (board) seatPersonToBox(personId, board.id, overBoxId);
  }

  e.preventDefault();
}, { passive:false });

function renderLists(){
  const wWrap = $("#tab_waiting");
  const aWrap = $("#tab_assigned");
  const bWrap = $("#tab_boxes");
  if (!wWrap || !aWrap || !bWrap) return;

  const board = getActiveBoard();

  // Waiting
  const waiting = state.people.filter(p=>p.status==="waiting");
  if (waiting.length===0){
    wWrap.innerHTML = `<div class="sub" style="padding:8px 2px;">대기 인원이 없습니다.</div>`;
  }else{
    wWrap.innerHTML = "";
    waiting
      .sort((a,b)=>(a.waitStartedAt||a.createdAt) - (b.waitStartedAt||b.createdAt))
      .forEach(p=>{
        const row = document.createElement("div");
        row.className = "row waiting-draggable unassigned";
        row.draggable = true;
        row.dataset.personId = p.id;
        row.innerHTML = `
          <div class="left">
            <div class="name-line">
              <div class="name">${escapeHtml(p.name)}</div>
              <div class="meta">
                <span class="tag warn slim">미배정</span>
                <span class="tag time slim" data-waitelapsed>--:--:--</span>
              </div>
            </div>
          </div>
          <div class="actions">
            <button class="danger slimbtn" data-act="remove">삭제</button>
          </div>
        `;

        row.addEventListener("dragstart", (e)=>{
          row.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData(DRAG_MIME, p.id);
          e.dataTransfer.setData("text/plain", p.id);
        });
        row.addEventListener("dragend", ()=> row.classList.remove("dragging"));

        // ✅ 모바일(및 일부 브라우저)에서 HTML5 drag가 잘 안 먹혀서
        // pointer 기반 "끌어서 드롭"을 추가로 제공한다.
        enablePointerDragWaitingRow(row, p.id);

        row.querySelector('[data-act="remove"]').addEventListener("click", ()=>{
          state.people = state.people.filter(x=>x.id!==p.id);
          renderAll();
        });

        wWrap.appendChild(row);
      });
  }

  // Assigned
  const assigned = state.people.filter(p=>p.status==="assigned");
  if (assigned.length===0){
    aWrap.innerHTML = `<div class="sub" style="padding:8px 2px;">배치된 사람이 없습니다.</div>`;
  }else{
    aWrap.innerHTML = "";
    assigned
      .sort((a,b)=>(a.assignedStartedAt||0) - (b.assignedStartedAt||0))
      .forEach(p=>{
        const row = document.createElement("div");
        row.className = "row inplay";
        row.dataset.personId = p.id;
        const boxTitle = (()=>{
          const bb = state.boards.find(x=>x.id===p.boardId);
          const bx = bb?.boxes?.find(x=>x.id===p.boxId);
          return bx?.title || "-";
        })();
        row.innerHTML = `
          <div class="left">
            <div class="name">${escapeHtml(p.name)}</div>
            <div class="meta">
              <span class="pill good">배치됨</span>
              <span class="pill" data-assignedelapsed>--:--:--</span>
              <span class="pill blue">${escapeHtml(boxTitle)}</span>
            </div>
          </div>
          <div class="actions">
            <button data-act="goto">이동</button>
            <button class="danger" data-act="unseat">대기</button>
          </div>
        `;
        row.querySelector('[data-act="goto"]').addEventListener("click", ()=>{
          if (p.boardId) setActiveBoard(p.boardId);
          if (p.boxId){
            state.selectedBoxIds.clear();
            state.selectedBoxIds.add(p.boxId);
            renderBoardSelectionOnly();
            focusBox(p.boxId);
          }
        });
        row.querySelector('[data-act="unseat"]').addEventListener("click", ()=>{
          if (p.boardId && p.boxId) unseatBox(p.boardId, p.boxId);
          renderAll();
        });
        aWrap.appendChild(row);
      });
  }

  // Boxes list
  if (!board){
    bWrap.innerHTML = "";
  }else{
    bWrap.innerHTML = "";
    board.boxes.forEach(box=>{
      const seated = box.seat?.personId ? state.people.find(p=>p.id===box.seat.personId) : null;
      const card = document.createElement("div");
      card.className = "box-card";
      card.innerHTML = `
        <div>
          <b>${escapeHtml(box.title)}</b>
          <div><span>${seated ? `좌석: ${escapeHtml(seated.name)}` : "좌석: 비어있음"}</span></div>
        </div>
        <div class="btns">
          <button data-act="select" class="blue">선택</button>
          <button data-act="clear">비우기</button>
        </div>
      `;
      card.querySelector('[data-act="select"]').addEventListener("click", ()=>{
        state.selectedBoxIds.clear();
        state.selectedBoxIds.add(box.id);
        renderAll();
        focusBox(box.id);
      });
      card.querySelector('[data-act="clear"]').addEventListener("click", ()=>{
        if (box.seat?.personId) unseatBox(board.id, box.id);
        renderAll();
      });
      bWrap.appendChild(card);
    });
  }
}

function updateCounts(){
  const w = state.people.filter(p=>p.status==="waiting").length;
  const a = state.people.filter(p=>p.status==="assigned").length;
  const b = getActiveBoard()?.boxes?.length || 0;
  const txt = `대기 ${w} · 배치 ${a} · 박스 ${b}`;
  const c1 = $("#countsLabel");
  const c2 = $("#countsLabelBoard");
  if (c1) c1.textContent = txt;
  if (c2) c2.textContent = txt;
}

function resizeBoardCanvas(){
  const board = getActiveBoard();
  const canvas = $("#boardCanvas");
  if (!board || !canvas) return;
  const pad = 60;
  let maxX = 1400, maxY = 900;
  for (const box of board.boxes){
    const w = box.w ?? DEFAULT_BOX_W;
    const h = box.h ?? DEFAULT_BOX_H;
    maxX = Math.max(maxX, box.x + w + pad);
    maxY = Math.max(maxY, box.y + h + pad);
  }
  canvas.style.width = `${maxX}px`;
  canvas.style.height = `${maxY}px`;
}

function fmtElapsed(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const hh = String(Math.floor(s/3600)).padStart(2,"0");
  const mm = String(Math.floor((s%3600)/60)).padStart(2,"0");
  const ss = String(s%60).padStart(2,"0");
  return `${hh}:${mm}:${ss}`;
}

function tickTimers(){
  const t = now();
  // waiting list timers
  $$('[data-waitelapsed]').forEach(el=>{
    const row = el.closest('.row');
    const pid = row?.dataset?.personId;
    const p = state.people.find(x=>x.id===pid);
    if (!p) return;
    el.textContent = fmtElapsed(t - (p.waitStartedAt || p.createdAt || t));
  });
  // assigned list timers
  $$('[data-assignedelapsed]').forEach(el=>{
    const row = el.closest('.row');
    const pid = row?.dataset?.personId;
    const p = state.people.find(x=>x.id===pid);
    if (!p) return;
    el.textContent = fmtElapsed(t - (p.assignedStartedAt || t));
  });
  // box timers
  $$('[data-boxelapsed]').forEach(el=>{
    const boxEl = el.closest('.table-box');
    const boxId = boxEl?.dataset?.boxId;
    const board = getActiveBoard();
    const box = board?.boxes?.find(x=>x.id===boxId);
    if (!box?.seat?.startedAt) { el.textContent = "--:--:--"; return; }
    el.textContent = fmtElapsed(t - box.seat.startedAt);
  });
  $$('[data-seatelapsed]').forEach(el=>{
    const seatEl = el.closest('.seat');
    const pid = seatEl?.dataset?.personId;
    const p = state.people.find(x=>x.id===pid);
    if (!p?.assignedStartedAt) { el.textContent = "--:--:--"; return; }
    el.textContent = fmtElapsed(t - p.assignedStartedAt);
  });
}

function focusBox(boxId){
  const vp = $("#boardViewport");
  const boxEl = document.querySelector(`.table-box[data-box-id="${CSS.escape(boxId)}"]`) || document.querySelector(`.table-box[data-boxid="${CSS.escape(boxId)}"]`);
  // dataset is boxId; selector must match attribute name exactly => data-box-id not present
}

/* =========================================================
   ✅ 핵심: 모바일에서도 되는 Pointer 기반 Drag/Resize
========================================================= */
function makeDraggable(el, box){
  // ✅ Layout thrash 방지: 드래그 중에는 left/top을 계속 바꾸지 말고 transform으로만 표시
  //   (pointermove마다 reflow가 나면 “버벅임”이 생김)
  let pid = null;
  let dragging = false;
  let startX=0, startY=0, ox=0, oy=0;
  let lastDX=0, lastDY=0;
  let raf = 0;

  const applyTransform = ()=>{
    raf = 0;
    el.style.transform = `translate(${lastDX}px, ${lastDY}px)`;
  };

  const onMove = (e)=>{
    if (!dragging || e.pointerId !== pid) return;

    // zoom이 걸려있으므로 화면 이동량을 캔버스 좌표로 환산
    const z = state.zoom || 1;
    const dx = (e.clientX - startX) / z;
    const dy = (e.clientY - startY) / z;

    // transform은 픽셀 단위이므로 다시 zoom 반영해서 화면 이동량으로 적용
    lastDX = dx * z;
    lastDY = dy * z;

    if (!raf) raf = requestAnimationFrame(applyTransform);
    e.preventDefault();
  };

  const finish = (e)=>{
    if (!dragging || e.pointerId !== pid) return;
    dragging = false;
    el.classList.remove("dragging");

    try{ el.releasePointerCapture(pid); }catch(_){}
    pid = null;

    // transform 제거 후 최종 좌표 확정
    if (raf){ cancelAnimationFrame(raf); raf = 0; }
    el.style.transform = "";

    // lastDX/lastDY are already in local coords (zoom-adjusted)
    const dx = lastDX;
    const dy = lastDY;

    box.x = ox + dx;
    box.y = oy + dy;

    if (state.snapEnabled && !(e?.altKey)){
      snapBoxXY(box);
    }

    // clamp: prevent boxes going outside (negative coords)
    box.x = Math.max(0, box.x);
    box.y = Math.max(0, box.y);

    el.style.left = box.x + "px";
    el.style.top  = box.y + "px";

    lastDX = 0; lastDY = 0;

    resizeBoardCanvas();
    e.preventDefault();
  };

  el.addEventListener("pointerdown", (e)=>{
    // 좌클릭/터치만
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // 리사이즈 핸들은 제외
    if (e.target.closest(".resize-handle")) return;
    // 입력/버튼류 제외
    if (e.target.closest("button, input, select, textarea, a, label")) return;

    pid = e.pointerId;
    dragging = true;
    el.classList.add("dragging");

    // 포인터 캡쳐(손가락이 박스 밖으로 나가도 계속 드래그)
    el.setPointerCapture(pid);

    startX = e.clientX;
    startY = e.clientY;
    ox = box.x;
    oy = box.y;

    lastDX = 0; lastDY = 0;
    el.style.willChange = "transform";

    el.addEventListener("pointermove", onMove);
    e.preventDefault();
  });

  el.addEventListener("pointerup", (e)=>{
    el.style.willChange = "";
    el.removeEventListener("pointermove", onMove);
    finish(e);
  });
  el.addEventListener("pointercancel", (e)=>{
    el.style.willChange = "";
    el.removeEventListener("pointermove", onMove);
    finish(e);
  });
}

function makeResizable(el, box){
  const handle = el.querySelector(".resize-handle");
  if (!handle) return;

  let pid = null;
  let resizing = false;
  let startX=0, startY=0, ow=0, oh=0;
  let lastDW=0, lastDH=0;
  let raf = 0;

  const MIN_W = 170;
  const MIN_H = 130;

  const applySize = ()=>{
    raf = 0;
    el.style.width = Math.max(MIN_W, ow + lastDW) + "px";
    el.style.height = Math.max(MIN_H, oh + lastDH) + "px";
  };

  const onMove = (e)=>{
    if (!resizing || e.pointerId !== pid) return;

    const z = state.zoom || 1;
    const dw = (e.clientX - startX) / z;
    const dh = (e.clientY - startY) / z;

    lastDW = dw;
    lastDH = dh;

    if (!raf) raf = requestAnimationFrame(applySize);
    e.preventDefault();
  };

  const finish = (e)=>{
    if (!resizing || e.pointerId !== pid) return;
    resizing = false;

    try{ handle.releasePointerCapture(pid); }catch(_){}
    pid = null;

    if (raf){ cancelAnimationFrame(raf); raf = 0; }

    box.w = Math.max(MIN_W, ow + lastDW);
    box.h = Math.max(MIN_H, oh + lastDH);

    if (state.snapEnabled && !(e?.altKey)){
      // 리사이즈는 x/y는 그대로, w/h만 스냅
      box.w = snap(box.w, state.gridSize);
      box.h = snap(box.h, state.gridSize);
    }

    el.style.width = box.w + "px";
    el.style.height = box.h + "px";
    // CSS 계산용 사이즈 변수
    el.style.setProperty("--bw", box.w + "px");
    el.style.setProperty("--bh", box.h + "px");
    el.style.setProperty("--wmUser", Math.round(box.text.titleSize) + "px");
    el.style.setProperty("--wmScale", String(state.wmScale || 1));
    el.style.setProperty("--wmAuto", Math.max(18, Math.round(Math.min(box.w, box.h) * 0.38)) + "px");

    lastDW = 0; lastDH = 0;

    resizeBoardCanvas();
    e.preventDefault();
  };

  handle.addEventListener("pointerdown", (e)=>{
    if (e.pointerType === "mouse" && e.button !== 0) return;

    pid = e.pointerId;
    resizing = true;
    handle.setPointerCapture(pid);

    startX = e.clientX;
    startY = e.clientY;
    ow = box.w;
    oh = box.h;

    lastDW = 0; lastDH = 0;
    el.style.willChange = "width, height";

    handle.addEventListener("pointermove", onMove);
    e.preventDefault();
  });

  handle.addEventListener("pointerup", (e)=>{
    el.style.willChange = "";
    handle.removeEventListener("pointermove", onMove);
    finish(e);
  });
  handle.addEventListener("pointercancel", (e)=>{
    el.style.willChange = "";
    handle.removeEventListener("pointermove", onMove);
    finish(e);
  });
}

/* =========================================================
   renderBoard (이 함수 안에서 makeDraggable/makeResizable 호출하면 됨)
   - 아래는 "핵심 부분만" 예시 (너 기존 renderBoard와 동일하게 유지하고,
     마지막에 makeDraggable/makeResizable만 이 버전으로 쓰면 됨)
========================================================= */
function renderBoard(){
  const board = getActiveBoard();
  const canvas = $("#boardCanvas");
  if (!board || !canvas) return;

  canvas.innerHTML = "";

  board.boxes.forEach(box=>{
    ensureBoxText(box);

    const seatedPerson = box.seat?.personId ? state.people.find(p=>p.id===box.seat.personId) : null;
    const seatIsEmpty = !seatedPerson;

    const el = document.createElement("div");
    el.className = "table-box";
    el.dataset.boxId = box.id;

    el.style.left = box.x + "px";
    el.style.top  = box.y + "px";
    el.style.width = box.w + "px";
    el.style.height = box.h + "px";
    // CSS 계산용 사이즈 변수
    el.style.setProperty("--bw", box.w + "px");
    el.style.setProperty("--bh", box.h + "px");
    el.style.setProperty("--wmUser", Math.round(box.text.titleSize) + "px");
    el.style.setProperty("--wmScale", String(state.wmScale || 1));
    el.style.setProperty("--wmAuto", Math.max(18, Math.round(Math.min(box.w, box.h) * 0.38)) + "px");
    if (box.color) el.style.background = box.color;

    // 선택 표시
    if (state.selectedBoxIds.has(box.id)) el.classList.add("selected");
    if (box._flash && (now() - box._flash) < 1200) el.classList.add("seat-anim");

    // 워터마크(줌에 따라 자동 강화)
    state.wmOpacity = computeWmOpacity(state.zoom || 1);
    state.wmScale = computeWmScale(state.zoom || 1);

    el.innerHTML = `
      <button class="box-close" data-close title="삭제" aria-label="삭제">✕</button>

      <div class="wm-title" style="color:${box.text.titleColor}; --wmOpacity:${state.wmOpacity};">
        ${escapeHtml(box.title)}
      </div>

      <div class="wm-time" style="font-size:${box.text.headerTimeSize}px; color:${box.text.headerTimeColor};">
        <span data-boxelapsed>--:--:--</span>
      </div>

      <div class="body">
        <div class="seat ${seatIsEmpty ? "empty" : "occupied"}" data-seat>
          <div class="who" style="font-size:${box.text.nameSize}px; color:${box.text.nameColor};">
            ${seatIsEmpty ? "대기자 드래그해서 넣기" : escapeHtml(seatedPerson.name)}
          </div>
          <div class="seat-meta">
            <span class="pill slim ${seatIsEmpty ? "blue" : "good"}" data-seatelapsed>--:--:--</span>
            ${seatIsEmpty ? `<span class="pill slim">DROP</span>` : ``}
            ${seatIsEmpty ? `` : `<button class="pill slimbtn" data-seat-to-wait>대기로</button>`}
          </div>
        </div>
      </div>

      <div class="resize-handle" title="크기 조절"></div>
    `;

    // 선택(Shift+클릭 멀티)
    el.addEventListener("pointerdown", (e)=>{
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest(".resize-handle")) return;
      if (e.target.closest("button, input, select, textarea, a, label")) return;

      const id = box.id;
      if (e.shiftKey){
        if (state.selectedBoxIds.has(id)) state.selectedBoxIds.delete(id);
        else state.selectedBoxIds.add(id);
      } else {
        if (!state.selectedBoxIds.has(id) || state.selectedBoxIds.size > 1){
          state.selectedBoxIds.clear();
          state.selectedBoxIds.add(id);
        }
      }
      renderBoardSelectionOnly();
    });

    // 좌석 더블클릭: 대기로 이동
    const seatEl = el.querySelector("[data-seat]");
    seatEl.addEventListener("dblclick", ()=>{
      if (!box.seat?.personId) return;
      const p = state.people.find(x=>x.id===box.seat.personId);
      if (!p) return;
      box.seat.personId = null;
      box.seat.startedAt = null;
      toWaiting(p);
      renderAll();
    });
    // ✅ 박스 우상단 X(삭제)
    const closeBtn = el.querySelector("[data-close]");
    if (closeBtn){
      closeBtn.addEventListener("click", (e)=>{
        e.stopPropagation();
        const board = getActiveBoard();
        if (!board) return;
        // 박스에 사람이 있으면 대기로 복귀
        if (box?.seat?.personId){
          const p = state.people.find(x=>x.id===box.seat.personId);
          if (p) toWaiting(p);
        }
        board.boxes = board.boxes.filter(x=>x.id!==box.id);
        state.selectedBoxIds.delete(box.id);
        renderAll();
      });
    }

    // ✅ '대기로' 버튼(클릭)
    const toWaitBtn = el.querySelector("[data-seat-to-wait]");
    if (toWaitBtn){
      toWaitBtn.addEventListener("click", (e)=>{
        e.stopPropagation();
        if (!box.seat?.personId) return;
        const p = state.people.find(x=>x.id===box.seat.personId);
        if (!p) return;
        box.seat.personId = null;
        box.seat.startedAt = null;
        toWaiting(p);
        renderAll();
      });
    }


    // ✅ Drag drop (대기 → 좌석)
    const allowDrop = (e)=>{
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      el.classList.add("drop-over");
    };
    const clearDrop = ()=> el.classList.remove("drop-over");

    seatEl.addEventListener("dragover", allowDrop);
    seatEl.addEventListener("dragenter", allowDrop);
    seatEl.addEventListener("dragleave", clearDrop);
    seatEl.addEventListener("drop", (e)=>{
      e.preventDefault();
      clearDrop();
      const pid = (e.dataTransfer?.getData(DRAG_MIME) || e.dataTransfer?.getData("text/plain") || "").trim();
      if (!pid) return;
      seatPersonToBox(pid, board.id, box.id);
    });

    // 모바일(pointer drag) 드롭도 지원: 좌석 위로 오면 하이라이트만
    seatEl.addEventListener("pointerenter", ()=>{
      if (waitingPointerDrag) el.classList.add("drop-over");
    });
    seatEl.addEventListener("pointerleave", ()=>{
      el.classList.remove("drop-over");
    });

    makeDraggable(el, box);
    makeResizable(el, box);

    canvas.appendChild(el);
  });

  renderBoardSelectionOnly();
}

function renderBoardSelectionOnly(){
  $$(".table-box").forEach(el=>{
    const id = el.dataset.boxId;
    el.classList.toggle("selected", state.selectedBoxIds.has(id));
  });
}

/* =========================================================
   Placeholder: 기존 함수들(좌석 배치/검색/정렬/모달 등)
   - 너 파일에 이미 있는 것 그대로 유지해서 붙여넣으면 됨
========================================================= */
function toWaiting(p){
  p.status = "waiting";
  p.boardId = null;
  p.boxId = null;
  p.waitStartedAt = now();
  p.assignedStartedAt = null;
}

function runSearchAndFocusNext(){
  const q = ($("#searchInput")?.value || "").trim().toLowerCase();
  if (!q){
    $$(".row").forEach(r=>r.classList.remove("search-hit"));
    return;
  }

  const rows = Array.from($$(".row"));
  const hits = rows.filter(r => (r.querySelector(".name")?.textContent || "").toLowerCase().includes(q));
  rows.forEach(r=>r.classList.remove("search-hit"));

  const assignedHits = state.people
    .filter(p => (p.name || "").toLowerCase().includes(q) && p.status === "assigned" && p.boardId && p.boxId);

  runSearchAndFocusNext._i = (runSearchAndFocusNext._i ?? -1) + 1;

  if (hits.length){
    const idx = runSearchAndFocusNext._i % hits.length;
    const el = hits[idx];
    el.classList.add("search-hit");
    el.scrollIntoView({ block:"center", behavior:"smooth" });
    return;
  }

  if (assignedHits.length){
    const idx = runSearchAndFocusNext._i % assignedHits.length;
    const p = assignedHits[idx];

    if (p.boardId !== state.activeBoardId){
      state.activeBoardId = p.boardId;
      renderAll(); // 보드가 바뀌면 DOM이 다시 만들어짐
    }

    const finalEl = document.querySelector(`.table-box[data-box-id="${p.boxId}"]`);
    if (finalEl){
      state.selectedBoxIds.clear();
      state.selectedBoxIds.add(p.boxId);
      renderBoardSelectionOnly();

      const viewport = $("#boardViewport");
      const rect = finalEl.getBoundingClientRect();
      const vrect = viewport.getBoundingClientRect();
      viewport.scrollBy({
        left: (rect.left + rect.width/2) - (vrect.left + vrect.width/2),
        top:  (rect.top  + rect.height/2) - (vrect.top  + vrect.height/2),
        behavior: "smooth"
      });

      finalEl.classList.add("pulse-hit");
      setTimeout(()=> finalEl.classList.remove("pulse-hit"), 900);
    }
    return;
  }

  runSearchAndFocusNext._i = -1;
}

/* =========================================================
   ✅ Layout fix: toolbar 높이(줄바꿈 포함)를 CSS 변수로 반영
   - 모바일에서 상단 UI가 겹치거나 "큰 빈 패널"처럼 보이는 현상 방지
========================================================= */
function updateToolbarHeight(){
  const tb = document.getElementById("toolbar");
  if (!tb) return;
  const h = Math.ceil(tb.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--toolbarH", `${h}px`);
}
window.addEventListener("resize", ()=>{
  // iOS 주소창 변화 등으로 연속 resize가 많이 발생할 수 있어 살짝 디바운스
  clearTimeout(updateToolbarHeight._t);
  updateToolbarHeight._t = setTimeout(updateToolbarHeight, 60);
});
document.addEventListener("DOMContentLoaded", updateToolbarHeight);

/* =========================================================
   Boot
========================================================= */
initIfEmpty();
bindUI();
renderAll();
applyGridUI();
updateToolbarHeight();
// ✅ 카운트업 타이머 시작
try{ tickTimers(); }catch(e){}
setInterval(()=>{ try{ tickTimers(); }catch(e){} }, 250);
Firestore.start();
startStateChangeDetector();
