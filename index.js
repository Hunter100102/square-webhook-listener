const express = require('express');
const fs = require('fs');
const twilio = require('twilio');
require('dotenv').config();

console.log("Twilio From Number:", process.env.TWILIO_PHONE_NUMBER);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Twilio client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Load recipients
const smsRecipients = process.env.SMS_RECIPIENTS
  ? process.env.SMS_RECIPIENTS.split(',').map(num => num.trim())
  : [];

function logWebhook(data) {
  const log = `${new Date().toISOString()}\nRAW:\n${JSON.stringify(data, null, 2)}\n\n`;
  fs.appendFileSync('square_webhook_log.txt', log);
}

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
        message = `🚨 Receipt #${receipt_number} was ${status} for $${amount}.`;
      }
      break;
    }

    case 'refund.created': {
      const refund = object.refund || {};
      const refundId = refund.id || 'UNKNOWN';
      const amount = ((refund.amount_money?.amount || 0) / 100).toFixed(2);
      message = `💸 Refund ${refundId} created for $${amount}.`;
      alert = true;
      break;
    }

    case 'dispute.created':
    case 'dispute.updated': {
      const dispute = object.dispute || {};
      const disputeId = dispute.id || 'UNKNOWN';
      const reason = dispute.reason || 'UNKNOWN';
      const status = dispute.status || 'PENDING';
      message = `⚠️ Dispute ${disputeId} created. Reason: ${reason}, Status: ${status}.`;
      alert = true;
      break;
    }

    case 'order.created': {
      const order = object.order || {};
      const orderId = order.id || 'UNKNOWN';
      message = `🧾 New order created: ${orderId}.`;
      alert = true;
      break;
    }

    default:
      message = `No action for event type: ${eventType}`;
      break;
  }

  if (alert && smsRecipients.length > 0) {
    try {
      for (const recipient of smsRecipients) {
        await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: recipient,
        });
      }

      console.log('Alert sent via Twilio:', message);
      res.status(200).send('Alert sent via Twilio');
    } catch (err) {
      console.error('Failed to send Twilio SMS:', err);
      res.status(500).send('Failed to send SMS');
    }
  } else {
    res.status(200).send(`No alert triggered. Event: ${eventType}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
