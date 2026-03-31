import { useState, useEffect } from 'react';
import { getLastStatus, isScanning } from '../services/securityScanService';
import type { ScanStatus } from '../services/securityScanService';

export function useSecurityStatus(pollInterval = 5000) {
  const [status, setStatus] = useState<ScanStatus | null>(getLastStatus());
  const [scanning, setScanning] = useState(isScanning());

  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(getLastStatus());
      setScanning(isScanning());
    }, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval]);

  return { status, scanning };
}
