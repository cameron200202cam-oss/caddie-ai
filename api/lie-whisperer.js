// api/lie-whisperer.js — Lie Whisperer using Vercel Postgres

const Anthropic = require("@anthropic-ai/sdk");
const jwt = require("jsonwebtoken");
const { query, setupDB } = require("./_db");

const SYSTEM_PROMPT = `You are Caddie AI's tactical lie reader. Analyze a photo of a golf ball's lie. Respond ONLY with valid JSON:
{
  "lieType": "Thick Rough",
  "riskLevel": "caution",
  "summary": "One sentence describing the lie and key challenge",
  "aimAdjust": "+8 yds R",
  "distanceEffect": "-20%",
  "riskLabel": "Medium",
  "grassType": "Thick rough",
  "flierRisk": false,
  "spinEffect": "reduced",
  "advice": [
    { "type": "warn", "title": "Club Up", "text": "Specific advice about this lie." },
    { "type": "tip", "title": "Ball Position", "text": "Specific ball position advice." }
  ],
  "shotRecommendation": "Specific 1-2 sentence shot plan.",
  "aggressive": false
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
        return res.status(402).json({ error: "free_limit_reached" });
      }
    }

    const { image, context } = req.body || {};
    if (!image || !image.data) return res.status(400).json({ error: "Image required" });

    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
    if (!ALLOWED_TYPES.includes(image.mediaType)) return res.status(400).json({ error: "Invalid image type" });

    const safeContext = {
      distance: String(context?.distance || "not sure").slice(0, 50),
      club: String(context?.club || "not decided").slice(0, 50),
      shotShape: String(context?.shotShape || "straight").slice(0, 50),
      wind: String(context?.wind || "no wind").slice(0, 50)
    };

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          { type: "text", text: `Read this lie. Distance: ${safeContext.distance}, Club: ${safeContext.club}, Shot: ${safeContext.shotShape}, Wind: ${safeContext.wind}` }
        ]
      }]
    });

    const analysisText = response.content[0].text;

    await query(
      "INSERT INTO questions (user_id, question, response) VALUES ($1, $2, $3)",
      [userId, `[LIE WHISPERER] ${safeContext.distance} / ${safeContext.club}`, analysisText]
    );

    return res.status(200).json({ analysis: analysisText });
  } catch (error) {
    return res.status(500).json({ error: "Analysis failed: " + error.message });
  }
};
