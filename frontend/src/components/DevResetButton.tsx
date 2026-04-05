// components/DevResetButton.tsx
import React from 'react';
import axios from 'axios';
import { useState } from 'react';

interface DevResetButtonProps {
  eventId: number;
  eventName: string;
  onResetComplete?: () => void;
}

export const DevResetButton: React.FC<DevResetButtonProps> = ({ 
  eventId, 
  eventName, 
  onResetComplete 
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleReset = async () => {
    // Confirmation dialog
    const confirmed = window.confirm(
      `⚠️ DEV RESET: Reset event "${eventName}" (#${eventId})?\n\n` +
      `This will:\n` +
      `• Reset all processing data\n` +
      `• Delete clusters, indexes, thumbnails\n` +
      `• Clear Redis cache\n\n` +
      `PRESERVED:\n` +
      `• Original uploaded images ✅\n` +
      `• Event settings ✅\n\n` +
      `Continue?`
    );

    if (!confirmed) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await axios.post(
        `/api/events/${eventId}/dev-reset`,
        {},
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
      );

      const data = response.data;
      
      setResult(`✅ Reset complete!\n` +
        `Photos reset: ${data.reset_summary.photos_reset}\n` +
        `Clusters deleted: ${data.reset_summary.clusters_deleted}\n` +
        `Ready to re-process!`);

      if (onResetComplete) onResetComplete();

    } catch (error: any) {
      setResult(`❌ Error: ${error.response?.data?.detail || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Only show in development mode
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  return (
    <div style={{ 
      margin: '20px 0', 
      padding: '15px', 
      border: '2px dashed #ff4444',
      borderRadius: '8px',
      backgroundColor: '#fff5f5'
    }}>
      <h4 style={{ color: '#cc0000', marginBottom: '10px' }}>
        🛠️ Development Tools (Dev Mode Only)
      </h4>
      
      <button
        onClick={handleReset}
        disabled={loading}
        style={{
          padding: '10px 20px',
          backgroundColor: '#ff4444',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
          fontSize: '14px',
          opacity: loading ? 0.6 : 1
        }}
      >
        {loading ? '⏳ Resetting...' : '🔄 Reset Event (Dev)'}
      </button>

      {result && (
        <pre style={{
          marginTop: '10px',
          padding: '10px',
          backgroundColor: '#f0f0f0',
          borderRadius: '4px',
          fontSize: '12px',
          whiteSpace: 'pre-wrap',
          color: '#333'
        }}>
          {result}
        </pre>
      )}
    </div>
  );
};