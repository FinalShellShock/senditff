const admin = require('firebase-admin');

// Initialize Firebase Admin once per cold start
// Set FIREBASE_SERVICE_ACCOUNT_JSON in Vercel dashboard (paste the full service account JSON as a string)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    ),
  });
}

const db = admin.firestore();

const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-6';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Verify Firebase ID token
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const idToken = authHeader.slice(7);

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const email = decodedToken.email;
  if (!email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 2. Check allowlist
    const allowlistDoc = await db.collection('allowlist').doc(email).get();
    if (!allowlistDoc.exists) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 3. Get user's allowed model (defaults to haiku)
    const userDoc = await db.collection('users').doc(email).get();
    const allowedModel = userDoc.exists
      ? (userDoc.data()?.allowedModel || 'haiku')
      : 'haiku';

    const { requestedModel, anthropicPayload } = req.body;

    // 4. Resolve final model: haiku users always get haiku; sonnet users get their choice
    const finalModel =
      allowedModel === 'sonnet' && requestedModel === 'sonnet'
        ? MODEL_SONNET
        : MODEL_HAIKU;

    // 5. Forward to Anthropic with resolved model and server-side API key
    const tools = anthropicPayload.tools || [];
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    };
    // Enable native web search if the client requested it
    if (tools.some(t => t.type === 'web_search_20250305')) {
      headers['anthropic-beta'] = 'web-search-2025-03-05';
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...anthropicPayload,
        model: finalModel,
      }),
    });

    const data = await anthropicRes.json();
    return res.status(anthropicRes.status).json(data);
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
