import { useEffect, useState } from 'react';
import { auditCommands, isLive } from './api';

// Read-only: the same GET /audit/commands the Activity page uses, fetched slowly (15 s) and only
// while the tab is visible. A failed request leaves the old rows in place and never raises a banner.
export function useAudit({ limit = 200, every = 15000 } = {}) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!isLive) { setRows([]); return undefined; }
    let alive = true;
    const load = async () => {
      try {
        const r = await auditCommands({ limit });
        if (alive && Array.isArray(r)) setRows(r);
      } catch { /* keep previous rows */ }
    };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, every);
    return () => { alive = false; clearInterval(t); };
  }, [limit, every]);
  return rows;
}
