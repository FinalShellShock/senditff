import { useCallback, useEffect, useRef, useState } from "react";
import { PATCH_NOTES } from "../data/patchNotes.ts";
import { LEGAL_UPDATED, PRIVACY_POLICY, TERMS_OF_SERVICE, type LegalSection } from "../data/legal.ts";
import { ALGO_VERSION, ALGO_FINGERPRINT } from "../algo/version.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import { makeApiClient, type FeedbackSummary, type PendingUser } from "../api/client.ts";
import {
  categoryForRoute,
  FEEDBACK_CATEGORIES,
} from "../data/feedbackCategories.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Manual formatting (not Date + toLocaleDateString) sidesteps the classic
// timezone off-by-one: parsing "YYYY-MM-DD" as UTC midnight and then
// formatting in the browser's local zone can roll the date back a day.
function formatDate(iso: string): string {
  const parts = iso.split("-");
  const y = parts[0];
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const month = MONTHS[m - 1];
  if (!y || !month || !d) return iso;
  return `${month} ${d}, ${y}`;
}

const FINGERPRINT_DISPLAY =
  ALGO_FINGERPRINT.length > 12 ? ALGO_FINGERPRINT.slice(0, 12) : ALGO_FINGERPRINT;

type Panel = "updates" | "privacy" | "terms" | "feedback" | "admin";

const PANEL_TITLE: Record<Panel, string> = {
  updates: "Recent updates",
  privacy: "Privacy policy",
  terms: "Terms of service",
  feedback: "Feedback",
  admin: "Join requests",
};

function LegalBody({ sections }: { sections: LegalSection[] }) {
  return (
    <>
      <div className="legal-updated dim-text">Last updated {formatDate(LEGAL_UPDATED)}</div>
      {sections.map((section) => (
        <div className="legal-section" key={section.heading}>
          <div className="patch-release-heading">{section.heading}</div>
          {section.body.map((para, i) => (
            <p className="legal-para" key={i}>
              {para}
            </p>
          ))}
        </div>
      ))}
    </>
  );
}

function UpdatesBody() {
  return (
    <>
      {PATCH_NOTES.map((note, i) => (
        <div className="patch-release" key={`${note.branch}-${note.release}`}>
          {i > 0 && <div className="patch-release-divider" />}
          <div className="patch-release-header">
            <span className="patch-release-version">
              {note.branch} {note.release}
            </span>
            <span className="patch-release-date dim-text">{formatDate(note.date)}</span>
          </div>
          <div className="patch-release-title">{note.title}</div>
          {/* Three axes: the BRANCH changes on a paradigm shift, the RELEASE
              on every noticeable deploy, and the formation names the ENGINE.
              One engine spans many branches, so it is reported rather than
              used as the version number. */}
          <div className="patch-release-algo dim-text">{note.algo} engine</div>

          <div className="patch-release-heading">What changed</div>
          <ul className="patch-release-list">
            {note.changes.map((change, ci) => (
              <li key={ci}>{change}</li>
            ))}
          </ul>

          {note.knownIssues.length > 0 && (
            <>
              <div className="patch-release-heading patch-release-heading-muted">Known issues</div>
              <ul className="patch-release-list patch-release-list-muted">
                {note.knownIssues.map((issue, ii) => (
                  <li key={ii}>{issue}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
    </>
  );
}

function BellIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function FeedbackBell({ summary }: { summary: FeedbackSummary | null }) {
  const [tapOpen, setTapOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Mobile/touch has no hover, so a tap opens the tooltip. It closes on the
  // next tap anywhere else, or on scroll, so it never lingers over content.
  useEffect(() => {
    if (!tapOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setTapOpen(false);
      }
    }
    function onScroll() {
      setTapOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [tapOpen]);

  return (
    <div className="feedback-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="feedback-bell"
        onClick={() => setTapOpen((v) => !v)}
        aria-label="Feedback activity"
      >
        <BellIcon />
        {summary && summary.unreviewed > 0 && <span className="feedback-bell-dot" />}
      </button>
      {summary && (
        <div
          className={`feedback-tooltip${tapOpen ? " feedback-tooltip-open" : ""}`}
          role="status"
        >
          {summary.total} feedback log{summary.total === 1 ? "" : "s"}
          <br />
          you {summary.mine} &middot; everyone else {summary.others}
        </div>
      )}
    </div>
  );
}

// Join requests. There is no separate request record: signing in creates an
// unapproved user doc, so this is that collection filtered. Admin-gated
// server-side; this component only ever renders for an admin.
function JoinRequests({ onChanged }: { onChanged: () => void }) {
  const { getToken } = useAuth();
  const [pending, setPending] = useState<PendingUser[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    makeApiClient(getToken)
      .getPendingUsers()
      .then((r) => setPending(r.pending))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load requests"));
  }, [getToken]);

  useEffect(load, [load]);

  function decide(uid: string, action: "approve" | "deny") {
    setBusy(uid);
    setError(null);
    makeApiClient(getToken)
      .decideUser(uid, action)
      .then(() => {
        setPending((prev) => (prev ?? []).filter((p) => p.uid !== uid));
        onChanged();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setBusy(null));
  }

  if (error) return <p className="feedback-form-error">{error}</p>;
  if (pending === null) return <p className="dim-text">Loading...</p>;
  if (pending.length === 0) {
    return <p className="dim-text">Nobody is waiting. Everyone who has signed in has been let in or turned down.</p>;
  }

  return (
    <div className="join-requests">
      {pending.map((u) => (
        <div className="join-request" key={u.uid}>
          <div className="join-request-who">
            <span className="join-request-name">{u.displayName ?? u.email}</span>
            {u.displayName && <span className="join-request-email dim-text">{u.email}</span>}
            {u.createdAt && (
              <span className="join-request-when dim-text">asked {formatDate(u.createdAt.slice(0, 10))}</span>
            )}
          </div>
          <div className="join-request-actions">
            <button
              className="join-approve"
              onClick={() => decide(u.uid, "approve")}
              disabled={busy === u.uid}
            >
              Approve
            </button>
            <button
              className="join-deny"
              onClick={() => decide(u.uid, "deny")}
              disabled={busy === u.uid}
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedbackForm({
  onSubmitted,
  onRequestClose,
}: {
  onSubmitted: () => void;
  onRequestClose: () => void;
}) {
  const { getToken } = useAuth();
  // Defaulted from the page they were standing on, and always editable. A
  // wrong guess costs one click; a right one costs none.
  const [category, setCategory] = useState(() => categoryForRoute(window.location.pathname));
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Give the thank-you a beat on screen, then close on its own so the user
  // isn't left wondering whether the panel is supposed to stay open.
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(onRequestClose, 1600);
    return () => clearTimeout(t);
  }, [sent, onRequestClose]);

  function submit() {
    const trimmed = comment.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    makeApiClient(getToken)
      .submitSiteFeedback({
        kind: "site",
        comment: trimmed,
        category,
        route: window.location.pathname,
      })
      .then(() => {
        setSent(true);
        onSubmitted();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to send feedback"))
      .finally(() => setSending(false));
  }

  if (sent) {
    return <p className="feedback-form-sent">Thanks, got it.</p>;
  }

  return (
    <div className="feedback-form">
      <p className="feedback-form-hint dim-text">
        Anything you notice anywhere in the app: the overview, a scouting report, the calculator,
        grades, an idea, a bug. Feedback on one specific trade belongs on the thumbs on that
        trade's card.
      </p>
      <label className="feedback-form-label" htmlFor="feedback-category">
        What is this about?
      </label>
      <select
        id="feedback-category"
        className="feedback-form-category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        {FEEDBACK_CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <textarea
        ref={textareaRef}
        className="feedback-form-comment"
        placeholder="What's on your mind?"
        maxLength={2000}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {error && <p className="feedback-form-error">{error}</p>}
      <button
        type="button"
        className="feedback-form-submit"
        onClick={submit}
        disabled={!comment.trim() || sending}
      >
        {sending ? "Sending..." : "Submit"}
      </button>
    </div>
  );
}

export default function Footer({ authed = false }: { authed?: boolean }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const { getToken, isAdmin } = useAuth();

  // Join requests, for the admin only. Same shape as the feedback bell: a
  // count that is quiet at zero and impossible to miss above it.
  const refreshPending = useCallback(() => {
    if (!authed || !isAdmin) return;
    makeApiClient(getToken)
      .getPendingUsers()
      .then((r) => setPendingCount(r.pending.length))
      .catch(() => {
        // Ambient info only.
      });
  }, [authed, isAdmin, getToken]);

  useEffect(refreshPending, [refreshPending]);

  function refreshSummary() {
    if (!authed) return;
    makeApiClient(getToken)
      .getFeedbackSummary()
      .then(setSummary)
      .catch(() => {
        // Ambient info only, never worth surfacing as an error.
      });
  }

  // Fetch once on mount. Signed-out users never hit the auth-gated endpoint.
  useEffect(() => {
    if (!authed) return;
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // Escape closes whichever panel is open, and the page behind is locked from
  // scrolling while it is.
  useEffect(() => {
    if (!panel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPanel(null);
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [panel]);

  return (
    <>
      <div className="app-footer">
        {authed && (
          <>
            <FeedbackBell summary={summary} />
            <span className="app-footer-sep">&middot;</span>
          </>
        )}
        <button className="app-footer-link" onClick={() => setPanel("updates")}>
          Recent updates
        </button>
        <span className="app-footer-sep">&middot;</span>
        <button className="app-footer-link" onClick={() => setPanel("privacy")}>
          Privacy
        </button>
        <span className="app-footer-sep">&middot;</span>
        <button className="app-footer-link" onClick={() => setPanel("terms")}>
          Terms
        </button>
        <span className="app-footer-sep">&middot;</span>
        <button className="app-footer-link" onClick={() => setPanel("feedback")}>
          Feedback
        </button>
        <span className="app-footer-sep">&middot;</span>
        {authed && isAdmin && (
          <>
            <button className="app-footer-link" onClick={() => setPanel("admin")}>
              Join requests
              {pendingCount > 0 && <span className="join-count">{pendingCount}</span>}
            </button>
            <span className="app-footer-sep">&middot;</span>
          </>
        )}
        <span className="app-footer-copy">&copy; 2026 Send It</span>
      </div>

      {panel && (
        <div className="patch-modal-backdrop" onClick={() => setPanel(null)}>
          <div
            className="patch-modal"
            role="dialog"
            aria-modal="true"
            aria-label={PANEL_TITLE[panel]}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="patch-modal-header">
              <span className="patch-modal-title">{PANEL_TITLE[panel]}</span>
              <button className="patch-modal-close" onClick={() => setPanel(null)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="patch-modal-body">
              {panel === "updates" && <UpdatesBody />}
              {panel === "privacy" && <LegalBody sections={PRIVACY_POLICY} />}
              {panel === "terms" && <LegalBody sections={TERMS_OF_SERVICE} />}
              {panel === "admin" && <JoinRequests onChanged={refreshPending} />}
              {panel === "feedback" && (
                <FeedbackForm onSubmitted={refreshSummary} onRequestClose={() => setPanel(null)} />
              )}
            </div>

            <div className="patch-modal-footer">
              algo {ALGO_VERSION} &middot; {FINGERPRINT_DISPLAY}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
