# Send It — Build Spec

## What You're Building

Take `dynasty-trade-block.html` (existing single-file app) and deploy it as an authenticated web app on Vercel. The analysis logic, UI, and API calls do not change. You're adding auth, moving the Anthropic key server-side, and structuring it for deployment.

---

## Repo Structure

```
sendit/
├── public/
│   └── index.html        ← existing HTML, modified per spec below
├── api/
│   └── analyze.js        ← new: API proxy serverless function
├── package.json
└── vercel.json
```

---

## Environment Variables (set in Vercel dashboard, never committed)

| Variable | Source |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console |
| `VITE_FIREBASE_API_KEY` | Firebase project settings |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase project settings |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project settings |

---

## Auth — Firebase (not Clerk)

The developer already uses Firebase Auth + Firestore in another Vercel project. Use the same Firebase project.

**Sign-in:** Google OAuth only.

**Allowlist:** On successful Google sign-in, check Firestore collection `allowlist` for a document matching the user's email. If not found, sign them out and show an access denied screen. This replaces Clerk's allowlist feature.

**Model tier:** Each user document in Firestore collection `users` has a field `allowedModel: "haiku" | "sonnet"`. Defaults to `"haiku"` if the document or field doesn't exist. The developer sets this manually in the Firebase console to grant Sonnet access.

---

## `/api/analyze.js` — Serverless Function

**Input:** POST with `Authorization: Bearer <firebase_id_token>` header and a body containing:
```json
{
  "requestedModel": "haiku" | "sonnet",
  "anthropicPayload": { ...existing Anthropic API payload... }
}
```

**Logic:**
1. Verify Firebase ID token using Firebase Admin SDK — return 401 if invalid
2. Look up user's `allowedModel` in Firestore `users` collection
3. Resolve final model:
   - User has `haiku` → always use Haiku regardless of `requestedModel`
   - User has `sonnet` → use whatever `requestedModel` says
4. Forward `anthropicPayload` to `https://api.anthropic.com/v1/messages` with resolved model and server-side `ANTHROPIC_API_KEY`
5. Return Anthropic's response directly

**Model strings:**
- Haiku: `claude-haiku-4-5-20251001`
- Sonnet: `claude-sonnet-4-6`

**Errors:** 401 bad token, 403 not on allowlist, 500 unexpected. No sensitive details in error responses.

---

## `package.json`

```json
{
  "name": "sendit",
  "version": "1.0.0",
  "dependencies": {
    "firebase-admin": "latest"
  }
}
```

---

## `vercel.json`

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/public/index.html" }
  ]
}
```

---

## `index.html` Changes

### 1. Rename the app
Replace all instances of "Dynasty Trade Analyzer" or "Dynasty Trade Block" with **Send It**.

### 2. Add Firebase Auth SDK in `<head>`
```html
<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
  import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
  import { getFirestore, doc, getDoc }
    from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
  window._firebaseModules = { initializeApp, getAuth, signInWithPopup,
    GoogleAuthProvider, signOut, onAuthStateChanged, getFirestore, doc, getDoc };
</script>
```

### 3. Auth gate
On page load, before rendering anything:
- Not signed in → show sign-in screen (centered, dark theme matching existing UI): app name "Send It", tagline "Dynasty trade analysis. Don't get fleeced.", "Sign in with Google" button
- Signed in, not on allowlist → show: "You don't have beta access yet." with a sign-out link
- Signed in, on allowlist → show the app

### 4. Status bar
One line at the top of the app when signed in:
```
Send It  [Beta]                    👤 [user display name]   [Haiku ▾]   [Sign out]
```
The model selector in the status bar reflects the current selection. If user only has Haiku access, Sonnet option is greyed out with tooltip "Not available for your account."

### 5. Model selector
Haiku/Sonnet toggle. Haiku default. Locked to Haiku if `allowedModel` is `"haiku"`.

### 6. Replace the API call
Remove the direct Anthropic fetch and the API key input field. Replace with:

```javascript
const token = await firebase.auth().currentUser.getIdToken();
const res = await fetch('/api/analyze', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    requestedModel: selectedModel,
    anthropicPayload: { ...existingAnthropicPayload }
  })
});
```

The existing tool-use loop and all response parsing stays exactly the same.

---

## Firestore Setup (developer does this manually)

Collection: `allowlist`
- Document ID = user email
- Content: `{ "email": "user@gmail.com" }`

Collection: `users`
- Document ID = user email  
- Content: `{ "allowedModel": "haiku" }` or `{ "allowedModel": "sonnet" }`

To grant Sonnet: update the user's doc in Firebase console. Takes effect on their next request.

---

## Definition of Done

- [ ] Unauthenticated users see sign-in screen, not the app
- [ ] Google sign-in works
- [ ] Email not on allowlist → access denied screen
- [ ] Signed-in user sees full app with status bar
- [ ] Anthropic API key not visible in browser network tab
- [ ] Model selector works, Sonnet locked unless granted
- [ ] All existing functionality works identically (Sleeper fetch, FantasyCalc values, trade generation, Reddit search, KTC links, copy button)
- [ ] Deployed and accessible at `sendit.vercel.app` or similar
