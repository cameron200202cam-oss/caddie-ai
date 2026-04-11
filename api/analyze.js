// api/analyze.js
// Accepts swing photos, sends to Claude Vision, returns structured analysis

const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const SYSTEM_PROMPT = `You are Caddie AI's elite swing analyst — a PGA-certified instructor with 20+ years of experience analyzing swings from photos. You have a gift for spotting mechanical issues quickly and explaining them in plain English.

When analyzing swing photos, you MUST respond ONLY in valid JSON with this exact structure:

{
  "overallScore": "B+",
  "summary": "One sentence overall assessment of the swing",
  "scores": {
    "setup": { "score": 75, "label": "Setup & Address" },
    "grip": { "score": 82, "label": "Grip" },
    "posture": { "score": 68, "label": "Posture" },
    "alignment": { "score": 71, "label": "Alignment" }
  },
  "strengths": ["Specific strength 1", "Specific strength 2"],
  "issues": [
    {
      "severity": "high",
      "area": "Hip Turn",
      "what": "Clear description of what you see wrong in the photo",
      "why": "Why this causes problems / what miss it produces",
      "fix": "Specific actionable fix"
    }
  ],
  "drill": {
    "name": "Drill Name",
    "description": "3-4 sentence description of a specific drill to fix the biggest issue"
  },
  "onTheCourse": "One simple swing thought to take to the course"
}

Rules:
- Be SPECIFIC about what you actually see. Reference body parts, positions, angles.
- severity must be "high", "medium", or "low"
- overallScore uses letter grades: A+, A, A-, B+, B, B-, C+, C, C-, D
- scores are 0-100 integers
- 1-3 issues, 1-3 strengths
- Respond ONLY with the JSON object, zero other text`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1. Auth check
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

    // 2. Check user + pro status
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

    // Swing analysis = Pro feature OR counts toward free limit
    if (!user.is_pro) {
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase
        .from("questions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", `${today}T00:00:00.000Z`);

      if (count >= 2) {
        return res.status(402).json({
          error: "free_limit_reached",
          message: "Upgrade to Pro for unlimited swing analyses."
        });
      }
    }

    // 3. Get images from request
    const { images, context } = req.body;

    if (!images || images.length === 0) {
      return res.status(400).json({ error: "No images provided" });
    }

    if (images.length > 3) {
      return res.status(400).json({ error: "Maximum 3 images allowed" });
    }

    // 4. Build message content with images
    const imageContents = images.map(img => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType || "image/jpeg",
        data: img.data
      }
    }));

    const textContent = {
      type: "text",
      text: `Please analyze my golf swing from these photos.\n\n${context || "No additional context provided."}`
    };

    // 5. Call Claude Vision
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [...imageContents, textContent]
      }]
    });

    const analysisText = response.content[0].text;

    // 6. Log it
    await supabase.from("questions").insert({
      user_id: userId,
      question: `[SWING ANALYSIS] ${context?.slice(0, 200) || 'Photo analysis'}`,
      response: analysisText,
      club: null
    });

    return res.status(200).json({ analysis: analysisText });

  } catch (error) {
    console.error("Analyze error:", error);
    return res.status(500).json({ error: "Analysis failed. Please try again." });
  }
};
