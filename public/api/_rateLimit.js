// api/_rateLimit.js — Shared rate limiter for all features
// All 4 features (chat, analyzer, detective, lie whisperer) share 2/day limit for free users

const { query } = require("./_db");

const FREE_DAILY_LIMIT = 2;

async function checkAndConsumeLimit(userId, isPro) {
  if (isPro) return { allowed: true, remaining: 999 };

  const today = new Date().toISOString().split("T")[0];
  const countResult = await query(
    "SELECT COUNT(*) FROM questions WHERE user_id = $1 AND created_at >= $2",
    [userId, `${today}T00:00:00.000Z`]
  );

  const used = parseInt(countResult.rows[0].count);
  const remaining = Math.max(0, FREE_DAILY_LIMIT - used);

  if (used >= FREE_DAILY_LIMIT) {
    return { allowed: false, remaining: 0, used };
  }

  return { allowed: true, remaining: remaining - 1, used };
}

module.exports = { checkAndConsumeLimit, FREE_DAILY_LIMIT };
