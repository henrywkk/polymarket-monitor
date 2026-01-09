# Discord Webhook Quick Start

## 🚀 Quick Setup (5 minutes)

### 1. Create Discord Webhook
1. Right-click channel → **Edit Channel** → **Integrations** → **Webhooks**
2. Click **New Webhook** → **Copy Webhook URL**

### 2. Set Environment Variables

**Local (.env):**
```env
WEBHOOK_ENABLED=true
WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN
```

**Production (Railway/etc.):**
- Add same variables in your platform's environment settings

### 3. Restart Backend
```bash
# Local
npm run dev

# Production - redeploy/restart
```

### 4. Done! ✅
Alerts will now appear in your Discord channel as rich embeds.

---

## 📋 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WEBHOOK_ENABLED` | Yes | `false` | Set to `true` to enable |
| `WEBHOOK_URL` | Yes | - | Discord webhook URL |
| `WEBHOOK_SECRET` | No | - | Optional security secret |
| `WEBHOOK_TIMEOUT` | No | `5000` | Timeout in ms |
| `WEBHOOK_RETRY_ATTEMPTS` | No | `3` | Retry attempts |

---

## 🎨 Alert Format

Alerts appear as Discord embeds with:
- **Color-coded by severity** (Blue/Orange/Red/Purple)
- **Emoji indicators** (🚨 ⚠️ 💧 🐋 📈)
- **Rich metrics** (price change, volume, etc.)
- **Direct links** to Polymarket markets

---

## 🔍 Troubleshooting

**No alerts appearing?**
1. Check `WEBHOOK_ENABLED=true`
2. Verify `WEBHOOK_URL` is correct
3. Check backend logs for errors
4. Test webhook URL manually with curl

**See full guide:** `DISCORD_WEBHOOK_SETUP.md`
