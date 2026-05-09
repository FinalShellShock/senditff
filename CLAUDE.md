# Send It — Fantasy Trade Analyzer

A fantasy sports trade analyzer that uses Claude AI to evaluate trades. Users authenticate with Google (Firebase), and the AI analysis is gated behind a subscription check.

## Stack

- **Frontend:** Single HTML file at `public/index.html` — vanilla JS, no build step
- **Backend:** Vercel serverless function at `api/analyze.js` (Node.js)
- **Auth & DB:** Firebase (Google sign-in, Firestore for user/subscription data)
- **AI:** Anthropic Claude API (Haiku and Sonnet selectable per user)
- **Deployment:** Vercel (auto-deploys from `main` branch on GitHub)

## Project Structure

```
senditff/
├── public/
│   └── index.html      # entire frontend (HTML + CSS + JS in one file)
├── api/
│   └── analyze.js      # serverless API handler — calls Claude, checks subscriptions
├── package.json
└── vercel.json         # routes /api/* to functions, everything else to index.html
```

## Environment Variables

These are **never committed to git**. In production they live in the Vercel dashboard.
For local dev, create a `.env` file (already gitignored) with:

```
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}   # full JSON as a string
ANTHROPIC_API_KEY=sk-ant-...
```

## Development Workflow

This app has no build step. To make changes:
1. Edit `public/index.html` (frontend) or `api/analyze.js` (backend)
2. Commit and push to `main` → Vercel auto-deploys in ~30 seconds
3. Test at the live Vercel URL

For local backend testing, install the Vercel CLI (`npm i -g vercel`) and run `vercel dev`.

## Key Concepts

- **Subscription check:** `api/analyze.js` reads `users/{email}` in Firestore and checks `subscribed: true` before allowing AI calls
- **Auth flow:** Firebase Google sign-in in the browser; the ID token is sent as a Bearer token to `/api/analyze`
- **Model selection:** Users can pick Haiku (faster/cheaper) or Sonnet (better quality); stored per-user in Firestore
- **Trade value:** The frontend has a built-in value chart; AI analysis supplements this with context-aware reasoning
