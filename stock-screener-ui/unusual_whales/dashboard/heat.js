/* Heat-map colour helper — signed rgba() fill scaled by a shared max. */
(function () {
  const U = (window.UW = window.UW || {});

  // rgba() colour for a value vs a max (0..1 intensity); "" when max<=0
  U.heat = function (value, max) {
    if (!(max > 0)) return "";
    const t = Math.min(1, Math.abs(Number(value) || 0) / max);
    return Number(value) < 0 ? `rgba(220,38,38,${t * 0.45})` : `rgba(22,163,74,${t * 0.45})`;
  };
})();
