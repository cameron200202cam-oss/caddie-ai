// api/chat.js — Chat with shared rate limiting

const Anthropic = require("@anthropic-ai/sdk");
const jwt = require("jsonwebtoken");
const { query, setupDB } = require("./_db");
const { checkAndConsumeLimit } = require("./_rateLimit");

const SYSTEM_PROMPT = `You are Caddie AI — a world-class golf instructor and swing coach with 25+ years of experience.

When a golfer describes a miss or problem, structure your response EXACTLY like this:

### Why This Happens
Explain the 2-3 most likely root causes clearly and concisely.

### The Fix
Give 2-3 specific, immediately actionable adjustments.

### The Drill
One simple, effective practice drill. 3-5 sentences.

### On The Course
One practical swing key. One sentence.

Be direct and confident. Keep total response under 420 words.`;

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
    } catch { return res.status(401).json({ error: "Invalid or expired session" }); }

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

    const { messages, club } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid request" });

    const processedMessages = [...messages];
    if (club && processedMessages.length > 0) {
      const last = processedMessages[processedMessages.length - 1];
      if (last.role === "user") {
        processedMessages[processedMessages.length - 1] = { ...last, content: `${last.content} (Club: ${club})` };
      }
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: processedMessages
    });

    const reply = response.content[0].text;

    await query(
      "INSERT INTO questions (user_id, question, response, club) VALUES ($1, $2, $3, $4)",
      [userId, messages[messages.length - 1].content.slice(0, 500), reply, club || null]
    );

    return res.status(200).json({ reply, remaining: limitCheck.remaining });

  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Something went wrong: " + error.message });
  }
};
