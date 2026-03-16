<script>
(() => {
  if (localStorage.getItem("espinAuth") !== "true") {
    location.replace("index.html");
  }
})();

/* USER */
const userEmail = (localStorage.getItem("espinUserEmail") || "")
  .toLowerCase()
  .trim();

/* API */
const API_BASE = "";

/* PROJECT ID — ALWAYS RESOLVE */
const params = new URLSearchParams(location.search);

let projectId =
  params.get("projectId") ||
  params.get("id") ||
  localStorage.getItem("activeProjectId") ||
  null;

/* ensure valid uuid */
if (projectId) {
  const m = String(projectId).match(/[0-9a-fA-F-]{36}/);
  projectId = m ? m[0] : null;
}

if (!projectId) {
  console.error("Missing projectId");
}

localStorage.setItem("activeProjectId", projectId);

/* BACK NAV */
function handleBack(){
 location.href="equipment-details.html?projectId=" + projectId;
}

/* IMAGE ID RESOLVER */
function getPrimaryId(p){
 return String(
   p?.id ||
   p?.photoId ||
   p?.photo_id ||
   p?.uuid ||
   p?.image_id ||
   p?.imageId ||
   ""
 ).trim();
}

/* ===============================
   NEW PILL LOGIC
=============================== */

const BADGE_STORAGE_KEY = `new_images_${projectId}`;
const BADGE_KV_KEY = `project:badges_images:${projectId}:${userEmail}`;

let newImageIds = new Set();

/* load local state */
try {
  const local = JSON.parse(localStorage.getItem(BADGE_STORAGE_KEY) || "[]");
  local.forEach(id => newImageIds.add(id));
} catch {}

/* mark seen */
function clearNewImage(id){
  if(!newImageIds.has(id)) return;

  newImageIds.delete(id);

  localStorage.setItem(
    BADGE_STORAGE_KEY,
    JSON.stringify([...newImageIds])
  );
}

/* render badge */
function renderNewBadge(card,id){

  if(!newImageIds.has(id)) return;

  const badge=document.createElement("div");

  badge.textContent="NEW";

  badge.style.cssText=`
  position:absolute;
  top:10px;
  right:10px;
  background:#d93025;
  color:#fff;
  font-size:11px;
  font-weight:800;
  padding:4px 7px;
  border-radius:6px;
  z-index:10;
  `;

  card.style.position="relative";

  card.appendChild(badge);
}
</script>