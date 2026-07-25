import { useEffect, useState } from "react";
import { PATCH_NOTES } from "../data/patchNotes.ts";
import { LEGAL_UPDATED, PRIVACY_POLICY, TERMS_OF_SERVICE, type LegalSection } from "../data/legal.ts";
import { ALGO_VERSION, ALGO_FINGERPRINT } from "../algo/version.ts";

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

type Panel = "updates" | "privacy" | "terms";

const PANEL_TITLE: Record<Panel, string> = {
  updates: "Recent updates",
  privacy: "Privacy policy",
  terms: "Terms of service",
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
        <div className="patch-release" key={note.branch}>
          {i > 0 && <div className="patch-release-divider" />}
          <div className="patch-release-header">
            <span className="patch-release-version">{note.branch}</span>
            <span className="patch-release-date dim-text">{formatDate(note.date)}</span>
          </div>
          <div className="patch-release-title">{note.title}</div>
          {/* The formation names the ENGINE, not the release. One engine spans
              several releases, so it is reported here rather than used as the
              version number. */}
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

export default function Footer() {
  const [panel, setPanel] = useState<Panel | null>(null);

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
