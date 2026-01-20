export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  
  try {
    const METRICS_URL = process.env.METRICS_API_URL;
    
    if (!METRICS_URL) {
      throw new Error('METRICS_API_URL not configured');
    }
    
    const response = await fetch(METRICS_URL, {
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
    if (!data.data) {
      throw new Error('Invalid API response structure');
    }
    
    res.status(200).json(data);
    
  } catch (error) {
    console.error('Metrics API Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch metrics',
      message: error.message,
      statusCode: 500,
      data: { 
        maxPlayers: '?', 
        uptime: 'N/A', 
        playerCount: 0,
        version: 'Unknown',
        queueSize: 0
      }
    });
  }
}