import { useEffect, useState } from "react";
import { PATCH_NOTES } from "../data/patchNotes.ts";
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

export default function PatchNotes() {
  const [open, setOpen] = useState(false);
  const latest = PATCH_NOTES[0];

  // Escape closes the modal, and the page behind is locked from scrolling
  // while it's open.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!latest) return null;

  return (
    <>
      <div className="app-footer">
        <button className="app-footer-version" onClick={() => setOpen(true)}>
          {latest.version}
        </button>
      </div>

      {open && (
        <div className="patch-modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="patch-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Patch notes"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="patch-modal-header">
              <span className="patch-modal-title">Patch notes</span>
              <button className="patch-modal-close" onClick={() => setOpen(false)} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="patch-modal-body">
              {PATCH_NOTES.map((note, i) => (
                <div className="patch-release" key={note.version}>
                  {i > 0 && <div className="patch-release-divider" />}
                  <div className="patch-release-header">
                    <span className="patch-release-version">{note.version}</span>
                    <span className="patch-release-date dim-text">{formatDate(note.date)}</span>
                  </div>
                  <div className="patch-release-title">{note.title}</div>

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
