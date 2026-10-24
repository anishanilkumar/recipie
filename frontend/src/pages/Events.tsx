import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listEvents } from "../events";
import { ago } from "../format";
import { HttpError } from "../sync";
import type { EventSummary } from "../types";

// Menus cooked for other people. Online only: an event is shared through the
// server, so there's nothing useful to do with one offline.
export function Events() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<"signed-out" | "offline" | null>(null);

  useEffect(() => {
    listEvents().then(setEvents, (e) => setError(e instanceof HttpError && e.status === 401 ? "signed-out" : "offline"));
  }, []);

  return (
    <div className="page page-events">
      <header className="topbar">
        <nav className="back"><Link to="/">Recipes</Link></nav>
        <h1 className="wordmark">Events</h1>
      </header>

      {error === "signed-out" ? (
        <div className="empty">
          <p className="empty-title">Sign in to see events.</p>
          <a className="btn btn-primary" href="/auth/login">Sign in</a>
        </div>
      ) : error ? (
        <div className="empty">
          <p className="empty-title">No connection.</p>
          <p>Events are kept on the server. Try again when you're online.</p>
        </div>
      ) : events === null ? null : events.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No events yet.</p>
          <p>Plan a menu for a lunch or a party, with a shopping list the cooks can share. Or paste a menu to Claude and
            ask it to save it as an event.</p>
          <Link className="btn btn-primary" to="/events/new">Plan an event</Link>
        </div>
      ) : (
        <ul className="tray">
          {events.map((e) => (
            <li key={e.id}>
              <Link to={`/events/${e.id}/edit`} className="row">
                <span className="row-body">
                  <span className="row-title">{e.title}</span>
                  <span className="row-why">
                    {e.days.map((d) => [d.label, d.headcount ? `for ${d.headcount}` : ""].filter(Boolean).join(" ")).join(" · ")}
                  </span>
                </span>
                <span className="row-meta">
                  <span>{e.share_enabled ? "Shared" : "Not shared"}</span>
                  <span>{ago(e.updated_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {events?.length ? (
        <Link to="/events/new" className="fab" aria-label="Plan an event">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </Link>
      ) : null}
    </div>
  );
}
