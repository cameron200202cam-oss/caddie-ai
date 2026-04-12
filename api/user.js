// api/user.js — User status using Vercel Postgres

const jwt = require("jsonwebtoken");
const { query, setupDB } = require("./_db");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

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
      "SELECT id, name, email, is_pro, created_at FROM users WHERE id = $1",
      [userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    let questionsUsedToday = 0;
    if (!user.is_pro) {
      const today = new Date().toISOString().split("T")[0];
      const countResult = await query(
        "SELECT COUNT(*) FROM questions WHERE user_id = $1 AND created_at >= $2",
        [userId, `${today}T00:00:00.000Z`]
      );
      questionsUsedToday = parseInt(countResult.rows[0].count);
    }

    return res.status(200).json({
      user: { id: user.id, name: user.name, email: user.email, isPro: user.is_pro },
      questionsUsedToday,
      questionsRemaining: user.is_pro ? "unlimited" : Math.max(0, 2 - questionsUsedToday)
    });
  } catch (error) {
    return res.status(500).json({ error: "Server error: " + error.message });
  }
};
