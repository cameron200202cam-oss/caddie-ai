// api/auth.js — Auth using Vercel Postgres

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query, setupDB } = require("./_db");

const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  if (now - attempts.firstAttempt > LOCKOUT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    const retryAfter = Math.ceil((attempts.firstAttempt + LOCKOUT_WINDOW_MS - now) / 60000);
    return { allowed: false, retryAfter };
  }
  loginAttempts.set(ip, { count: attempts.count + 1, firstAttempt: attempts.firstAttempt });
  return { allowed: true };
}

function sanitizeEmail(email) { return String(email || "").toLowerCase().trim().slice(0, 254); }
function sanitizeName(name) { return String(name || "").trim().replace(/[<>]/g, "").slice(0, 100); }
function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email); }
function validatePassword(p) { return typeof p === "string" && p.length >= 6 && p.length <= 128; }

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await setupDB();
  } catch (e) {
    return res.status(500).json({ error: "Database setup failed: " + e.message });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  const { action, name, email, password } = req.body || {};

  if (!action || !["signup", "login"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  // ── SIGNUP ──
  if (action === "signup") {
    const cleanName = sanitizeName(name);
    const cleanEmail = sanitizeEmail(email);

    if (!cleanName || cleanName.length < 2) return res.status(400).json({ error: "Please enter your full name." });
    if (!validateEmail(cleanEmail)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (!validatePassword(password)) return res.status(400).json({ error: "Password must be 6-128 characters." });

    try {
      const existing = await query("SELECT id FROM users WHERE email = $1", [cleanEmail]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: "An account with that email already exists." });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await query(
        "INSERT INTO users (name, email, password_hash, is_pro) VALUES ($1, $2, $3, false) RETURNING id, name, email, is_pro",
        [cleanName, cleanEmail, passwordHash]
      );

      const newUser = result.rows[0];
      const token = jwt.sign(
        { userId: newUser.id, email: newUser.email },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.status(201).json({
        token,
        user: { id: newUser.id, name: newUser.name, email: newUser.email, isPro: newUser.is_pro }
      });

    } catch (err) {
      return res.status(500).json({ error: "Signup failed: " + err.message });
    }
  }

  // ── LOGIN ──
  if (action === "login") {
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) return res.status(429).json({ error: `Too many failed attempts. Wait ${rateCheck.retryAfter} minutes.` });

    const cleanEmail = sanitizeEmail(email);
    if (!validateEmail(cleanEmail)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (!password) return res.status(400).json({ error: "Password is required." });

    try {
      const result = await query(
        "SELECT id, name, email, password_hash, is_pro FROM users WHERE email = $1",
        [cleanEmail]
      );

      const user = result.rows[0];
      const dummyHash = "$2a$12$dummyhashtopreventtimingattackspadding12345678";
      const passwordMatch = await bcrypt.compare(password, user?.password_hash || dummyHash);

      if (!user || !passwordMatch) return res.status(401).json({ error: "Incorrect email or password." });

      loginAttempts.delete(ip);

      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.status(200).json({
        token,
        user: { id: user.id, name: user.name, email: user.email, isPro: user.is_pro }
      });

    } catch (err) {
      return res.status(500).json({ error: "Login failed: " + err.message });
    }
  }
};
