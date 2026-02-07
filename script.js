// === CONFIG ===
const PLAYERS_API = "/api/players";
const METRICS_API = "/api/metrics";
const SHIFTS_API = "/api/shifts";

// Cache configuration
const SHIFTS_CACHE_DURATION = 60000; // 1 minute
const MAX_RETRIES = 3;

// === UTIL ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour12: true });
}

// === STATE ===
let shiftMap = new Map(); // license → { icName, role }
let shiftsCache = {
  data: null,
  timestamp: 0
};

let lastPlayers = [];
let lastMeta = { maxPlayers: "?", uptime: "N/A", playerCount: 0 };
let lastUpdated = null;

let refreshInterval = 30;
let refreshCounter = refreshInterval;
let refreshTimer;
let loading = false;

// === RETRY LOGIC ===
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to get friendly name for API endpoint
function getFriendlyName(url) {
  if (url.includes('/shifts')) return 'Shift Data';
  if (url.includes('/players')) return 'Player List';
  if (url.includes('/metrics')) return 'Server Data';
  return 'Data';
}

async function fetchWithRetry(url, options = {}, maxRetries = MAX_RETRIES) {
  let lastError;
  const { timeout = 6000, ...fetchOptions } = options;
  const friendlyName = getFriendlyName(url);
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Only show detailed logs in development mode
      if (window.location.hostname === 'localhost') {
        console.log(`[Fetch] Attempt ${attempt + 1}/${maxRetries} - ${friendlyName}`);
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch(url, { 
          cache: "no-store", 
          signal: controller.signal,
          ...fetchOptions
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Success - only log on first attempt failure or in dev mode
        if (attempt > 0 || window.location.hostname === 'localhost') {
          console.log(`✓ ${friendlyName} loaded successfully`);
        }
        return response;
        
      } finally {
        clearTimeout(timeoutId);
      }
      
    } catch (error) {
      lastError = error;
      
      // Only show retry logs if not the first attempt
      if (attempt > 0) {
        console.warn(`⚠ ${friendlyName} - Retry ${attempt + 1}/${maxRetries}`);
      }
      
      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await wait(delay);
      }
    }
  }
  
  // Failed all retries
  console.error(`✗ Failed to load ${friendlyName} after ${maxRetries} attempts`);
  throw lastError;
}

// === FETCH WITH CACHING ===
async function fetchShiftData() {
  const now = Date.now();
  const cacheAge = now - shiftsCache.timestamp;
  
  // Check if cache is valid
  if (shiftsCache.data && cacheAge < SHIFTS_CACHE_DURATION) {
    console.log(`✓ Shift data loaded from cache (${Math.round(cacheAge / 1000)}s old)`);
    showToast(` Shift data loaded from cache`);
    return shiftsCache.data;
  }
  
  showToast('⏳ Loading shift assignments...');
  
  try {
    const res = await fetchWithRetry(SHIFTS_API, { timeout: 8000 });
    const data = await res.json();
    
    if (data.error) {
      throw new Error(data.message || "API error");
    }

    // Build shiftMap: license → { icName, role }
    const map = new Map();
    data.forEach(item => {
      const license = (item.license || '').trim().toLowerCase();
      if (license) {
        map.set(license, {
          icName: item.icName || '-',
          role: item.role || '-'
        });
      }
    });

    console.log(`✓ Loaded ${map.size} shift assignments`);
    
    // Update cache
    shiftsCache.data = map;
    shiftsCache.timestamp = now;
    
    showToast(` Loaded ${map.size} shift assignments`);
    return map;
    
  } catch (err) {
    console.error("✗ Failed to load shift assignments:", err.message);
    
    // Fallback to stale cache if available
    if (shiftsCache.data) {
      const staleAge = Math.round((now - shiftsCache.timestamp) / 1000);
      console.log(`⚠ Using cached shift data (${staleAge}s old)`);
      showToast(`⚠️ Using cached shift data`);
      return shiftsCache.data;
    }
    
    showToast('⚠️ Failed to load shift data');
    return new Map();
  }
}

async function getPlayers() {
  const res = await fetchWithRetry(PLAYERS_API, { timeout: 8000 });
  const json = await res.json();
  
  if (json.statusCode !== 200) {
    throw new Error(json.error || "API error");
  }
  
  return json.data || [];
}

async function getMetrics() {
  try {
    const res = await fetchWithRetry(METRICS_API, { timeout: 6000 });
    const json = await res.json();
    
    if (json.statusCode !== 200) {
      return { maxPlayers: "?", uptime: "N/A", playerCount: lastPlayers.length || 0 };
    }
    
    return json.data || { maxPlayers: "?", uptime: "N/A", playerCount: lastPlayers.length || 0 };
  } catch (err) {
    console.warn("⚠ Using default server metrics");
    return { maxPlayers: "?", uptime: "N/A", playerCount: lastPlayers.length || 0 };
  }
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
  const existingToast = $(".toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function showLoadingIndicator(message = "Loading...") {
  const indicator = document.createElement("div");
  indicator.id = "loading-indicator";
  indicator.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: rgba(52, 152, 219, 0.95);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 10px;
    backdrop-filter: blur(10px);
    animation: slideInRight 0.3s ease;
  `;
  
  indicator.innerHTML = `
    <div style="
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    "></div>
    <span>${message}</span>
  `;
  
  document.body.appendChild(indicator);
  return indicator;
}

function hideLoadingIndicator() {
  const indicator = $("#loading-indicator");
  if (indicator) {
    indicator.remove();
  }
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

  const filtered = lastPlayers.filter((p) => {
    const name = p?.playerName || "";
    const id = String(p?.source ?? "").toLowerCase();
    const license = (p?.licenseIdentifier || "").toLowerCase();
    
    // Get shift data for IC name search
    const entry = shiftMap.get(license);
    const icName = entry ? entry.icName : "";

    // Search includes IC Name
    const matchesSearch =
      !searchVal ||
      name.toLowerCase().includes(searchVal) ||
      id.includes(searchVal) ||
      license.includes(searchVal) ||
      icName.toLowerCase().includes(searchVal);

    if (!matchesSearch) return false;

    if (filter === "all") return true;

    if (!entry || entry.role === '-') return false;

    // Split combined roles back to array (handles "Shift 1 • Staff" → ["Shift 1", "Staff"])
    const playerRoles = entry.role.split(' • ');

    // Apply your custom rules
    if (filter === "Shift-1") {
      return playerRoles.includes("Shift-1") || playerRoles.includes("Full Shift");
    }
    if (filter === "Shift-2") {
      return playerRoles.includes("Shift-2") || playerRoles.includes("Full Shift");
    }
    if (filter === "Full Shift") {
      return playerRoles.includes("Full Shift");
    }
    if (filter === "Staff") {
      return playerRoles.includes("Staff");
    }

    return false; // fallback
  });

  filtered.forEach((p, i) => {
    const name = p?.playerName || "Unknown";
    const id = p?.source ?? "-";
    const license = (p?.licenseIdentifier || "").toLowerCase();
    
    const entry = shiftMap.get(license);
    const icName = entry ? entry.icName : "-";
    const roles = entry ? entry.role : "-";

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
  const loadingIndicator = showLoadingIndicator("Updating data...");
  
  try {
    loader.style.display = "flex";
    setSpinner(true);

    const [players, metrics] = await Promise.all([
      getPlayers(),
      getMetrics()
    ]);

    const sorted = players.slice().sort((a, b) => (a?.source ?? 0) - (b?.source ?? 0));

    lastPlayers = sorted;
    lastMeta = { ...metrics, playerCount: sorted.length };
    lastUpdated = nowTime();

    hideWarning();
    setMeta(lastMeta);
    renderPlayers();
    
    hideLoadingIndicator();
    showToast(` Updated (${sorted.length} players online)`);
    
  } catch (err) {
    console.error("✗ Update failed:", err.message);
    hideLoadingIndicator();
    
    if (lastPlayers.length) {
      const ts = lastUpdated || "N/A";
      showWarning(`⚠️ Update failed - showing last data from ${ts}`);
      lastMeta.playerCount = lastPlayers.length;
      setMeta(lastMeta);
      renderPlayers();
      showToast('⚠️ Using cached data');
    } else {
      $("#players-table").innerHTML = "<tr><td colspan='5'>Failed to load. Please refresh.</td></tr>";
      showToast('❌ Failed to load data');
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
  console.log('🚀 LRBD Player Tracker - Initializing...');
  
  const initialLoader = showLoadingIndicator("Starting up...");
  
  try {
    showToast('⏳ Loading shift assignments...');
    shiftMap = await fetchShiftData();
    
    await loadData();
    
    startRefreshTimer();
    setInterval(updateDateTime, 60000);
    updateDateTime();
    
    hideLoadingIndicator();
    console.log('✓ Player Tracker ready');
    
  } catch (err) {
    console.error('✗ Initialization error:', err.message);
    hideLoadingIndicator();
    showToast('⚠️ Some features may not work');
    
    startRefreshTimer();
    updateDateTime();
  }
})();