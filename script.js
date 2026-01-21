// === CONFIG ===
const PLAYERS_API = "/api/players";
const METRICS_API = "/api/metrics";
const SHIFTS_API = "/api/shifts";

// Column mappings (0-indexed: A=0, B=1, C=2, etc.)
const SHIFT_COLUMNS = {
  "Shift-1": { icName: 2, license: 3 },     // C, D
  "Shift-2": { icName: 6, license: 7 },     // G, H
  "Full Shift": { icName: 10, license: 11 }, // K, L
  "Staff": { icName: 16, license: 17 }       // Q, R
};

// === UTIL ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour12: true });
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i+1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(cell); cell = ""; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch === '\r') { /* ignore */ }
      else { cell += ch; }
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

// === STATE ===
let shiftGroups = {};
let lastPlayers = [];
let lastMeta = { maxPlayers: "?", uptime: "N/A", playerCount: 0 };
let lastUpdated = null;

let refreshInterval = 30;
let refreshCounter = refreshInterval;
let refreshTimer;
let loading = false;

// === FETCH ===
async function fetchWithTimeout(url, { timeout = 5000 } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchShiftGroups() {
  try {
    const res = await fetchWithTimeout(SHIFTS_API, { timeout: 6000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const csvText = await res.text();
    const rows = parseCsv(csvText);
    const dataRows = rows.slice(6);

    const groups = { "Shift-1": [], "Shift-2": [], "Full Shift": [], "Staff": [] };

    for (const row of dataRows) {
      for (const [shiftName, cols] of Object.entries(SHIFT_COLUMNS)) {
        const icName = (row[cols.icName] || "").trim();
        const license = (row[cols.license] || "").trim();
        if (icName && license) {
          groups[shiftName].push({ license, icName });
        }
      }
    }

    console.log("✅ Loaded shift groups:", groups);
    return groups;
  } catch (err) {
    console.error("❌ Failed to load shift groups:", err);
    return { "Shift-1": [], "Shift-2": [], "Full Shift": [], "Staff": [] };
  }
}

async function getPlayers() {
  const res = await fetchWithTimeout(PLAYERS_API, { timeout: 6000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const json = await res.json();
  if (json.statusCode !== 200) throw new Error(json.error || "API error");
  
  return json.data || [];
}

async function getMetrics() {
  const res = await fetchWithTimeout(METRICS_API, { timeout: 6000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const json = await res.json();
  if (json.statusCode !== 200) {
    console.warn("Metrics API error, using defaults");
    return { maxPlayers: "?", uptime: "N/A", playerCount: lastPlayers.length || 0 };
  }
  
  return json.data || { maxPlayers: "?", uptime: "N/A", playerCount: lastPlayers.length || 0 };
}

// === UI ===
function setMeta(metrics) {
  $("#server-count").textContent = `${metrics.playerCount}/${metrics.maxPlayers}`;
  $("#server-uptime").textContent = `Uptime: ${metrics.uptime}`;
}

function showWarning(msg) {
  const w = $("#warning");
  w.style.display = "block";
  w.textContent = msg;
}

function hideWarning() {
  $("#warning").style.display = "none";
}

function setSpinner(on) {
  const icon = $("#refresh-status img");
  if (!icon) return;
  icon.style.animation = on ? "spin 0.9s linear infinite" : "";
}

function updateRefreshDisplay() {
  const el = $("#refresh-timer");
  if (!el) return;
  const next = `${refreshCounter}s`;
  const updated = lastUpdated ? ` • Last updated: ${lastUpdated}` : "";
  el.textContent = `${next}${updated}`;
}

function showToast(message) {
  // Remove any existing toast
  const existingToast = $(".toast");
  if (existingToast) existingToast.remove();

  // Create new toast
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// === RENDER ===
function renderPlayers() {
  const table = $("#players-table");
  table.innerHTML = `
    <tr>
      <th>No.</th>
      <th>ID</th>
      <th>Name</th>
      <th>IC Name</th>
      <th>Role</th>
    </tr>`;

  const searchVal = ($("#search").value || "").trim().toLowerCase();
  const filter = $("#shift-filter").value;

  const shiftMap = new Map();
  for (const [shiftName, members] of Object.entries(shiftGroups)) {
    for (const { license, icName } of members) {
      if (!shiftMap.has(license)) shiftMap.set(license, []);
      shiftMap.get(license).push({ shift: shiftName, icName });
    }
  }

  const filtered = lastPlayers.filter((p) => {
    const name = p?.playerName || "";
    const id = String(p?.source ?? "").toLowerCase();
    const license = (p?.licenseIdentifier || "").toLowerCase();

    const matchesSearch =
      !searchVal ||
      name.toLowerCase().includes(searchVal) ||
      id.includes(searchVal) ||
      license.includes(searchVal);

    if (!matchesSearch) return false;

    if (filter !== "all") {
      const playerData = shiftMap.get(p?.licenseIdentifier);
      if (!playerData) return false;
      return playerData.some(d => d.shift === filter);
    }
    return true;
  });

  filtered.forEach((p, i) => {
    const name = p?.playerName || "Unknown";
    const id = p?.source ?? "-";
    const license = p?.licenseIdentifier || "";
    
    const playerData = shiftMap.get(license);
    const icName = playerData ? [...new Set(playerData.map(d => d.icName))].join(" • ") : "-";
    const roles = playerData ? playerData.map(d => d.shift).join(" • ") : "-";

    table.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${i + 1}</td>
        <td>${id}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(icName)}</td>
        <td>${roles}</td>
      </tr>`);
  });

  if (filtered.length === 0) {
    table.insertAdjacentHTML("beforeend", `<tr><td colspan="5">No players match your filters.</td></tr>`);
  }
}

// === LOAD ===
async function loadData() {
  if (loading) return;
  loading = true;

  const loader = $("#loader");
  try {
    loader.style.display = "flex";
    setSpinner(true);

    const [players, metrics] = await Promise.all([
      getPlayers(),
      getMetrics()
    ]);

    const sorted = players.slice().sort((a, b) => (a?.source ?? 0) - (b?.source ?? 0));

    lastPlayers = sorted;
    lastMeta = { ...metrics, playerCount: sorted.length }; // Always use actual player count for accuracy
    lastUpdated = nowTime();

    hideWarning();
    setMeta(lastMeta);
    renderPlayers();
    showToast("Server data loaded successfully");
  } catch (err) {
    console.error("Load failed:", err);
    if (lastPlayers.length) {
      const ts = lastUpdated || "N/A";
      showWarning(`⚠ Couldn't update, showing last data — last updated at ${ts}`);
      lastMeta.playerCount = lastPlayers.length; // Fallback player count
      setMeta(lastMeta);
      renderPlayers();
    } else {
      $("#players-table").innerHTML = "<tr><td colspan='5'>⚠ Failed to load players.</td></tr>";
    }
  } finally {
    loader.style.display = "none";
    setSpinner(false);
    resetRefreshTimer();
    loading = false;
  }
}

// === TABS ===
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $$(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

// === FILTERS ===
const debounce = (fn, ms = 150) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

$("#search").addEventListener("input", debounce(renderPlayers, 120));
$("#shift-filter").addEventListener("change", renderPlayers);
$("#refresh-status").addEventListener("click", () => loadData());

// === AUTO REFRESH ===
function startRefreshTimer() {
  refreshCounter = refreshInterval;
  updateRefreshDisplay();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    refreshCounter--;
    updateRefreshDisplay();
    if (refreshCounter <= 0) loadData();
  }, 1000);
}

function resetRefreshTimer() {
  refreshCounter = refreshInterval;
  updateRefreshDisplay();
}

// === DATETIME ===
function updateDateTime() {
  const el = $("#current-datetime");
  if (!el) return;

  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();

  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  el.textContent = `${day}/${month}/${year}, ${hours}:${minutes} ${ampm}`;
}

// === INIT ===
(async function init() {
  const groupsPromise = fetchShiftGroups().catch(() => ({}));
  await loadData();
  shiftGroups = await groupsPromise;
  renderPlayers();
  startRefreshTimer();
  
  setInterval(updateDateTime, 60000);
  updateDateTime();
})();
