// api/detective.js
// Swing Detective — forensic symptom-based diagnosis

const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const ALLOWED_BALL_FLIGHTS = ["Slice", "Hook", "Push", "Pull", "Thin", "Fat"];
const FREE_DAILY_LIMIT = 2;

const SYSTEM_PROMPT = `You are a forensic golf swing analyst. A golfer tells you what happened after a bad shot — you diagnose the root cause like a detective using ball flight laws.

Respond ONLY with valid JSON in this exact format:
{
  "primaryCause": "Short name of the #1 cause (max 4 words)",
  "confidence": 82,
  "summary": "One confident sentence about the main fault",
  "causes": [
    { "rank": 1, "name": "Lead Hip Stalling", "probability": 82, "explanation": "What this means and why it produces this exact ball flight + divot + contact combo" },
    { "rank": 2, "name": "Early Release", "probability": 60, "explanation": "Second most likely cause with explanation" },
    { "rank": 3, "name": "Setup Issue", "probability": 35, "explanation": "Third possibility" }
  ],
  "drill": {
    "name": "Drill name",
    "duration": "30 seconds",
    "description": "Specific drill they can do on the course or range right now. 2-3 sentences. Be specific."
  },
  "onTheCourse": "One immediate swing thought for their very next shot. One sentence, keep it simple."
}

Rules: confidence is 0-100 integer. Cause probabilities are 0-100. Be specific and direct. No hedging. JSON only.`;

module.exports = async function handler(req, res) {
  // Security headers
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

    // 2. Input validation
    const { symptoms } = req.body || {};
    if (!symptoms || typeof symptoms !== "object") {
      return res.status(400).json({ error: "Missing symptoms data" });
    }

    const { ballFlight, divotPattern, contactPoint, club } = symptoms;
    if (!ballFlight || !divotPattern || !contactPoint) {
      return res.status(400).json({ error: "All three symptoms are required" });
    }

    // Sanitize inputs
    const safeBallFlight = String(ballFlight).slice(0, 100);
    const safeDivot = String(divotPattern).slice(0, 100);
    const safeContact = String(contactPoint).slice(0, 100);
    const safeClub = String(club || "Not specified").slice(0, 50);

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
          message: "You've used your free questions for today. Upgrade to Pro for unlimited access.",
        });
      }
    }

    // 4. Call AI
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `Diagnose this golf shot based on the symptoms:
Ball flight: ${safeBallFlight}
Divot pattern: ${safeDivot}
Contact point: ${safeContact}
Club used: ${safeClub}

Use ball flight laws to identify the most likely swing fault. Give me a probability-ranked diagnosis.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const diagnosisText = response.content[0].text;

    // 5. Log
    await supabase.from("questions").insert({
      user_id: userId,
      question: `[DETECTIVE] ${safeBallFlight} / ${safeDivot} / ${safeContact} / ${safeClub}`,
      response: diagnosisText,
      club: safeClub !== "Not specified" ? safeClub : null,
    });

    return res.status(200).json({ diagnosis: diagnosisText });

  } catch (error) {
    console.error("Detective error:", error);
    return res.status(500).json({ error: "Diagnosis failed. Please try again." });
  }
};

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}
