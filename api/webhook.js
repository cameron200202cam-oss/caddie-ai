// api/webhook.js
// Listens for Stripe events — keeps your DB in sync with subscription status
// This is critical: if someone cancels, this turns off their Pro access

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");

// Vercel needs raw body for Stripe signature verification
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
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
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Handle different Stripe events
  switch (event.type) {

    // Subscription became active (payment succeeded)
    case "customer.subscription.created":
    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      const customerId = invoice.customer;

      await supabase
        .from("users")
        .update({ is_pro: true })
        .eq("stripe_customer_id", customerId);

      console.log(`✅ Pro activated for customer: ${customerId}`);
      break;
    }

    // Subscription cancelled or payment failed — revoke Pro
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const obj = event.data.object;
      const customerId = obj.customer;

      await supabase
        .from("users")
        .update({
          is_pro: false,
          stripe_subscription_id: null,
        })
        .eq("stripe_customer_id", customerId);

      console.log(`❌ Pro revoked for customer: ${customerId}`);
      break;
    }

    // Subscription updated (e.g., plan change)
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const customerId = sub.customer;
      const isActive = sub.status === "active" || sub.status === "trialing";

      await supabase
        .from("users")
        .update({ is_pro: isActive })
        .eq("stripe_customer_id", customerId);

      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.status(200).json({ received: true });
};
