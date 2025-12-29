import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, doc, onSnapshot, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* ✅ 네 Firebase 설정 */
const firebaseConfig = {
  apiKey: "AIzaSyDXZM15ex4GNFdf2xjVOW-xopMHf_AMYGc",
  authDomain: "box-board.firebaseapp.com",
  projectId: "box-board",
  storageBucket: "box-board.firebasestorage.app",
  messagingSenderId: "336632241536",
  appId: "1:336632241536:web:d7b57b91d91596dbf3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const stateRef = doc(db, "boxboard", "state");

const $ = (id) => document.getElementById(id);

const el = {
  syncLine: $("syncLine"),
  syncBadge: $("syncBadge"),
  cntWaiting: $("cntWaiting"),
  cntAssigned: $("cntAssigned"),
  cntBoxes: $("cntBoxes"),

  btnTogglePanel: $("btnTogglePanel"),
  leftPanel: $("leftPanel"),

  inpName: $("inpName"),
  btnAdd: $("btnAdd"),
  waitingList: $("waitingList"),
  assignedList: $("assignedList"),
  boxList: $("boxList"),

  inpBoxName: $("inpBoxName"),
  btnAddBox: $("btnAddBox"),

  stageWrap: $("stageWrap"),
  stage: $("stage"),

  btnBoard1: $("btnBoard1"),
  btnBoard2: $("btnBoard2"),
  btnAddBoard: $("btnAddBoard"),

  zoomOut: $("zoomOut"),
  zoomIn: $("zoomIn"),
  zoomReset: $("zoomReset"),
  zoomLabel: $("zoomLabel"),

  btnColor: $("btnColor"),
  btnText: $("btnText"),
  btnDelete: $("btnDelete"),

  dlgText: $("dlgText"),
  dlgTextValue: $("dlgTextValue"),
  dlgTextOk: $("dlgTextOk"),

  dlgColor: $("dlgColor"),
  btnSelectionMode: $("btnSelectionMode"),
};

let state = null;
let isPanelOpen = true;

let zoom = 1;
let activeBoardId = "b1";
let selectedBoxIds = new Set();
let selectionModeMobile = false;

let drag = null; // {pointerId,startX,startY, originBoxes:[{id,x,y}]}

/* ---------- iOS/모바일에서 "안 눌림" 방지용 바인더 ---------- */
function bindTap(element, handler) {
  if (!element) return;
  element.addEventListener("click", (e) => handler(e));
  element.addEventListener("touchend", (e) => {
    e.preventDefault(); // 300ms/ghost click 방지 + click 누락 방지
    handler(e);
  }, { passive: false });
}

/* ---------- 기본 상태 생성 ---------- */
async function ensureState() {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stateRef);
    if (snap.exists()) return;

    const mkBox = (label, x, y) => ({
      id: "bx_" + Math.random().toString(36).slice(2, 10),
      label, x, y, w: 260, h: 160,
      color: "#4aa3ff",
      text: "",
      seat: null,
      createdAt: Date.now()
    });

    tx.set(stateRef, {
      rev: 1,
      updatedAt: serverTimestamp(),
      activeBoardId: "b1",
      waiting: [],
      boards: [
        { id: "b1", name: "배치도 1", boxes: [
          mkBox("BOX 1", 80, 90),
          mkBox("BOX 2", 420, 90),
          mkBox("BOX 3", 760, 90),
          mkBox("BOX 4", 80, 320),
          mkBox("BOX 5", 420, 320),
          mkBox("BOX 6", 760, 320),
        ]},
        { id: "b2", name: "배치도 2", boxes: [
          mkBox("BOX 1", 120, 120),
          mkBox("BOX 2", 520, 120),
          mkBox("BOX 3", 120, 360),
          mkBox("BOX 4", 520, 360),
        ]}
      ]
    });
  });
}

/* ---------- 트랜잭션 업데이트 ---------- */
async function updateState(mutator) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stateRef);
    if (!snap.exists()) return;
    const s = snap.data();
    const next = structuredClone(s);
    mutator(next);
    next.rev = (next.rev || 0) + 1;
    next.updatedAt = serverTimestamp();
    tx.set(stateRef, next);
  });
}

function uid(prefix="id"){ return prefix + "_" + Math.random().toString(36).slice(2, 10); }
function nowMs(){ return Date.now(); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms/1000));
  const hh = Math.floor(s/3600);
  const mm = Math.floor((s%3600)/60);
  const ss = s%60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  return `${mm}:${String(ss).padStart(2,"0")}`;
}
function hexToRgba(hex, a=1){
  const h = hex.replace("#","");
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function getBoard() {
  return state.boards.find(b => b.id === activeBoardId) || state.boards[0];
}
function getAllBoxes() {
  return getBoard().boxes;
}
function findBox(id) {
  return getAllBoxes().find(b => b.id === id);
}

/* ---------- 탭 ---------- */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tabPane").forEach(p => {
      p.classList.toggle("active", p.dataset.pane === tab);
    });
  });
});

/* ---------- 패널 토글 ---------- */
bindTap(el.btnTogglePanel, () => {
  isPanelOpen = !isPanelOpen;
  el.leftPanel.style.display = isPanelOpen ? "" : "none";
  el.btnTogglePanel.textContent = isPanelOpen ? "목록 닫기" : "목록 열기";
});

/* ---------- 모바일 선택모드 ---------- */
bindTap(el.btnSelectionMode, () => {
  selectionModeMobile = !selectionModeMobile;
  el.btnSelectionMode.textContent = `선택모드: ${selectionModeMobile ? "ON" : "OFF"}`;
});

/* ---------- 대기 추가 (문제 핵심: 여기 무조건 눌리게) ---------- */
async function addWaiting() {
  const name = (el.inpName.value || "").trim();
  if (!name) return;
  el.inpName.value = "";
  await updateState((s) => {
    s.waiting.push({ id: uid("w"), name, createdAt: nowMs() });
  });
}
bindTap(el.btnAdd, addWaiting);
el.inpName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addWaiting();
});

/* ---------- 박스 추가 ---------- */
bindTap(el.btnAddBox, async () => {
  const label = (el.inpBoxName.value || "").trim() || `BOX ${getAllBoxes().length + 1}`;
  el.inpBoxName.value = "";
  await updateState((s) => {
    const b = s.boards.find(x => x.id === activeBoardId);
    b.boxes.push({
      id: uid("bx"),
      label,
      x: 80 + (b.boxes.length % 3) * 340,
      y: 90 + Math.floor(b.boxes.length / 3) * 230,
      w: 260, h: 160,
      color: "#4aa3ff",
      text: "",
      seat: null,
      createdAt: nowMs()
    });
  });
});

/* ---------- 배치도 ---------- */
bindTap(el.btnBoard1, () => setActiveBoard("b1"));
bindTap(el.btnBoard2, () => setActiveBoard("b2"));
bindTap(el.btnAddBoard, async () => {
  const name = prompt("배치도 이름을 입력하세요", `배치도 ${state.boards.length + 1}`);
  if (!name) return;
  await updateState((s) => {
    const id = uid("b");
    s.boards.push({ id, name, boxes: [] });
    s.activeBoardId = id;
  });
});
async function setActiveBoard(id) {
  await updateState((s) => { s.activeBoardId = id; });
  selectedBoxIds.clear();
}

/* ---------- 줌 ---------- */
function applyZoom() {
  el.stage.style.transform = `scale(${zoom})`;
  el.zoomLabel.textContent = `Zoom ${Math.round(zoom*100)}%`;
}
bindTap(el.zoomIn, () => { zoom = Math.min(2.0, zoom + 0.1); applyZoom(); });
bindTap(el.zoomOut, () => { zoom = Math.max(0.5, zoom - 0.1); applyZoom(); });
bindTap(el.zoomReset, () => { zoom = 1; applyZoom(); });
applyZoom();

el.stageWrap.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  zoom = Math.max(0.5, Math.min(2.0, zoom + (delta > 0 ? -0.06 : 0.06)));
  applyZoom();
}, { passive:false });

/* ---------- 다이얼로그 ---------- */
bindTap(el.btnText, () => {
  if (selectedBoxIds.size === 0) return alert("선택된 박스가 없습니다.");
  const first = findBox([...selectedBoxIds][0]);
  el.dlgTextValue.value = first?.text || "";
  el.dlgText.showModal();
});
el.dlgTextOk.addEventListener("click", async (e) => {
  e.preventDefault();
  const value = el.dlgTextValue.value;
  el.dlgText.close();
  await updateState((s) => {
    const b = s.boards.find(x => x.id === activeBoardId);
    b.boxes.forEach(box => { if (selectedBoxIds.has(box.id)) box.text = value; });
  });
});

bindTap(el.btnColor, () => {
  if (selectedBoxIds.size === 0) return alert("선택된 박스가 없습니다.");
  el.dlgColor.showModal();
});
el.dlgColor.addEventListener("click", async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (!t.classList.contains("sw")) return;
  const c = t.dataset.c;
  el.dlgColor.close();
  await updateState((s) => {
    const b = s.boards.find(x => x.id === activeBoardId);
    b.boxes.forEach(box => { if (selectedBoxIds.has(box.id)) box.color = c; });
  });
});

bindTap(el.btnDelete, async () => {
  if (selectedBoxIds.size === 0) return alert("선택된 박스가 없습니다.");
  if (!confirm("선택한 박스를 삭제할까요?")) return;
  const ids = new Set(selectedBoxIds);
  selectedBoxIds.clear();
  await updateState((s) => {
    const b = s.boards.find(x => x.id === activeBoardId);
    b.boxes = b.boxes.filter(x => !ids.has(x.id));
  });
});

/* ---------- 배치/해제 ---------- */
async function assignWaitingToBox(waitId, boxId) {
  await updateState((s) => {
    const w = s.waiting.find(x => x.id === waitId);
    if (!w) return;
    const b = s.boards.find(x => x.id === activeBoardId);
    const box = b.boxes.find(x => x.id === boxId);
    if (!box) return;

    if (box.seat) {
      s.waiting.unshift({ id: uid("w"), name: box.seat.name, createdAt: nowMs() });
    }
    box.seat = { id: uid("p"), name: w.name, assignedAt: nowMs() };
    s.waiting = s.waiting.filter(x => x.id !== waitId);
  });
}
async function unseatToWaiting(boxId) {
  await updateState((s) => {
    const b = s.boards.find(x => x.id === activeBoardId);
    const box = b.boxes.find(x => x.id === boxId);
    if (!box || !box.seat) return;
    s.waiting.unshift({ id: uid("w"), name: box.seat.name, createdAt: nowMs() });
    box.seat = null;
  });
}

/* ---------- 렌더 ---------- */
function refreshCounts() {
  const boxes = getAllBoxes();
  const assigned = boxes.filter(b => !!b.seat).length;
  el.cntWaiting.textContent = state.waiting.length;
  el.cntAssigned.textContent = assigned;
  el.cntBoxes.textContent = boxes.length;
}

function renderLists() {
  // waiting
  el.waitingList.innerHTML = "";
  for (const w of state.waiting) {
    const node = document.createElement("div");
    node.className = "item";
    node.draggable = true;

    node.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type:"waiting", id:w.id }));
    });

    node.innerHTML = `
      <div class="itemLeft">
        <div class="itemName">${escapeHtml(w.name)}</div>
        <div class="itemMeta">
          <span class="badge warn">미배정</span>
          <span class="badge">${fmtElapsed(nowMs() - w.createdAt)}</span>
        </div>
      </div>
      <div class="itemActions">
        <button class="btn mini ghost" type="button" data-act="remove">삭제</button>
      </div>
    `;
    node.querySelector('[data-act="remove"]').addEventListener("click", async () => {
      await updateState((s) => { s.waiting = s.waiting.filter(x => x.id !== w.id); });
    });
    el.waitingList.appendChild(node);
  }

  // assigned
  el.assignedList.innerHTML = "";
  const assignedPeople = [];
  for (const box of getAllBoxes()) {
    if (box.seat) assignedPeople.push({ boxId: box.id, boxLabel: box.label, ...box.seat });
  }
  if (assignedPeople.length === 0) {
    el.assignedList.innerHTML = `<div class="hint">배치된 사람이 없습니다.</div>`;
  } else {
    for (const p of assignedPeople) {
      const node = document.createElement("div");
      node.className = "item";
      node.innerHTML = `
        <div class="itemLeft">
          <div class="itemName">${escapeHtml(p.name)}</div>
          <div class="itemMeta">
            <span class="badge good">배치됨</span>
            <span class="badge">${escapeHtml(p.boxLabel)}</span>
            <span class="badge">${fmtElapsed(nowMs() - p.assignedAt)}</span>
          </div>
        </div>
        <div class="itemActions">
          <button class="btn mini" type="button" data-act="unseat">대기로</button>
        </div>
      `;
      node.querySelector('[data-act="unseat"]').addEventListener("click", async () => {
        await unseatToWaiting(p.boxId);
      });
      el.assignedList.appendChild(node);
    }
  }

  // box list
  el.boxList.innerHTML = "";
  for (const box of getAllBoxes()) {
    const node = document.createElement("div");
    node.className = "item";
    node.innerHTML = `
      <div class="itemLeft">
        <div class="itemName">${escapeHtml(box.label)}</div>
        <div class="itemMeta">
          ${box.seat ? `<span class="badge good">배치중</span>` : `<span class="badge warn">비어있음</span>`}
          <span class="badge">${Math.round(box.x)},${Math.round(box.y)}</span>
        </div>
      </div>
    `;
    node.addEventListener("click", () => {
      selectedBoxIds.clear();
      selectedBoxIds.add(box.id);
      renderStage();
      scrollBoxIntoView(box.id);
    });
    el.boxList.appendChild(node);
  }

  refreshCounts();
}

function scrollBoxIntoView(boxId){
  const boxEl = el.stage.querySelector(`.box[data-id="${boxId}"]`);
  if (!boxEl) return;
  const rect = boxEl.getBoundingClientRect();
  const wrapRect = el.stageWrap.getBoundingClientRect();
  el.stageWrap.scrollBy({ left: rect.left - wrapRect.left - 40, top: rect.top - wrapRect.top - 40, behavior:"smooth" });
}

function renderStage() {
  el.stage.innerHTML = "";
  for (const box of getAllBoxes()) {
    const node = document.createElement("div");
    node.className = "box";
    node.dataset.id = box.id;
    node.dataset.label = box.label;

    node.style.left = box.x + "px";
    node.style.top = box.y + "px";
    node.style.width = (box.w || 260) + "px";
    node.style.height = (box.h || 160) + "px";
    node.style.background = `linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.22)), radial-gradient(circle at 30% 10%, ${hexToRgba(box.color, .35)}, transparent 55%)`;

    if (selectedBoxIds.has(box.id)) node.classList.add("sel");

    node.innerHTML = `
      <div class="boxInner">
        <div class="boxTop">
          <div>
            <div class="boxTitle">${escapeHtml(box.label)}</div>
            <div class="boxSub">${box.text ? escapeHtml(box.text) : "더블클릭: 텍스트 편집"}</div>
          </div>
        </div>

        <div class="seat" data-drop="seat">
          ${
            box.seat
              ? `
                <div class="seatLeft">
                  <div class="seatName">${escapeHtml(box.seat.name)}</div>
                  <div class="seatMeta">
                    <span class="badge good">배치</span>
                    <span class="badge">${fmtElapsed(nowMs() - box.seat.assignedAt)}</span>
                  </div>
                </div>
                <div class="itemActions">
                  <button class="btn mini ghost" type="button" data-act="unseat">대기로</button>
                </div>
              `
              : `<div class="seatHint">여기로 대기자를 드래그해서 배치</div>`
          }
        </div>
      </div>
    `;

    // select
    node.addEventListener("click", (e) => {
      const id = box.id;
      if (e.shiftKey || selectionModeMobile) {
        selectedBoxIds.has(id) ? selectedBoxIds.delete(id) : selectedBoxIds.add(id);
      } else {
        selectedBoxIds.clear();
        selectedBoxIds.add(id);
      }
      renderStage();
    });

    node.addEventListener("dblclick", () => {
      selectedBoxIds.clear();
      selectedBoxIds.add(box.id);
      el.dlgTextValue.value = box.text || "";
      el.dlgText.showModal();
    });

    // drag move (pointer)
    node.addEventListener("pointerdown", (e) => {
      const id = box.id;
      if (!selectedBoxIds.has(id) && !(e.shiftKey || selectionModeMobile)) {
        selectedBoxIds.clear();
        selectedBoxIds.add(id);
        renderStage();
      }

      node.setPointerCapture(e.pointerId);

      const originBoxes = [];
      for (const bid of selectedBoxIds) {
        const b = findBox(bid);
        if (b) originBoxes.push({ id: b.id, x: b.x, y: b.y });
      }

      drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originBoxes };
    });

    node.addEventListener("pointermove", (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;

      for (const ob of drag.originBoxes) {
        const boxEl = el.stage.querySelector(`.box[data-id="${ob.id}"]`);
        if (boxEl) {
          boxEl.style.left = (ob.x + dx) + "px";
          boxEl.style.top = (ob.y + dy) + "px";
        }
      }
    });

    node.addEventListener("pointerup", async (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      const originBoxes = drag.originBoxes;
      drag = null;

      await updateState((s) => {
        const b = s.boards.find(x => x.id === activeBoardId);
        for (const ob of originBoxes) {
          const bx = b.boxes.find(x => x.id === ob.id);
          if (!bx) continue;
          bx.x = clamp(ob.x + dx, 0, 1600 - (bx.w || 260));
          bx.y = clamp(ob.y + dy, 0, 980 - (bx.h || 160));
        }
      });
    });

    // drop
    const seat = node.querySelector('[data-drop="seat"]');
    seat.addEventListener("dragover", (e) => e.preventDefault());
    seat.addEventListener("drop", async (e) => {
      e.preventDefault();
      try{
        const data = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (data.type !== "waiting") return;
        await assignWaitingToBox(data.id, box.id);
      }catch(_){}
    });

    const unseatBtn = node.querySelector('[data-act="unseat"]');
    if (unseatBtn) unseatBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await unseatToWaiting(box.id);
    });

    el.stage.appendChild(node);
  }
  refreshCounts();
}

/* ---------- 실시간 구독 ---------- */
function subscribe() {
  onSnapshot(stateRef, (snap) => {
    if (!snap.exists()) return;
    state = snap.data();
    activeBoardId = state.activeBoardId || "b1";
    el.syncLine.textContent = "연결됨";
    el.syncBadge.textContent = "동기화됨 (Firestore)";

    renderLists();
    renderStage();

    el.btnBoard1.classList.toggle("active", activeBoardId === "b1");
    el.btnBoard2.classList.toggle("active", activeBoardId === "b2");
  }, (err) => {
    console.error(err);
    el.syncLine.textContent = "연결 오류";
    el.syncBadge.textContent = "동기화 실패";
  });
}

/* ---------- 타이머 표시 갱신 ---------- */
setInterval(() => {
  if (!state) return;
  renderLists();
  renderStage();
}, 1000);

/* ---------- 시작 ---------- */
await ensureState();
subscribe();
