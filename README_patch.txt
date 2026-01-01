Box Board Patch (scroll lock + render coalescing)

What this fixes
- When you drag a waiting person into BOX1, the box/canvas appears to shift to the right (scroll/relayout jump).
- Jank/stutter caused by multiple back-to-back render() calls.

Install
1) Save patch.js next to index.html and app.js
2) In index.html, add AFTER app.js:
   <script src="./patch.js?v=1"></script>

3) Commit & push:
   git add patch.js index.html
   git commit -m "Add patch: scroll lock + render coalescing"
   git push

4) Hard refresh: Cmd + Shift + R
