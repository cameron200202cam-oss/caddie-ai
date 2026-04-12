// api/subscribe.js — Stripe subscriptions using Vercel Postgres

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require("jsonwebtoken");
const { query, setupDB } = require("./_db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch { return res.status(401).json({ error: "Invalid token" }); }

    await setupDB();

    const result = await query(
      "SELECT id, name, email, stripe_customer_id, is_pro FROM users WHERE id = $1",
      [userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.is_pro) return res.status(400).json({ error: "Already a Pro member!" });

    const { paymentMethodId } = req.body;
    if (!paymentMethodId) return res.status(400).json({ error: "Payment method required" });

    // Create or retrieve Stripe customer
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
      });
      customerId = customer.id;
      await query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [customerId, userId]);
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    // Create subscription with immediate payment
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
      default_payment_method: paymentMethodId,
      expand: ["latest_invoice.payment_intent"]
    });

    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice?.payment_intent;

    // Handle 3D Secure
    if (paymentIntent?.status === "requires_action") {
      return res.status(200).json({
        requiresAction: true,
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id
      });
    }

    // Success
    if (
      subscription.status === "active" ||
      subscription.status === "trialing" ||
      paymentIntent?.status === "succeeded"
    ) {
      await query(
        "UPDATE users SET is_pro = true, stripe_subscription_id = $1 WHERE id = $2",
        [subscription.id, userId]
      );
      return res.status(200).json({ success: true });
    }

    // Payment failed — return specific Stripe error if available
    const declineCode = paymentIntent?.last_payment_error?.decline_code;
    const errorMsg = paymentIntent?.last_payment_error?.message || "Payment failed. Please check your card details.";
    return res.status(400).json({ error: errorMsg, declineCode });

  } catch (error) {
    console.error("Subscribe error:", error);
    if (error.type === "StripeCardError") return res.status(400).json({ error: error.message });
    if (error.type === "StripeInvalidRequestError") return res.status(400).json({ error: "Invalid payment details: " + error.message });
    return res.status(500).json({ error: "Something went wrong: " + error.message });
  }
};
