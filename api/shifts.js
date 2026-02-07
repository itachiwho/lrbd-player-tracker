// ============================================
// CACHE CONFIGURATION
// ============================================
let cache = {
  data: null,
  timestamp: 0
};
const CACHE_TTL = 60000; // 1 minute (adjust as needed)

// ============================================
// RETRY HELPER FUNCTION
// ============================================
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`[Airtable] Attempt ${attempt + 1}/${maxRetries}`);
      
      const response = await fetch(url, options);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      console.log(`[Airtable] ✓ Request successful on attempt ${attempt + 1}`);
      return response;
      
    } catch (error) {
      lastError = error;
      console.error(`[Airtable] ✗ Attempt ${attempt + 1} failed:`, error.message);
      
      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // 1s, 2s, 4s (max 5s)
        console.log(`[Airtable] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError; // All attempts failed
}

export default async function handler(req, res) {
  // Enable CORS for your frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

// ============================================
// SECURITY CHECK: Referrer + Bearer Token
// ============================================
const referer = req.headers.referer || req.headers.origin || '';
const authHeader = req.headers.authorization || '';

// Get allowed domains
const deploymentUrl = process.env.VERCEL_URL || '';
const allowedDomains = [
  deploymentUrl,                        // auto-detected Vercel URL
  'fivem-player-list.vercel.app',       // ← your actual live domain
  'localhost:3000',                     // local dev
  'localhost:5173',                     // Vite/VS Code live server
  '127.0.0.1'
];

// Strict check: Only allow if:
// 1. Referer/Origin matches allowed domains EXACTLY (no partial matches)
const isFromAllowedOrigin = allowedDomains.some(domain => 
  referer === `http://${domain}` || 
  referer === `https://${domain}` ||
  referer.startsWith(`http://${domain}/`) ||
  referer.startsWith(`https://${domain}/`)
);

// 2. OR has valid Bearer token
const expectedToken = process.env.API_SECRET_TOKEN;
const hasValidToken = expectedToken && authHeader === `Bearer ${expectedToken}`;

// Block if neither condition is met
if (!isFromAllowedOrigin && !hasValidToken) {
  console.log(`[Security] Blocked - Referer/Origin: "${referer}", Auth: ${authHeader ? 'present' : 'missing'}`);
  return res.status(403).json({ 
    error: 'Forbidden',
    message: 'Access denied. This API is restricted to authorized clients only.'
  });
}

// Log success
if (hasValidToken) {
  console.log('[Security] Allowed via Bearer token');
} else {
  console.log(`[Security] Allowed via origin: ${referer}`);
}

  // ============================================
  // CACHE CHECK
  // ============================================
  const now = Date.now();
  if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
    console.log('[Cache] Serving cached roster data');
    return res.status(200).json(cache.data);
  }

  try {
    const pat = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableName = 'Players';

    if (!pat || !baseId) {
      throw new Error('Missing AIRTABLE_PAT or AIRTABLE_BASE_ID');
    }

    // Server-side filter: Only rows where License is NOT empty
    const filterFormula = `NOT({License} = BLANK())`;
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(filterFormula)}`;

    const response = await fetchWithRetry(url, {
      headers: {
        'Authorization': `Bearer ${pat}`
      }
    });

    const data = await response.json();
    const records = data.records || [];

    console.log(`Fetched ${records.length} records with filled License (server-side filtered)`);

    const shiftData = records.map(record => {
      const f = record.fields || {};
      return {
        license: (f.License || '').trim(),
        icName: (f['IC Name'] || '').trim(),
        role: (f.Role || []).join(' • ') || '-'
      };
    });

    // Update cache
    cache.data = shiftData;
    cache.timestamp = now;

    res.status(200).json(shiftData);

  } catch (error) {
    console.error('Shifts API Error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch shift data',
      message: error.message
    });
  }
}