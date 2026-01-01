
/* Box Board - stable build (split box layout) v20260102-11 */
(() => {
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const now = () => Date.now();

  const LS_KEY = "boxboard_state_v3";

  const state = {
    zoom: 1,
    showGrid: true,
    snap: true,
    sideCollapsed: false,
    waiters: [], // {id, name, createdAt}
    boxes: [],   // {id, name, x, y, color, assigned: waiterId|null, assignedAt:number|null}
    selectedBoxIds: [],
  };

  // ---------- utils ----------
  const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const snapTo = (v, grid=40) => Math.round(v / grid) * grid;

  const fmt = (ms) => {
    ms = Math.max(0, ms);
    const s = Math.floor(ms/1000);
    const hh = String(Math.floor(s/3600)).padStart(2,"0");
    const mm = String(Math.floor((s%3600)/60)).padStart(2,"0");
    const ss = String(s%60).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  };

  const save = () => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    showSaveHint("저장됨");
  };

  const load = () => {
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return;
      const data = JSON.parse(raw);
      Object.assign(state, data);
      // sanity
      state.waiters ||= [];
      state.boxes ||= [];
      state.selectedBoxIds ||= [];
    }catch(e){}
  };

  let saveHintTimer = null;
  const showSaveHint = (txt) => {
    const el = $("#saveHint");
    if(!el) return;
    el.textContent = txt;
    el.style.opacity = "1";
    clearTimeout(saveHintTimer);
    saveHintTimer = setTimeout(() => { el.style.opacity = ".75"; }, 800);
  };

  // ---------- DOM refs ----------
  const layoutEl = $("#layout");
  const sideEl = $("#side");
  const boardEl = $("#board");
  const boardOuterEl = $("#boardOuter");
  const gridEl = $("#grid");
  const zoomPctEl = $("#zoomPct");

  const waitNameEl = $("#waitName");
  const addWaitBtn = $("#addWait");
  const waitSearchEl = $("#waitSearch");
  const waitListEl = $("#waitList");

  const assignedSearchEl = $("#assignedSearch");
  const assignedListEl = $("#assignedList");

  const boxNameEl = $("#boxName");
  const addBoxBtn = $("#addBox");
  const boxSearchEl = $("#boxSearch");
  const boxListEl = $("#boxList");

  // ---------- Tabs ----------
  const setTab = (key) => {
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === key));
    $$(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === key ? "true" : "false"));
    $$(".tabPanel").forEach(p => p.classList.toggle("hidden", p.dataset.panel !== key));
  };
  $$(".tab").forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

  // ---------- Sidebar toggle ----------
  const toggleSide = () => {
    state.sideCollapsed = !state.sideCollapsed;
    layoutEl.classList.toggle("sideCollapsed", state.sideCollapsed);
    save();
  };
  $("#toggleSide").addEventListener("click", toggleSide);
  window.addEventListener("keydown", (e) => {
    if(e.key === "Tab"){
      e.preventDefault();
      toggleSide();
    }
    if(e.key === "Delete"){
      deleteSelectedBoxes();
    }
  });

  // ---------- Grid / Snap ----------
  const applyGridSnapUI = () => {
    $("#gridToggle").checked = !!state.showGrid;
    $("#snapToggle").checked = !!state.snap;
    gridEl.classList.toggle("hidden", !state.showGrid);
  };
  $("#gridToggle").addEventListener("change", (e)=>{ state.showGrid = e.target.checked; applyGridSnapUI(); save(); });
  $("#snapToggle").addEventListener("change", (e)=>{ state.snap = e.target.checked; save(); });

  // ---------- Zoom ----------
  const applyZoom = () => {
    state.zoom = clamp(state.zoom, 0.3, 2.5);
    boardEl.style.transform = `scale(${state.zoom})`;
    zoomPctEl.textContent = `${Math.round(state.zoom*100)}%`;
  };
  $("#zoomIn").addEventListener("click", ()=>{ state.zoom += 0.1; applyZoom(); save(); });
  $("#zoomOut").addEventListener("click", ()=>{ state.zoom -= 0.1; applyZoom(); save(); });
  $("#zoomReset").addEventListener("click", ()=>{ state.zoom = 1; applyZoom(); save(); });
  boardOuterEl.addEventListener("wheel", (e)=>{
    if(!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    state.zoom += (e.deltaY > 0 ? -0.05 : 0.05);
    applyZoom();
    save();
  }, {passive:false});

  // ---------- Waiters ----------
  const addWaiter = (name) => {
    name = (name || "").trim();
    if(!name) return;
    state.waiters.unshift({ id: uid(), name, createdAt: now() });
    save();
    renderAll();
  };

  const editWaiter = (id) => {
    const w = state.waiters.find(x=>x.id===id);
    if(!w) return;
    const v = prompt("이름 수정", w.name);
    if(v == null) return;
    w.name = v.trim() || w.name;
    save(); renderAll();
  };

  const deleteWaiter = (id) => {
    // also unassign from any box
    state.boxes.forEach(b=>{
      if(b.assigned === id){ b.assigned = null; b.assignedAt = null; }
    });
    state.waiters = state.waiters.filter(w=>w.id!==id);
    save(); renderAll();
  };

  addWaitBtn.addEventListener("click", ()=> addWaiter(waitNameEl.value));
  waitNameEl.addEventListener("keydown", (e)=>{ if(e.key==="Enter") addWaiter(waitNameEl.value); });

  // ---------- Boxes ----------
  const addBox = (name) => {
    name = (name || "").trim();
    if(!name) return;
    const b = {
      id: uid(),
      name,
      x: 200 + state.boxes.length*40,
      y: 120 + state.boxes.length*40,
      color: "green",
      assigned: null,
      assignedAt: null,
      size: "m",
    };
    state.boxes.push(b);
    save(); renderAll();
  };

  const editBoxName = (boxId) => {
    const b = state.boxes.find(x=>x.id===boxId);
    if(!b) return;
    const v = prompt("BOX 이름 변경", b.name);
    if(v == null) return;
    b.name = v.trim() || b.name;
    save(); renderAll();
  };

  const deleteBox = (boxId) => {
    state.boxes = state.boxes.filter(b=>b.id!==boxId);
    state.selectedBoxIds = state.selectedBoxIds.filter(id=>id!==boxId);
    save(); renderAll();
  };

  addBoxBtn.addEventListener("click", ()=> addBox(boxNameEl.value));
  boxNameEl.addEventListener("keydown", (e)=>{ if(e.key==="Enter") addBox(boxNameEl.value); });

  const deleteSelectedBoxes = () => {
    if(!state.selectedBoxIds.length) return;
    if(!confirm(`선택된 박스 ${state.selectedBoxIds.length}개를 삭제할까요?`)) return;
    state.boxes = state.boxes.filter(b=>!state.selectedBoxIds.includes(b.id));
    state.selectedBoxIds = [];
    save(); renderAll();
  };
  $("#deleteSelected").addEventListener("click", deleteSelectedBoxes);

  // ---------- Align / distribute ----------
  const getSelectedBoxes = () => state.boxes.filter(b=>state.selectedBoxIds.includes(b.id));
  const alignH = () => {
    const sel = getSelectedBoxes(); if(sel.length < 2) return;
    const y = sel[0].y;
    sel.forEach(b=> b.y = y);
    save(); renderAll();
  };
  const alignV = () => {
    const sel = getSelectedBoxes(); if(sel.length < 2) return;
    const x = sel[0].x;
    sel.forEach(b=> b.x = x);
    save(); renderAll();
  };
  const distributeH = () => {
    const sel = getSelectedBoxes(); if(sel.length < 3) return;
    sel.sort((a,b)=>a.x-b.x);
    const minX = sel[0].x, maxX = sel[sel.length-1].x;
    const step = (maxX - minX) / (sel.length-1);
    sel.forEach((b,i)=> b.x = minX + step*i);
    save(); renderAll();
  };
  const distributeV = () => {
    const sel = getSelectedBoxes(); if(sel.length < 3) return;
    sel.sort((a,b)=>a.y-b.y);
    const minY = sel[0].y, maxY = sel[sel.length-1].y;
    const step = (maxY - minY) / (sel.length-1);
    sel.forEach((b,i)=> b.y = minY + step*i);
    save(); renderAll();
  };
  $("#alignH").addEventListener("click", alignH);
  $("#alignV").addEventListener("click", alignV);
  $("#distributeH").addEventListener("click", distributeH);
  $("#distributeV").addEventListener("click", distributeV);

  // ---------- Assign / Unassign ----------
  const unassignBoxToWaitTop = (box) => {
    if(!box.assigned) return;
    const w = findWaiterAny(box.assigned);
    // if assigned waiter object is not in waiters (likely), reconstruct from assigned cache stored on box
    const waiterObj = w || { id: box.assigned, name: box.assignedName || "이름", createdAt: now() };
    // prevent duplicates: remove if exists in waiters
    state.waiters = state.waiters.filter(x=>x.id!==waiterObj.id);
    state.waiters.unshift({ ...waiterObj, createdAt: now() });
    box.assigned = null;
    box.assignedAt = null;
    box.assignedName = null;
  };

  const findWaiterAny = (waiterId) => state.waiters.find(w=>w.id===waiterId) || null;

  const assignWaiterToBox = (waiterId, boxId) => {
    const box = state.boxes.find(b=>b.id===boxId);
    if(!box) return;

    // locate waiter in wait list
    let wIdx = state.waiters.findIndex(w=>w.id===waiterId);
    let waiter = wIdx>=0 ? state.waiters[wIdx] : null;

    // fallback: if drag passed name only
    if(!waiter){
      // try match by name string
      const byNameIdx = state.waiters.findIndex(w=>w.name===String(waiterId));
      if(byNameIdx>=0){ wIdx = byNameIdx; waiter = state.waiters[byNameIdx]; }
    }
    if(!waiter) return;

    // IMPORTANT: remove dragged waiter first (avoid index shift bug)
    state.waiters.splice(wIdx, 1);

    // move previous assigned to wait top
    if(box.assigned){
      const prev = { id: box.assigned, name: box.assignedName || "이름", createdAt: now() };
      state.waiters = state.waiters.filter(x=>x.id!==prev.id);
      state.waiters.unshift(prev);
    }

    box.assigned = waiter.id;
    box.assignedName = waiter.name;
    box.assignedAt = now();

    save(); renderAll();
  };

  const sendBoxToWait = (boxId) => {
    const box = state.boxes.find(b=>b.id===boxId);
    if(!box || !box.assigned) return;
    const prev = { id: box.assigned, name: box.assignedName || "이름", createdAt: now() };
    state.waiters = state.waiters.filter(x=>x.id!==prev.id);
    state.waiters.unshift(prev);
    box.assigned = null;
    box.assignedAt = null;
    box.assignedName = null;
    save(); renderAll();
  };

  // ---------- Drag data ----------
  const DRAG_MIME = "text/plain";
  let dragWaiterId = null;

  const attachWaiterDrag = (el, waiterId) => {
    el.draggable = true;
    el.addEventListener("dragstart", (e)=>{
      dragWaiterId = waiterId;
      e.dataTransfer.setData(DRAG_MIME, waiterId);
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", ()=>{
      dragWaiterId = null;
    });
  };

  // ---------- Box drag/multi-select ----------
  let dragMode = null; // {startX, startY, origin: Map(id->{x,y})}
  const onBoxPointerDown = (e, boxId) => {
    // ignore button clicks
    if(e.target.closest("button")) return;

    const isShift = e.shiftKey;
    const already = state.selectedBoxIds.includes(boxId);

    if(isShift){
      if(already) state.selectedBoxIds = state.selectedBoxIds.filter(id=>id!==boxId);
      else state.selectedBoxIds.push(boxId);
    }else{
      if(!already) state.selectedBoxIds = [boxId];
    }
    renderBoxesOnly();

    const pt = getBoardPoint(e);
    const origin = new Map();
    state.selectedBoxIds.forEach(id=>{
      const b = state.boxes.find(x=>x.id===id);
      if(b) origin.set(id, {x:b.x, y:b.y});
    });
    dragMode = { startX: pt.x, startY: pt.y, origin };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, {once:true});
  };

  const getBoardPoint = (e) => {
    const rect = boardEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / state.zoom;
    const y = (e.clientY - rect.top) / state.zoom;
    return {x,y};
  };

  const onPointerMove = (e) => {
    if(!dragMode) return;
    const pt = getBoardPoint(e);
    const dx = pt.x - dragMode.startX;
    const dy = pt.y - dragMode.startY;
    dragMode.origin.forEach((o, id)=>{
      const b = state.boxes.find(x=>x.id===id);
      if(!b) return;
      let nx = o.x + dx;
      let ny = o.y + dy;
      if(state.snap){
        nx = snapTo(nx, 40);
        ny = snapTo(ny, 40);
      }
      b.x = nx; b.y = ny;
    });
    renderBoxesOnly();
  };

  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    dragMode = null;
    save();
  };

  // ---------- Render ----------
  const filterText = (s) => (s||"").trim().toLowerCase();

  const renderWait = () => {
    const q = filterText(waitSearchEl.value);
    waitListEl.innerHTML = "";
    state.waiters
      .filter(w => !q || w.name.toLowerCase().includes(q))
      .forEach(w=>{
        const item = document.createElement("div");
        item.className = "item waitItem";
        item.dataset.waiterId = w.id;

        const left = document.createElement("div");
        left.className = "waitLine";

        const name = document.createElement("div");
        name.className = "waitName";
        name.textContent = w.name;

        const time = document.createElement("div");
        time.className = "waitTime";
        time.dataset.t = "wait";
        time.dataset.createdAt = String(w.createdAt);
        time.textContent = `대기 ${fmt(now()-w.createdAt)}`;

        left.appendChild(name);
        left.appendChild(time);

        const actions = document.createElement("div");
        actions.className = "itemActions";

        const editBtn = document.createElement("button");
        editBtn.className = "itemBtn";
        editBtn.textContent = "수정";
        editBtn.addEventListener("click", (e)=>{ e.stopPropagation(); editWaiter(w.id); });

        const delBtn = document.createElement("button");
        delBtn.className = "itemBtn danger";
        delBtn.textContent = "삭제";
        delBtn.addEventListener("click", (e)=>{ e.stopPropagation(); deleteWaiter(w.id); });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        item.appendChild(left);
        item.appendChild(actions);

        attachWaiterDrag(item, w.id);

        waitListEl.appendChild(item);
      });
  };

  const getAssignedRows = () => {
    const rows = [];
    state.boxes.forEach(b=>{
      if(!b.assigned) return;
      rows.push({
        boxId: b.id,
        boxName: b.name,
        waiterId: b.assigned,
        name: b.assignedName || "이름",
        assignedAt: b.assignedAt || now(),
      });
    });
    return rows;
  };

  const renderAssigned = () => {
    const q = filterText(assignedSearchEl.value);
    assignedListEl.innerHTML = "";
    const rows = getAssignedRows()
      .filter(r => !q || (r.name + " " + r.boxName).toLowerCase().includes(q));

    rows.forEach(r=>{
      const item = document.createElement("div");
      item.className = "item clickable";
      item.addEventListener("click", ()=> focusBox(r.boxId));

      const left = document.createElement("div");
      left.className = "waitLine";

      const nm = document.createElement("div");
      nm.className = "waitName";
      nm.textContent = `${r.name} · ${r.boxName}`;

      const tm = document.createElement("div");
      tm.className = "waitTime";
      tm.dataset.t = "assigned";
      tm.dataset.assignedAt = String(r.assignedAt);
      tm.textContent = `배치 ${fmt(now()-r.assignedAt)}`;

      left.appendChild(nm);
      left.appendChild(tm);

      item.appendChild(left);
      assignedListEl.appendChild(item);
    });
  };

  const renderBoxList = () => {
    const q = filterText(boxSearchEl.value);
    boxListEl.innerHTML = "";
    state.boxes
      .filter(b => !q || b.name.toLowerCase().includes(q))
      .forEach(b=>{
        const item = document.createElement("div");
        item.className = "item clickable";
        item.addEventListener("click", ()=> focusBox(b.id));

        const left = document.createElement("div");
        left.className = "waitLine";

        const nm = document.createElement("div");
        nm.className = "waitName";
        nm.textContent = b.name;

        const tm = document.createElement("div");
        tm.className = "waitTime";
        tm.textContent = b.assigned ? "진행중" : "비어있음";

        left.appendChild(nm);
        left.appendChild(tm);

        item.appendChild(left);
        boxListEl.appendChild(item);
      });
  };

  const focusBox = (boxId) => {
    const el = boardEl.querySelector(`.box[data-box-id="${boxId}"]`);
    if(!el) return;
    el.classList.add("highlight");
    setTimeout(()=> el.classList.remove("highlight"), 1600);

    // scroll into view inside boardOuter
    const rect = el.getBoundingClientRect();
    const outerRect = boardOuterEl.getBoundingClientRect();
    const dx = rect.left - outerRect.left - outerRect.width/2 + rect.width/2;
    const dy = rect.top - outerRect.top - outerRect.height/2 + rect.height/2;
    boardOuterEl.scrollBy({ left: dx, top: dy, behavior: "smooth" });
  };

  const makeBoxEl = (b) => {
    const box = document.createElement("div");
    box.className = "box";
    box.dataset.boxId = b.id;
    box.dataset.color = b.color || "green";
    box.dataset.size = b.size || "m";
    box.style.setProperty("--x", `${b.x}px`);
    box.style.setProperty("--y", `${b.y}px`);
    box.classList.toggle("selected", state.selectedBoxIds.includes(b.id));

    // drag over
    box.addEventListener("dragover", (e)=>{ e.preventDefault(); box.classList.add("dropOver"); });
    box.addEventListener("dragleave", ()=> box.classList.remove("dropOver"));
    box.addEventListener("drop", (e)=>{
      e.preventDefault();
      box.classList.remove("dropOver");
      const data = e.dataTransfer.getData(DRAG_MIME) || dragWaiterId;
      if(!data) return;
      assignWaiterToBox(data, b.id);
      dragWaiterId = null;
    });

    // pointer down for moving/selection
    box.addEventListener("pointerdown", (e)=> onBoxPointerDown(e, b.id));

    const inner = document.createElement("div");
    inner.className = "boxInner";

    const wm = document.createElement("div");
    wm.className = "boxWatermark";
    wm.textContent = b.name;

    const right = document.createElement("div");
    right.className = "boxRightPane";

    const actions = document.createElement("div");
    actions.className = "boxActions";

    const editBtn = document.createElement("button");
    editBtn.className = "iconBtn";
    editBtn.title = "BOX 이름 수정";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", (e)=>{ e.stopPropagation(); editBoxName(b.id); });

    const delBtn = document.createElement("button");
    delBtn.className = "iconBtn";
    delBtn.title = "BOX 삭제";
    delBtn.textContent = "🗑️";
    delBtn.addEventListener("click", (e)=>{ e.stopPropagation(); if(confirm("이 BOX를 삭제할까요?")) deleteBox(b.id); });

    if(b.assigned){
      const toWait = document.createElement("button");
      toWait.className = "actionBtn";
      toWait.textContent = "대기로";
      toWait.title = "대기로 보내기";
      toWait.addEventListener("click", (e)=>{ e.stopPropagation(); sendBoxToWait(b.id); });
      actions.appendChild(toWait);
    }

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    const resizeBtn = document.createElement("button");
    resizeBtn.className = "resizeBtn";
    resizeBtn.title = "박스 크기 변경";
    resizeBtn.textContent = "⤢";
    resizeBtn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const order = ["s","m","l"];
      const cur = (b.size || "m");
      const idx = order.indexOf(cur);
      const next = order[(idx<0?1:idx+1)%order.length];
      b.size = next;
      save();
      renderBoxesOnly();
    });

    const slot = document.createElement("div");
    slot.className = "slot";

    if(b.assigned){
      const left = document.createElement("div");
      left.className = "slotLeft";

      const nm = document.createElement("div");
      nm.className = "slotName";
      nm.textContent = b.assignedName || "이름";
      nm.addEventListener("dblclick", (e)=>{ e.stopPropagation(); sendBoxToWait(b.id); });

      const row = document.createElement("div");
      row.className = "slotTimeRow";

      const pill = document.createElement("div");
      pill.className = "timePill";
      pill.dataset.t = "boxAssigned";
      pill.dataset.assignedAt = String(b.assignedAt || now());
      pill.textContent = fmt(now() - (b.assignedAt || now()));

      const lbl = document.createElement("div");
      lbl.className = "timeLabel";
      lbl.textContent = "배치 시간";

      row.appendChild(pill);
      row.appendChild(lbl);

      left.appendChild(nm);
      left.appendChild(row);
      slot.appendChild(left);
    }else{
      const hint = document.createElement("div");
      hint.className = "dropHint";
      hint.textContent = "대기를 드래그해서 여기에 드롭";
      slot.appendChild(hint);
    }

    right.appendChild(actions);
    right.appendChild(slot);
    right.appendChild(resizeBtn);

    inner.appendChild(wm);
    inner.appendChild(right);
    box.appendChild(inner);
    return box;
  };

  const renderBoxesOnly = () => {
    // update box elements in place if possible
    const existing = new Map();
    $$(".box", boardEl).forEach(el => existing.set(el.dataset.boxId, el));

    // remove gone
    existing.forEach((el, id)=>{
      if(!state.boxes.some(b=>b.id===id)) el.remove();
    });

    // add/update
    state.boxes.forEach(b=>{
      const el = existing.get(b.id) || makeBoxEl(b);
      if(!existing.get(b.id)) boardEl.appendChild(el);
      el.style.setProperty("--x", `${b.x}px`);
      el.style.setProperty("--y", `${b.y}px`);
      el.dataset.color = b.color || "green";
      el.dataset.size = b.size || "m";
      el.classList.toggle("selected", state.selectedBoxIds.includes(b.id));

      // update watermark text if name changed
      const wm = $(".boxWatermark", el);
      if(wm && wm.textContent !== b.name) wm.textContent = b.name;

      // update assigned area if assignment changed: easiest rebuild slot
      const slot = $(".slot", el);
      const hasAssignedDom = !!$(".slotName", el);
      if(!!b.assigned !== hasAssignedDom){
        // rebuild whole box element for simplicity
        el.replaceWith(makeBoxEl(b));
      }else{
        // update name/timer
        const nm = $(".slotName", el);
        if(nm && nm.textContent !== (b.assignedName||"이름")) nm.textContent = b.assignedName||"이름";
        const pill = $('[data-t="boxAssigned"]', el);
        if(pill) pill.dataset.assignedAt = String(b.assignedAt || now());
      }
    });
  };

  const renderAll = () => {
    renderWait();
    renderAssigned();
    renderBoxList();
    renderBoxesOnly();
    applyGridSnapUI();
    applyZoom();
    layoutEl.classList.toggle("sideCollapsed", state.sideCollapsed);
  };

  // ---------- live timers (no rerender) ----------
  const tick = () => {
    const t = now();
    // wait list
    $$('[data-t="wait"]').forEach(el=>{
      const c = Number(el.dataset.createdAt||t);
      el.textContent = `대기 ${fmt(t - c)}`;
    });
    // assigned list
    $$('[data-t="assigned"]').forEach(el=>{
      const a = Number(el.dataset.assignedAt||t);
      el.textContent = `배치 ${fmt(t - a)}`;
    });
    // box assigned pills
    $$('[data-t="boxAssigned"]').forEach(el=>{
      const a = Number(el.dataset.assignedAt||t);
      el.textContent = fmt(t - a);
    });
  };

  // ---------- listeners for search ----------
  waitSearchEl.addEventListener("input", renderWait);
  assignedSearchEl.addEventListener("input", renderAssigned);
  boxSearchEl.addEventListener("input", renderBoxList);

  // ---------- init ----------
  load();

  // ensure default boxes if empty (optional)
  if(state.boxes.length === 0){
    ["1","2","3","4","5"].forEach((n,i)=>{
      state.boxes.push({ id: uid(), name:n, x: 200 + i*620, y: 140, color:"green", assigned:null, assignedAt:null });
    });
  }

  renderAll();
  setInterval(tick, 1000);

})();
