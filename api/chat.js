// api/chat.js
// This runs on Vercel's servers — your API key stays hidden from users

const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const FREE_DAILY_LIMIT = 2;

const SYSTEM_PROMPT = `You are Caddie AI — a world-class golf instructor and swing coach with 25+ years of experience teaching players of all levels, from weekend hackers to club champions. You have deep expertise in biomechanics, ball flight laws, club fitting, and the mental game.

Your job is to help golfers diagnose and fix their exact swing problem. Be their trusted on-course caddie and coach.

When a golfer describes a miss or problem, structure your response EXACTLY like this:

### Why This Happens
Explain the 2-3 most likely root causes clearly and concisely. Use simple language but include proper golf terminology — just explain it plainly. Reference ball flight laws where relevant (club face angle, swing path, angle of attack, low point).

### The Fix
Give 2-3 specific, immediately actionable adjustments. Be precise — not vague tips like "keep your head down." Give them something real: grip pressure change, setup adjustment, specific swing thought, body position cue.

### The Drill
One simple, effective practice drill they can do at the range or at home. Describe it step by step in 3-5 sentences. Name the drill if it has a common name.

### On The Course
One practical swing key to hold in their head during their next round. One sentence. Simple and memorable.

Rules:
- Be direct and confident. Golfers want real answers, not hedging or disclaimers.
- If a specific club is mentioned, tailor advice to that club's unique characteristics and typical ball flight.
- Keep total response under 420 words.
- Warm but authoritative tone — like a coach who's seen every miss and knows exactly what's wrong.
- If the problem could have multiple causes, address the most statistically common one first.
- Never say "without seeing your swing" — just give the most likely diagnosis confidently.`;

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  try {
    // 1. Verify user is logged in
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const token = authHeader.split(" ")[1];
    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // 2. Connect to Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 3. Get user + check subscription
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, is_pro, stripe_customer_id")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: "User not found" });
    }

    // 4. Check free tier limit
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
          message: "You've used your 2 free questions today. Upgrade to Pro for unlimited access.",
        });
      }
    }

    // 5. Get the message from request
    const { messages, club } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    // Append club context to last message if provided
    const processedMessages = [...messages];
    if (club && processedMessages.length > 0) {
      const last = processedMessages[processedMessages.length - 1];
      if (last.role === "user") {
        processedMessages[processedMessages.length - 1] = {
          ...last,
          content: `${last.content} (Club being used: ${club})`,
        };
      }
    }

    // 6. Call Anthropic API (key is safe on server)
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: processedMessages,
    });

    const reply = response.content[0].text;

    // 7. Log question to database
    await supabase.from("questions").insert({
      user_id: userId,
      question: messages[messages.length - 1].content,
      response: reply,
      club: club || null,
    });

    // 8. Return the AI response
    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Something went wrong. Try again." });
  }
};
