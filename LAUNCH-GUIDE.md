# CADDIE AI — Launch Guide
## From zero to live in ~30 minutes

---

## WHAT YOU HAVE
- `/api/auth.js` — signup & login
- `/api/chat.js` — AI golf coach (talks to Claude)
- `/api/subscribe.js` — Stripe payment processing
- `/api/webhook.js` — keeps subscriptions in sync
- `/api/user.js` — user status checker
- `/public/index.html` — the full app frontend
- `/database-setup.sql` — creates your database
- `/.env.example` — all the keys you need

---

## STEP 1 — Create a Supabase account (your database)
**Time: 5 min | Cost: Free**

1. Go to **supabase.com** → Sign up
2. Create a new project (name it "caddie-ai")
3. Wait for it to load (~2 min)
4. Go to **SQL Editor** (left sidebar)
5. Copy everything from `database-setup.sql` → paste → click Run
6. Go to **Settings → API**
7. Copy:
   - **Project URL** → this is your `SUPABASE_URL`
   - **service_role key** (under Project API keys) → this is your `SUPABASE_SERVICE_KEY`

---

## STEP 2 — Get your Anthropic API key
**Time: 2 min | Cost: Pay per use (~$0.003/question)**

1. Go to **console.anthropic.com**
2. Sign up / log in
3. Click **API Keys** → Create new key
4. Copy it → this is your `ANTHROPIC_API_KEY`
5. Add a payment method (you'll only pay for what's used)

---

## STEP 3 — Set up Stripe (payments)
**Time: 10 min | Cost: 2.9% + 30¢ per transaction**

1. Go to **dashboard.stripe.com** → Sign up
2. Go to **Products** → Add product
   - Name: "Caddie AI Pro"
   - Price: $7.00 / month / recurring
   - Click Save → copy the **Price ID** (starts with `price_`)
3. Go to **Developers → API Keys**
   - Copy **Publishable key** → `STRIPE_PUBLISHABLE_KEY`
   - Copy **Secret key** → `STRIPE_SECRET_KEY`
4. Skip webhooks for now (set up after deploy)

---

## STEP 4 — Deploy to Vercel
**Time: 5 min | Cost: Free**

1. Go to **github.com** → Sign up → Create new repository called "caddie-ai"
2. Upload all the project files (drag and drop)
3. Go to **vercel.com** → Sign up with GitHub
4. Click **Add New Project** → Import your "caddie-ai" repo
5. Before clicking Deploy, click **Environment Variables** and add ALL of these:

```
ANTHROPIC_API_KEY        = (from Step 2)
SUPABASE_URL             = (from Step 1)
SUPABASE_SERVICE_KEY     = (from Step 1)
STRIPE_SECRET_KEY        = (from Step 3)
STRIPE_PUBLISHABLE_KEY   = (from Step 3)
STRIPE_PRICE_ID          = (from Step 3)
JWT_SECRET               = (make up any long random string, 32+ chars)
```

6. Click **Deploy** → wait ~1 minute
7. Copy your Vercel URL (looks like `caddie-ai-abc123.vercel.app`)

---

## STEP 5 — Update the frontend with your URLs
**Time: 2 min**

1. Open `/public/index.html`
2. Find this at the top:
   ```
   const API_BASE = 'https://your-app.vercel.app';
   const STRIPE_PK = 'pk_live_your_stripe_publishable_key';
   ```
3. Replace with your real Vercel URL and Stripe publishable key
4. Save → re-upload to GitHub → Vercel will auto-redeploy

---

## STEP 6 — Set up Stripe Webhook
**Time: 5 min**

This makes sure cancelled subscriptions lose Pro access.

1. In Stripe Dashboard → **Developers → Webhooks**
2. Click **Add endpoint**
3. URL: `https://your-vercel-url.vercel.app/api/webhook`
4. Events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.deleted`
   - `customer.subscription.updated`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click Save → copy **Signing secret** → add to Vercel as `STRIPE_WEBHOOK_SECRET`
6. Redeploy Vercel

---

## STEP 7 — Buy a domain (optional but recommended)
**Time: 5 min | Cost: ~$12/year**

1. Go to **namecheap.com** or **porkbun.com**
2. Search: `caddieai.golf` or `mycaddieai.com`
3. Buy it
4. In Vercel → your project → **Settings → Domains**
5. Add your domain → follow the DNS instructions

---

## YOU'RE LIVE 🎉

Test it:
- Sign up as a new user
- Ask 2 golf questions (should hit the limit)
- Try to upgrade (Stripe test mode first — use card `4242 4242 4242 4242`)
- Make sure Pro unlocks unlimited questions

---

## MONTHLY COSTS (once you're making money)

| Service | Cost |
|---|---|
| Vercel | Free |
| Supabase | Free up to 50,000 users |
| Anthropic API | ~$0.003 per question |
| Stripe | 2.9% + 30¢ per payment |
| Domain | ~$1/mo |

At 100 Pro users paying $7/mo:
- Revenue: $700/mo
- Stripe fees: ~$23
- Anthropic (est. 20 questions/user/day): ~$180
- **Net: ~$497/mo profit**

At 500 Pro users:
- Revenue: $3,500/mo
- Costs: ~$1,000
- **Net: ~$2,500/mo profit**

---

## NEED HELP?

If you get stuck on any step, come back and tell me exactly where —
I'll walk you through it.
