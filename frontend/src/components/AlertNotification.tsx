/**
 * Alert Notification Component
 * 
 * Displays real-time alerts in a notification panel or toast notifications
 */

import { useEffect, useState } from 'react';
import { useRealtimeAlerts, Alert } from '../hooks/useRealtimeAlerts';
import { X, AlertTriangle, TrendingUp, DollarSign, Droplet, Zap } from 'lucide-react';

interface AlertNotificationProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  maxVisible?: number;
  autoDismiss?: number; // Auto-dismiss after N seconds (0 = no auto-dismiss)
}

const getAlertIcon = (type: string) => {
  switch (type) {
    case 'insider_move':
      return <TrendingUp className="w-5 h-5" />;
    case 'whale_trade':
      return <DollarSign className="w-5 h-5" />;
    case 'liquidity_vacuum':
      return <Droplet className="w-5 h-5" />;
    case 'fat_finger':
    case 'volume_acceleration':
      return <Zap className="w-5 h-5" />;
    default:
      return <AlertTriangle className="w-5 h-5" />;
  }
};

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'critical':
      return 'bg-red-600 border-red-500';
    case 'high':
      return 'bg-orange-600 border-orange-500';
    case 'medium':
      return 'bg-yellow-600 border-yellow-500';
    case 'low':
      return 'bg-blue-600 border-blue-500';
    default:
      return 'bg-gray-600 border-gray-500';
  }
};

export const AlertNotification = ({
  position = 'top-right',
  maxVisible = 5,
  autoDismiss = 10, // Auto-dismiss after 10 seconds
}: AlertNotificationProps) => {
  const { alerts } = useRealtimeAlerts({
    maxAlerts: maxVisible * 2, // Keep more in memory than visible
  });
  const [visibleAlerts, setVisibleAlerts] = useState<Set<string>>(new Set());

  // Show new alerts
  useEffect(() => {
    alerts.forEach(alert => {
      if (!visibleAlerts.has(alert.timestamp)) {
        setVisibleAlerts(prev => new Set([...prev, alert.timestamp]));

        // Auto-dismiss after specified time
        if (autoDismiss > 0) {
          setTimeout(() => {
            setVisibleAlerts(prev => {
              const next = new Set(prev);
              next.delete(alert.timestamp);
              return next;
            });
          }, autoDismiss * 1000);
        }
      }
    });
  }, [alerts, visibleAlerts, autoDismiss]);

  // Get visible alerts (newest first)
  const displayAlerts = alerts
    .filter(alert => visibleAlerts.has(alert.timestamp))
    .slice(0, maxVisible);

  if (displayAlerts.length === 0) {
    return null;
  }

  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
  };

  return (
    <div className={`fixed ${positionClasses[position]} z-50 space-y-2 max-w-md`}>
      {displayAlerts.map((alert) => (
        <AlertToast
          key={alert.timestamp}
          alert={alert}
          onDismiss={() => {
            setVisibleAlerts(prev => {
              const next = new Set(prev);
              next.delete(alert.timestamp);
              return next;
            });
          }}
        />
      ))}
    </div>
  );
};

interface AlertToastProps {
  alert: Alert;
  onDismiss: () => void;
}

const AlertToast = ({ alert, onDismiss }: AlertToastProps) => {
  const severityColor = getSeverityColor(alert.severity);
  const icon = getAlertIcon(alert.type);

  return (
    <div
      className={`
        ${severityColor} 
        text-white 
        rounded-lg 
        shadow-lg 
        p-4 
        border-2 
        min-w-[320px] 
        max-w-md
        animate-in 
        slide-in-from-top 
        fade-in
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <div className="flex-shrink-0 mt-0.5">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm mb-1">{alert.title}</div>
            <div className="text-xs opacity-90 line-clamp-2">{alert.message}</div>
            {alert.polymarketUrl && (
              <a
                href={alert.polymarketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline mt-1 inline-block hover:opacity-80"
              >
                View on Polymarket →
              </a>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-white hover:opacity-70 transition-opacity"
          aria-label="Dismiss alert"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

/**
 * Alert Badge Component
 * Shows a badge with unread alert count
 */
export const AlertBadge = () => {
  const { unreadCount, isConnected } = useRealtimeAlerts();

  if (!isConnected || unreadCount === 0) {
    return null;
  }

  return (
    <div className="relative">
      <AlertTriangle className="w-5 h-5 text-yellow-500" />
      {unreadCount > 0 && (
        <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </div>
  );
};
