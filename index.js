const express = require('express');
const fs = require('fs');
require('dotenv').config();

// Node 18+ has global fetch; if you're on older Node, uncomment next line:
// const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Load recipients (comma-separated list of E.164 numbers, e.g., +16782627635)
const smsRecipients = process.env.SMS_RECIPIENTS
  ? process.env.SMS_RECIPIENTS.split(',').map(num => num.trim())
  : [];

const TEXTBELT_KEY = process.env.TEXTBELT_KEY;
if (!TEXTBELT_KEY) {
  console.warn('WARNING: TEXTBELT_KEY is not set. Use "textbelt" for 1 free SMS/day testing or purchase a key.');
}

function logWebhook(data) {
  const log = `${new Date().toISOString()}\nRAW:\n${JSON.stringify(data, null, 2)}\n\n`;
  fs.appendFileSync('square_webhook_log.txt', log);
}

// --- Textbelt helpers ---
async function sendSMSViaTextbelt(to, body) {
  // Textbelt expects standard US format; include +1 if you can
  const params = new URLSearchParams({
    phone: to,
    message: body,
    key: TEXTBELT_KEY || 'textbelt', // fallback for quick tests
  });

  const resp = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const json = await resp.json();
  return json; // { success: true/false, textId: "...", quotaRemaining: ... }
}

async function checkTextbeltStatus(textId) {
  try {
    const resp = await fetch(`https://textbelt.com/status/${encodeURIComponent(textId)}`);
    return await resp.json(); // { status: 'DELIVERED'|'SENT'|'FAILED' ... }
  } catch {
    return null;
  }
}

// --- Your webhook ---
app.post('/webhook', async (req, res) => {
  const data = req.body;
  logWebhook(data);

  const eventType = data.type || 'unknown';
  const object = data.data?.object || {};

  let alert = false;
  let message = '';

  switch (eventType) {
    case 'payment.updated':
    case 'payment.created': {
      const payment = object.payment || {};
      const amountCents = payment.amount_money?.amount || 0;
      const status = (payment.status || 'UNKNOWN').toUpperCase();
      const receipt_number = payment.receipt_number || 'UNKNOWN';

      if (['VOIDED', 'REFUNDED', 'DISPUTED', 'CANCELED'].includes(status) || amountCents === 0) {
        alert = true;
        const amount = (amountCents / 100).toFixed(2);
        message = `Receipt #${receipt_number} was ${status} for $${amount}. Reply STOP to opt out.`;
      }
      break;
    }

    case 'refund.created': {
      const refund = object.refund || {};
      const refundId = refund.id || 'UNKNOWN';
      const amount = ((refund.amount_money?.amount || 0) / 100).toFixed(2);
      message = `Refund ${refundId} created for $${amount}. Reply STOP to opt out.`;
      alert = true;
      break;
    }

    case 'dispute.created':
    case 'dispute.updated': {
      const dispute = object.dispute || {};
      const disputeId = dispute.id || 'UNKNOWN';
      const reason = dispute.reason || 'UNKNOWN';
      const status = dispute.status || 'PENDING';
      message = `Dispute ${disputeId}. Reason: ${reason}. Status: ${status}. Reply STOP to opt out.`;
      alert = true;
      break;
    }

    case 'order.created': {
      const order = object.order || {};
      const orderId = order.id || 'UNKNOWN';
      message = `New order created: ${orderId}. Reply STOP to opt out.`;
      alert = true;
      break;
    }

    default:
      message = `No action for event type: ${eventType}`;
      break;
  }

  if (alert && smsRecipients.length > 0) {
    try {
      const results = [];
      for (const recipient of smsRecipients) {
        const sendResult = await sendSMSViaTextbelt(recipient, message);
        results.push({ recipient, sendResult });

        // Optional: check status after a short delay (Textbelt updates quickly but not instant)
        if (sendResult?.textId) {
          setTimeout(async () => {
            const statusJson = await checkTextbeltStatus(sendResult.textId);
            console.log(`Delivery status for ${recipient}:`, statusJson);
          }, 2000);
        }
      }

      console.log('Textbelt send results:', results);
      // If any failed, return 207 Multi-Status-like message
      const anyFail = results.some(r => !r.sendResult?.success);
      return res.status(anyFail ? 207 : 200).json({
        ok: !anyFail,
        results
      });
    } catch (err) {
      console.error('Failed to send via Textbelt:', err);
      return res.status(500).send('Failed to send SMS');
    }
  } else {
    return res.status(200).send(`No alert triggered. Event: ${eventType}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
