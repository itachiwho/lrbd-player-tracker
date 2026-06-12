export default async function handler(req, res) {
  // Enable CORS
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

  // Strict origin check (exact match or startsWith for path)
  const isFromAllowedOrigin = allowedDomains.some(domain => 
    referer === `http://${domain}` || 
    referer === `https://${domain}` ||
    referer.startsWith(`http://${domain}/`) ||
    referer.startsWith(`https://${domain}/`)
  );

  // Token check
  const expectedToken = process.env.API_SECRET_TOKEN;
  const hasValidToken = expectedToken && authHeader === `Bearer ${expectedToken}`;

  // Block if neither condition is met
  if (!isFromAllowedOrigin && !hasValidToken) {
    console.log(`[Security] Blocked players.js - Referer/Origin: "${referer}", Auth: ${authHeader ? 'present' : 'missing'}`);
    return res.status(403).json({ 
      error: 'Forbidden',
      message: 'Access denied. This API is restricted to authorized clients only.'
    });
  }

  // Log success
  if (hasValidToken) {
    console.log('[Security] players.js allowed via Bearer token');
  } else {
    console.log(`[Security] players.js allowed via origin: ${referer}`);
  }

  try {
    const PLAYERS_URL = process.env.PLAYERS_API_URL;
    
    if (!PLAYERS_URL) {
      throw new Error('PLAYERS_API_URL not configured');
    }
    
    const response = await fetch(PLAYERS_URL, {
      headers: { 
        'User-Agent': 'Vercel-Serverless',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid API response structure');
    }
    
    res.status(200).json(data);
    
  } catch (error) {
    console.error('Players API Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch players',
      message: error.message,
      statusCode: 500,
      data: []
    });
  }
}