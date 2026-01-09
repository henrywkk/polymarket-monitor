/**
 * Notification Channels
 * 
 * Abstract interface and implementations for delivering alerts through various channels.
 */

import { FormattedAlert } from './alert-dispatcher';

/**
 * Base interface for notification channels
 */
export interface NotificationChannel {
  name: string;
  enabled: boolean;
  send(alert: FormattedAlert): Promise<boolean>;
}

/**
 * Webhook notification channel
 */
export class WebhookChannel implements NotificationChannel {
  name = 'webhook';
  enabled: boolean;
  private url: string;
  private secret?: string;
  private timeout: number;
  private retryAttempts: number;

  constructor() {
    this.enabled = process.env.WEBHOOK_ENABLED === 'true';
    this.url = process.env.WEBHOOK_URL || '';
    this.secret = process.env.WEBHOOK_SECRET;
    this.timeout = parseInt(process.env.WEBHOOK_TIMEOUT || '5000', 10);
    this.retryAttempts = parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS || '3', 10);

    if (this.enabled && !this.url) {
      console.warn('[Webhook Channel] WEBHOOK_ENABLED is true but WEBHOOK_URL is not set');
      this.enabled = false;
    }
  }

  async send(alert: FormattedAlert): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    const payload = this.buildPayload(alert);
    const headers = this.buildHeaders();

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await fetch(this.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        });

        if (response.ok) {
          console.log(`[Webhook Channel] Alert delivered successfully (attempt ${attempt})`);
          return true;
        } else {
          console.warn(`[Webhook Channel] HTTP ${response.status} (attempt ${attempt}/${this.retryAttempts})`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[Webhook Channel] Error on attempt ${attempt}/${this.retryAttempts}: ${errorMessage}`);
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < this.retryAttempts) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.error(`[Webhook Channel] Failed to deliver alert after ${this.retryAttempts} attempts`);
    return false;
  }

  private buildPayload(alert: FormattedAlert): any {
    return {
      alert: {
        type: alert.rawAlert.type,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        marketId: alert.marketInfo.marketId,
        marketName: alert.marketInfo.marketName,
        outcomeName: alert.marketInfo.outcomeName,
        category: alert.marketInfo.category,
        timestamp: alert.timestamp,
        polymarketUrl: alert.polymarketUrl,
      },
      metrics: alert.metrics,
      signature: this.secret ? this.generateSignature(alert) : undefined,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.secret) {
      headers['X-Webhook-Secret'] = this.secret;
    }

    return headers;
  }

  private generateSignature(alert: FormattedAlert): string {
    // Simple HMAC-like signature (can be enhanced with crypto)
    const payload = JSON.stringify(alert);
    // For now, return a simple hash. In production, use proper HMAC-SHA256
    return Buffer.from(`${payload}${this.secret}`).toString('base64');
  }
}

/**
 * WebSocket notification channel (for frontend)
 */
export class WebSocketChannel implements NotificationChannel {
  name = 'websocket';
  enabled: boolean;
  private wsServer?: any; // WebSocketServer instance

  constructor(wsServer?: any) {
    this.enabled = process.env.WEBSOCKET_ALERTS_ENABLED !== 'false'; // Default: enabled
    this.wsServer = wsServer;
  }

  async send(alert: FormattedAlert): Promise<boolean> {
    if (!this.enabled || !this.wsServer) {
      return false;
    }

    try {
      // Broadcast alert to all connected clients
      this.wsServer.broadcastAlert({
        type: alert.rawAlert.type,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        marketId: alert.marketInfo.marketId,
        marketName: alert.marketInfo.marketName,
        outcomeName: alert.marketInfo.outcomeName,
        timestamp: alert.timestamp,
        polymarketUrl: alert.polymarketUrl,
        metrics: alert.metrics,
      });

      return true;
    } catch (error) {
      console.error('[WebSocket Channel] Error broadcasting alert:', error);
      return false;
    }
  }
}

/**
 * Email notification channel (optional, requires SMTP)
 */
export class EmailChannel implements NotificationChannel {
  name = 'email';
  enabled: boolean;
  // Email implementation deferred to future phase
  // Would require nodemailer or similar library

  constructor() {
    this.enabled = process.env.EMAIL_ENABLED === 'true';
    if (this.enabled) {
      console.warn('[Email Channel] Email notifications not yet implemented');
      this.enabled = false;
    }
  }

  async send(_alert: FormattedAlert): Promise<boolean> {
    // TODO: Implement email sending
    return false;
  }
}
