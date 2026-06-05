const config = require('../config.json');

const TARGET_URL = config.target_url;

module.exports = async (req, res) => {
  // Recover original path — Vercel rewrites may change req.url
  const originalPath = req.headers['x-forwarded-path']
    || req.headers['x-original-url']
    || req.url;

  // Health check endpoint
  if (originalPath === '/healthy') {
    return res.status(200).json({
      status: 'ok',
      target: TARGET_URL || 'not set',
      region: config.region || 'default',
      timestamp: new Date().toISOString(),
    });
  }

  // Debug endpoint — dump request info for diagnostics
  if (originalPath === '/debug') {
    return res.status(200).json({
      'req.url': req.url,
      'req.method': req.method,
      originalPath,
      resolvedTarget: TARGET_URL ? new URL(originalPath, TARGET_URL).toString() : 'TARGET_URL not set',
      headers: req.headers,
    });
  }

  if (!TARGET_URL) {
    console.error('target_url is not set in config.json');
    return res.status(500).json({ error: 'Server misconfiguration: target_url not set' });
  }

  const targetUrl = new URL(originalPath, TARGET_URL);

  // Strip ALL caller-identifying headers
  const forwardHeaders = {};
  const stripPrefixes = [
    'x-forwarded', 'x-real', 'x-vercel', 'x-now',
    'cf-', 'x-client', 'true-client',
    'forwarded', 'sec-',
  ];
  const stripExact = [
    'host', 'connection', 'transfer-encoding', 'content-length',
    'referer', 'origin',
    'cookie',
    'x-forwarded-host', 'x-forwarded-path', 'x-original-url',
    'via', 'x-request-id', 'x-trace-id',
  ];

  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (stripExact.includes(lower)) continue;
    if (stripPrefixes.some(p => lower.startsWith(p))) continue;
    forwardHeaders[name] = value;
  }

  // Replace User-Agent with a generic one
  forwardHeaders['user-agent'] = 'Vercel-Proxy/1.0';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      redirect: 'follow',
    };

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.body) {
      fetchOptions.body = Buffer.isBuffer(req.body)
        ? req.body
        : typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body);
    }

    console.log(`[proxy] ${req.method} ${targetUrl.toString()}`);
    const response = await fetch(targetUrl.toString(), fetchOptions);

    // Forward safe response headers
    const exposeHeaders = ['content-type', 'content-length', 'content-encoding',
      'cache-control', 'etag', 'last-modified', 'content-disposition'];
    response.headers.forEach((value, name) => {
      if (exposeHeaders.includes(name.toLowerCase()) || name.toLowerCase().startsWith('x-')) {
        res.setHeader(name, value);
      }
    });

    res.status(response.status);

    if (response.headers.get('content-type')?.includes('application/json')) {
      const json = await response.json();
      return res.json(json);
    }

    const buffer = await response.arrayBuffer();
    return res.send(Buffer.from(buffer));

  } catch (error) {
    console.error(`[proxy] ${req.method} ${targetUrl.toString()} -> ${error.message}`);
    return res.status(502).json({
      error: 'Bad Gateway',
      message: error.message,
      target: targetUrl.toString(),
    });
  }
};
