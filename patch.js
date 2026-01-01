/**
 * box-board patch v2: stop "push right" shift + reduce jank on assign-to-box
 *
 * Adds:
 * - Stronger scroll lock (captures canvas wrapper by heuristics)
 * - Temporarily blocks scrollIntoView/scrollTo during drop/assign
 * - Coalesces repeated render() into 1 per animation frame
 *
 * Install:
 * 1) Save as patch.js next to index.html/app.js
 * 2) index.html (after app.js):
 *    <script src="./patch.js?v=2"></script>
 */

(function () {
  "use strict";

  // -------- scroller heuristics --------
  function isScrollable(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    const ox = cs.overflowX;
    const canY = (oy === "auto" || oy === "scroll");
    const canX = (ox === "auto" || ox === "scroll");
    return (canY || canX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
  }

  function findCanvasEl() {
    return document.querySelector("#canvas") || document.querySelector(".canvas") || document.querySelector("[data-canvas]");
  }

  function findScroller() {
    // 1) explicit wrappers
    const direct =
      document.querySelector("#canvasWrap") ||
      document.querySelector(".canvas-wrap") ||
      document.querySelector("#boardWrap") ||
      document.querySelector(".board-wrap");
    if (direct) return direct;

    // 2) nearest scrollable ancestor of canvas
    const canvas = findCanvasEl();
    if (canvas) {
      let p = canvas.parentElement;
      while (p && p !== document.body) {
        if (isScrollable(p)) return p;
        p = p.parentElement;
      }
      // parent is usually the scroller even if not overflowing yet
      if (canvas.parentElement) return canvas.parentElement;
    }

    // 3) fallback
    return document.scrollingElement || document.documentElement || document.body;
  }

  // -------- scroll lock --------
  function withScrollLock(scroller, fn) {
    if (!scroller || typeof fn !== "function") return fn?.();
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;

    try {
      return fn();
    } finally {
      // immediate restore
      scroller.scrollLeft = sx;
      scroller.scrollTop = sy;
      // after layout
      requestAnimationFrame(() => {
        scroller.scrollLeft = sx;
        scroller.scrollTop = sy;
      });
    }
  }

  // -------- block auto scrolling during sensitive operations --------
  let __blockAutoScroll = 0;

  const _origScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...args) {
    if (__blockAutoScroll > 0) return;
    return _origScrollIntoView.apply(this, args);
  };

  // Also wrap scroller.scrollTo when available
  function blockAutoScroll(fn) {
    __blockAutoScroll++;
    const scroller = findScroller();
    const origScrollTo = scroller && scroller.scrollTo ? scroller.scrollTo.bind(scroller) : null;

    if (origScrollTo) {
      scroller.scrollTo = function (...args) {
        if (__blockAutoScroll > 0) return;
        return origScrollTo(...args);
      };
    }

    try {
      return fn();
    } finally {
      __blockAutoScroll--;
      if (origScrollTo && scroller) scroller.scrollTo = origScrollTo;
    }
  }

  // -------- render coalescing --------
  function wrapRender(renderFn) {
    let queued = false;
    let lastArgs = null;

    function requestRenderCoalesced(...args) {
      lastArgs = args;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const scroller = findScroller();
        // Block any auto scroll within render as well
        blockAutoScroll(() => withScrollLock(scroller, () => renderFn.apply(window, lastArgs || [])));
      });
    }

    requestRenderCoalesced.__original = renderFn;
    requestRenderCoalesced.__patched_by_boxboard = true;
    return requestRenderCoalesced;
  }

  function patch() {
    // Wrap render() if present
    if (typeof window.render === "function" && !window.render.__patched_by_boxboard) {
      const original = window.render;
      window.render = wrapRender(original);
      console.log("[patch.js v2] Wrapped window.render(): coalesced + scroll lock + block auto scroll");
    }

    // Wrap seatPersonToBox() if present
    if (typeof window.seatPersonToBox === "function" && !window.seatPersonToBox.__patched_by_boxboard) {
      const originalSeat = window.seatPersonToBox;
      const wrappedSeat = function (...args) {
        const scroller = findScroller();
        return blockAutoScroll(() => withScrollLock(scroller, () => originalSeat.apply(window, args)));
      };
      wrappedSeat.__original = originalSeat;
      wrappedSeat.__patched_by_boxboard = true;
      window.seatPersonToBox = wrappedSeat;
      console.log("[patch.js v2] Wrapped window.seatPersonToBox(): scroll lock + block auto scroll");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patch, { once: true });
  } else {
    patch();
  }
})();
