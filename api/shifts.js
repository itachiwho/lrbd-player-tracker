export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  
  try {
    const CSV_URL = process.env.CSV_URL;
    
    if (!CSV_URL) {
      throw new Error('CSV_URL not configured');
    }
    
    const response = await fetch(CSV_URL, {
      headers: { 
        'User-Agent': 'Vercel-Serverless',
        'Accept': 'text/csv'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const csvText = await response.text();
    
    // Return CSV as plain text
    res.setHeader('Content-Type', 'text/csv');
    res.status(200).send(csvText);
    
  } catch (error) {
    console.error('Shifts API Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch shift data',
      message: error.message,
      statusCode: 500
    });
  }
}
