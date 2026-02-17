const crypto = require("crypto");
const store = require("./store");
const ghl = require("./ghl");

// GHL's public key for webhook signature verification
// https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide
const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpvu
xmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF3
kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKUJ
062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXpI
ocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzNh
/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhCH
ULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJP
Qe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAykT
1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

function verifyWebhookSignature(rawBody, signatureHeader) {
  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(GHL_WEBHOOK_PUBLIC_KEY, signatureHeader, "base64");
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return false;
  }
}

/**
 * Process an incoming webhook event.
 *
 * TODO: Replace this with your app-specific logic.
 *
 * This function receives the raw webhook payload from GHL. Common patterns:
 *
 *   1. Filter by event type (payload.messageType, payload.type, etc.)
 *   2. Extract locationId from payload
 *   3. Look up trigger subscriptions for that location
 *   4. Build your eventData object (the fields your trigger exposes)
 *   5. Fire all triggers for the location
 *
 * Example (from ghl-call-duration):
 *
 *   if (payload.messageType !== "CALL") return;
 *   const locationId = payload.locationId;
 *   const triggers = store.getTriggersByLocation(locationId);
 *   const eventData = { callDuration: payload.callDuration, ... };
 *   await Promise.allSettled(
 *     triggers.map(t => ghl.fireTrigger(t.targetUrl, locationId, eventData))
 *   );
 */
async function processWebhookEvent(payload) {
  // TODO: Filter by event type
  // if (payload.messageType !== "YOUR_TYPE") return;

  const locationId = payload.locationId;
  if (!locationId) {
    console.error("Webhook event missing locationId");
    return;
  }

  const triggers = store.getTriggersByLocation(locationId);
  if (triggers.length === 0) return;

  // TODO: Build your eventData from the payload
  const eventData = {
    // Map payload fields to the custom variables you defined in the marketplace portal
    locationId,
  };

  console.log(
    `Processing event for location ${locationId}: ${triggers.length} trigger(s) to fire`
  );

  const results = await Promise.allSettled(
    triggers.map((trigger) =>
      ghl.fireTrigger(trigger.targetUrl, locationId, eventData)
    )
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(
        `Failed to fire trigger ${triggers[i].id}:`,
        result.reason?.message || result.reason
      );
    }
  });
}

module.exports = { verifyWebhookSignature, processWebhookEvent };
