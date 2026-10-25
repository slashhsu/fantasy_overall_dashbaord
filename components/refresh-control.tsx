"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { HelpTip } from "@/components/help-tip";
import type { UpdateStatus } from "@/lib/types";
export function RefreshControl({ status, loading, disabled, onRefresh, label }: {
  status?: UpdateStatus; loading: boolean; disabled: boolean; onRefresh: () => void; label?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const seconds = status ? Math.max(0, Math.ceil((Date.parse(status.nextRefreshAt) - now) / 1000)) : 0;
  return <span className="refresh-with-help"><button type="button" aria-label={label} className="refresh-button" disabled={disabled || loading || seconds > 0} onClick={onRefresh}>
    <RefreshCw size={16} className={loading ? "animate-spin" : ""} aria-hidden="true" />
    <span>{seconds > 0 ? `Refresh (${seconds}s)` : "Refresh"}</span>
  </button><HelpTip topic="refresh" /></span>;
}
export function UpdateNotice({ status }: { status?: UpdateStatus }) {
  if (!status) return null;
  return <p className={status.stale ? "inline-notice warning" : "update-notice"} role="status">
    {status.stale ? "Showing backup data · " : "Data retrieved · "}
    {new Date(status.fetchedAt).toLocaleString()}<HelpTip topic="cache" />{status.stale ? <HelpTip topic="partial" /> : null}
  </p>;
}
