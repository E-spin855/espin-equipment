(function () {
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function nowYear() {
    return new Date().getFullYear();
  }

  function uuid() {
    return "id_" + Math.random().toString(36).slice(2, 10);
  }

  function normalizeModality(v) {
    const m = String(v || "").trim().toUpperCase();
    if (m === "X-RAY" || m === "XRAY") return "XRAY";
    if (m === "CATH LAB" || m === "CATH") return "CATH";
    return m || "OTHER";
  }

  function ageFromDomNull(dom) {
    const year = Number(dom);
    if (!year || isNaN(year)) return null;
    return Math.max(0, nowYear() - year);
  }

  function ageFromDomEmpty(dom) {
    const year = Number(dom);
    if (!year) return "";
    return Math.max(0, nowYear() - year);
  }

  window.AxisUtils = {
    todayISO,
    nowYear,
    uuid,
    normalizeModality,
    ageFromDomNull,
    ageFromDomEmpty
  };
})();
