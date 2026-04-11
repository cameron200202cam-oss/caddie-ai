// api/lie-whisperer.js
// Lie Whisperer — reads a photo of a golf ball's lie and gives tactical advice

const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const FREE_DAILY_LIMIT = 2;
const MAX_IMAGE_SIZE_MB = 10;
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const SYSTEM_PROMPT = `You are Caddie AI's tactical lie reader — an elite caddie with 25 years of experience reading lies for tour players. You analyze a photo of a golf ball's lie and calculate exactly how it will affect the shot.

Respond ONLY with valid JSON in this exact format:
{
  "lieType": "Short descriptive name (e.g. 'Thick Rough', 'Tight Fairway', 'Fluffy Lie', 'Bare Lie', 'Upslope', 'Downslope', 'Divot', 'Wet Rough')",
  "riskLevel": "safe|caution|danger",
  "summary": "One sentence describing what you see and the key challenge this lie creates",
  "aimAdjust": "e.g. '+8 yds R' or '5 yds L' or 'Straight'",
  "distanceEffect": "e.g. '-20%' or '+5%' or 'Neutral'",
  "riskLabel": "Low|Medium|High",
  "grassType": "Short fairway|Light rough|Thick rough|Deep rough|Bare/tight|Sand edge|Wet grass",
  "flierRisk": true or false,
  "spinEffect": "normal|reduced|increased",
  "advice": [
    {
      "type": "warn|tip|info|go",
      "title": "Short title (3-5 words)",
      "text": "Detailed tactical advice. Be specific — mention exact adjustments, club changes, ball position tweaks."
    }
  ],
  "shotRecommendation": "Specific 1-2 sentence recommendation covering club choice, ball position, and swing adjustment.",
  "aggressive": true or false
}

Rules:
- riskLevel: 'safe' = clean lie, 'caution' = some challenge, 'danger' = severe lie needing major adjustment
- aimAdjust: account for how the grass will close/open the face
- flierRisk: true if the grass between ball and face will reduce spin and cause a flier
- Include 2-4 advice blocks covering the most important tactical points
- Be SPECIFIC. Reference what you actually see — grass length, ball sitting up/down, slope direction
- JSON only, no other text.`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1. Auth
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Authentication required" });

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
    }

    // 2. Validate image
    const { image, context } = req.body || {};
    if (!image || !image.data || !image.mediaType) {
      return res.status(400).json({ error: "Image is required" });
    }

    if (!ALLOWED_MEDIA_TYPES.includes(image.mediaType)) {
      return res.status(400).json({ error: "Invalid image type. Use JPEG, PNG, or WebP." });
    }

    // Check approximate size (base64 is ~4/3 of binary size)
    const approxSizeMB = (image.data.length * 0.75) / (1024 * 1024);
    if (approxSizeMB > MAX_IMAGE_SIZE_MB) {
      return res.status(400).json({ error: "Image too large. Maximum 10MB." });
    }

    // 3. DB + rate limiting
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data: user } = await supabase
      .from("users")
      .select("id, is_pro")
      .eq("id", userId)
      .single();

    if (!user) return res.status(401).json({ error: "User not found" });

    if (!user.is_pro) {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("questions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", `${today}T00:00:00.000Z`);

      if (count >= FREE_DAILY_LIMIT) {
        return res.status(402).json({
          error: "free_limit_reached",
          message: "Upgrade to Pro for unlimited lie reads.",
        });
      }
    }

    // 4. Sanitize context
    const safeContext = {
      distance: String(context?.distance || "not sure").slice(0, 50),
      club: String(context?.club || "not decided").slice(0, 50),
      shotShape: String(context?.shotShape || "straight").slice(0, 50),
      wind: String(context?.wind || "no wind").slice(0, 50),
    };

    // 5. Call Claude Vision
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.data },
          },
          {
            type: "text",
            text: `Read this golf lie and give me tactical advice.

Shot context:
- Distance to pin: ${safeContext.distance}
- Club I'm considering: ${safeContext.club}
- Intended shot shape: ${safeContext.shotShape}
- Wind: ${safeContext.wind}

Tell me exactly how this lie will affect my shot and what adjustments I need to make.`,
          },
        ],
      }],
    });

    const analysisText = response.content[0].text;

    // 6. Log
    await supabase.from("questions").insert({
      user_id: userId,
      question: `[LIE WHISPERER] ${safeContext.distance} / ${safeContext.club} / ${safeContext.wind}`,
      response: analysisText,
      club: safeContext.club !== "not decided" ? safeContext.club : null,
    });

    return res.status(200).json({ analysis: analysisText });

  } catch (error) {
    console.error("Lie Whisperer error:", error);
    return res.status(500).json({ error: "Analysis failed. Please try again." });
  }
};

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}
