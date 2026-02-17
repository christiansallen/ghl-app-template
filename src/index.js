const express = require("express");
const config = require("./config");
const ghl = require("./services/ghl");
const store = require("./services/store");
const {
  verifyWebhookSignature,
  processWebhookEvent,
} = require("./services/webhook");

const app = express();

// Parse JSON with raw body capture for webhook signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// --- Health check ---

app.get("/", (_req, res) => {
  res.json({ status: "ok", app: "ghl-app-template" });
});

// --- OAuth ---

app.get("/oauth/authorize", (_req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: `${config.appUrl}/oauth/callback`,
    client_id: config.ghl.clientId,
    scope: config.ghl.scopes,
  });
  res.redirect(
    `https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params}`
  );
});

app.get("/oauth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "Missing authorization code" });

  try {
    const data = await ghl.exchangeCodeForTokens(code);
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>App Installed</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;padding:48px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .icon{width:64px;height:64px;background:#e8f5e9;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:24px}
  .icon svg{width:32px;height:32px;color:#4caf50}
  h1{font-size:24px;font-weight:700;color:#1a1a1a;margin-bottom:8px}
  p{font-size:16px;color:#666;line-height:1.5}
  .location{margin-top:16px;padding:12px 16px;background:#f5f5f5;border-radius:8px;font-size:14px;color:#888;font-family:monospace}
  .next{margin-top:24px;font-size:14px;color:#999}
</style></head><body>
<div class="card">
  <div class="icon"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>
  <h1>App Installed</h1>
  <p>Your app has been successfully installed on this account.</p>
  <div class="location">Location: ${data.locationId}</div>
  <p class="next">You can close this tab.</p>
</div>
</body></html>`);
  } catch (err) {
    console.error("OAuth callback error:", err.response?.data || err.message);
    res.status(500).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Installation Failed</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;padding:48px;max-width:480px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .icon{width:64px;height:64px;background:#ffeaea;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:24px}
  .icon svg{width:32px;height:32px;color:#e53935}
  h1{font-size:24px;font-weight:700;color:#1a1a1a;margin-bottom:8px}
  p{font-size:16px;color:#666;line-height:1.5}
</style></head><body>
<div class="card">
  <div class="icon"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></div>
  <h1>Installation Failed</h1>
  <p>Something went wrong while installing the app. Please try again or contact support.</p>
</div>
</body></html>`);
  }
});

// --- Trigger subscription lifecycle ---

app.post("/webhooks/trigger", (req, res) => {
  const { triggerData, extras } = req.body;

  if (!triggerData || !extras?.locationId) {
    return res.status(400).json({ error: "Invalid trigger payload" });
  }

  const { locationId, workflowId } = extras;
  const { id, targetUrl, filters } = triggerData;

  // The eventType field may be at triggerData level or top level depending on GHL version
  const eventType = req.body.eventType || triggerData.eventType;

  console.log(
    `Trigger ${eventType}: id=${id}, location=${locationId}, workflow=${workflowId}`
  );

  if (eventType === "CREATED" || eventType === "UPDATED") {
    store.saveTriggerSubscription(locationId, {
      id,
      targetUrl,
      filters: filters || [],
      workflowId,
      createdAt: new Date().toISOString(),
    });
  } else if (eventType === "DELETED") {
    store.removeTriggerSubscription(locationId, id);
  }

  res.status(200).json({ success: true });
});

// --- Webhook receiver ---
// TODO: Rename this route to match your webhook URL in the marketplace portal
//       e.g. /webhooks/contact, /webhooks/message, /webhooks/opportunity

app.post("/webhooks/event", (req, res) => {
  const signature = req.headers["x-wh-signature"];

  if (signature && !verifyWebhookSignature(req.rawBody, signature)) {
    console.warn("Webhook signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Respond immediately — GHL only retries on 429
  res.status(200).json({ received: true });

  // Process async
  processWebhookEvent(req.body).catch((err) => {
    console.error("Error processing webhook event:", err);
  });
});

// --- SSO ---

app.post("/sso", (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "Missing SSO key" });

  try {
    const data = ghl.decryptSSOData(key);
    res.json(data);
  } catch (err) {
    console.error("SSO decryption error:", err.message);
    res.status(400).json({ error: "Invalid SSO key" });
  }
});

// --- Start ---

app.listen(config.port, () => {
  console.log(`GHL app running on port ${config.port}`);
  console.log(`OAuth: ${config.appUrl}/oauth/authorize`);
  console.log(`Trigger webhook: ${config.appUrl}/webhooks/trigger`);
  console.log(`Event webhook: ${config.appUrl}/webhooks/event`);
});
