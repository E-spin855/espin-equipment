/* ESPIN LINK sandbox access guard. Include before page-specific scripts. */
(function () {
  "use strict";
  const KEY = "espinSandboxSession";
  const LOGIN = "index.html";
  const session = (() => { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (_) { return null; } })();
  const deny = () => { sessionStorage.removeItem(KEY); location.replace(LOGIN); };
  const expired = session && session.expires_at && Date.parse(session.expires_at) <= Date.now();
  if (!session || expired || !Array.isArray(session.allowed_views)) return deny();
  const declaredPage = String(document.body.dataset.sandboxPage || "").toLowerCase();
  const page = declaredPage === "rep" ? String(session.active_view || "").toLowerCase() : declaredPage;
  const allowed = session.allowed_views.includes(page);
  const managerPage = page === "manager";
  const repPage = /^rep_[abc]$/.test(page);
  if (!allowed || (managerPage && session.role !== "manager") || (repPage && session.role === "rep" && session.assigned_rep_id !== page.toUpperCase())) return deny();
  window.ESPIN_SANDBOX = Object.freeze(session);
  window.espinSandboxLogout = () => { sessionStorage.removeItem(KEY); location.replace(LOGIN); };
})();
