/* Include before page scripts.  This is a UI guard; server endpoints also verify the signed auth cookie. */
(function () {
  const key = "espinSandboxSession";
  let s; try { s = JSON.parse(sessionStorage.getItem(key) || "null"); } catch (_) { s = null; }
  const deny = () => { sessionStorage.removeItem(key); location.replace("index.html"); };
  const page = document.body.dataset.sandboxPage === "rep" ? s?.active_view : document.body.dataset.sandboxPage;
  if (!s || (s.expires_at && Date.parse(s.expires_at) <= Date.now()) || !s.allowed_views?.includes(page) || (page === "manager" && !["manager", "sandbox_admin"].includes(s.role)) || (/^rep_[abc]$/.test(page) && s.role === "rep" && s.assigned_rep_id !== page.toUpperCase())) return deny();
  window.ESPIN_SANDBOX = Object.freeze(s);
  window.espinSandboxLogout = () => { sessionStorage.removeItem(key); document.cookie = "espin_sandbox_auth=; Path=/; Max-Age=0; SameSite=Lax"; location.replace("index.html"); };
})();
