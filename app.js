/* Box Board app.js - no chunks, no external deps
   Build: 20260103-perfect
*/
(() => {
  "use strict";

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // Elements (must exist in index.html)
  const sidePanel = $("#sidePanel");
  const toggleSideBtn = $("#toggleSide");

  const tabWait = $("#tabWait");
  const tabAssigned = $("#tabAssigned");
  const tabBoxes = $("#tabBoxes");
  const panels = $$(".panel");

  const nameInput = $("#nameInput");
  const addWaitBtn = $("#addWait");
  const searchInput = $("#searchInput");

  const waitListEl = $("#waitList");
  const assignedListEl = $("#assignedList");

  const addBoxBtn = $("#addBox");
  const deleteSelectedBtn = $("#deleteSelected");

  const alignHBtn = $("#alignH");
  const alignVBtn = $("#alignV");
  const spaceHBtn = $("#spaceH");
  const spaceVBtn = $("#spaceV");
  const selectModeBtn = $("#selectMode");

  const zoomOutBtn = $("#zoomOut");
  const zoomInBtn = $("#zoomIn");
  const zoomResetBtn = $("#zoomReset");
  const zoomPctEl = $("#zoomPct");

  const saveStatusEl = $("#saveStatus");

  const canvas = $("#canvas");
  const boxesLayer = $("#boxesLayer");

  // State
  const STORAGE_KEY = "boxboard_state_v1";
  const now = () => Date.now();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const fmtTime = (ms) => {
    ms = Math.max(0, ms|0);
    const s = Math.floor(ms/1000);
    const hh = String(Math.floor(s/3600)).padStart(2,"0");
    const mm = String(Math.floor((s%3600)/60)).padStart(2,"0");
    const ss = String(s%60).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  };

  const uid = () => Math.random().toString(36).slice(2, 10);

  const defaultState = () => ({
    zoom: 1,
    selectMode: false,
    wait: [],
    boxes: [
      { id: "b1", n: 1, x: 70, y: 40, w: 220, h: 120, assigned: null },
      { id: "b2", n: 2, x: 330, y: 40, w: 220, h: 120, assigned: null },
      { id: "b3", n: 9, x: 590, y: 40, w: 220, h: 120, assigned: null },
    ],
    selectedBoxIds: []
  });

  let state = loadState() ?? defaultState();

  // ---- Save (debounced) ----
  let saveTimer = null;
  function markSaving() {
    if (!saveStatusEl) return;
    saveStatusEl.textContent = "저장중…";
    saveStatusEl.style.opacity = "1";
  }
  function markSaved() {
    if (!saveStatusEl) return;
    saveStatusEl.textContent = "저장됨";
  }
  function saveStateNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      markSaved();
    } catch (e) {
      // storage full or blocked; ignore but keep app running
      if (saveStatusEl) saveStatusEl.textContent = "저장 실패";
    }
  }
  function saveStateDebounced() {
    markSaving();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveStateNow, 250);
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object") return null;
      return s;
    } catch {
      return null;
    }
  }

  // ---- UI helpers ----
  function setTab(name){
    // tabs
    [tabWait, tabAssigned, tabBoxes].forEach(t => t?.classList.remove("active"));
    if (name === "wait") tabWait?.classList.add("active");
    if (name === "assigned") tabAssigned?.classList.add("active");
    if (name === "boxes") tabBoxes?.classList.add("active");

    // panels
    panels.forEach(p => {
      const match = p.getAttribute("data-panel") === name;
      p.classList.toggle("hidden", !match);
    });
  }

  function setZoom(z){
    state.zoom = clamp(z, 0.3, 2.5);
    canvas.style.transform = `scale(${state.zoom})`;
    if (zoomPctEl) zoomPctEl.textContent = `${Math.round(state.zoom*100)}%`;
    saveStateDebounced();
  }

  function toggleSidebar(){
    sidePanel.classList.toggle("collapsed");
  }

  function setSelectMode(on){
    state.selectMode = !!on;
    selectModeBtn?.classList.toggle("active", state.selectMode);
    saveStateDebounced();
  }

  // ---- Wait list operations ----
  function addWait(name){
    name = (name ?? "").trim();
    if (!name) return;
    state.wait.unshift({
      id: uid(),
      name,
      waitStart: now()
    });
    saveStateDebounced();
    renderAll();
  }

  function removeWait(id){
    state.wait = state.wait.filter(p => p.id !== id);
    saveStateDebounced();
    renderAll();
  }

  function moveAssignedToWait(assigned){
    if (!assigned) return;
    // assigned has: {id,name,assignedAt}
    state.wait.unshift({ id: uid(), name: assigned.name, waitStart: now() });
  }

  // ---- Box operations ----
  function nextBoxNumber(){
    const nums = state.boxes.map(b => b.n);
    let n = 1;
    while(nums.includes(n)) n++;
    return n;
  }
  function addBox(){
    const n = nextBoxNumber();
    state.boxes.push({
      id: `b_${uid()}`,
      n,
      x: 80 + (state.boxes.length%5)*260,
      y: 220 + Math.floor(state.boxes.length/5)*160,
      w: 220,
      h: 120,
      assigned: null
    });
    saveStateDebounced();
    renderAll();
  }

  function deleteSelectedBoxes(){
    const set = new Set(state.selectedBoxIds);
    if (set.size === 0) return;
    // return assigned to wait
    for (const b of state.boxes){
      if (set.has(b.id) && b.assigned){
        moveAssignedToWait(b.assigned);
      }
    }
    state.boxes = state.boxes.filter(b => !set.has(b.id));
    state.selectedBoxIds = [];
    saveStateDebounced();
    renderAll();
  }

  function toggleBoxSelected(boxId, force){
    const set = new Set(state.selectedBoxIds);
    const has = set.has(boxId);
    if (force === true) set.add(boxId);
    else if (force === false) set.delete(boxId);
    else {
      if (has) set.delete(boxId); else set.add(boxId);
    }
    state.selectedBoxIds = Array.from(set);
    saveStateDebounced();
    renderBoxes();
  }

  function clearSelection(){
    if (state.selectedBoxIds.length === 0) return;
    state.selectedBoxIds = [];
    saveStateDebounced();
    renderBoxes();
  }

  function assignToBox(personId, boxId){
    const person = state.wait.find(p => p.id === personId);
    const box = state.boxes.find(b => b.id === boxId);
    if (!person || !box) return;

    // if box occupied, push that person back to wait
    if (box.assigned){
      moveAssignedToWait(box.assigned);
    }
    // assign new
    box.assigned = { name: person.name, assignedAt: now() };
    // remove from wait
    state.wait = state.wait.filter(p => p.id !== personId);

    saveStateDebounced();
    renderAll();
  }

  function unassignBox(boxId){
    const box = state.boxes.find(b => b.id === boxId);
    if (!box || !box.assigned) return;
    moveAssignedToWait(box.assigned);
    box.assigned = null;
    saveStateDebounced();
    renderAll();
  }

  // ---- Arrange operations ----
  function getSelectedBoxes(){
    const set = new Set(state.selectedBoxIds);
    return state.boxes.filter(b => set.has(b.id));
  }

  function alignHorizontal(){
    const sel = getSelectedBoxes();
    if (sel.length < 2) return;
    const avgY = Math.round(sel.reduce((a,b)=>a+b.y,0)/sel.length);
    sel.forEach(b => b.y = avgY);
    saveStateDebounced();
    renderBoxes();
  }
  function alignVertical(){
    const sel = getSelectedBoxes();
    if (sel.length < 2) return;
    const avgX = Math.round(sel.reduce((a,b)=>a+b.x,0)/sel.length);
    sel.forEach(b => b.x = avgX);
    saveStateDebounced();
    renderBoxes();
  }

  function distributeHorizontal(){
    const sel = getSelectedBoxes().slice().sort((a,b)=>a.x-b.x);
    if (sel.length < 3) return;
    const left = sel[0].x;
    const right = sel[sel.length-1].x;
    const step = (right-left)/(sel.length-1);
    sel.forEach((b,i)=> b.x = Math.round(left + step*i));
    saveStateDebounced();
    renderBoxes();
  }
  function distributeVertical(){
    const sel = getSelectedBoxes().slice().sort((a,b)=>a.y-b.y);
    if (sel.length < 3) return;
    const top = sel[0].y;
    const bottom = sel[sel.length-1].y;
    const step = (bottom-top)/(sel.length-1);
    sel.forEach((b,i)=> b.y = Math.round(top + step*i));
    saveStateDebounced();
    renderBoxes();
  }

  // ---- Rendering ----
  function renderWait(){
    if (!waitListEl) return;
    const q = (searchInput?.value ?? "").trim().toLowerCase();
    const list = q ? state.wait.filter(p => p.name.toLowerCase().includes(q)) : state.wait;

    waitListEl.innerHTML = "";
    for (const p of list){
      const el = document.createElement("div");
      el.className = "item";
      el.draggable = true;
      el.dataset.id = p.id;

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "chk";

      const badge = document.createElement("div");
      badge.className = "nameBadge";
      badge.textContent = p.name;

      const pill = document.createElement("div");
      pill.className = "pill";
      pill.innerHTML = `<span class="label">대기</span><span class="time" data-timer="wait" data-id="${p.id}">00:00:00</span>`;

      const del = document.createElement("button");
      del.className = "itemBtn";
      del.textContent = "삭제";
      del.addEventListener("click", () => removeWait(p.id));

      el.addEventListener("dragstart", (e)=>{
        el.classList.add("dragging");
        e.dataTransfer?.setData("text/plain", p.id);
      });
      el.addEventListener("dragend", ()=>{
        el.classList.remove("dragging");
      });

      el.append(chk, badge, pill, del);
      waitListEl.appendChild(el);
    }
  }

  function renderAssignedList(){
    if (!assignedListEl) return;
    assignedListEl.innerHTML = "";
    const assigned = state.boxes
      .filter(b => b.assigned)
      .map(b => ({ boxN: b.n, boxId: b.id, name: b.assigned.name, assignedAt: b.assigned.assignedAt }))
      .sort((a,b)=>a.boxN-b.boxN);

    for (const a of assigned){
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="nameBadge">${a.boxN}</div>
        <div class="pill" style="border-color: rgba(74,163,255,.45); background: rgba(74,163,255,.12)">
          <span class="label">${a.name}</span>
          <span class="time" data-timer="assigned" data-box="${a.boxId}">00:00:00</span>
        </div>
        <button class="itemBtn">대기</button>
      `;
      const btn = $("button", el);
      btn.addEventListener("click", ()=> unassignBox(a.boxId));

      // dblclick name area also
      el.addEventListener("dblclick", ()=> unassignBox(a.boxId));

      assignedListEl.appendChild(el);
    }
  }

  function boxElement(box){
    const el = document.createElement("div");
    el.className = "box";
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
    el.dataset.id = box.id;

    if (state.selectedBoxIds.includes(box.id)) el.classList.add("selected");

    const num = document.createElement("div");
    num.className = "boxNumber";
    num.textContent = String(box.n);

    const tools = document.createElement("div");
    tools.className = "boxTools";
    tools.innerHTML = `
      <div class="toolDot" title="대기">↩</div>
      <div class="toolDot" title="비우기">×</div>
    `;
    const [backBtn, clearBtn] = $$(".toolDot", tools);

    backBtn.addEventListener("click", (e)=>{
      e.stopPropagation();
      unassignBox(box.id);
    });
    clearBtn.addEventListener("click", (e)=>{
      e.stopPropagation();
      box.assigned = null;
      saveStateDebounced();
      renderAll();
    });

    const inner = document.createElement("div");
    inner.className = "boxInner";
    inner.innerHTML = `
      <div class="seatPill">
        <span class="seatName">${box.assigned ? box.assigned.name : "비어있음"}</span>
        <span class="seatTime" data-timer="box" data-box="${box.id}">${box.assigned ? "00:00:00" : ""}</span>
      </div>
    `;

    const resize = document.createElement("div");
    resize.className = "resizeHandle";
    resize.title = "크기 조절";

    // Drop support for wait items
    el.addEventListener("dragover", (e)=>{
      e.preventDefault();
    });
    el.addEventListener("drop", (e)=>{
      e.preventDefault();
      const pid = e.dataTransfer?.getData("text/plain");
      if (pid) assignToBox(pid, box.id);
    });

    // Selection
    el.addEventListener("click", (e)=>{
      const isSelectIntent = state.selectMode || e.shiftKey;
      if (isSelectIntent){
        toggleBoxSelected(box.id);
        e.stopPropagation();
      } else {
        clearSelection();
      }
    });

    // dblclick inside to return to wait
    el.addEventListener("dblclick", (e)=>{
      e.stopPropagation();
      unassignBox(box.id);
    });

    // Move box by pointer drag (but not on resize handle)
    let drag = null;

    function safeSetPointerCapture(target, pointerId){
      try {
        if (target?.setPointerCapture) target.setPointerCapture(pointerId);
      } catch {}
    }
    function safeReleasePointerCapture(target, pointerId){
      try {
        if (target?.releasePointerCapture) target.releasePointerCapture(pointerId);
      } catch {}
    }

    el.addEventListener("pointerdown", (e)=>{
      if (e.button !== 0) return;
      if (e.target === resize) return; // resize handle handles its own
      if (state.selectMode || e.shiftKey) return; // selection click shouldn't drag

      drag = {
        pid: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origX: box.x,
        origY: box.y
      };
      safeSetPointerCapture(el, e.pointerId);
    });

    window.addEventListener("pointermove", (e)=>{
      if (!drag) return;
      if (e.pointerId !== drag.pid) return;
      const dx = (e.clientX - drag.startX)/state.zoom;
      const dy = (e.clientY - drag.startY)/state.zoom;
      box.x = Math.round(drag.origX + dx);
      box.y = Math.round(drag.origY + dy);
      el.style.left = `${box.x}px`;
      el.style.top = `${box.y}px`;
    });

    window.addEventListener("pointerup", (e)=>{
      if (!drag) return;
      if (e.pointerId !== drag.pid) return;
      safeReleasePointerCapture(el, e.pointerId);
      drag = null;
      saveStateDebounced();
      renderAssignedList(); // positions only need box render, but cheap
    });

    // Resize handle
    let resizing = null;
    resize.addEventListener("pointerdown", (e)=>{
      e.stopPropagation();
      resizing = {
        pid: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origW: box.w,
        origH: box.h
      };
      safeSetPointerCapture(resize, e.pointerId);
    });

    window.addEventListener("pointermove", (e)=>{
      if (!resizing) return;
      if (e.pointerId !== resizing.pid) return;
      const dx = (e.clientX - resizing.startX)/state.zoom;
      const dy = (e.clientY - resizing.startY)/state.zoom;
      box.w = Math.round(clamp(resizing.origW + dx, 160, 520));
      box.h = Math.round(clamp(resizing.origH + dy, 90, 360));
      el.style.width = `${box.w}px`;
      el.style.height = `${box.h}px`;
    });

    window.addEventListener("pointerup", (e)=>{
      if (!resizing) return;
      if (e.pointerId !== resizing.pid) return;
      safeReleasePointerCapture(resize, e.pointerId);
      resizing = null;
      saveStateDebounced();
    });

    el.append(num, tools, inner, resize);
    return el;
  }

  function renderBoxes(){
    if (!boxesLayer) return;
    boxesLayer.innerHTML = "";
    for (const b of state.boxes){
      boxesLayer.appendChild(boxElement(b));
    }
  }

  function renderAll(){
    renderWait();
    renderBoxes();
    renderAssignedList();
    // reflect select mode state
    setSelectMode(state.selectMode);
    // reflect zoom
    setZoom(state.zoom);
  }

  // ---- Timers ----
  function tickTimers(){
    // wait timers
    $$('[data-timer="wait"]').forEach(el=>{
      const id = el.getAttribute("data-id");
      const p = state.wait.find(x => x.id === id);
      if (!p) return;
      el.textContent = fmtTime(now() - p.waitStart);
    });
    // assigned list timers
    $$('[data-timer="assigned"]').forEach(el=>{
      const boxId = el.getAttribute("data-box");
      const b = state.boxes.find(x => x.id === boxId);
      if (!b?.assigned) return;
      el.textContent = fmtTime(now() - b.assigned.assignedAt);
    });
    // box seat timers
    $$('[data-timer="box"]').forEach(el=>{
      const boxId = el.getAttribute("data-box");
      const b = state.boxes.find(x => x.id === boxId);
      if (!b?.assigned) {
        el.textContent = "";
        return;
      }
      el.textContent = fmtTime(now() - b.assigned.assignedAt);
    });
  }

  // ---- Events wiring ----
  function wire(){
    // Tabs
    tabWait?.addEventListener("click", ()=>setTab("wait"));
    tabAssigned?.addEventListener("click", ()=>setTab("assigned"));
    tabBoxes?.addEventListener("click", ()=>setTab("boxes"));

    // Sidebar toggle
    toggleSideBtn?.addEventListener("click", toggleSidebar);

    // Add wait
    addWaitBtn?.addEventListener("click", ()=>{
      addWait(nameInput.value);
      nameInput.value = "";
      nameInput.focus();
    });
    nameInput?.addEventListener("keydown", (e)=>{
      if (e.key === "Enter"){
        addWait(nameInput.value);
        nameInput.value = "";
      }
    });

    // Search
    searchInput?.addEventListener("input", renderWait);

    // Add box / delete selected
    addBoxBtn?.addEventListener("click", addBox);
    deleteSelectedBtn?.addEventListener("click", deleteSelectedBoxes);

    // Arrange
    alignHBtn?.addEventListener("click", alignHorizontal);
    alignVBtn?.addEventListener("click", alignVertical);
    spaceHBtn?.addEventListener("click", distributeHorizontal);
    spaceVBtn?.addEventListener("click", distributeVertical);

    // Select mode
    selectModeBtn?.addEventListener("click", ()=> setSelectMode(!state.selectMode));

    // Zoom buttons
    zoomOutBtn?.addEventListener("click", ()=> setZoom(state.zoom - 0.05));
    zoomInBtn?.addEventListener("click", ()=> setZoom(state.zoom + 0.05));
    zoomResetBtn?.addEventListener("click", ()=> setZoom(1));

    // Wheel zoom (ctrl/cmd)
    $("#appRoot")?.addEventListener("wheel", (e)=>{
      const isZoom = e.ctrlKey || e.metaKey;
      if (!isZoom) return;
      e.preventDefault();
      const delta = e.deltaY;
      const step = delta > 0 ? -0.05 : 0.05;
      setZoom(state.zoom + step);
    }, { passive:false });

    // Keyboard shortcuts
    window.addEventListener("keydown", (e)=>{
      if (e.key === "Tab"){
        e.preventDefault();
        toggleSidebar();
      }
      if (e.key === "Delete" || e.key === "Backspace"){
        // avoid deleting while typing
        const tag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        deleteSelectedBoxes();
      }
      if ((e.key === "+" || e.key === "=") && (e.ctrlKey || e.metaKey)){
        e.preventDefault();
        setZoom(state.zoom + 0.05);
      }
      if (e.key === "-" && (e.ctrlKey || e.metaKey)){
        e.preventDefault();
        setZoom(state.zoom - 0.05);
      }
      if (e.key === "Escape"){
        clearSelection();
      }
    });

    // Click empty canvas clears selection
    boxesLayer?.addEventListener("click", (e)=>{
      if (e.target === boxesLayer) clearSelection();
    });
  }

  // Init
  function init(){
    // ensure side panel not collapsed unexpectedly
    setTab("wait");
    setZoom(state.zoom || 1);
    setSelectMode(!!state.selectMode);

    wire();
    renderAll();
    tickTimers();
    setInterval(tickTimers, 250);

    // Debug marker: helps confirm latest app.js loaded
    console.log("[BoxBoard] build 20260103-perfect loaded");
  }

  init();
})();
