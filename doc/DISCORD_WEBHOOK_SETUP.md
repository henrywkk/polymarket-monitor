# Discord Webhook Setup Guide

This guide will walk you through setting up Discord webhooks to receive real-time alerts from the Polymarket Monitor backend.

## Prerequisites

- A Discord account
- Administrator or "Manage Webhooks" permission in the Discord server/channel where you want to receive alerts
- Access to your backend environment variables

---

## Step 1: Create a Discord Webhook

### 1.1 Open Discord and Navigate to Your Server

1. Open Discord and select the server where you want to receive alerts
2. Navigate to the channel where you want alerts to appear (or create a new channel)

### 1.2 Create the Webhook

1. **Right-click** on the channel name
2. Select **"Edit Channel"** (or **"Channel Settings"**)
3. Go to **"Integrations"** in the left sidebar
4. Click **"Webhooks"** tab
5. Click **"New Webhook"** or **"Create Webhook"**
6. Configure your webhook:
   - **Name**: Give it a name (e.g., "Polymarket Alerts")
   - **Channel**: Select the channel (should be pre-selected)
   - **Avatar**: Optionally upload an icon
7. Click **"Copy Webhook URL"** - **SAVE THIS URL** (you'll need it in the next step)
8. Click **"Save Changes"**

> ⚠️ **Important**: Keep your webhook URL secret! Anyone with this URL can send messages to your Discord channel. If it's compromised, delete the webhook and create a new one.

---

## Step 2: Configure Backend Environment Variables

### 2.1 Local Development (.env file)

If you're running locally, add these variables to your `backend/.env` file:

```env
# Enable webhook notifications
WEBHOOK_ENABLED=true

# Discord webhook URL (from Step 1)
WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN

# Optional: Webhook secret for additional security
WEBHOOK_SECRET=your-secret-key-here

# Optional: Timeout in milliseconds (default: 5000ms)
WEBHOOK_TIMEOUT=5000

# Optional: Retry attempts (default: 3)
WEBHOOK_RETRY_ATTEMPTS=3
```

### 2.2 Production (Railway/Vercel/etc.)

For production deployments, set these environment variables in your hosting platform:

#### Railway:
1. Go to your Railway project dashboard
2. Select your backend service
3. Go to **"Variables"** tab
4. Click **"New Variable"** and add:
   - `WEBHOOK_ENABLED` = `true`
   - `WEBHOOK_URL` = `https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN`
   - (Optional) `WEBHOOK_SECRET` = `your-secret-key`
5. Click **"Deploy"** to apply changes

#### Other Platforms:
Set the same environment variables in your platform's configuration:
- **Vercel**: Project Settings → Environment Variables
- **Heroku**: Settings → Config Vars
- **AWS/Docker**: Use your platform's environment variable configuration

---

## Step 3: Restart Your Backend

After setting the environment variables:

### Local Development:
```bash
# Stop your backend (Ctrl+C)
# Restart it
cd backend
npm run dev
```

### Production:
- Railway: Automatically redeploys when you add environment variables
- Other platforms: Trigger a redeploy or restart your service

---

## Step 4: Verify the Setup

### 4.1 Check Backend Logs

When your backend starts, you should see:
```
[Alert System] Alert dispatcher started
```

If webhooks are enabled, the webhook channel will be initialized automatically.

### 4.2 Test with a Real Alert

The best way to test is to wait for a real alert to be triggered. However, you can also:

1. Monitor your backend logs for alert generation
2. Check your Discord channel for incoming messages
3. Alerts will appear as rich embeds with:
   - Color-coded severity (Blue=Low, Orange=Medium, Red=High, Purple=Critical)
   - Alert type emoji (🚨 Insider Move, ⚠️ Fat Finger, etc.)
   - Market information
   - Metrics (price change, volume, etc.)
   - Link to Polymarket market page

---

## Step 5: Customize Alert Appearance (Optional)

The backend automatically formats alerts for Discord with:
- **Rich Embeds**: Color-coded by severity
- **Fields**: Metrics displayed in organized fields
- **Links**: Direct links to Polymarket markets
- **Timestamps**: Alert creation time

### Alert Types and Emojis:
- 🚨 **Insider Move**: Price moved >15pp in <1min with volume spike
- ⚠️ **Fat Finger**: Price deviation >30% with reversion
- 💧 **Liquidity Vacuum**: Spread >10 cents or depth drop
- 🐋 **Whale Trade**: Single trade >$10k USDC
- 📈 **Volume Acceleration**: Volume spike above 3σ

---

## Troubleshooting

### Alerts Not Appearing in Discord

1. **Check Environment Variables**:
   ```bash
   # Verify WEBHOOK_ENABLED is set to 'true'
   # Verify WEBHOOK_URL is correct and complete
   ```

2. **Check Backend Logs**:
   Look for:
   - `[Webhook Channel] Alert delivered successfully` ✅
   - `[Webhook Channel] HTTP 200` ✅
   - `[Webhook Channel] Error` ❌ (indicates a problem)

3. **Verify Webhook URL**:
   - Make sure the URL is complete: `https://discord.com/api/webhooks/ID/TOKEN`
   - Test the webhook manually:
     ```bash
     curl -X POST "YOUR_WEBHOOK_URL" \
       -H "Content-Type: application/json" \
       -d '{"content": "Test message"}'
     ```

4. **Check Discord Permissions**:
   - Ensure the webhook has permission to send messages in the channel
   - Verify the channel hasn't been deleted or permissions changed

5. **Check Rate Limits**:
   - Discord webhooks have rate limits (30 requests per minute)
   - The backend includes throttling to prevent exceeding limits
   - If you see rate limit errors, alerts will be queued and retried

### Common Error Messages

| Error | Solution |
|-------|----------|
| `WEBHOOK_ENABLED is true but WEBHOOK_URL is not set` | Set `WEBHOOK_URL` environment variable |
| `HTTP 404` | Webhook URL is invalid or webhook was deleted |
| `HTTP 401` | Webhook token is invalid |
| `HTTP 429` | Rate limit exceeded (will retry automatically) |
| `Failed to deliver alert after 3 attempts` | Check network connectivity and webhook URL |

---

## Security Best Practices

1. **Keep Webhook URL Secret**:
   - Never commit webhook URLs to version control
   - Use environment variables, not hardcoded values
   - Rotate webhook URLs if compromised

2. **Use Webhook Secret (Optional)**:
   - Set `WEBHOOK_SECRET` for additional security
   - The backend includes this in the payload signature

3. **Channel Permissions**:
   - Consider creating a private channel for alerts
   - Limit who can see the alerts channel
   - Use Discord roles to control access

4. **Monitor Usage**:
   - Check Discord audit logs for webhook activity
   - Review backend logs for failed deliveries
   - Set up alerts for webhook failures (if possible)

---

## Advanced Configuration

### Multiple Webhooks

Currently, the system supports one webhook URL. To send to multiple Discord channels:

1. Create multiple webhooks (one per channel)
2. Use a webhook proxy service (like Zapier, IFTTT, or a custom service)
3. Or modify the code to support multiple webhook URLs

### Custom Formatting

To customize the Discord message format, edit:
- `backend/src/services/notification-channels.ts`
- Method: `buildDiscordPayload()`

You can modify:
- Colors
- Emojis
- Field layout
- Embed structure

---

## Example Alert in Discord

When an alert is received, it will appear as:

```
┌─────────────────────────────────────────┐
│ 🚨 INSIDER MOVE Detected               │
│                                         │
│ Price moved 404.00% (0.00pp) in <1min │
│ with 6.52σ volume spike                │
│                                         │
│ Market: SpaceX Starship Flight Test 12 │
│ (Successful splash down?)              │
│                                         │
│ Price Change: +404.00%                 │
│ Volume Z-Score: 6.52σ                   │
│ Category: Technology                    │
│                                         │
│ [View on Polymarket]                    │
│                                         │
│ Polymarket Monitor • insider_move      │
│ 2 hours ago                             │
└─────────────────────────────────────────┘
```

---

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review backend logs for error messages
3. Verify Discord webhook is still active
4. Test webhook URL manually with curl

For code-related issues, check:
- `backend/src/services/notification-channels.ts`
- `backend/src/services/alert-dispatcher.ts`

---

## Next Steps

- ✅ Webhook is configured and receiving alerts
- Consider setting up alert filtering (by severity, market, etc.)
- Monitor alert frequency and adjust thresholds if needed
- Set up multiple channels for different alert types (if needed)
