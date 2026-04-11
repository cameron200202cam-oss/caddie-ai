// api/subscribe.js
// Creates a Stripe subscription for $7/mo Pro plan

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1. Verify auth token
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Not authenticated" });

    const token = authHeader.split(" ")[1];
    let userId, userEmail;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
      userEmail = decoded.email;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 2. Get user from DB
    const { data: user } = await supabase
      .from("users")
      .select("id, name, email, stripe_customer_id, is_pro")
      .eq("id", userId)
      .single();

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.is_pro) return res.status(400).json({ error: "Already a Pro member!" });

    const { paymentMethodId } = req.body;
    if (!paymentMethodId) return res.status(400).json({ error: "Payment method required" });

    // 3. Create or retrieve Stripe customer
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        payment_method: paymentMethodId,
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      customerId = customer.id;

      // Save customer ID to DB
      await supabase
        .from("users")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
    } else {
      // Attach new payment method to existing customer
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    }

    // 4. Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
    });

    const paymentIntent = subscription.latest_invoice.payment_intent;

    // 5. If payment needs confirmation
    if (paymentIntent.status === "requires_action") {
      return res.status(200).json({
        requiresAction: true,
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
      });
    }

    // 6. Payment succeeded — activate Pro
    if (
      paymentIntent.status === "succeeded" ||
      subscription.status === "active"
    ) {
      await supabase
        .from("users")
        .update({
          is_pro: true,
          stripe_subscription_id: subscription.id,
        })
        .eq("id", userId);

      return res.status(200).json({ success: true, message: "Pro activated!" });
    }

    return res.status(400).json({ error: "Payment failed. Please try again." });

  } catch (error) {
    console.error("Subscribe error:", error);

    if (error.type === "StripeCardError") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
