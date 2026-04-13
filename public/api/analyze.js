// api/analyze.js — Swing photo analysis with shared rate limiting

// Increase body size limit for image uploads
export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } }
};

const Anthropic = require("@anthropic-ai/sdk");
const jwt = require("jsonwebtoken");
const { query, setupDB } = require("./_db");
const { checkAndConsumeLimit } = require("./_rateLimit");

const SYSTEM_PROMPT = `You are Caddie AI's elite swing analyst. Analyze golf swing photos and respond ONLY with valid JSON:
{
  "overallScore": "B+",
  "summary": "One sentence overall assessment",
  "scores": {
    "setup": { "score": 75, "label": "Setup & Address" },
    "grip": { "score": 82, "label": "Grip" },
    "posture": { "score": 68, "label": "Posture" },
    "alignment": { "score": 71, "label": "Alignment" }
  },
  "strengths": ["Strength 1", "Strength 2"],
  "issues": [
    { "severity": "high", "area": "Hip Turn", "what": "What you see", "why": "Why it matters", "fix": "How to fix it" }
  ],
  "drill": { "name": "Drill name", "description": "3-4 sentence drill description" },
  "onTheCourse": "One swing thought"
}
JSON only, no other text.`;

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

    const userResult = await query("SELECT id, is_pro FROM users WHERE id = $1", [userId]);
    const user = userResult.rows[0];
    if (!user) return res.status(401).json({ error: "User not found" });

    // Check shared rate limit
    const limitCheck = await checkAndConsumeLimit(userId, user.is_pro);
    if (!limitCheck.allowed) {
      return res.status(402).json({
        error: "free_limit_reached",
        message: "You've used your 2 free questions today. Upgrade to Pro for unlimited access."
      });
    }

    const { images, context } = req.body;
    if (!images || images.length === 0) return res.status(400).json({ error: "No images provided" });

    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    for (const img of images) {
      if (!ALLOWED_TYPES.includes(img.mediaType)) return res.status(400).json({ error: "Invalid image type" });
    }

    const imageContents = images.map(img => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType || "image/jpeg", data: img.data }
    }));

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [...imageContents, { type: "text", text: `Analyze my golf swing.\n\n${context || ""}` }] }]
    });

    const analysisText = response.content[0].text;

    await query(
      "INSERT INTO questions (user_id, question, response) VALUES ($1, $2, $3)",
      [userId, `[SWING ANALYSIS] ${context?.slice(0, 100) || "Photo"}`, analysisText]
    );

    return res.status(200).json({ analysis: analysisText, remaining: limitCheck.remaining });

  } catch (error) {
    return res.status(500).json({ error: "Analysis failed: " + error.message });
  }
};
