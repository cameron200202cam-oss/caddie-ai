// api/user.js
// Returns current user info + Pro status — called on app load

const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Not authenticated" });

    const token = authHeader.split(" ")[1];
    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, is_pro, created_at")
      .eq("id", userId)
      .single();

    if (error || !user) return res.status(404).json({ error: "User not found" });

    // Get today's question count for free users
    let questionsUsedToday = 0;
    if (!user.is_pro) {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("questions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", `${today}T00:00:00.000Z`);
      questionsUsedToday = count || 0;
    }

    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isPro: user.is_pro,
        memberSince: user.created_at,
      },
      questionsUsedToday,
      questionsRemaining: user.is_pro ? "unlimited" : Math.max(0, 2 - questionsUsedToday),
    });

  } catch (error) {
    console.error("User fetch error:", error);
    return res.status(500).json({ error: "Server error" });
  }
};
