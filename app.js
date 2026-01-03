// Box Board app (restored core: wait + box create + drag assign + delete)
// This file is intentionally "stable core" to prevent broken UI.
(() => {
  const $ = (id) => document.getElementById(id);

  // Elements (may exist depending on page)
  const layout = $("layout");
  const side = $("side");
  const toggleSide = $("toggleSide");

  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".tabPanel"));

  const waitName = $("waitName");
  const addWaitBtn = $("addWait");
  const waitList = $("waitList");
  const waitSearch = $("waitSearch");

  const assignedList = $("assignedList");
  const assignedSearch = $("assignedSearch");

  const boxName = $("boxName");
  const addBoxBtn = $("addBox");
  const boxList = $("boxList");
  const boxSearch = $("boxSearch");

  const board = $("board");
  const grid = $("grid");
  const gridToggle = $("gridToggle");

  const zoomPct = $("zoomPct");
  const boardOuter = $("boardOuter");
  const zoomIn = $("zoomIn");
  const zoomOut = $("zoomOut");
  const zoomReset = $("zoomReset");

  // If page doesn't have full UI, safely no-op
  if (!waitList || !addWaitBtn) return;

  const LS_KEY = "boxBoard_state_v2";
  const LS_ZOOM = "boxBoard_zoom_v2";

  const now = () => Date.now();

  const state = loadState();

  function uid() {
    return Math.random().toString(16).slice(2) + "-" + now().toString(16);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) {
        return { wait: [], boxes: [], assigned: [] };
      }
      const parsed = JSON.parse(raw);
      // sanity
      return {
        wait: Array.isArray(parsed.wait) ? parsed.wait : [],
        boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [],
        assigned: Array.isArray(parsed.assigned) ? parsed.assigned : [],
      };
    } catch (e) {
      return { wait: [], boxes: [], assigned: [] };
    }
  }

  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    const hint = $("saveHint");
    if (hint) {
      hint.textContent = "저장됨";
      hint.style.opacity = "1";
      clearTimeout(saveState._t);
      saveState._t = setTimeout(() => (hint.style.opacity = ".75"), 800);
    }
  }

  // ---------- Tabs ----------
  tabs.forEach((t) => {
    t.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      const name = t.dataset.tab;
      panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== name));
    });
  });

  // ---------- Sidebar toggle ----------
  function setSideCollapsed(collapsed) {
    if (!layout) return;
    layout.classList.toggle("sideCollapsed", collapsed);
  }
  if (toggleSide) {
    toggleSide.addEventListener("click", () => {
      setSideCollapsed(!layout.classList.contains("sideCollapsed"));
    });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      setSideCollapsed(!layout.classList.contains("sideCollapsed"));
    }
  });

  // ---------- Grid toggle ----------
  if (gridToggle && grid) {
    gridToggle.addEventListener("change", () => {
      grid.classList.toggle("hidden", !gridToggle.checked);
      saveState();
    });
  }

  // ---------- Zoom ----------
  let zoom = 1;
  try {
    const z = parseFloat(localStorage.getItem(LS_ZOOM) || "1");
    if (!Number.isNaN(z)) zoom = Math.min(2.5, Math.max(0.35, z));
  } catch {}
  function applyZoom() {
    if (board) board.style.transform = `scale(${zoom})`;
    if (zoomPct) zoomPct.textContent = `${Math.round(zoom * 100)}%`;
    localStorage.setItem(LS_ZOOM, String(zoom));
  }
  if (zoomIn) zoomIn.addEventListener("click", () => { zoom = Math.min(2.5, zoom + 0.1); applyZoom(); });
  if (zoomOut) zoomOut.addEventListener("click", () => { zoom = Math.max(0.35, zoom - 0.1); applyZoom(); });
  if (zoomReset) zoomReset.addEventListener("click", () => { zoom = 1; applyZoom(); });
  if (boardOuter) {
    boardOuter.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const delta = e.deltaY;
      zoom += delta > 0 ? -0.06 : 0.06;
      zoom = Math.min(2.5, Math.max(0.35, zoom));
      applyZoom();
    }, { passive: false });
  }
  applyZoom();

  // ---------- Helpers ----------
  function fmtHMS(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function findBox(id) {
    return state.boxes.find((b) => b.id === id);
  }

  function getAssigned() {
    // assigned derived from boxes, but keep separate list for quick search
    const res = [];
    for (const b of state.boxes) {
      if (b.person) {
        res.push({
          id: b.person.id,
          name: b.person.name,
          since: b.person.assignedAt,
          boxId: b.id,
          boxName: b.name,
        });
      }
    }
    return res;
  }

  function removeFromWait(id) {
    state.wait = state.wait.filter((p) => p.id !== id);
  }

  function addToWait(person) {
    // keep original createdAt if exists
    if (!person.createdAt) person.createdAt = now();
    // ensure not duplicated
    removeFromWait(person.id);
    state.wait.unshift(person);
  }

  // ---------- Wait add ----------
  addWaitBtn.addEventListener("click", () => {
    const name = (waitName.value || "").trim();
    if (!name) return;
    const person = { id: uid(), name, createdAt: now() };
    state.wait.unshift(person);
    waitName.value = "";
    saveState();
    renderAll();
  });
  waitName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addWaitBtn.click();
  });

  // ---------- Box add ----------
  if (addBoxBtn) {
    addBoxBtn.addEventListener("click", () => {
      const name = (boxName.value || "").trim() || `BOX ${state.boxes.length + 1}`;
      const b = {
        id: uid(),
        name,
        x: 120 + (state.boxes.length % 3) * 420,
        y: 120 + Math.floor(state.boxes.length / 3) * 270,
        w: 360,
        h: 220,
        color: "blue",
        person: null,
      };
      state.boxes.push(b);
      boxName.value = "";
      saveState();
      renderAll();
    });
    boxName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addBoxBtn.click();
    });
  }

  // ---------- Remove person (wait + any box) ----------
  function removePersonEverywhere(personId) {
    state.wait = state.wait.filter((p) => p.id !== personId);
    for (const b of state.boxes) {
      if (b.person && b.person.id === personId) b.person = null;
    }
    saveState();
    renderAll();
  }

  // ---------- Delete box ----------
  function deleteBox(boxId) {
    // send assigned to wait (optional) - here we just remove assignment too
    state.boxes = state.boxes.filter((b) => b.id !== boxId);
    saveState();
    renderAll();
  }

  // ---------- Rendering ----------
  function renderWait() {
    if (!waitList) return;
    const q = (waitSearch?.value || "").trim().toLowerCase();
    waitList.innerHTML = "";
    const items = state.wait.filter((p) => !q || (p.name || "").toLowerCase().includes(q));
    for (const p of items) {
      const item = document.createElement("div");
      item.className = "item";
      item.draggable = true;

      const line = document.createElement("div");
      line.className = "waitLine";

      const nm = document.createElement("div");
      nm.className = "waitName";
      nm.textContent = p.name; // <-- IMPORTANT: no suffix

      const tm = document.createElement("div");
      tm.className = "waitTime";
      tm.textContent = `대기 ${fmtHMS(now() - (p.createdAt || now()))}`;

      line.appendChild(nm);
      line.appendChild(tm);

      const actions = document.createElement("div");
      actions.className = "itemActions";

      const del = document.createElement("button");
      del.className = "itemBtn delete";
      del.textContent = "삭제";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        removePersonEverywhere(p.id);
      });

      actions.appendChild(del);

      item.appendChild(line);
      item.appendChild(actions);

      item.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", p.id);
      });

      waitList.appendChild(item);
    }
  }

  function renderAssigned() {
    if (!assignedList) return;
    const q = (assignedSearch?.value || "").trim().toLowerCase();
    assignedList.innerHTML = "";
    const items = getAssigned().filter((a) => {
      if (!q) return true;
      return (a.name || "").toLowerCase().includes(q) || (a.boxName || "").toLowerCase().includes(q);
    });

    for (const a of items) {
      const item = document.createElement("div");
      item.className = "item clickable";

      const line = document.createElement("div");
      line.className = "waitLine";

      const nm = document.createElement("div");
      nm.className = "waitName";
      nm.textContent = a.name;

      const tm = document.createElement("div");
      tm.className = "waitTime";
      tm.textContent = `${a.boxName} · ${fmtHMS(now() - (a.since || now()))}`;

      line.appendChild(nm);
      line.appendChild(tm);

      const actions = document.createElement("div");
      actions.className = "itemActions";

      const del = document.createElement("button");
      del.className = "itemBtn delete";
      del.textContent = "삭제";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        removePersonEverywhere(a.id);
      });

      actions.appendChild(del);

      item.appendChild(line);
      item.appendChild(actions);

      item.addEventListener("click", () => {
        const boxEl = document.querySelector(`.box[data-id="${a.boxId}"]`);
        if (boxEl) {
          boxEl.classList.add("highlight");
          setTimeout(() => boxEl.classList.remove("highlight"), 1400);
          // scroll into view
          boxEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        }
      });

      assignedList.appendChild(item);
    }
  }

  function renderBoxesList() {
    if (!boxList) return;
    const q = (boxSearch?.value || "").trim().toLowerCase();
    boxList.innerHTML = "";
    const items = state.boxes.filter((b) => !q || (b.name || "").toLowerCase().includes(q));
    for (const b of items) {
      const item = document.createElement("div");
      item.className = "item";

      const left = document.createElement("div");
      left.className = "waitLine";

      const nm = document.createElement("div");
      nm.className = "waitName";
      nm.textContent = b.name;

      const meta = document.createElement("div");
      meta.className = "waitTime";
      meta.textContent = b.person ? `배치 1명` : `비어있음`;

      left.appendChild(nm);
      left.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "itemActions";

      const del = document.createElement("button");
      del.className = "itemBtn delete";
      del.textContent = "삭제";
      del.addEventListener("click", () => deleteBox(b.id));

      actions.appendChild(del);

      item.appendChild(left);
      item.appendChild(actions);

      boxList.appendChild(item);
    }
  }

  function renderBoard() {
    if (!board) return;
    // Remove existing boxes (keep grid)
    const existing = Array.from(board.querySelectorAll(".box"));
    existing.forEach((el) => el.remove());

    for (const b of state.boxes) {
      const el = document.createElement("div");
      el.className = "box";
      el.dataset.id = b.id;
      el.style.setProperty("--x", `${b.x}px`);
      el.style.setProperty("--y", `${b.y}px`);
      el.style.setProperty("--w", `${b.w}px`);
      el.style.setProperty("--h", `${b.h}px`);

      const inner = document.createElement("div");
      inner.className = "boxInner";

      const watermark = document.createElement("div");
      watermark.className = "watermark";
      watermark.textContent = b.name;

      const top = document.createElement("div");
      top.className = "boxTop";

      const title = document.createElement("div");
      title.className = "boxTitle";
      title.textContent = b.name;

      top.appendChild(title);


      // Box top actions (right-top): rename / delete
      const boxActions = document.createElement("div");
      boxActions.className = "boxActions";

      const renameBoxBtn = document.createElement("button");
      renameBoxBtn.className = "actionBtn";
      renameBoxBtn.textContent = "수정";
      renameBoxBtn.title = "BOX 이름 수정";
      renameBoxBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = prompt("BOX 이름 변경", b.name || "");
        if (next === null) return;
        const v = String(next).trim();
        if (!v) return;
        b.name = v;
        saveState();
        renderAll();
      });

      const delBoxBtn = document.createElement("button");
      delBoxBtn.className = "actionBtn danger";
      delBoxBtn.textContent = "삭제";
      delBoxBtn.title = "BOX 삭제";
      delBoxBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const ok = confirm(`"${b.name}" 박스를 삭제할까요?`);
        if (!ok) return;
        deleteBox(b.id);
      });

      boxActions.appendChild(renameBoxBtn);
      boxActions.appendChild(delBoxBtn);
      inner.appendChild(boxActions);

      const slot = document.createElement("div");
      slot.className = "slot";
      slot.style.position = "absolute";
      slot.style.overflow = "hidden";
      slot.dataset.slot = "1";

      const slotLeft = document.createElement("div");
      slotLeft.className = "slotLeft";

      const slotName = document.createElement("div");
      slotName.className = "slotName";
      slotName.textContent = b.person ? b.person.name : "비어있음";

      const hint = document.createElement("div");
      hint.className = "dropHint";
      hint.textContent = b.person ? `배치 ${fmtHMS(now() - (b.person.assignedAt || now()))}` : "여기로 드롭";

      slotLeft.appendChild(slotName);
      slotLeft.appendChild(hint);

      const slotActions = document.createElement("div");
      slotActions.className = "slotActions";

      if (b.person) {
        const editBtn = document.createElement("button");
        editBtn.className = "actionBtn";
        editBtn.textContent = "수정";
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const next = prompt("이름 수정", b.person.name || "");
          if (next === null) return;
          const v = String(next).trim();
          if (!v) return;
          b.person.name = v;
          saveState();
          renderAll();
        });

        const delBtn = document.createElement("button");
        delBtn.className = "actionBtn danger";
        delBtn.textContent = "삭제";
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          // remove person from this box only (not send to wait)
          b.person = null;
          saveState();
          renderAll();
        });

        const un = document.createElement("button");
        un.className = "actionBtn";
        un.textContent = "대기로";
        un.addEventListener("click", (e) => {
          e.stopPropagation();
          const p = b.person;
          b.person = null;
          addToWait({ id: p.id, name: p.name, createdAt: now() });
          saveState();
          renderAll();
        });

        slotActions.appendChild(editBtn);
        slotActions.appendChild(delBtn);
        slotActions.appendChild(un);
      }

      slot.appendChild(slotLeft);
      slot.appendChild(slotActions);

      // Drag/drop assign from wait
      slot.addEventListener("dragover", (e) => {
        e.preventDefault();
      });
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        const personId = e.dataTransfer.getData("text/plain");
        const p = state.wait.find((x) => x.id === personId);
        if (!p) return;

        // if already occupied, send current back to wait
        if (b.person) {
          addToWait({ id: b.person.id, name: b.person.name, createdAt: now() });
        }

        // assign
        b.person = { id: p.id, name: p.name, assignedAt: now() };
        removeFromWait(p.id);

        saveState();
        renderAll();
      });

      inner.appendChild(watermark);
      inner.appendChild(top);
      inner.appendChild(slot);
      el.appendChild(inner);

      // Resizer (bottom-right)
      const resizer = document.createElement("div");
      resizer.className = "boxResizer";
      el.appendChild(resizer);

      let resizing = null;
      resizer.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        resizing = { startX: e.clientX, startY: e.clientY, w: b.w, h: b.h };
        document.body.style.userSelect = "none";
      });

      window.addEventListener("mousemove", (e) => {
        if (!resizing) return;
        const dx = (e.clientX - resizing.startX) / zoom;
        const dy = (e.clientY - resizing.startY) / zoom;
        const minW = 260;
        const minH = 170;
        b.w = Math.max(minW, Math.round(resizing.w + dx));
        b.h = Math.max(minH, Math.round(resizing.h + dy));
        el.style.setProperty("--w", `${b.w}px`);
        el.style.setProperty("--h", `${b.h}px`);
      });

      window.addEventListener("mouseup", () => {
        if (!resizing) return;
        resizing = null;
        document.body.style.userSelect = "";
        saveState();
      });

      // Simple drag box move (single)
      let drag = null;
      el.addEventListener("mousedown", (e) => {
        // avoid dragging from inputs/buttons
        if (e.target.closest("button")) return;
        drag = { startX: e.clientX, startY: e.clientY, bx: b.x, by: b.y };
        el.style.cursor = "grabbing";
      });
      window.addEventListener("mousemove", (e) => {
        if (!drag) return;
        const dx = (e.clientX - drag.startX) / zoom;
        const dy = (e.clientY - drag.startY) / zoom;
        b.x = Math.round(drag.bx + dx);
        b.y = Math.round(drag.by + dy);
        el.style.setProperty("--x", `${b.x}px`);
        el.style.setProperty("--y", `${b.y}px`);
      });
      window.addEventListener("mouseup", () => {
        if (!drag) return;
        drag = null;
        el.style.cursor = "";
        saveState();
      });

      board.appendChild(el);
    }
  }

  function renderAll() {
    renderWait();
    renderAssigned();
    renderBoxesList();
    renderBoard();
  }

  // Search rerender
  waitSearch?.addEventListener("input", renderAll);
  assignedSearch?.addEventListener("input", renderAll);
  boxSearch?.addEventListener("input", renderAll);

  // Tick timers
  setInterval(() => {
    // only update visible text without heavy re-render? simplest: rerender lists+board text
    renderWait();
    renderAssigned();
    // Update board slot times/hints
    const boxEls = document.querySelectorAll(".box");
    boxEls.forEach((boxEl) => {
      const id = boxEl.dataset.id;
      const b = findBox(id);
      if (!b) return;
      const slotName = boxEl.querySelector(".slotName");
      const hint = boxEl.querySelector(".dropHint");
      if (!slotName || !hint) return;
      slotName.textContent = b.person ? b.person.name : "비어있음";
      hint.textContent = b.person ? `배치 ${fmtHMS(now() - (b.person.assignedAt || now()))}` : "여기로 드롭";
    });
  }, 1000);

  // Initial render
  renderAll();
})();
