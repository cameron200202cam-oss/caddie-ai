// api/detective.js — Swing Detective using Vercel Postgres

const Anthropic = require("@anthropic-ai/sdk");
const jwt = require("jsonwebtoken");
const { query, setupDB } = require("./_db");

const SYSTEM_PROMPT = `You are a forensic golf swing analyst. Diagnose golf shot problems from symptoms. Respond ONLY with valid JSON:
{
  "primaryCause": "Short name of #1 cause",
  "confidence": 82,
  "summary": "One confident sentence about the main fault",
  "causes": [
    { "rank": 1, "name": "Lead Hip Stalling", "probability": 82, "explanation": "Why this produces this ball flight" },
    { "rank": 2, "name": "Early Release", "probability": 60, "explanation": "Second cause" },
    { "rank": 3, "name": "Setup Issue", "probability": 35, "explanation": "Third possibility" }
  ],
  "drill": { "name": "Drill name", "duration": "30 seconds", "description": "Specific drill for right now. 2-3 sentences." },
  "onTheCourse": "One immediate swing thought. One sentence."
}
JSON only.`;

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

    const userResult = await query("SELECT id, is_pro FROM users WHERE id = $1", [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(401).json({ error: "User not found" });

    if (!user.is_pro) {
      const today = new Date().toISOString().split("T")[0];
      const countResult = await query(
        "SELECT COUNT(*) FROM questions WHERE user_id = $1 AND created_at >= $2",
        [userId, `${today}T00:00:00.000Z`]
      );
      if (parseInt(countResult.rows[0].count) >= 2) {
        return res.status(402).json({ error: "free_limit_reached", message: "Upgrade to Pro for unlimited access." });
      }
    }

    const { symptoms } = req.body || {};
    if (!symptoms) return res.status(400).json({ error: "Missing symptoms" });

    const { ballFlight, divotPattern, contactPoint, club } = symptoms;
    const safeBallFlight = String(ballFlight || "").slice(0, 100);
    const safeDivot = String(divotPattern || "").slice(0, 100);
    const safeContact = String(contactPoint || "").slice(0, 100);
    const safeClub = String(club || "Not specified").slice(0, 50);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Ball flight: ${safeBallFlight}\nDivot: ${safeDivot}\nContact: ${safeContact}\nClub: ${safeClub}` }]
    });

    const diagnosisText = response.content[0].text;

    await query(
      "INSERT INTO questions (user_id, question, response, club) VALUES ($1, $2, $3, $4)",
      [userId, `[DETECTIVE] ${safeBallFlight} / ${safeDivot} / ${safeContact}`, diagnosisText, safeClub]
    );

    return res.status(200).json({ diagnosis: diagnosisText });
  } catch (error) {
    return res.status(500).json({ error: "Diagnosis failed: " + error.message });
  }
};
