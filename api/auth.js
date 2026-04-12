// api/auth.js — Hardened with rate limiting, input validation, secure headers

const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  const { action, name, email, password } = req.body || {};

  if (!action || !["signup", "login"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  if (action === "signup") {
    const cleanName = sanitizeName(name);
    const cleanEmail = sanitizeEmail(email);
    if (!cleanName || cleanName.length < 2) return res.status(400).json({ error: "Please enter your full name." });
    if (!validateEmail(cleanEmail)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (!validatePassword(password)) return res.status(400).json({ error: "Password must be 6-128 characters." });

    const { data: existing } = await supabase.from("users").select("id").eq("email", cleanEmail).single();
    if (existing) return res.status(409).json({ error: "An account with that email already exists." });

    const passwordHash = await bcrypt.hash(password, 12);
    const { data: newUser, error: createError } = await supabase
      .from("users").insert({ name: cleanName, email: cleanEmail, password_hash: passwordHash, is_pro: false })
      .select("id, name, email, is_pro").single();

    if (createError) { console.error("Signup error:", createError); return res.status(500).json({ error: "Failed to create account. Please try again." }); }

    const token = jwt.sign({ userId: newUser.id, email: newUser.email }, process.env.JWT_SECRET, { expiresIn: "30d", issuer: "caddie-ai" });
    return res.status(201).json({ token, user: { id: newUser.id, name: newUser.name, email: newUser.email, isPro: newUser.is_pro } });
  }

  if (action === "login") {
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) return res.status(429).json({ error: `Too many failed attempts. Wait ${rateCheck.retryAfter} minutes.` });

    const cleanEmail = sanitizeEmail(email);
    if (!validateEmail(cleanEmail)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (!password) return res.status(400).json({ error: "Password is required." });

    const { data: user } = await supabase.from("users").select("id, name, email, password_hash, is_pro").eq("email", cleanEmail).single();

    const dummyHash = "$2a$12$dummyhashtopreventtimingattackspadding12345678";
    const passwordMatch = await bcrypt.compare(password, user?.password_hash || dummyHash);

    if (!user || !passwordMatch) return res.status(401).json({ error: "Incorrect email or password." });

    loginAttempts.delete(ip);
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d", issuer: "caddie-ai" });
    return res.status(200).json({ token, user: { id: user.id, name: user.name, email: user.email, isPro: user.is_pro } });
  }
};
