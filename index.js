// index.js
const express = require('express');
const nodemailer = require('nodemailer');
const fs = require('fs');
require('dotenv').config();

console.log("SMTP_USER:", process.env.SMTP_USER);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Prepare SMS recipient list from .env
const smsRecipients = process.env.SMS_RECIPIENTS
  ? process.env.SMS_RECIPIENTS.split(',').map(email => email.trim())
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
      const paymentId = payment.id || 'UNKNOWN';
      const receipt_number = payment.receipt_number || 'UNKNOWN';

      if (['VOIDED', 'REFUNDED', 'DISPUTED', 'CANCELED'].includes(status) || amountCents === 0) {
        alert = true;
        const amount = (amountCents / 100).toFixed(2);
        message = `🚨 Recipt # ${receipt_number} was ${status} for $${amount}.`;
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

  // Send email alert if needed
  if (alert && smsRecipients.length > 0) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: `"Moustache Hookah Alert" <${process.env.SMTP_USER}>`,
        to: smsRecipients,
        subject: '', // Blank for SMS
        text: message,
      });

      console.log('Alert sent:', message);
      res.status(200).send('Alert sent');
    } catch (err) {
      console.error('Failed to send alert:', err);
      res.status(500).send('Failed to send alert');
    }
  } else {
    res.status(200).send(`No alert triggered. Event: ${eventType}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
