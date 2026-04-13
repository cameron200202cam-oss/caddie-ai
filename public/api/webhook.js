// api/webhook.js — Stripe webhook using Vercel Postgres

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { query } = require("./_db");

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "invoice.payment_succeeded": {
      const customerId = event.data.object.customer;
      await query("UPDATE users SET is_pro = true WHERE stripe_customer_id = $1", [customerId]);
      break;
    }
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const customerId = event.data.object.customer;
      await query("UPDATE users SET is_pro = false, stripe_subscription_id = null WHERE stripe_customer_id = $1", [customerId]);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const isActive = sub.status === "active" || sub.status === "trialing";
      await query("UPDATE users SET is_pro = $1 WHERE stripe_customer_id = $2", [isActive, sub.customer]);
      break;
    }
  }

  res.status(200).json({ received: true });
};
