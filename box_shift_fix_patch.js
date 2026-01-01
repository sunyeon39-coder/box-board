/* =========================================================
   Box Board - Box Shift / Jank Fix Patch
   목적:
   - 대기자 드롭/배치 시 캔버스가 "오른쪽으로 밀리는" 현상(스크롤 튐) 방지
   - 드롭/배치 중 과도한 render 호출로 인한 버벅임 완화

   사용법(권장):
   1) 이 파일을 프로젝트 루트(index.html, app.js 있는 곳)에 저장: box_shift_fix_patch.js
   2) index.html에서 app.js 아래에 추가:
      <script src="./box_shift_fix_patch.js?v=1"></script>

   ========================================================= */

(() => {
  "use strict";

  const CONFIG = {
    blockAutoScrollDuringMutations: true,
    batchRender: true,
    scrollerSelectors: ["#canvasWrap", "#canvas", ".canvas-wrap", ".canvas", "#boardCanvas"],
    debug: false,
  };

  function log(...args) {
    if (CONFIG.debug) console.log("[shift-fix]", ...args);
  }

  function getMainScroller() {
    for (const sel of CONFIG.scrollerSelectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.scrollingElement || document.documentElement;
  }

  function preserveScroll(fn) {
    const sc = getMainScroller();
    if (!sc) return fn();

    const left = sc.scrollLeft;
    const top = sc.scrollTop;

    const prevBehavior = sc.style.scrollBehavior;
    sc.style.scrollBehavior = "auto";

    fn();

    requestAnimationFrame(() => {
      try {
        sc.scrollLeft = left;
        sc.scrollTop = top;
      } finally {
        sc.style.scrollBehavior = prevBehavior;
      }
    });
  }

  let _renderQueued = false;
  function scheduleRender(renderFn) {
    if (!CONFIG.batchRender) return preserveScroll(renderFn);
    if (_renderQueued) return;
    _renderQueued = true;
    requestAnimationFrame(() => {
      _renderQueued = false;
      preserveScroll(renderFn);
    });
  }

  let _scrollBlocked = 0;
  function withScrollBlocked(fn) {
    _scrollBlocked++;
    try {
      return fn();
    } finally {
      _scrollBlocked--;
    }
  }

  const _orig = {
    el_scrollIntoView: Element.prototype.scrollIntoView,
    win_scrollTo: window.scrollTo,
    el_scrollTo: Element.prototype.scrollTo,
  };

  function installScrollBlockers() {
    if (!CONFIG.blockAutoScrollDuringMutations) return;

    Element.prototype.scrollIntoView = function (...args) {
      if (_scrollBlocked > 0) {
        log("blocked scrollIntoView", this);
        return;
      }
      return _orig.el_scrollIntoView.apply(this, args);
    };

    window.scrollTo = function (...args) {
      if (_scrollBlocked > 0) {
        log("blocked window.scrollTo", args);
        return;
      }
      return _orig.win_scrollTo.apply(window, args);
    };

    Element.prototype.scrollTo = function (...args) {
      if (_scrollBlocked > 0) {
        log("blocked el.scrollTo", this, args);
        return;
      }
      return _orig.el_scrollTo.apply(this, args);
    };
  }

  function tryHookGlobals() {
    if (typeof window.render === "function" && !window.render.__shiftFixWrapped) {
      const origRender = window.render;
      function wrappedRender(...args) {
        return scheduleRender(() => origRender.apply(this, args));
      }
      wrappedRender.__shiftFixWrapped = true;
      window.render = wrappedRender;
      log("hooked window.render");
    }

    if (typeof window.seatPersonToBox === "function" && !window.seatPersonToBox.__shiftFixWrapped) {
      const orig = window.seatPersonToBox;
      function wrappedSeatPersonToBox(...args) {
        return withScrollBlocked(() => orig.apply(this, args));
      }
      wrappedSeatPersonToBox.__shiftFixWrapped = true;
      window.seatPersonToBox = wrappedSeatPersonToBox;
      log("hooked window.seatPersonToBox");
    }

    if (typeof window.saveState === "function" && !window.saveState.__shiftFixWrapped) {
      const orig = window.saveState;
      function wrappedSaveState(...args) {
        return orig.apply(this, args);
      }
      wrappedSaveState.__shiftFixWrapped = true;
      window.saveState = wrappedSaveState;
      log("hooked window.saveState");
    }
  }

  function installDnDGuards() {
    document.addEventListener(
      "drop",
      () => {
        withScrollBlocked(() => {});
      },
      true
    );

    document.addEventListener(
      "pointerup",
      () => {
        _scrollBlocked++;
        setTimeout(() => {
          _scrollBlocked = Math.max(0, _scrollBlocked - 1);
        }, 50);
      },
      true
    );
  }

  installScrollBlockers();
  installDnDGuards();

  tryHookGlobals();
  window.addEventListener("load", () => {
    tryHookGlobals();
    let n = 0;
    const t = setInterval(() => {
      tryHookGlobals();
      n++;
      if (n >= 20) clearInterval(t);
    }, 250);
  });

  window.__shiftFix = {
    preserveScroll,
    scheduleRender,
    withScrollBlocked,
    getMainScroller,
    setDebug(v) {
      CONFIG.debug = !!v;
    },
  };
})();
