// Box Board Stable 2.2
(() => {
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const els = {
    layout: $("#layout"),
    side: $("#side"),
    toggleSide: $("#toggleSide"),
    tabs: $$(".tab"),
    panels: $$(".tabPanel"),

    waitName: $("#waitName"),
    addWait: $("#addWait"),
    waitSearch: $("#waitSearch"),
    waitList: $("#waitList"),

    assignedSearch: $("#assignedSearch"),
    assignedList: $("#assignedList"),

    boxName: $("#boxName"),
    addBox: $("#addBox"),
    boxSearch: $("#boxSearch"),
    boxList: $("#boxList"),

    boardOuter: $("#boardOuter"),
    board: $("#board"),
    grid: $("#grid"),

    zoomOut: $("#zoomOut"),
    zoomIn: $("#zoomIn"),
    zoomReset: $("#zoomReset"),
    zoomPct: $("#zoomPct"),

    gridToggle: $("#gridToggle"),
    saveHint: $("#saveHint"),

    alignH: $("#alignH"),
    alignV: $("#alignV"),
    distributeH: $("#distributeH"),
    distributeV: $("#distributeV"),
    deleteSelected: $("#deleteSelected"),
  };

  const STORAGE_KEY = "boxBoard_stable_2_2";
  const now = () => Date.now();
  const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : String(now()) + Math.random().toString(16).slice(2));

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function fmt(ms){
    const s = Math.max(0, Math.floor(ms/1000));
    const hh = String(Math.floor(s/3600)).padStart(2,"0");
    const mm = String(Math.floor((s%3600)/60)).padStart(2,"0");
    const ss = String(s%60).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  }

  let state = {
    zoom: 1,
    gridOn: true,
    waiters: [],
    boxes: [],
    selectedBoxIds: [],
  };

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        state = { ...state, ...parsed };
      }
    }catch(e){}
    state.zoom = clamp(Number(state.zoom)||1, 0.25, 2.5);
    state.gridOn = state.gridOn !== false;
    if(!Array.isArray(state.waiters)) state.waiters = [];
    if(!Array.isArray(state.boxes)) state.boxes = [];
    if(!Array.isArray(state.selectedBoxIds)) state.selectedBoxIds = [];
  }

  let saveT = null;
  function flashSaved(){
    els.saveHint.textContent = "저장됨";
    els.saveHint.style.opacity = "0.9";
    clearTimeout(saveT);
    saveT = setTimeout(()=>{ els.saveHint.style.opacity = "0.65"; }, 800);
  }
  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      zoom: state.zoom,
      gridOn: state.gridOn,
      waiters: state.waiters,
      boxes: state.boxes,
      selectedBoxIds: state.selectedBoxIds,
    }));
    flashSaved();
  }

  function setZoom(z){
    state.zoom = clamp(z, 0.25, 2.5);
    els.board.style.transform = `scale(${state.zoom})`;
    els.zoomPct.textContent = `${Math.round(state.zoom*100)}%`;
    save();
  }

  function setGrid(on){
    state.gridOn = !!on;
    els.grid.classList.toggle("hidden", !state.gridOn);
    els.gridToggle.checked = state.gridOn;
    save();
  }

  function selectBox(id, {toggle=false, add=false} = {}){
    const set = new Set(state.selectedBoxIds);
    if(toggle){
      if(set.has(id)) set.delete(id); else set.add(id);
    }else if(add){
      set.add(id);
    }else{
      set.clear(); set.add(id);
    }
    state.selectedBoxIds = Array.from(set);
    renderBoard();
    save();
  }
  function clearSelection(){
    state.selectedBoxIds = [];
    renderBoard();
    save();
  }

  function boxById(id){ return state.boxes.find(b => b.id === id); }
  function waiterById(id){ return state.waiters.find(w => w.id === id); }

  // Tabs
  els.tabs.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const t = btn.dataset.tab;
      els.tabs.forEach(b=>b.classList.toggle("active", b===btn));
      els.panels.forEach(p=>{
        p.classList.toggle("hidden", p.dataset.panel !== t);
      });
    });
  });

  // Sidebar toggle
  els.toggleSide.addEventListener("click", ()=>{
    els.layout.classList.toggle("sideCollapsed");
  });
  window.addEventListener("keydown", (e)=>{
    if(e.key === "Tab"){
      e.preventDefault();
      els.layout.classList.toggle("sideCollapsed");
    }
    if(e.key === "Delete"){
      if(state.selectedBoxIds.length){
        deleteSelectedBoxes();
      }
    }
    if(e.key === "Escape"){
      clearSelection();
    }
  });

  // Zoom controls
  els.zoomIn.addEventListener("click", ()=>setZoom(state.zoom + 0.1));
  els.zoomOut.addEventListener("click", ()=>setZoom(state.zoom - 0.1));
  els.zoomReset.addEventListener("click", ()=>setZoom(1));

  // Wheel zoom
  els.boardOuter.addEventListener("wheel", (e)=>{
    if(!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY;
    const factor = delta > 0 ? 0.9 : 1.1;
    setZoom(state.zoom * factor);
  }, {passive:false});

  els.gridToggle.addEventListener("change", ()=>setGrid(els.gridToggle.checked));

  // Add waiter
  function addWaiter(name){
    const n = String(name||"").trim();
    if(!n) return;
    state.waiters.unshift({ id: uid(), name: n, createdAt: now() });
    els.waitName.value = "";
    renderAll();
    save();
  }
  els.addWait.addEventListener("click", ()=>addWaiter(els.waitName.value));
  els.waitName.addEventListener("keydown", (e)=>{
    if(e.key==="Enter") addWaiter(els.waitName.value);
  });
  els.waitSearch.addEventListener("input", renderWaitList);

  // Assigned search
  els.assignedSearch.addEventListener("input", renderAssignedList);

  // Add box
  function addBox(name){
    const n = String(name||"").trim();
    if(!n) return;
    const b = {
      id: uid(),
      name: n,
      x: 120 + Math.random()*140,
      y: 120 + Math.random()*140,
      w: 520,
      h: 240,
      color: "green",
      assignedId: null,
      assignedAt: null,
    };
    state.boxes.push(b);
    els.boxName.value = "";
    renderAll();
    save();
  }
  els.addBox.addEventListener("click", ()=>addBox(els.boxName.value));
  els.boxName.addEventListener("keydown", (e)=>{ if(e.key==="Enter") addBox(els.boxName.value); });
  els.boxSearch.addEventListener("input", renderBoxList);

  // Top operations (selection)
  function deleteSelectedBoxes(){
    const set = new Set(state.selectedBoxIds);
    const removed = state.boxes.filter(b=>set.has(b.id));
    // return assigned back to waiting
    for(const b of removed){
      if(b.assignedId){
        const existing = waiterById(b.assignedId);
        if(!existing){
          state.waiters.unshift({ id: b.assignedId, name: b.assignedName || "이름", createdAt: now() });
        }
      }
    }
    state.boxes = state.boxes.filter(b=>!set.has(b.id));
    state.selectedBoxIds = [];
    renderAll();
    save();
  }
  els.deleteSelected.addEventListener("click", deleteSelectedBoxes);

  function alignSelected(axis){
    const ids = state.selectedBoxIds;
    if(ids.length < 2) return;
    const boxes = ids.map(boxById).filter(Boolean);
    if(!boxes.length) return;
    if(axis==="h"){
      const y = boxes[0].y;
      boxes.forEach(b=>b.y = y);
    }else{
      const x = boxes[0].x;
      boxes.forEach(b=>b.x = x);
    }
    renderBoard(); save();
  }
  els.alignH.addEventListener("click", ()=>alignSelected("h"));
  els.alignV.addEventListener("click", ()=>alignSelected("v"));

  function distributeSelected(axis){
    const ids = state.selectedBoxIds;
    if(ids.length < 3) return;
    const boxes = ids.map(boxById).filter(Boolean);
    boxes.sort((a,b)=> axis==="h" ? a.x-b.x : a.y-b.y);
    const first = boxes[0], last = boxes[boxes.length-1];
    const span = axis==="h" ? (last.x-first.x) : (last.y-first.y);
    const step = span / (boxes.length-1);
    boxes.forEach((b,i)=>{
      if(axis==="h") b.x = first.x + step*i;
      else b.y = first.y + step*i;
    });
    renderBoard(); save();
  }
  els.distributeH.addEventListener("click", ()=>distributeSelected("h"));
  els.distributeV.addEventListener("click", ()=>distributeSelected("v"));

  // Drag wait -> box
  function assignWaiterToBox(waiterId, boxId){
    const wIdx = state.waiters.findIndex(w=>w.id===waiterId);
    if(wIdx < 0) return; // must exist
    const waiter = state.waiters[wIdx];
    const box = boxById(boxId);
    if(!box) return;

    // remove dragged waiter first (prevents index shift bugs)
    state.waiters.splice(wIdx, 1);

    // if box had assigned, return to waiting
    if(box.assignedId){
      state.waiters.unshift({ id: box.assignedId, name: box.assignedName || "이름", createdAt: now() });
    }

    box.assignedId = waiter.id;
    box.assignedName = waiter.name;
    box.assignedAt = now();

    renderAll();
    save();
  }

  function unassignBox(boxId){
    const box = boxById(boxId);
    if(!box || !box.assignedId) return;
    state.waiters.unshift({ id: box.assignedId, name: box.assignedName || "이름", createdAt: now() });
    box.assignedId = null;
    box.assignedName = "";
    box.assignedAt = null;
    renderAll();
    save();
  }

  // Render lists
  function renderWaitList(){
    const q = (els.waitSearch.value||"").trim().toLowerCase();
    els.waitList.innerHTML = "";
    const items = state.waiters.filter(w => !q || w.name.toLowerCase().includes(q));
    for(const w of items){
      const row = document.createElement("div");
      row.className = "item";
      row.draggable = true;
      row.addEventListener("dragstart", (e)=>{
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", w.id);
      });

      const line = document.createElement("div");
      line.className = "waitLine";
      const name = document.createElement("div");
      name.className = "waitName";
      name.textContent = w.name;
      const time = document.createElement("div");
      time.className = "waitTime";
      time.textContent = `대기 ${fmt(now()-w.createdAt)}`;
      line.append(name, time);

      const actions = document.createElement("div");
      actions.className = "itemActions";
      const edit = document.createElement("button");
      edit.className = "itemBtn";
      edit.textContent = "수정";
      edit.addEventListener("click", ()=>{
        const nn = prompt("이름 수정", w.name);
        if(nn===null) return;
        const t = String(nn).trim();
        if(!t) return;
        const ww = waiterById(w.id);
        if(ww) ww.name = t;
        renderAll(); save();
      });
      const del = document.createElement("button");
      del.className = "itemBtn danger";
      del.textContent = "삭제";
      del.addEventListener("click", ()=>{
        state.waiters = state.waiters.filter(x=>x.id!==w.id);
        renderAll(); save();
      });
      actions.append(edit, del);

      row.append(line, actions);
      els.waitList.appendChild(row);
    }
  }

  function renderAssignedList(){
    const q = (els.assignedSearch.value||"").trim().toLowerCase();
    els.assignedList.innerHTML = "";
    const assigned = [];
    for(const b of state.boxes){
      if(!b.assignedId) continue;
      const label = `${b.assignedName || ""} · ${b.name}`;
      if(q && !label.toLowerCase().includes(q)) continue;
      assigned.push({ boxId: b.id, boxName: b.name, name: b.assignedName, at: b.assignedAt });
    }
    for(const a of assigned){
      const row = document.createElement("div");
      row.className = "item clickable";
      row.addEventListener("click", ()=>{
        focusBox(a.boxId);
      });

      const line = document.createElement("div");
      line.className = "waitLine";
      const name = document.createElement("div");
      name.className = "waitName";
      name.textContent = `${a.name} · ${getBoxShortName(a.boxName)}`;
      const time = document.createElement("div");
      time.className = "waitTime";
      time.textContent = `배치 ${fmt(now()-a.at)}`;
      line.append(name, time);

      const actions = document.createElement("div");
      actions.className = "itemActions";
      const toWait = document.createElement("button");
      toWait.className = "itemBtn";
      toWait.textContent = "대기";
      toWait.addEventListener("click", (e)=>{
        e.stopPropagation();
        unassignBox(a.boxId);
      });
      actions.append(toWait);

      row.append(line, actions);
      els.assignedList.appendChild(row);
    }
  }
  function getBoxShortName(n){
    // show last token if like "BOX 5"
    const s = String(n||"");
    const parts = s.split(" ").filter(Boolean);
    return parts.length ? parts[parts.length-1] : s;
  }

  function renderBoxList(){
    const q = (els.boxSearch.value||"").trim().toLowerCase();
    els.boxList.innerHTML = "";
    const items = state.boxes.filter(b => !q || b.name.toLowerCase().includes(q));
    for(const b of items){
      const row = document.createElement("div");
      row.className = "item clickable";
      row.addEventListener("click", ()=>focusBox(b.id));
      const line = document.createElement("div");
      line.className = "waitLine";
      const name = document.createElement("div");
      name.className = "waitName";
      name.textContent = b.name;
      const time = document.createElement("div");
      time.className = "waitTime";
      time.textContent = b.assignedId ? `사용중` : `비어있음`;
      line.append(name, time);
      row.append(line);
      els.boxList.appendChild(row);
    }
  }

  // Board render
  function renderBoard(){
    // clear all boxes but keep grid
    $$("[data-box]", els.board).forEach(n=>n.remove());

    const selected = new Set(state.selectedBoxIds);

    for(const b of state.boxes){
      const box = document.createElement("div");
      box.className = "box";
      box.dataset.box = "1";
      box.dataset.id = b.id;
      box.dataset.color = b.color || "green";
      box.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
      box.style.width = `${b.w||520}px`;
      box.style.height = `${b.h||240}px`;
      if(selected.has(b.id)) box.classList.add("selected");

      // selection + drag move
      box.addEventListener("pointerdown", (e)=>{
        // ignore clicks on buttons/handle
        if(e.target.closest("button") || e.target.closest(".resizeHandle")) return;
        const multi = e.shiftKey;
        if(multi) selectBox(b.id, {toggle:true});
        else selectBox(b.id);
        startMoveBox(e, b.id);
      });

      // double click on name area -> unassign
      box.addEventListener("dblclick", (e)=>{
        if(e.target.closest("button") || e.target.closest(".resizeHandle")) return;
        unassignBox(b.id);
      });

      // drag-over drop waiter
      box.addEventListener("dragover", (e)=>{ e.preventDefault(); });
      box.addEventListener("drop", (e)=>{
        e.preventDefault();
        const wid = e.dataTransfer.getData("text/plain");
        if(wid) assignWaiterToBox(wid, b.id);
      });

      const inner = document.createElement("div");
      inner.className = "boxInner";

      const wm = document.createElement("div");
      wm.className = "watermarkBig";
      wm.textContent = getBoxShortName(b.name);

      const actions = document.createElement("div");
      actions.className = "boxActionsTop";

      const btnToWait = document.createElement("button");
      btnToWait.className = "chipBtn";
      btnToWait.textContent = "대기로";
      btnToWait.disabled = !b.assignedId;
      btnToWait.addEventListener("click", (e)=>{ e.stopPropagation(); unassignBox(b.id); });

      const btnEdit = document.createElement("button");
      btnEdit.className = "chipBtn";
      btnEdit.textContent = "✏";
      btnEdit.title = "이름 수정";
      btnEdit.addEventListener("click", (e)=>{
        e.stopPropagation();
        const nn = prompt("BOX 이름 수정", b.name);
        if(nn===null) return;
        const t = String(nn).trim();
        if(!t) return;
        const bb = boxById(b.id);
        if(bb) bb.name = t;
        renderAll(); save();
      });

      const btnDel = document.createElement("button");
      btnDel.className = "chipBtn danger";
      btnDel.textContent = "🗑";
      btnDel.title = "박스 삭제";
      btnDel.addEventListener("click", (e)=>{
        e.stopPropagation();
        state.boxes = state.boxes.filter(x=>x.id!==b.id);
        state.selectedBoxIds = state.selectedBoxIds.filter(x=>x!==b.id);
        renderAll(); save();
      });

      actions.append(btnToWait, btnEdit, btnDel);

      const pane = document.createElement("div");
      pane.className = "rightPane";

      const card = document.createElement("div");
      card.className = "assignCard";

      const left = document.createElement("div");
      left.className = "assignLeft";
      const nm = document.createElement("div");
      nm.className = "assignName";
      nm.textContent = b.assignedId ? (b.assignedName || "") : "—";
      const meta = document.createElement("div");
      meta.className = "assignMeta";

      if(b.assignedId){
        const badge = document.createElement("div");
        badge.className = "badge";
        badge.textContent = fmt(now() - (b.assignedAt || now()));
        const txt = document.createElement("div");
        txt.textContent = "배치 시간";
        meta.append(badge, txt);
      }else{
        const hint = document.createElement("div");
        hint.className = "dropHint";
        hint.textContent = "대기를 드롭";
        meta.append(hint);
      }

      left.append(nm, meta);
      card.append(left);

      pane.append(card);

      // resize handle (bottom-left)
      const handle = document.createElement("div");
      handle.className = "resizeHandle";
      handle.title = "드래그로 크기 조절";
      handle.addEventListener("pointerdown", (e)=>{
        e.stopPropagation();
        e.preventDefault();
        startResizeBox(e, b.id);
      });

      inner.append(wm, pane);
      box.append(inner, actions, handle);
      els.board.appendChild(box);
    }
  }

  function focusBox(id){
    const b = boxById(id);
    if(!b) return;
    // scroll to box area
    const pad = 80;
    const x = (b.x*state.zoom) - pad;
    const y = (b.y*state.zoom) - pad;
    els.boardOuter.scrollTo({ left: Math.max(0,x), top: Math.max(0,y), behavior:"smooth" });
    selectBox(id);
    const node = $(`[data-box][data-id="${id}"]`, els.board);
    if(node){
      node.classList.add("highlight");
      setTimeout(()=>node.classList.remove("highlight"), 1400);
    }
  }

  // Move box by pointer drag
  let drag = null;
  function startMoveBox(e, boxId){
    const b = boxById(boxId);
    if(!b) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = b.x, oy = b.y;
    drag = { type:"move", boxId, startX, startY, ox, oy };
    e.target.setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, {once:true});
  }

  function startResizeBox(e, boxId){
    const b = boxById(boxId);
    if(!b) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const ow = b.w||520, oh = b.h||240;
    drag = { type:"resize", boxId, startX, startY, ow, oh };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, {once:true});
  }

  function onPointerMove(e){
    if(!drag) return;
    const b = boxById(drag.boxId);
    if(!b) return;
    if(drag.type==="move"){
      const dx = (e.clientX - drag.startX) / state.zoom;
      const dy = (e.clientY - drag.startY) / state.zoom;
      b.x = drag.ox + dx;
      b.y = drag.oy + dy;
      renderBoard();
    }else if(drag.type==="resize"){
      const dx = (e.clientX - drag.startX) / state.zoom;
      const dy = (e.clientY - drag.startY) / state.zoom;
      b.w = clamp(drag.ow + dx, 320, 920);
      b.h = clamp(drag.oh + dy, 170, 520);
      renderBoard();
    }
  }
  function onPointerUp(){
    window.removeEventListener("pointermove", onPointerMove);
    drag = null;
    save();
  }

  // Click outside to clear selection
  els.board.addEventListener("pointerdown", (e)=>{
    if(e.target === els.board || e.target === els.grid){
      clearSelection();
    }
  });

  // Main render
  function renderAll(){
    renderWaitList();
    renderAssignedList();
    renderBoxList();
    renderBoard();
  }

  // Timer ticks
  function tick(){
    // update list timer texts only (cheap)
    $$(".waitTime", els.waitList).forEach((node, idx)=>{
      // cannot map easily; re-render for simplicity when there are items
    });
    // simplest stable: re-render lists if there is any timer visible
    if(state.waiters.length || state.boxes.some(b=>b.assignedId)){
      renderWaitList();
      renderAssignedList();
      // update box badges without full rerender: renderBoard is heavier; keep simple but not too frequent
      renderBoard();
    }
  }

  // init
  function init(){
    load();
    setZoom(state.zoom);
    setGrid(state.gridOn);
    renderAll();
    setInterval(tick, 1000);
  }

  // Safety: show error on screen if something breaks
  window.addEventListener("error", (e)=>{
    console.error(e.error || e.message);
    els.saveHint.textContent = "오류: 콘솔 확인";
    els.saveHint.style.opacity = "1";
  });

  init();
})();