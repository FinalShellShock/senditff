// Thumbs up/down + reason chips + comment, shared by the Send It trade cards
// and the scouting report plays.
//
// Extracted rather than copied. Johnny asked for scouting feedback that works
// "the same as trade finder", and two copies of an eighty line stateful widget
// drift within a release or two: one gets a toggle-off fix, the other doesn't.
// Sharing the component makes "the same" structural instead of a promise.
//
// The reason KEYS stay with the caller, because they are the part that must
// differ. A trade and a scouting play fail in completely different ways, and a
// shared chip list would collapse both into vague labels that tune neither.

import { useState, type ReactNode } from "react";

export type FeedbackReason = { key: string; label: string };
export type FeedbackVerdictValue = "up" | "down";

// Outline thumb, drawn with strokes so `currentColor` drives it: the button's
// own color handles the neutral/green/red states with no second icon. Thumbs
// down is the same path rotated 180 degrees, which is exactly how the two
// glyphs relate.
export function ThumbIcon({ direction }: { direction: FeedbackVerdictValue }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...(direction === "down" ? { style: { transform: "rotate(180deg)" } } : {})}
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

export function FeedbackBlock({
  upReasons,
  downReasons,
  upLabel,
  downLabel,
  leading,
  onSubmit,
}: {
  upReasons: FeedbackReason[];
  downReasons: FeedbackReason[];
  /** Tooltip / aria-label for the thumbs-up button, e.g. "Good trade". */
  upLabel: string;
  downLabel: string;
  /** Optional control pinned to the left of the thumbs (Send It's prompt toggle). */
  leading?: ReactNode;
  onSubmit: (payload: {
    verdict: FeedbackVerdictValue;
    reasons: string[];
    comment: string;
  }) => Promise<unknown>;
}) {
  const [verdict, setVerdict] = useState<FeedbackVerdictValue | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function pickVerdict(next: FeedbackVerdictValue) {
    if (sent) return;
    if (verdict === next) {
      // Toggle off.
      setVerdict(null);
      setReasons([]);
      return;
    }
    // Either opening fresh or switching sides: the reason keys differ
    // between up and down, so always clear.
    setVerdict(next);
    setReasons([]);
    setSendError(null);
  }

  function toggleReason(key: string) {
    setReasons((prev) => (prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]));
  }

  function submit() {
    if (!verdict || sending) return;
    setSending(true);
    setSendError(null);
    onSubmit({ verdict, reasons, comment: comment.trim() })
      .then(() => setSent(true))
      .catch((e) => setSendError(e instanceof Error ? e.message : "Failed to send feedback"))
      .finally(() => setSending(false));
  }

  const reasonOptions = verdict === "down" ? downReasons : upReasons;

  return (
    <>
      <div className="trade-feedback-bar">
        {/* Even with no leading control, the empty span keeps the thumbs pinned right. */}
        {leading ?? <span />}
        <span className="trade-feedback-thumbs">
          <button
            type="button"
            className={`trade-feedback-btn${verdict === "up" ? " trade-feedback-btn-up" : ""}`}
            onClick={() => pickVerdict("up")}
            disabled={sent}
            aria-pressed={verdict === "up"}
            title={upLabel}
            aria-label={upLabel}
          >
            <ThumbIcon direction="up" />
          </button>
          <button
            type="button"
            className={`trade-feedback-btn${verdict === "down" ? " trade-feedback-btn-down" : ""}`}
            onClick={() => pickVerdict("down")}
            disabled={sent}
            aria-pressed={verdict === "down"}
            title={downLabel}
            aria-label={downLabel}
          >
            <ThumbIcon direction="down" />
          </button>
        </span>
      </div>

      {verdict && sent && (
        <div className="trade-feedback-panel">
          <p className="trade-feedback-sent">
            <ThumbIcon direction={verdict} />
            Thanks, logged.
          </p>
        </div>
      )}

      {verdict && !sent && (
        <div className="trade-feedback-panel">
          <div className="trade-feedback-chips">
            {reasonOptions.map((r) => (
              <button
                type="button"
                key={r.key}
                className={`trade-feedback-chip${reasons.includes(r.key) ? " selected" : ""}`}
                onClick={() => toggleReason(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            className="trade-feedback-comment"
            placeholder="Anything else? (optional)"
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {sendError && <p className="trade-feedback-error">{sendError}</p>}
          <button type="button" className="trade-feedback-submit" disabled={sending} onClick={submit}>
            {sending ? "Sending..." : "Send feedback"}
          </button>
        </div>
      )}
    </>
  );
}
