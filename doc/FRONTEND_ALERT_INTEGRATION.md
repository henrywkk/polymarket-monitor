# Frontend Alert Integration Guide

## Overview

The frontend receives alerts in **real-time via WebSocket**, not webhooks. Webhooks are for server-to-server communication, while WebSockets are perfect for browser-to-server real-time communication.

---

## How It Works

### Architecture

```
Backend (Alert Dispatcher)
    ↓
WebSocket Server (Socket.IO)
    ↓
Frontend (React Hook)
    ↓
UI Components (Toast Notifications)
```

### Flow

1. **Phase 2** detects anomaly → generates alert → stores in Redis
2. **Phase 3 Alert Dispatcher** processes alert → formats message
3. **WebSocket Server** broadcasts `alert` event to all connected clients
4. **Frontend Hook** (`useRealtimeAlerts`) listens for `alert` events
5. **UI Component** (`AlertNotification`) displays toast notifications

---

## Components Created

### 1. `useRealtimeAlerts` Hook

**File:** `frontend/src/hooks/useRealtimeAlerts.ts`

**Features:**
- Listens for `alert` events via WebSocket
- Manages alert state (stores recent alerts)
- Filtering by severity, market ID
- Optional callback when new alert arrives
- Auto-cleanup of old alerts

**Usage:**
```typescript
import { useRealtimeAlerts } from '../hooks/useRealtimeAlerts';

const { alerts, isConnected, unreadCount, clearAlerts } = useRealtimeAlerts({
  maxAlerts: 50,
  filterBySeverity: ['high', 'critical'],
  filterByMarketId: '131313', // Optional: only this market
  onAlert: (alert) => {
    console.log('New alert!', alert);
  },
});
```

### 2. `AlertNotification` Component

**File:** `frontend/src/components/AlertNotification.tsx`

**Features:**
- Toast-style notifications (top-right by default)
- Auto-dismiss after 10 seconds (configurable)
- Shows up to 5 alerts at once
- Color-coded by severity
- Click to dismiss
- Link to Polymarket market page

**Usage:**
```tsx
import { AlertNotification } from './components/AlertNotification';

// In your App component
<AlertNotification 
  position="top-right"  // or "top-left", "bottom-right", "bottom-left"
  maxVisible={5}        // Max alerts shown at once
  autoDismiss={10}      // Auto-dismiss after 10 seconds (0 = no auto-dismiss)
/>
```

### 3. `AlertBadge` Component

**File:** `frontend/src/components/AlertNotification.tsx`

Shows a badge with unread alert count (useful for header/navbar).

**Usage:**
```tsx
import { AlertBadge } from './components/AlertNotification';

<AlertBadge /> // Shows alert count badge
```

---

## Alert Data Structure

When an alert is received via WebSocket, it has this structure:

```typescript
interface Alert {
  type: string;                    // "insider_move", "whale_trade", etc.
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;                    // "🚨 INSIDER MOVE Detected"
  message: string;                  // Human-readable description
  marketId: string;                 // Market ID
  marketName?: string;              // Market question/title
  outcomeName?: string;             // Outcome name (e.g., ">$5M")
  timestamp: string;                // ISO timestamp
  polymarketUrl?: string;          // Link to market on Polymarket
  metrics?: Record<string, any>;    // Alert-specific metrics
}
```

---

## Integration Status

✅ **Already Integrated:**
- `AlertNotification` component added to `App.tsx`
- WebSocket connection already established
- Alert hook and component created

**Current Behavior:**
- Alerts appear as toast notifications in the top-right corner
- Auto-dismiss after 10 seconds
- Shows up to 5 alerts at once
- Color-coded by severity (red=critical, orange=high, yellow=medium, blue=low)

---

## Customization

### Change Alert Position

```tsx
<AlertNotification position="bottom-left" />
```

### Disable Auto-Dismiss

```tsx
<AlertNotification autoDismiss={0} />
```

### Show More Alerts

```tsx
<AlertNotification maxVisible={10} />
```

### Filter Alerts

```tsx
// Only show critical alerts
const { alerts } = useRealtimeAlerts({
  filterBySeverity: ['critical'],
});

// Only show alerts for specific market
const { alerts } = useRealtimeAlerts({
  filterByMarketId: '131313',
});
```

### Custom Alert Handler

```tsx
const { alerts } = useRealtimeAlerts({
  onAlert: (alert) => {
    // Play sound
    playNotificationSound();
    
    // Send to analytics
    analytics.track('alert_received', {
      type: alert.type,
      severity: alert.severity,
    });
    
    // Show browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(alert.title, {
        body: alert.message,
        icon: '/alert-icon.png',
      });
    }
  },
});
```

---

## Testing

### 1. Verify WebSocket Connection

**Check Browser Console:**
```javascript
// Should see:
WebSocket connected <socket-id>
WebSocket event: alert {...}
```

### 2. Test Alert Reception

**Option A: Wait for Real Alert**
- Wait for Phase 2 to detect an anomaly
- Alert should appear automatically

**Option B: Manual Test (Backend)**
```bash
# Push test alert to Redis
redis-cli
LPUSH alerts:pending '{
  "type": "insider_move",
  "marketId": "131313",
  "severity": "critical",
  "message": "TEST: Price moved 32.50%",
  "data": {"priceChange": 32.5},
  "timestamp": 1704800000000
}'
```

**Option C: Test Alert API Endpoint** (if we add one)
```bash
curl -X POST "http://localhost:3000/api/alerts/test"
```

### 3. Verify UI Display

- Alert toast should appear in top-right corner
- Should show title, message, and Polymarket link
- Should auto-dismiss after 10 seconds
- Should be color-coded by severity

---

## Browser Notifications (Optional Enhancement)

You can add browser push notifications:

```typescript
// Request permission
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// In useRealtimeAlerts hook
onAlert: (alert) => {
  if (Notification.permission === 'granted') {
    new Notification(alert.title, {
      body: alert.message,
      icon: '/alert-icon.png',
      badge: '/badge-icon.png',
    });
  }
}
```

---

## Comparison: Webhook vs WebSocket

| Feature | Webhook | WebSocket |
|---------|---------|-----------|
| **Direction** | Server → Server | Server → Browser |
| **Protocol** | HTTP POST | WebSocket (persistent connection) |
| **Use Case** | External services (Slack, email, etc.) | Real-time frontend updates |
| **Setup** | Requires public URL | Automatic (same origin) |
| **Latency** | Network-dependent | Real-time (< 100ms) |
| **Our Implementation** | ✅ For external services | ✅ For frontend |

---

## Summary

**Frontend receives alerts via WebSocket, not webhook.**

- ✅ WebSocket is already set up
- ✅ Alert hook created (`useRealtimeAlerts`)
- ✅ Alert component created (`AlertNotification`)
- ✅ Integrated into App.tsx
- ✅ Alerts appear as toast notifications

**Webhooks are for:**
- Sending alerts to external services (Slack, Discord, email, etc.)
- Server-to-server communication
- Your own backend services

**WebSockets are for:**
- Real-time frontend updates
- Browser notifications
- Live UI updates

Both are implemented and working! 🎉
