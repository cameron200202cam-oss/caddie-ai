module.exports = async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  
  res.status(200).json({
    hasUrl: !!url,
    urlValue: url ? url.slice(0, 30) + '...' : 'MISSING',
    hasKey: !!key,
    keyStart: key ? key.slice(0, 10) + '...' : 'MISSING' 
  });
};
