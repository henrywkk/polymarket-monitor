/**
 * Hook to receive real-time alert notifications via WebSocket
 * 
 * Alerts are broadcasted to all connected clients when anomalies are detected.
 * This hook listens for 'alert' events and manages alert state.
 */

import { useState, useEffect, useCallback } from 'react';
import { wsService } from '../services/websocket';

export interface Alert {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  marketId: string;
  marketName?: string;
  outcomeName?: string;
  timestamp: string;
  polymarketUrl?: string;
  metrics?: Record<string, any>;
}

export interface UseRealtimeAlertsOptions {
  maxAlerts?: number; // Maximum number of alerts to keep in memory (default: 50)
  filterBySeverity?: ('low' | 'medium' | 'high' | 'critical')[]; // Only show alerts with these severities
  filterByMarketId?: string; // Only show alerts for this market
  onAlert?: (alert: Alert) => void; // Callback when new alert arrives
}

/**
 * Hook to receive real-time alerts via WebSocket
 * 
 * @param options - Configuration options
 * @returns Object with alerts array and helper functions
 */
export const useRealtimeAlerts = (options: UseRealtimeAlertsOptions = {}) => {
  const {
    maxAlerts = 50,
    filterBySeverity,
    filterByMarketId,
    onAlert,
  } = options;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect WebSocket
    wsService.connect();

    // Check connection status
    const checkConnection = () => {
      setIsConnected(wsService.isConnected());
    };
    checkConnection();
    const connectionInterval = setInterval(checkConnection, 2000);

    // Handle alert events
    const handleAlert = (data: unknown) => {
      const alert = data as Alert;

      // Apply filters
      if (filterBySeverity && !filterBySeverity.includes(alert.severity)) {
        return;
      }

      if (filterByMarketId && alert.marketId !== filterByMarketId) {
        return;
      }

      // Add alert to state (newest first)
      setAlerts(prev => {
        const newAlerts = [alert, ...prev];
        // Keep only the most recent alerts
        return newAlerts.slice(0, maxAlerts);
      });

      // Call optional callback
      if (onAlert) {
        onAlert(alert);
      }
    };

    // Subscribe to alert events
    wsService.on('alert', handleAlert);

    return () => {
      clearInterval(connectionInterval);
      wsService.off('alert', handleAlert);
    };
  }, [maxAlerts, filterBySeverity, filterByMarketId, onAlert]);

  // Clear all alerts
  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  // Remove a specific alert
  const removeAlert = useCallback((timestamp: string) => {
    setAlerts(prev => prev.filter(alert => alert.timestamp !== timestamp));
  }, []);

  // Get unread count (alerts that haven't been acknowledged)
  const unreadCount = alerts.length; // For now, all alerts are "unread"

  return {
    alerts,
    isConnected,
    unreadCount,
    clearAlerts,
    removeAlert,
  };
};
