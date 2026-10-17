import { useEffect, useState } from "react";
import { ago } from "../format";
import { syncNow, useSyncState } from "../sync";

export function SyncPill() {
  const s = useSyncState();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (s.phase === "signed-out") {
    return (
      <a className="pill pill-alert" href="/auth/login">
        Sign in to sync
      </a>
    );
  }

  let text: string;
  let tone = "";
  if (s.phase === "syncing") text = "Syncing…";
  else if (s.phase === "offline") {
    text = s.pending ? `Offline, ${s.pending} to send` : "Offline";
    tone = "pill-quiet";
  } else if (s.phase === "error") {
    text = "Sync failed, retry";
    tone = "pill-alert";
  } else text = s.pending ? `${s.pending} to send` : `Synced ${ago(s.lastSyncedAt)}`;

  return (
    <button
      type="button"
      className={`pill ${tone}`}
      onClick={() => void syncNow()}
      disabled={s.phase === "syncing"}
      aria-live="polite"
      title={s.message ?? "Sync now"}
    >
      <span className={`pill-dot pill-dot-${s.phase}`} aria-hidden="true" />
      {text}
    </button>
  );
}
