/* Box Board - app.js (no build, single file)
   v2026-01-05: add "o" tool button for per-box text size control
*/
(() => {
  'use strict';

  // ---------- utils ----------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6);
  const now = () => Date.now();
  const fmtMS = (ms) => {
    ms = Math.max(0, ms|0);
    const s = Math.floor(ms/1000);
    const hh = Math.floor(s/3600);
    const mm = Math.floor((s%3600)/60);
    const ss = s%60;
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  };

  // ---------- persistence ----------
  const LS_KEY = 'boxBoard_state_v2026_01_05';
  const loadState = () => {
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return null;
      const s = JSON.parse(raw);
      return s && typeof s === 'object' ? s : null;
    }catch(_){ return null; }
  };
  const saveState = (s) => {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  };

  // ---------- state ----------
  const state = {
    ui: {
      tab: 'wait',
      sidebarCollapsed: false,
      zoom: 1,
      selectMode: false,
    },
    people: [], // {id,name,createdAt,assignedBoxId:null|boxId}
    boxes: [],  // {id,num,x,y,w,h,seatPersonId:null|personId,fontScale:1}
    selectedBoxIds: [],
  };

  const loaded = loadState();
  if(loaded){
    // soft-merge for forward compatibility
    if(loaded.ui) Object.assign(state.ui, loaded.ui);
    if(Array.isArray(loaded.people)) state.people = loaded.people;
    if(Array.isArray(loaded.boxes)) state.boxes = loaded.boxes;
    if(Array.isArray(loaded.selectedBoxIds)) state.selectedBoxIds = loaded.selectedBoxIds;
  }

  // ---------- dom refs ----------
  const sidePanel = $('#sidePanel');
  const toggleSide = $('#toggleSide');

  const tabBtns = $$('.tab');
  const panels = $$('.panel');

  const nameInput = $('#nameInput');
  const addWaitBtn = $('#addWait');
  const searchInput = $('#searchInput');
  const waitList = $('#waitList');

  const assignedList = $('#assignedList');

  const addBoxBtn = $('#addBox');
  const deleteSelectedBtn = $('#deleteSelected');

  const boxesLayer = $('#boxesLayer');
  const canvas = $('#canvas');
  const zoomPct = $('#zoomPct');
  const zoomIn = $('#zoomIn');
  const zoomOut = $('#zoomOut');
  const zoomReset = $('#zoomReset');

  const selectModeBtn = $('#selectMode');

  const alignHBtn = $('#alignH');
  const alignVBtn = $('#alignV');
  const spaceHBtn = $('#spaceH');
  const spaceVBtn = $('#spaceV');

  const saveStatus = $('#saveStatus');

  // ---------- save status debounce ----------
  let saveTimer = null;
  const markDirty = () => {
    saveStatus.textContent = '저장 중...';
    saveStatus.style.opacity = '1';
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveState(state);
      saveStatus.textContent = '저장됨';
    }, 260);
  };

  // ---------- ui helpers ----------
  const setTab = (tab) => {
    state.ui.tab = tab;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    panels.forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
    markDirty();
  };

  const applySidebar = () => {
    sidePanel.classList.toggle('collapsed', !!state.ui.sidebarCollapsed);
  };

  const applyZoom = () => {
    const z = clamp(state.ui.zoom, 0.3, 2.5);
    state.ui.zoom = z;
    canvas.style.transform = `scale(${z})`;
    zoomPct.textContent = `${Math.round(z*100)}%`;
  };

  const isSelectToggle = (ev) => state.ui.selectMode || ev.shiftKey;

  const getBoxById = (id) => state.boxes.find(b => b.id === id) || null;
  const getPersonById = (id) => state.people.find(p => p.id === id) || null;

  const selectedSet = () => new Set(state.selectedBoxIds);
  const setSelected = (arr) => { state.selectedBoxIds = Array.from(new Set(arr)); markDirty(); renderBoxes(); };

  const toggleSelectBox = (boxId) => {
    const s = selectedSet();
    if(s.has(boxId)) s.delete(boxId); else s.add(boxId);
    state.selectedBoxIds = Array.from(s);
    markDirty();
    renderBoxes();
  };

  const clearSelection = () => {
    if(state.selectedBoxIds.length){
      state.selectedBoxIds = [];
      markDirty();
      renderBoxes();
    }
  };

  // ---------- people actions ----------
  const addWaiting = (name) => {
    name = (name || '').trim();
    if(!name) return;
    state.people.unshift({ id: uid(), name, createdAt: now(), assignedBoxId: null });
    nameInput.value = '';
    markDirty();
    renderAll();
  };

  const deletePerson = (personId) => {
    // unseat if seated
    state.boxes.forEach(b => { if(b.seatPersonId === personId) b.seatPersonId = null; });
    state.people = state.people.filter(p => p.id !== personId);
    markDirty();
    renderAll();
  };

  const unassignPerson = (personId) => {
    const p = getPersonById(personId);
    if(!p) return;
    p.assignedBoxId = null;
    // also clear seat links in boxes (if any)
    state.boxes.forEach(b => { if(b.seatPersonId === personId) b.seatPersonId = null; });
    markDirty();
    renderAll();
  };

  const assignPersonToBox = (personId, boxId) => {
    const p = getPersonById(personId);
    const b = getBoxById(boxId);
    if(!p || !b) return;

    // if box had someone, push them back to wait
    if(b.seatPersonId){
      const prev = getPersonById(b.seatPersonId);
      if(prev) prev.assignedBoxId = null;
    }

    // if this person was in another box, clear that seat
    state.boxes.forEach(x => { if(x.seatPersonId === personId) x.seatPersonId = null; });

    b.seatPersonId = personId;
    p.assignedBoxId = boxId;

    markDirty();
    renderAll();
  };

  // ---------- box actions ----------
  const nextBoxNum = () => {
    const m = state.boxes.reduce((acc,b)=>Math.max(acc, b.num||0), 0);
    return m + 1;
  };

  const addBox = () => {
    const num = nextBoxNum();
    const b = {
      id: uid(),
      num,
      x: 120 + (num-1)*30,
      y: 80 + (num-1)*20,
      w: 220,
      h: 120,
      seatPersonId: null,
      fontScale: 1,
    };
    state.boxes.push(b);
    markDirty();
    renderBoxes();
  };

  const deleteSelectedBoxes = () => {
    const s = selectedSet();
    if(!s.size) return;
    // unassign people seated in deleted boxes
    state.boxes.forEach(b => {
      if(s.has(b.id) && b.seatPersonId){
        const p = getPersonById(b.seatPersonId);
        if(p) p.assignedBoxId = null;
      }
    });
    state.boxes = state.boxes.filter(b => !s.has(b.id));
    state.selectedBoxIds = [];
    markDirty();
    renderAll();
  };

  // ---------- render lists ----------
  const renderWait = () => {
    const q = (searchInput.value || '').trim().toLowerCase();
    const waiting = state.people.filter(p => !p.assignedBoxId && (!q || p.name.toLowerCase().includes(q)));

    waitList.innerHTML = '';
    waiting.forEach(p => {
      const el = document.createElement('div');
      el.className = 'item';
      el.draggable = true;
      el.dataset.pid = p.id;

      // 이름(중복 표시 방지): 왼쪽은 이름만, 오른쪽 pill은 시간만
      const nameEl = document.createElement('div');
      nameEl.className = 'personName';
      nameEl.textContent = p.name;

      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.innerHTML = `<span class="time">${fmtMS(now()-p.createdAt)}</span>`;

      const del = document.createElement('button');
      del.className = 'itemBtn';
      del.textContent = '삭제';
      del.addEventListener('click', (e)=>{ e.stopPropagation(); deletePerson(p.id); });

      el.addEventListener('dragstart', (e) => {
        el.classList.add('dragging');
        e.dataTransfer.setData('text/plain', p.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));

      el.append(nameEl, pill, del);
      waitList.appendChild(el);
    });
  };
  const renderAssigned = () => {
    const assigned = state.people.filter(p => !!p.assignedBoxId);
    assignedList.innerHTML = '';
    assigned.forEach(p => {
      const box = getBoxById(p.assignedBoxId);
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="nameBadge">${escapeHTML(p.name.slice(0,1))}</div>
        <div class="pill" style="border-color: rgba(255,209,102,.35); background: rgba(255,209,102,.10)">
          <span class="label">BOX ${box ? box.num : '-'}</span>
          <span class="time">${fmtMS(now()-p.createdAt)}</span>
        </div>
        <button class="itemBtn">대기</button>
      `;
      el.querySelector('.pill').addEventListener('dblclick', () => unassignPerson(p.id));
      el.querySelector('.itemBtn').addEventListener('click', () => unassignPerson(p.id));
      assignedList.appendChild(el);
    });
  };

  // ---------- render boxes ----------
  const renderBoxes = () => {
    const s = selectedSet();
    boxesLayer.innerHTML = '';
    state.boxes.forEach(b => {
      const boxEl = document.createElement('div');
      boxEl.className = 'box' + (s.has(b.id) ? ' selected' : '');
      boxEl.dataset.boxid = b.id;
      boxEl.style.left = b.x + 'px';
      boxEl.style.top = b.y + 'px';
      boxEl.style.width = b.w + 'px';
      boxEl.style.height = b.h + 'px';
      boxEl.style.setProperty('--seatScale', String(b.fontScale || 1));

      const numEl = document.createElement('div');
      numEl.className = 'boxNumber';
      numEl.textContent = String(b.num);

      const inner = document.createElement('div');
      inner.className = 'boxInner';

      const seat = document.createElement('div');
      seat.className = 'seatPill';
      const seated = b.seatPersonId ? getPersonById(b.seatPersonId) : null;
      if(seated){
        // Name stays in the pill (watermark right side). Timer is anchored to bottom.
        seat.innerHTML = `<span class="seatName">${escapeHTML(seated.name)}</span>`;
        seat.title = '더블클릭: 대기로';
        seat.addEventListener('dblclick', (e)=>{ e.stopPropagation(); unassignPerson(seated.id); });
      }else{
        seat.innerHTML = `<span class="seatName" style="opacity:.85">비어있음</span>`;
      }
      inner.appendChild(seat);

      // Bottom anchored timer (requested: attach to box bottom)
      const bottomTime = document.createElement('div');
      bottomTime.className = 'boxTimeBottom';
      bottomTime.textContent = seated ? fmtMS(now() - seated.createdAt) : '';

      // tools
      const tools = document.createElement('div');
      tools.className = 'boxTools';

      // o button (settings)
      const oBtn = makeToolDot('o', '글자 크기');
      oBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBoxPopover(boxEl, b.id);
      });

      // return button (↩) = send seated to wait
      const retBtn = makeToolDot('↩', '대기로');
      retBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if(b.seatPersonId) unassignPerson(b.seatPersonId);
      });

      // x button = clear seat
      const xBtn = makeToolDot('×', '비우기');
      xBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if(b.seatPersonId){
          const p = getPersonById(b.seatPersonId);
          if(p) p.assignedBoxId = null;
          b.seatPersonId = null;
          markDirty();
          renderAll();
        }
      });

      tools.append(oBtn, retBtn, xBtn);

      const handle = document.createElement('div');
      handle.className = 'resizeHandle';
      handle.title = '크기 조절';

      boxEl.append(numEl, inner, bottomTime, tools, handle);
      boxesLayer.appendChild(boxEl);

      // If a popover was open, it would disappear on the 1s re-render.
      // Re-create it so it stays open.
      ensureBoxPopover(boxEl, b.id);

      // drag/drop from wait list
      boxEl.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; });
      boxEl.addEventListener('drop', (e)=>{
        e.preventDefault();
        const pid = e.dataTransfer.getData('text/plain');
        if(pid) assignPersonToBox(pid, b.id);
      });

      // selection + move
      boxEl.addEventListener('mousedown', (e) => onBoxMouseDown(e, b.id));
      handle.addEventListener('mousedown', (e) => onResizeMouseDown(e, b.id));
      // prevent drag when clicking tools
      tools.addEventListener('mousedown', (e)=> e.stopPropagation());
    });
  };

  const escapeHTML = (s) => String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'","&#039;");

  const makeToolDot = (txt, title) => {
    const d = document.createElement('div');
    d.className = 'toolDot';
    d.textContent = txt;
    d.title = title;
    return d;
  };

  // ---------- popover (o button) ----------
  let openPopoverBoxId = null;

  const closePopover = () => {
    if(!openPopoverBoxId) return;
    const boxEl = boxesLayer.querySelector(`.box[data-boxid="${openPopoverBoxId}"]`);
    if(boxEl){
      const pop = boxEl.querySelector('.boxPopover');
      if(pop) pop.remove();
    }
    openPopoverBoxId = null;
  };

  // build popover (shared by click + rerender)
  const buildBoxPopover = (boxEl, boxId) => {
    const b = getBoxById(boxId);
    if(!b) return null;

    const pop = document.createElement('div');
    pop.className = 'boxPopover';
    pop.innerHTML = `
      <div class="popTitle">글자 크기</div>
      <div class="popRow">
        <button class="popBtn" data-act="minus">−</button>
        <div class="popVal" id="popVal">x${(b.fontScale||1).toFixed(1)}</div>
        <button class="popBtn" data-act="plus">＋</button>
      </div>
      <button class="popLink" data-act="reset">기본으로</button>
    `;

    const updateVal = () => {
      const val = pop.querySelector('#popVal');
      if(val) val.textContent = `x${(b.fontScale||1).toFixed(1)}`;
      boxEl.style.setProperty('--seatScale', String(b.fontScale||1));
    };

    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = e.target && e.target.dataset ? e.target.dataset.act : null;
      if(!act) return;
      const step = 0.1;
      if(act === 'minus') b.fontScale = clamp((b.fontScale||1) - step, 0.7, 1.6);
      if(act === 'plus')  b.fontScale = clamp((b.fontScale||1) + step, 0.7, 1.6);
      if(act === 'reset') b.fontScale = 1;
      updateVal();
      markDirty();
    });

    // prevent moving while using popover
    pop.addEventListener('mousedown', (e)=> e.stopPropagation());

    // keep value synced if needed
    pop._updateVal = updateVal;
    return pop;
  };

  const ensureBoxPopover = (boxEl, boxId) => {
    if(openPopoverBoxId !== boxId) return;
    if(boxEl.querySelector('.boxPopover')) return;
    const pop = buildBoxPopover(boxEl, boxId);
    if(pop) boxEl.appendChild(pop);
  };

  const toggleBoxPopover = (boxEl, boxId) => {
    // close another box's popover
    if(openPopoverBoxId && openPopoverBoxId !== boxId) closePopover();

    const existing = boxEl.querySelector('.boxPopover');
    if(existing){
      existing.remove();
      openPopoverBoxId = null;
      return;
    }

    openPopoverBoxId = boxId;
    const pop = buildBoxPopover(boxEl, boxId);
    if(pop) boxEl.appendChild(pop);
  };

  // close popover on outside click
  document.addEventListener('mousedown', (e) => {
    if(!openPopoverBoxId) return;
    const boxEl = boxesLayer.querySelector(`.box[data-boxid="${openPopoverBoxId}"]`);
    if(!boxEl) { openPopoverBoxId = null; return; }
    if(boxEl.contains(e.target)) return; // inside
    closePopover();
  });

  // ---------- box move / resize ----------
  let drag = null;

  const onBoxMouseDown = (e, boxId) => {
    // left button only
    if(e.button !== 0) return;

    const boxEl = e.currentTarget;
    const isTool = e.target.closest('.boxTools') || e.target.classList.contains('resizeHandle');
    if(isTool) return;

    const toggle = isSelectToggle(e);
    if(toggle){
      toggleSelectBox(boxId);
      return;
    }

    // if not selected, select single
    if(!selectedSet().has(boxId)){
      setSelected([boxId]);
    }

    closePopover();

    const z = state.ui.zoom || 1;
    const startX = e.clientX;
    const startY = e.clientY;

    const selIds = state.selectedBoxIds.length ? state.selectedBoxIds : [boxId];
    const starts = selIds.map(id => {
      const b = getBoxById(id);
      return b ? {id, x:b.x, y:b.y} : null;
    }).filter(Boolean);

    drag = { type:'move', startX, startY, starts, zoom:z };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const onResizeMouseDown = (e, boxId) => {
    if(e.button !== 0) return;
    e.stopPropagation();
    closePopover();

    if(!selectedSet().has(boxId)) setSelected([boxId]);

    const b = getBoxById(boxId);
    if(!b) return;
    const z = state.ui.zoom || 1;
    drag = {
      type:'resize',
      boxId,
      startX: e.clientX,
      startY: e.clientY,
      startW: b.w,
      startH: b.h,
      zoom: z,
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const onMouseMove = (e) => {
    if(!drag) return;
    const dx = (e.clientX - drag.startX) / drag.zoom;
    const dy = (e.clientY - drag.startY) / drag.zoom;

    if(drag.type === 'move'){
      drag.starts.forEach(s => {
        const b = getBoxById(s.id);
        if(!b) return;
        b.x = Math.round(s.x + dx);
        b.y = Math.round(s.y + dy);
      });
      renderBoxes();
      markDirty();
      return;
    }

    if(drag.type === 'resize'){
      const b = getBoxById(drag.boxId);
      if(!b) return;
      b.w = Math.round(clamp(drag.startW + dx, 160, 640));
      b.h = Math.round(clamp(drag.startH + dy, 90, 420));
      renderBoxes();
      markDirty();
    }
  };

  const onMouseUp = () => {
    drag = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  // ---------- align / distribute ----------
  const getSelectedBoxes = () => {
    const s = selectedSet();
    return state.boxes.filter(b => s.has(b.id));
  };

  const alignH = () => {
    const sel = getSelectedBoxes();
    if(sel.length < 2) return;
    const y = Math.round(sel.reduce((acc,b)=>acc+b.y,0)/sel.length);
    sel.forEach(b => b.y = y);
    markDirty(); renderBoxes();
  };
  const alignV = () => {
    const sel = getSelectedBoxes();
    if(sel.length < 2) return;
    const x = Math.round(sel.reduce((acc,b)=>acc+b.x,0)/sel.length);
    sel.forEach(b => b.x = x);
    markDirty(); renderBoxes();
  };
  const spaceH = () => {
    const sel = getSelectedBoxes().sort((a,b)=>a.x-b.x);
    if(sel.length < 3) return;
    const left = sel[0].x;
    const right = sel[sel.length-1].x;
    const gap = (right - left) / (sel.length-1);
    sel.forEach((b,i)=> b.x = Math.round(left + gap*i));
    markDirty(); renderBoxes();
  };
  const spaceV = () => {
    const sel = getSelectedBoxes().sort((a,b)=>a.y-b.y);
    if(sel.length < 3) return;
    const top = sel[0].y;
    const bottom = sel[sel.length-1].y;
    const gap = (bottom - top) / (sel.length-1);
    sel.forEach((b,i)=> b.y = Math.round(top + gap*i));
    markDirty(); renderBoxes();
  };

  // ---------- events ----------
  tabBtns.forEach(btn => btn.addEventListener('click', ()=> setTab(btn.dataset.tab)));

  toggleSide.addEventListener('click', () => {
    state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
    applySidebar();
    markDirty();
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Tab'){
      e.preventDefault();
      state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
      applySidebar();
      markDirty();
    }
    if(e.key === 'Delete' || e.key === 'Backspace'){
      // don't hijack when typing
      const tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
      if(tag === 'input' || tag === 'textarea') return;
      deleteSelectedBoxes();
    }
    if(e.key === 'Escape'){
      closePopover();
      clearSelection();
    }
  });

  addWaitBtn.addEventListener('click', ()=> addWaiting(nameInput.value));
  nameInput.addEventListener('keydown', (e)=> { if(e.key === 'Enter') addWaiting(nameInput.value); });

  searchInput.addEventListener('input', ()=> renderWait());

  addBoxBtn.addEventListener('click', addBox);
  deleteSelectedBtn.addEventListener('click', deleteSelectedBoxes);

  selectModeBtn.addEventListener('click', () => {
    state.ui.selectMode = !state.ui.selectMode;
    selectModeBtn.classList.toggle('active', state.ui.selectMode);
    markDirty();
  });

  alignHBtn.addEventListener('click', alignH);
  alignVBtn.addEventListener('click', alignV);
  spaceHBtn.addEventListener('click', spaceH);
  spaceVBtn.addEventListener('click', spaceV);

  zoomIn.addEventListener('click', ()=> { state.ui.zoom = clamp(state.ui.zoom + 0.1, 0.3, 2.5); applyZoom(); markDirty(); });
  zoomOut.addEventListener('click', ()=> { state.ui.zoom = clamp(state.ui.zoom - 0.1, 0.3, 2.5); applyZoom(); markDirty(); });
  zoomReset.addEventListener('click', ()=> { state.ui.zoom = 1; applyZoom(); markDirty(); });

  // ctrl/meta + wheel zoom
  const canvasWrap = document.querySelector('.canvasWrap');
  canvasWrap.addEventListener('wheel', (e) => {
    if(!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    state.ui.zoom = clamp(state.ui.zoom + (delta>0 ? -0.06 : 0.06), 0.3, 2.5);
    applyZoom();
    markDirty();
  }, { passive:false });

  // click empty canvas clears selection / popover
  canvasWrap.addEventListener('mousedown', (e) => {
    const hitBox = e.target.closest('.box');
    if(!hitBox){
      closePopover();
      if(!isSelectToggle(e)) clearSelection();
    }
  });

  // ---------- ticker (update timers) ----------
  const updateSeatTimers = () => {
    // Update only the time text inside existing box DOM (NO full re-render).
    // This keeps the o-button popover from disappearing/flickering.
    for(const b of state.boxes){
      const boxEl = boxesLayer.querySelector(`.box[data-boxid="${b.id}"]`);
      if(!boxEl) continue;
      if(b.seatPersonId){
        const p = getPersonById(b.seatPersonId);
        if(!p) continue;
        const nameEl = boxEl.querySelector(".seatName");
        const timeEl = boxEl.querySelector(".boxTimeBottom");
        if(nameEl && nameEl.textContent !== p.name) nameEl.textContent = p.name;
        if(timeEl) timeEl.textContent = fmtMS(now() - p.createdAt);
      } else {
        const timeEl = boxEl.querySelector(".boxTimeBottom");
        if(timeEl) timeEl.textContent = '';
      }

      if(openPopoverBoxId === b.id){
        const pop = boxEl.querySelector(".boxPopover");
        if(pop && typeof pop._updateVal === "function") pop._updateVal();
      }
    }
  };

  setInterval(() => {
    // list timers
    renderWait();
    renderAssigned();
    // box timers (no DOM rebuild)
    updateSeatTimers();
  }, 1000);

  // ---------- initial render ----------
  const renderAll = () => {
    applySidebar();
    applyZoom();
    selectModeBtn.classList.toggle('active', state.ui.selectMode);
    setTab(state.ui.tab);
    renderWait();
    renderAssigned();
    renderBoxes();
  };

  renderAll();
})();
