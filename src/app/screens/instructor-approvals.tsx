"use client";

// LIVE instructor Approvals screen (epic-5 entry 1 port of the static
// reference): the exact-version approval inspector over the signed-in
// instructor's real pending drafts and committed approval records. The D4
// gate is explicit — a keyboard-operable "I have inspected these exact
// versions" checkbox enables Approve, and the covered-version sentence is
// programmatically tied to the button via aria-describedby. Approval is a
// deliberate authenticated command; the record comes back with approver,
// time and version. Batch approval over listed versions is entry 3 — this
// tracer approves exactly one inspected version.

import { useCallback, useEffect, useRef, useState } from "react";
import kit from "../kit.module.css";
import st from "./instructor.module.css";
import { api, command, json } from "../client";
import { SignInPanel, useSessionGate } from "../live-session";
import type {
  ApprovalsState,
  ApproveVersion,
  ApprovalPendingItem,
  InstructorReceipt,
} from "../../contracts/instructor-courses";

export function InstructorApprovals() {
  const gate = useSessionGate();
  const { session, ready, notice, setNotice } = gate;
  const [approvals, setApprovals] = useState<ApprovalsState>({ pending: [], approved: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspected, setInspected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<"pending" | "approved">("pending");
  const [approveEnvelope, setApproveEnvelope] = useState<ReturnType<typeof command> | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const value = await api<ApprovalsState>("instructor/approvals");
      setApprovals(value);
      setSelectedId(previous =>
        previous && value.pending.some(item => item.versionId === previous)
          ? previous
          : value.pending[0]?.versionId ?? null,
      );
    } catch (error) {
      gate.failure(error);
    }
  }, [gate]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (session) void load();
      else {
        setApprovals({ pending: [], approved: [] });
        setSelectedId(null);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [session, load]);

  // The inspection gate resets in the selection HANDLER whenever the
  // inspected version changes — approval is never sticky across versions.
  function select(versionId: string) {
    setSelectedId(versionId);
    setInspected(false);
    setApproveEnvelope(null);
  }

  const selected: ApprovalPendingItem | null =
    approvals.pending.find(item => item.versionId === selectedId) ?? null;

  async function approve() {
    if (!selected || !inspected || busy) return;
    setBusy(true);
    setNotice("");
    try {
      // The same command replays after a lost response; an explicit new
      // approval attempt mints a fresh command (state-held, not a ref).
      const envelope = approveEnvelope ?? command();
      if (!approveEnvelope) setApproveEnvelope(envelope);
      const receipt = await api<InstructorReceipt>(`instructor/courses/${selected.courseId}/approve`, json({
        ...envelope,
        courseId: selected.courseId,
        versionId: selected.versionId,
      } satisfies ApproveVersion));
      setInspected(false);
      setApproveEnvelope(null);
      await load();
      setNotice(`Approved exact version v${receipt.version}. Approver, time and version are recorded.`);
      requestAnimationFrame(() => detailRef.current?.focus());
    } catch (error) {
      gate.failure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={st.screen}>
      <div className={st.pageHead}>
        <div>
          <h1 className={st.title} tabIndex={-1}>Approvals</h1>
          <p className={st.sub}>
            Nothing reaches enrolled learners until you personally approve the exact version — identified by version
            number and content digest, with approver and time recorded for every approval.
          </p>
        </div>
        <div className={st.pageActions}>
          {session && <button type="button" className={st.quietBtn} onClick={() => { void gate.signOut(); }}>Sign out</button>}
        </div>
      </div>

      <div role="alert" className={notice ? kit.notice : undefined}>{notice}</div>
      {!ready && <output>Checking your session…</output>}
      {ready && !session && (
        <section className={st.panel}>
          <SignInPanel busy={gate.busy} onSubmit={event => { void gate.signIn(event); }} note="Use the operator-provisioned synthetic instructor account." />
        </section>
      )}
      {ready && session && queue === "pending" && approvals.pending.length === 0 && (
        <div className={st.emptyBox}>
          <h2 className={st.emptyTitle}>Nothing waiting</h2>
          <p className={st.emptyText}>Draft a manual version on the Courses screen — it appears here for exact-version inspection before learners can see it.</p>
        </div>
      )}
      {ready && session && queue === "approved" && approvals.approved.length === 0 && (
        <div className={st.emptyBox}>
          <h2 className={st.emptyTitle}>No approvals yet</h2>
          <p className={st.emptyText}>Approve a pending draft and its approver/time/version record appears here.</p>
        </div>
      )}
      {ready && session && (approvals.pending.length > 0 || approvals.approved.length > 0) && (
        <>
          <fieldset className={st.segFieldset}>
            <legend className={st.srOnly}>Approval queue filter</legend>
            <div className={st.seg}>
              <button type="button" className={st.segBtn} aria-pressed={queue === "pending"} onClick={() => setQueue("pending")}>
                Pending<span className={st.segCount}>{approvals.pending.length}</span>
              </button>
              <button type="button" className={st.segBtn} aria-pressed={queue === "approved"} onClick={() => setQueue("approved")}>
                Approved<span className={st.segCount}>{approvals.approved.length}</span>
              </button>
            </div>
          </fieldset>

          {queue === "pending" && (
            <div className={st.approvalsGrid}>
              <fieldset className={st.queueFieldset}>
                <legend className={st.listLabel}>Pending approval</legend>
                <div className={st.queueList}>
                  {approvals.pending.map(item => (
                    <button
                      key={item.versionId}
                      type="button"
                      className={st.queueItem}
                      aria-pressed={selectedId === item.versionId}
                      onClick={() => select(item.versionId)}
                    >
                      <span className={st.qTop}>
                        <span className={st.qName}>{item.courseTitle}<span className={st.verChip}>v{item.version}</span></span>
                      </span>
                      <span className={st.qChanged}>Manual draft · {item.lesson.sections.length} section{item.lesson.sections.length === 1 ? "" : "s"}</span>
                      <span className={st.qBy}>Drafted {item.createdAt.slice(0, 10)} · digest {item.digest.slice(0, 12)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              {selected && (
                <div className={st.detail} ref={detailRef} tabIndex={-1}>
                  <h2 className={st.detailTitle}>{selected.courseTitle} — v{selected.version}</h2>
                  <p className={st.dBy}>Manual draft · submitted by you · {selected.createdAt.slice(0, 16).replace("T", " ")}</p>
                  <div className={st.versionLine}>exact version: v{selected.version} · digest {selected.digest}</div>
                  <p className={st.dStateNote}>Inspect the full lesson below exactly as enrolled learners will receive it after approval.</p>
                  <p className={st.diffTitle}>Lesson 1 — {selected.lesson.title}</p>
                  {selected.lesson.sections.map((section, index) => (
                    <p key={index} className={st.baText}>{section.text}</p>
                  ))}
                  <p className={st.qBy}>Required content item: {selected.item.title} ({selected.item.id})</p>
                  <div className={st.detailActions}>
                    <input
                      id="inspected-gate"
                      type="checkbox"
                      checked={inspected}
                      onChange={event => setInspected(event.target.checked)}
                      aria-describedby="inspected-covered"
                    />
                    <label htmlFor="inspected-gate">I have inspected these exact versions</label>
                    <button
                      type="button"
                      className={st.primaryBtn}
                      disabled={!inspected || busy}
                      aria-describedby="inspected-covered"
                      onClick={() => { void approve(); }}
                    >
                      {busy ? "Approving…" : "Approve exact version"}
                    </button>
                  </div>
                  <p id="inspected-covered" className={st.honestyNote} style={{ marginTop: 16 }}>
                    Approving covers exactly {selected.courseTitle} v{selected.version} (digest {selected.digest.slice(0, 12)}…). Unseen future output is never covered.
                  </p>
                </div>
              )}
            </div>
          )}

          {queue === "approved" && (
            <div className={st.tableScroll}>
              <table className={`${st.dataTable} ${st.wideTable}`}>
                <thead>
                  <tr><th>Course</th><th>Version</th><th>Digest</th><th>Approver</th><th>Approved at</th></tr>
                </thead>
                <tbody>
                  {approvals.approved.map(record => (
                    <tr key={record.versionId}>
                      <td className={st.cellName}>{record.courseTitle}</td>
                      <td className={st.vNum}>v{record.version}</td>
                      <td className={st.cellMono}>{record.digest.slice(0, 12)}</td>
                      <td>{record.approverName}</td>
                      <td className={st.cellTime}>{record.approvedAt.slice(0, 19).replace("T", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
