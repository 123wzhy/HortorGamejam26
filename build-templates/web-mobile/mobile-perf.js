// Render-resolution cap, driven ONLY by a ?dpr= URL parameter.
// The host app decides the cap before Cocos Creator initializes its canvas.
(function () {
  try {
    var match = (location.search || "").match(/[?&]dpr=(-?[0-9.]+)/);
    if (!match) return;
    var cap = parseFloat(match[1]);
    if (!(cap > 0)) return;
    var real = window.devicePixelRatio || 1;
    if (real > cap) {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: function () { return cap; },
        set: function () {}
      });
      console.log("[mobile-perf] DPR " + real + " -> " + cap);
    }
  } catch (error) {}
})();
