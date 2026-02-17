# GHL App Template

A ready-to-clone template for building GoHighLevel Marketplace apps. OAuth, webhook verification, trigger lifecycle, SSO, and file-based token storage are all pre-wired — just add your app-specific logic.

## Quick Start

```bash
git clone https://github.com/christiansallen/ghl-app-template.git my-ghl-app
cd my-ghl-app
npm install
cp .env.example .env
# Fill in your GHL credentials in .env
npm run dev
```

## Project Structure

```
src/
  index.js              Express server — all routes
  config.js             Centralized env config
  services/
    ghl.js              OAuth, token refresh, trigger firing, SSO decryption
    store.js            File-based JSON storage (tokens + triggers)
    webhook.js          Signature verification + event processing
data/                   Created at runtime, gitignored
  tokens.json           OAuth tokens keyed by locationId
  triggers.json         Trigger subscriptions keyed by locationId
```

## What's Included (Ready to Go)

- **OAuth flow** — `/oauth/authorize` and `/oauth/callback` with styled success/error pages
- **Token storage** — Tokens saved per locationId, single-use refresh token handling
- **Webhook signature verification** — RSA SHA256 using GHL's public key
- **Trigger subscription lifecycle** — CREATED/UPDATED/DELETED handling on `/webhooks/trigger`
- **Trigger firing** — `ghl.fireTrigger()` with automatic 401 retry + token refresh
- **API helper** — `ghl.apiCall()` for any authenticated GHL API request
- **SSO decryption** — `/sso` endpoint for embedded UI auth
- **Raw body capture** — Express middleware preserves raw body for signature verification

## Customizing for a New App

### Step 1: Clone and rename

```bash
git clone https://github.com/christiansallen/ghl-app-template.git my-ghl-app
cd my-ghl-app
rm -rf .git && git init
```

Update `package.json` with your app's name and description.

### Step 2: Create the app in the GHL Marketplace portal

1. Go to [marketplace.gohighlevel.com](https://marketplace.gohighlevel.com) → **My Apps** → **Create App**
2. Fill in name, description, category
3. Under **Auth**, set the **Redirect URI** to `https://your-domain.com/oauth/callback`
4. Note down your **Client ID**, **Client Secret**, and **SSO Key**
5. Under **Scopes**, select only the permissions your app needs. Common ones:
   - `contacts.readonly` / `contacts.write`
   - `conversations/message.readonly` / `conversations/message.write`
   - `workflows.readonly`
   - `locations.readonly`
   - `opportunities.readonly` / `opportunities.write`
6. Under **Webhook**, set the URL to `https://your-domain.com/webhooks/event` and select the events you want
7. If building a **custom trigger**: under **Modules > Workflow**, create the trigger with a subscription URL of `https://your-domain.com/webhooks/trigger`

### Step 3: Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:
```
GHL_APP_CLIENT_ID=your-client-id
GHL_APP_CLIENT_SECRET=your-client-secret
GHL_APP_SSO_KEY=your-sso-key
GHL_APP_SCOPES=contacts.readonly workflows.readonly
APP_URL=http://localhost:3000
```

The `GHL_APP_SCOPES` value must match exactly what you selected in the marketplace portal.

### Step 4: Write your webhook handler

Open `src/services/webhook.js` and edit `processWebhookEvent()`. This is where your app-specific logic goes.

1. **Filter by event type** — Check `payload.messageType`, `payload.type`, or whatever field distinguishes the events you care about
2. **Extract locationId** — Always pull `payload.locationId` to look up tokens and triggers
3. **Build eventData** — Map the payload fields to the custom variables you defined in the marketplace portal
4. **Fire triggers** — The template already handles this with `Promise.allSettled()`

Example for a contact-created trigger:
```js
async function processWebhookEvent(payload) {
  if (payload.type !== "ContactCreate") return;

  const locationId = payload.locationId;
  if (!locationId) return;

  const triggers = store.getTriggersByLocation(locationId);
  if (triggers.length === 0) return;

  const eventData = {
    contactId: payload.id,
    firstName: payload.firstName || null,
    lastName: payload.lastName || null,
    email: payload.email || null,
    phone: payload.phone || null,
    dateAdded: payload.dateAdded || new Date().toISOString(),
    locationId,
  };

  const results = await Promise.allSettled(
    triggers.map((t) => ghl.fireTrigger(t.targetUrl, locationId, eventData))
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`Failed to fire trigger ${triggers[i].id}:`, result.reason?.message);
    }
  });
}
```

### Step 5: Rename the webhook route (if needed)

In `src/index.js`, the default webhook route is `/webhooks/event`. Rename it to match whatever you configured in the marketplace portal (e.g., `/webhooks/contact`, `/webhooks/opportunity`).

Also update the health check response and the startup log with your app name.

### Step 6: Configure triggers in the marketplace portal (if applicable)

If your app exposes a custom workflow trigger:

1. Go to **Modules > Workflow > Create Trigger** in the marketplace portal
2. Paste **Sample Trigger Data** — a JSON object matching the `eventData` your code sends:
   ```json
   {
     "contactId": "abc123",
     "firstName": "Jane",
     "lastName": "Doe",
     "email": "jane@example.com",
     "phone": "+15551234567",
     "dateAdded": "2025-01-01T00:00:00.000Z",
     "locationId": "loc123"
   }
   ```
3. Add **Custom Variables** mapping each field — this is what makes `{{trigger.firstName}}` available in the workflow builder
4. Set the **Subscription URL** to `https://your-domain.com/webhooks/trigger`
5. Save and publish a new version

### Step 7: Test locally with ngrok

```bash
npm run dev          # Terminal 1
ngrok http 3000      # Terminal 2
```

Update `.env` with your ngrok URL, then update the marketplace portal URLs (redirect URI, webhook URL, trigger URL) to point to ngrok. See [Local Development](#local-development) for details.

### Step 8: Deploy

Push to GitHub, deploy to Railway/Render/Fly.io, set env vars on the platform, update all marketplace portal URLs to your production domain, and publish a new app version. See [Deployment](#deployment) for details.

---

## How GHL OAuth Works

GHL uses standard **OAuth 2.0 Authorization Code** flow, but with a few GHL-specific details that trip people up.

### The Flow

```
┌─────────┐          ┌─────────────┐          ┌─────────────┐
│  User    │          │  Your App   │          │  GHL OAuth  │
│ (browser)│          │  (Express)  │          │  Server     │
└────┬─────┘          └──────┬──────┘          └──────┬──────┘
     │  clicks "Install"     │                        │
     │ ───────────────────>  │                        │
     │                       │  redirect to consent   │
     │                       │ ────────────────────>  │
     │  <─────────────────── │                        │
     │  (user sees GHL       │                        │
     │   location picker)    │                        │
     │                       │                        │
     │  picks location,      │                        │
     │  grants consent       │                        │
     │ ────────────────────────────────────────────>  │
     │                       │                        │
     │                       │  redirect with ?code=  │
     │  <──────────────────────────────────────────── │
     │ ───────────────────>  │                        │
     │                       │  POST /oauth/token     │
     │                       │  (code → tokens)       │
     │                       │ ────────────────────>  │
     │                       │  <──────────────────── │
     │                       │  { access_token,       │
     │                       │    refresh_token,      │
     │                       │    locationId,         │
     │                       │    companyId, ... }    │
     │                       │                        │
     │  "App Installed!"     │  save tokens by        │
     │  <─────────────────── │  locationId            │
```

### Key Details

| Item | Value |
|------|-------|
| Consent URL | `https://marketplace.leadconnectorhq.com/oauth/chooselocation` |
| Token endpoint | `https://services.leadconnectorhq.com/oauth/token` |
| Content-Type for token requests | `application/x-www-form-urlencoded` (NOT JSON) |
| `user_type` param | `"Location"` for sub-account apps |
| Refresh tokens | **Single-use** — always save the new one after refresh |
| Token TTL | ~24 hours (`expires_in: 86399`) |

### Token Response Shape

```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 86399,
  "scope": "conversations/message.readonly workflows.readonly",
  "locationId": "abc123",
  "companyId": "xyz789",
  "userId": "user456"
}
```

### Refresh Strategy: Lazy, Not Scheduled

Don't refresh on a timer. Instead:
1. Make your API call with the current `access_token`
2. If you get a **401**, call `refreshAccessToken(locationId)`
3. Retry the original request with the new token

This is simpler, avoids unnecessary API calls, and matches GHL's own template pattern.

### Single-Use Refresh Tokens (Critical)

GHL refresh tokens are **single-use**. After you use one, the old token is invalidated and a new one comes back in the response. If you fail to save the new refresh token, the user must reinstall.

The template handles this with a merge strategy:
```js
store.saveTokens(locationId, { ...existing, ...data });
```

---

## LocationId vs CompanyId

GHL has a two-level hierarchy:

```
Agency (companyId)
  └── Location / Sub-Account (locationId)
  └── Location / Sub-Account (locationId)
  └── Location / Sub-Account (locationId)
```

- **locationId** — The sub-account. This is the primary key for everything in your app. Each location gets its own tokens, its own trigger subscriptions, its own data.
- **companyId** — The parent agency. Comes in the token response. Useful if you need to group locations by agency, but most apps key everything by locationId.

When a user installs your app, they pick which location to install it on. The OAuth response tells you which `locationId` they chose. All subsequent webhook events for that location include `payload.locationId`.

**Multiple locations = multiple installs = multiple token sets.** Each one goes through the OAuth flow independently and gets stored separately in `data/tokens.json`.

---

## Webhook Signature Verification

GHL signs webhook payloads with **RSA SHA256**. The signature is in the `x-wh-signature` header, base64-encoded.

The template:
1. Captures the raw request body before Express parses JSON (required for signature verification)
2. Verifies using GHL's public key (hardcoded — it's the same for all apps)
3. During local dev, the header may not be present — the check is conditional

---

## Custom Workflow Triggers

If your app adds a trigger to GHL workflows:

### Lifecycle

1. User drags your trigger into a workflow → GHL POSTs to `/webhooks/trigger` with `eventType: "CREATED"` and a `targetUrl`
2. You store that `targetUrl` keyed by locationId
3. When your event happens, you POST your data to `targetUrl` with a Bearer token
4. User removes the trigger → GHL POSTs with `eventType: "DELETED"`

### Marketplace Portal Config

After writing the code, you also need to configure the trigger in the marketplace portal:

1. **Modules > Workflow > Create Trigger**
2. **Sample Trigger Data** — Paste a JSON example of what your trigger sends. This generates the variable picker in the workflow builder.
3. **Custom Variables** — Map each field so users can reference `{{trigger.yourField}}` in actions.
4. **Subscription URL** — Your `/webhooks/trigger` endpoint.

### Premium Actions

All custom marketplace triggers are "LC Premium Triggers & Actions" — GHL charges the end user ~$0.01 per execution. This isn't your fee, it's a platform fee. Mention it in your app description.

---

## SSO for Embedded UI

If your app has a settings page inside GHL, it receives an encrypted SSO token containing user/location info. The `/sso` endpoint decrypts it with your SSO key.

---

## Local Development

```bash
# Terminal 1
npm run dev

# Terminal 2
ngrok http 3000
```

Then update in `.env`:
```
APP_URL=https://abc123.ngrok-free.app
```

And in the GHL marketplace portal:
- Redirect URI → `https://abc123.ngrok-free.app/oauth/callback`
- Webhook URL → `https://abc123.ngrok-free.app/webhooks/event`
- Trigger URL → `https://abc123.ngrok-free.app/webhooks/trigger`

---

## Deployment

1. Push to GitHub
2. Deploy to Railway / Render / Fly.io / VPS
3. Set environment variables on the platform
4. Update all URLs in the GHL marketplace portal to your production domain
5. Publish a new app version

### Production Considerations

- Replace file-based storage with a database for persistence/scale
- Add `express-rate-limit`
- Add request logging (`morgan`)
- Monitor for token refresh failures

---

## Quick Reference

| Item | Value |
|------|-------|
| OAuth consent URL | `https://marketplace.leadconnectorhq.com/oauth/chooselocation` |
| Token endpoint | `https://services.leadconnectorhq.com/oauth/token` |
| Token content type | `application/x-www-form-urlencoded` |
| Webhook signature header | `x-wh-signature` |
| Signature algorithm | RSA SHA256, base64 |
| Refresh tokens | Single-use |
| SSO decryption | AES via `crypto-js` |
| Marketplace portal | `https://marketplace.gohighlevel.com` |
| Listing images | 3x PNG, 16:9, max 960x540 |
