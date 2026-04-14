// api/cancel.js — Cancel Stripe subscription immediately

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require("jsonwebtoken");
const { query, setupDB } = require("./_db");

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ["https://mycaddieai.golf", "https://caddie-ai-nine.vercel.app"];
  res.setHeader("Access-Control-Allow-Origin", allowed.includes(origin) ? origin : allowed[0]);
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
      "SELECT id, stripe_subscription_id, is_pro FROM users WHERE id = $1",
      [userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.is_pro) return res.status(400).json({ error: "No active subscription found" });
    if (!user.stripe_subscription_id) return res.status(400).json({ error: "No subscription ID found" });

    // Cancel immediately — no grace period
    await stripe.subscriptions.cancel(user.stripe_subscription_id);

    // Revoke Pro access immediately
    await query(
      "UPDATE users SET is_pro = false, stripe_subscription_id = null WHERE id = $1",
      [userId]
    );

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("Cancel error:", error);
    return res.status(500).json({ error: "Failed to cancel: " + error.message });
  }
};
