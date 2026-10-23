"use client";

import { useRef, useState } from "react";
import kit from "../../kit.module.css";
import st from "./instructor.module.css";

/* Instructor — Students sample screen: roster with status filters, a local
   CSV template download (Blob + anchor, no network), and paste-list import
   with per-row validation. Problems are flagged amber, never red.
   Memory-only — every state resets on reload. */

type RosterStatus = "active" | "invited" | "notstarted";
type RosterFilter = "all" | RosterStatus;

type RosterRow = {
  id: string;
  name: string;
  email: string;
  course: string;
  status: RosterStatus;
  lastActive: string;
};

type ParsedRow = {
  name: string;
  email: string;
  valid: boolean;
};

const BASE_ROSTER: readonly RosterRow[] = [
  { id: "amara", name: "Amara Okafor", email: "amara.o@example.edu", course: "Neural Networks Foundations", status: "active", lastActive: "2 hours ago" },
  { id: "jonas", name: "Jonas Lindqvist", email: "j.lindqvist@example.edu", course: "Neural Networks Foundations", status: "active", lastActive: "Yesterday" },
  { id: "sofia", name: "Sofia Marchetti", email: "sofia.m@example.edu", course: "Statistics for A/B Tests", status: "active", lastActive: "3 days ago" },
  { id: "daniel", name: "Daniel Osei", email: "d.osei@example.edu", course: "Neural Networks Foundations", status: "notstarted", lastActive: "Enrolled Oct 2 · never opened" },
  { id: "lena", name: "Lena Fischer", email: "lena.f@example.edu", course: "Technical Writing Basics", status: "active", lastActive: "5 days ago" },
  { id: "ravi", name: "Ravi Patel", email: "ravi.p@example.edu", course: "Statistics for A/B Tests", status: "invited", lastActive: "Invited 2 days ago" },
  { id: "grace", name: "Grace Nakamura", email: "grace.n@example.edu", course: "Statistics for A/B Tests", status: "notstarted", lastActive: "Enrolled Oct 6 · never opened" },
  { id: "omar", name: "Omar Haddad", email: "omar.h@example.edu", course: "Technical Writing Basics", status: "active", lastActive: "1 week ago" },
  { id: "ines", name: "Inés Duarte", email: "ines.d@example.edu", course: "Technical Writing Basics", status: "invited", lastActive: "Invited 4 days ago" },
];

const FILTERS: readonly { key: RosterFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "invited", label: "Invited" },
  { key: "notstarted", label: "Not started" },
];

const EMPTY_STATE_TEXT: Record<RosterFilter, { title: string; text: string }> = {
  all: {
    title: "Nobody here",
    text: "No students match this filter yet — the roster will not pad itself with placeholder rows.",
  },
  active: {
    title: "No active students",
    text: "No student has opened a lesson or practice in the last 7 days.",
  },
  invited: {
    title: "No pending invites",
    text: "No outstanding invites. Add students above to send some.",
  },
  notstarted: {
    title: "Everyone has started",
    text: "Every enrolled student has opened the course at least once — a plain good fact, not a score.",
  },
};

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function parseLines(text: string): ParsedRow[] {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      let name = "";
      let email = "";
      const angle = line.match(/^(.*?)<([^>]+)>\s*$/);
      if (angle) {
        name = angle[1].trim();
        email = angle[2].trim();
      } else if (line.includes(",")) {
        const parts = line.split(",");
        name = parts[0].trim();
        email = parts
          .slice(1)
          .join(",")
          .trim();
      } else {
        email = line;
      }
      return { name, email, valid: EMAIL_RE.test(email) };
    });
}

/* Local-only download: builds the file in memory, never touches the network. */
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function StatusPill({ status }: { status: RosterStatus }) {
  if (status === "active") {
    return (
      <span className={kit.pillSuccess}>
        <span className={kit.dot} />
        Active
      </span>
    );
  }
  if (status === "invited") {
    return (
      <span className={kit.pillMuted}>
        <span className={kit.dot} />
        Invited
      </span>
    );
  }
  return (
    <span className={kit.pillWarn}>
      <span className={kit.dot} />
      Not started
    </span>
  );
}

export function InstructorStudents() {
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [roster, setRoster] = useState<readonly RosterRow[]>(BASE_ROSTER);
  const [pasteText, setPasteText] = useState("");
  const [parsedRows, setParsedRows] = useState<readonly ParsedRow[] | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const inviteSeq = useRef(0);

  const counts: Record<RosterFilter, number> = { all: roster.length, active: 0, invited: 0, notstarted: 0 };
  for (const row of roster) counts[row.status] += 1;

  const visibleRows = filter === "all" ? roster : roster.filter(row => row.status === filter);

  const validCount = parsedRows ? parsedRows.filter(row => row.valid).length : 0;
  const invalidCount = parsedRows ? parsedRows.length - validCount : 0;

  function changePaste(value: string) {
    setPasteText(value);
    setParsedRows(null);
    setSentCount(null);
  }

  function previewInvites() {
    setParsedRows(parseLines(pasteText));
  }

  function sendInvites() {
    if (parsedRows === null) return;
    const valid = parsedRows.filter(row => row.valid);
    if (valid.length === 0) return;
    inviteSeq.current += 1;
    const seq = inviteSeq.current;
    setRoster(prev => [
      ...valid.map((row, index) => ({
        id: `invite-${seq}-${index}`,
        name: row.name,
        email: row.email,
        course: "Neural Networks Foundations",
        status: "invited" as const,
        lastActive: "Invited just now",
      })),
      ...prev,
    ]);
    setSentCount(valid.length);
    setPasteText("");
    setParsedRows(null);
  }

  return (
    <div className={st.screen}>
      <div className={st.pageHead}>
        <div>
          <h1 className={st.title}>Students</h1>
          <p className={st.sub}>
            Your roster across all three courses, and the ways to add people to it. Invites go out by email; students
            appear here as soon as they are invited.
          </p>
        </div>
      </div>

      <section className={st.panel} aria-labelledby="import-h">
        <div className={st.panelHead}>
          <h2 id="import-h" className={st.panelTitle}>
            Add students
          </h2>
          <span className={st.panelNote}>Invites are recorded here — nothing is emailed in this sample</span>
        </div>
        <div className={st.importGrid}>
          <div>
            <div className={st.addSlot}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="11" />
                <polyline points="9 14 12 11 15 14" />
              </svg>
              <span>Drop a CSV roster here — file upload is disabled in this sample. Paste a list below instead.</span>
            </div>
            <div className={st.importRow}>
              <button
                type="button"
                className={st.textLink}
                onClick={() => downloadText("fieldnotes-roster-template.csv", "name,email\nAda Example,ada.example@example.edu\n")}
              >
                Download CSV template
              </button>
              <span className={st.monoMeta}>Columns: name, email</span>
            </div>
          </div>

          <div className={st.pasteField}>
            <label htmlFor="paste-list" className={st.fieldLabel}>
              Or paste an email list
            </label>
            <span className={st.fieldHint}>{"One per line — an email alone, “Name <email>”, or “Name, email”."}</span>
            <textarea
              id="paste-list"
              className={kit.textarea}
              placeholder={"Maya Chen <maya.chen@example.edu>\nTomas Reyes, tomas.reyes@example.edu\npriya.n@example.edu"}
              value={pasteText}
              onChange={event => changePaste(event.target.value)}
            />
          </div>

          <div className={st.importActions}>
            <button
              type="button"
              className={st.secondaryBtn}
              disabled={pasteText.trim().length === 0}
              onClick={previewInvites}
            >
              Preview invites
            </button>
            <button type="button" className={st.primaryBtn} disabled={parsedRows === null || validCount === 0} onClick={sendInvites}>
              Send invites
            </button>
          </div>

          {parsedRows !== null && (
            <div>
              <p className={st.previewNote}>
                {parsedRows.length} row{parsedRows.length === 1 ? "" : "s"} read — {validCount} ready to invite
                {invalidCount > 0 ? `, ${invalidCount} skipped (flagged above, not errors)` : ""}.
              </p>
              <div className={st.tableScroll}>
                <table className={`${st.dataTable} ${st.wideTable} ${st.middleTable}`} aria-label="Invite preview">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, index) => (
                      <tr key={`${index}-${row.email}`} className={row.valid ? undefined : st.rowFlag}>
                        <td className={st.cellName}>
                          {row.name.length > 0 ? row.name : <span className={st.noData}>—</span>}
                        </td>
                        <td className={st.cellEmail}>{row.email}</td>
                        <td>
                          {row.valid ? (
                            <span className={kit.pillSuccess}>
                              <span className={kit.dot} />
                              Ready to invite
                            </span>
                          ) : (
                            <span className={st.flagNote}>
                              <span className={st.flagDot} />
                              Not a valid email — this row will be skipped
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sentCount !== null && (
            <output className={st.statusGood}>
              {sentCount} invite{sentCount === 1 ? "" : "s"} recorded in this sample — nothing was emailed. New rows
              appear in the roster as “Invited”.
            </output>
          )}
        </div>
      </section>

      <section aria-labelledby="roster-h">
        <div className={st.panelHead}>
          <h2 id="roster-h" className={st.panelTitle}>
            Roster
          </h2>
          <span className={st.panelNote}>Sample data · shown across all your courses</span>
        </div>

        <fieldset className={st.segFieldset}>
          <legend className={st.srOnly}>Filter roster by status</legend>
          <div className={st.seg}>
            {FILTERS.map(tab => (
              <button
                key={tab.key}
                type="button"
                className={st.segBtn}
                aria-pressed={filter === tab.key}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label}
                <span className={st.segCount}>{counts[tab.key]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className={`${st.panel} ${st.flushPanel}`}>
          <div className={st.tableScroll}>
            <table className={`${st.dataTable} ${st.wideTable} ${st.middleTable}`} aria-label="Student roster">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Course</th>
                  <th>Status</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr key={row.id}>
                    <td className={st.cellName}>{row.name}</td>
                    <td className={st.cellEmail}>{row.email}</td>
                    <td>{row.course}</td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                    <td className={st.cellTime}>{row.lastActive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={st.rosterLegend}>
            “Active” means the student opened a lesson or practice in the last 7 days. “Not started” means enrolled but
            never opened — stated plainly, not counted as inactive.
          </p>
        </div>

        {visibleRows.length === 0 && (
          <div className={st.emptyBox}>
            <h3 className={st.emptyTitle}>{EMPTY_STATE_TEXT[filter].title}</h3>
            <p className={st.emptyText}>{EMPTY_STATE_TEXT[filter].text}</p>
          </div>
        )}
      </section>
    </div>
  );
}
