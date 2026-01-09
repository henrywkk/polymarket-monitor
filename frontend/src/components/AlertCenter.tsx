/**
 * Alert Center Component
 * 
 * Displays a bell icon with unread alert count badge.
 * When clicked, shows a dropdown with all unread alerts.
 * User can mark all as read or clear the queue.
 * 
 * All state is managed client-side using localStorage for persistence.
 */

import { useState, useEffect, useRef } from 'react';
import { useRealtimeAlerts, Alert } from '../hooks/useRealtimeAlerts';
import { Bell, X, CheckCheck, Trash2, ExternalLink } from 'lucide-react';

const STORAGE_KEY = 'polymarket_alerts_read';

interface AlertCenterProps {
  position?: 'top-right' | 'top-left';
}

export const AlertCenter = ({ position = 'top-right' }: AlertCenterProps) => {
  const { alerts, isConnected } = useRealtimeAlerts({
    maxAlerts: 100, // Keep more alerts in memory
  });
  const [isOpen, setIsOpen] = useState(false);
  const [readAlertTimestamps, setReadAlertTimestamps] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load read alerts from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const timestamps = JSON.parse(stored) as string[];
        setReadAlertTimestamps(new Set(timestamps));
      }
    } catch (error) {
      console.error('Error loading read alerts from localStorage:', error);
    }
  }, []);

  // Save read alerts to localStorage whenever it changes
  useEffect(() => {
    try {
      const timestamps = Array.from(readAlertTimestamps);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timestamps));
    } catch (error) {
      console.error('Error saving read alerts to localStorage:', error);
    }
  }, [readAlertTimestamps]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        window.dispatchEvent(new CustomEvent('alertCenterToggle', { detail: { isOpen: false } }));
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Filter unread alerts for badge count
  const unreadAlerts = alerts.filter(alert => !readAlertTimestamps.has(alert.timestamp));
  const unreadCount = unreadAlerts.length;
  
  // Show all alerts in dropdown (not just unread), but mark which are read
  const allAlerts = alerts; // Show all alerts, not just unread

  // Mark alert as read
  const markAsRead = (timestamp: string) => {
    setReadAlertTimestamps(prev => new Set([...prev, timestamp]));
  };

  // Mark all alerts as read
  const markAllAsRead = () => {
    const allTimestamps = alerts.map(alert => alert.timestamp);
    setReadAlertTimestamps(prev => new Set([...prev, ...allTimestamps]));
  };

  // Clear all alerts (remove from read list and mark all as read)
  const clearAll = () => {
    const allTimestamps = alerts.map(alert => alert.timestamp);
    setReadAlertTimestamps(prev => new Set([...prev, ...allTimestamps]));
    // Also clear localStorage (optional - keeps it clean)
    try {
      localStorage.removeItem(STORAGE_KEY);
      setReadAlertTimestamps(new Set(allTimestamps));
    } catch (error) {
      console.error('Error clearing alerts:', error);
    }
  };

  // Get severity color
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-l-red-500 bg-red-500/10';
      case 'high':
        return 'border-l-orange-500 bg-orange-500/10';
      case 'medium':
        return 'border-l-yellow-500 bg-yellow-500/10';
      case 'low':
        return 'border-l-blue-500 bg-blue-500/10';
      default:
        return 'border-l-gray-500 bg-gray-500/10';
    }
  };

  // Get alert icon
  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'insider_move':
        return '📈';
      case 'whale_trade':
        return '🐋';
      case 'liquidity_vacuum':
        return '💧';
      case 'fat_finger':
      case 'volume_acceleration':
        return '⚡';
      default:
        return '⚠️';
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn('Invalid timestamp:', timestamp);
        return 'Unknown time';
      }
      
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      
      // Handle negative differences (future dates) or very large differences (likely data error)
      if (diffMs < 0) {
        return 'Just now'; // Future date, treat as now
      }
      if (diffMs > 86400000 * 365) {
        // More than a year old, show actual date
        return date.toLocaleDateString();
      }
      
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch (error) {
      console.error('Error formatting timestamp:', error, timestamp);
      return 'Unknown time';
    }
  };

  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
  };

  return (
    <div className={`fixed ${positionClasses[position]} z-50`} ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-3 bg-[#121826] border border-slate-800/60 rounded-lg hover:bg-[#1a2332] transition-colors"
        aria-label={`Alerts (${unreadCount} unread)`}
      >
        <Bell className="w-5 h-5 text-slate-300" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
        {!isConnected && (
          <span className="absolute bottom-0 right-0 w-2 h-2 bg-gray-500 rounded-full border border-[#121826]" />
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-96 max-h-[600px] bg-[#121826] border border-slate-800/60 rounded-lg shadow-xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-800/60 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Alerts</h3>
              {unreadCount > 0 && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {unreadCount} unread {unreadCount === 1 ? 'alert' : 'alerts'}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {unreadCount > 0 && (
                <>
                  <button
                    onClick={markAllAsRead}
                    className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 rounded transition-colors"
                    title="Mark all as read"
                    aria-label="Mark all as read"
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                  <button
                    onClick={clearAll}
                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800/50 rounded transition-colors"
                    title="Clear all"
                    aria-label="Clear all alerts"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  setIsOpen(false);
                  window.dispatchEvent(new CustomEvent('alertCenterToggle', { detail: { isOpen: false } }));
                }}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 rounded transition-colors"
                title="Close"
                aria-label="Close alerts"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Alerts List */}
          <div className="overflow-y-auto flex-1">
            {allAlerts.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-400">No alerts</p>
                <p className="text-xs text-slate-500 mt-1">You're all caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {allAlerts.map((alert) => {
                  const isRead = readAlertTimestamps.has(alert.timestamp);
                  return (
                    <AlertItem
                      key={alert.timestamp}
                      alert={alert}
                      isRead={isRead}
                      onMarkAsRead={() => markAsRead(alert.timestamp)}
                      onDismiss={() => {
                        markAsRead(alert.timestamp);
                        setIsOpen(false);
                      }}
                      getSeverityColor={getSeverityColor}
                      getAlertIcon={getAlertIcon}
                      formatTimestamp={formatTimestamp}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface AlertItemProps {
  alert: Alert;
  isRead: boolean;
  onMarkAsRead: () => void;
  onDismiss: () => void;
  getSeverityColor: (severity: string) => string;
  getAlertIcon: (type: string) => string;
  formatTimestamp: (timestamp: string) => string;
}

const AlertItem = ({
  alert,
  isRead,
  onMarkAsRead,
  onDismiss,
  getSeverityColor,
  getAlertIcon,
  formatTimestamp,
}: AlertItemProps) => {
  const severityColor = getSeverityColor(alert.severity);
  const icon = getAlertIcon(alert.type);

  return (
    <div className={`p-4 border-l-4 ${severityColor} hover:bg-slate-800/30 transition-colors ${isRead ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="text-xl flex-shrink-0">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <h4 className={`text-sm font-semibold line-clamp-1 ${isRead ? 'text-slate-400' : 'text-slate-200'}`}>
                  {alert.title}
                </h4>
                {!isRead && (
                  <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full" title="Unread" />
                )}
              </div>
              <button
                onClick={onDismiss}
                className="flex-shrink-0 p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded transition-colors"
                aria-label="Dismiss alert"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className={`text-xs mb-2 ${isRead ? 'text-slate-500' : 'text-slate-400'}`} style={{ 
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word'
            }}>{alert.message}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">{formatTimestamp(alert.timestamp)}</span>
              {alert.polymarketUrl && (
                <a
                  href={alert.polymarketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onMarkAsRead}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                >
                  View <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
