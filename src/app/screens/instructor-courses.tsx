"use client";

// LIVE instructor Courses screen (epic-5 entry 1 port of the static
// reference): the signed-in instructor's real course list with manual
// authoring and the single-row enrollment preview/confirm action. Data comes
// from /api/v1/instructor/courses… behind the server's role/ownership fences;
// every denial surfaces the platform's stable messages. Command envelopes are
// cached in STATE per intent (the course-stage handler convention): a lost
// response replays the SAME command; an explicit retry mints a fresh one.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import kit from "../kit.module.css";
import st from "./instructor.module.css";
import { api, command, json } from "../client";
import { SignInPanel, useSessionGate } from "../live-session";
import { DialogFrame } from "./dialog-frame";
import type { Command } from "../../contracts/setup";
import type {
  CreateCourse,
  EnrollmentPreviewResult,
  EnrollmentRecord,
  InstructorCourseDetail,
  InstructorCourseSummary,
  InstructorReceipt,
  SaveDraft,
} from "../../contracts/instructor-courses";

function StatusPill({ kind, label }: { kind: "success" | "warn" | "muted"; label: string }) {
  const variant = kind === "success" ? kit.pillSuccess : kind === "warn" ? kit.pillWarn : kit.pillMuted;
  return (
    <span className={variant}>
      <span className={kit.dot} />
      {label}
    </span>
  );
}

export function InstructorCourses() {
  const gate = useSessionGate();
  const { session, ready, notice, setNotice } = gate;
  const [courses, setCourses] = useState<InstructorCourseSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InstructorCourseDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [envelopes, setEnvelopes] = useState(new Map<string, ReturnType<typeof command>>());
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonText, setLessonText] = useState("");
  const [rosterName, setRosterName] = useState("");
  const [rosterEmail, setRosterEmail] = useState("");
  const [preview, setPreview] = useState<EnrollmentPreviewResult | null>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);

  const commandFor = useCallback((intent: string): Command => {
    const existing = envelopes.get(intent);
    if (existing) return existing;
    const fresh = command();
    setEnvelopes(previous => new Map(previous).set(intent, fresh));
    return fresh;
  }, [envelopes]);

  const loadCourses = useCallback(async () => {
    try {
      const value = await api<{ courses: InstructorCourseSummary[] }>("instructor/courses");
      setCourses(value.courses);
    } catch (error) { gate.failure(error); }
  }, [gate]);

  const loadDetail = useCallback(async (courseId: string) => {
    try {
      const value = await api<InstructorCourseDetail>(`instructor/courses/${courseId}`);
      setDetail(value);
    } catch (error) {
      setDetail(null);
      setOpenId(null);
      gate.failure(error);
    }
  }, [gate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (session) void loadCourses();
      else { setCourses([]); setOpenId(null); setDetail(null); }
    }, 0);
    return () => clearTimeout(timer);
  }, [session, loadCourses]);

  useEffect(() => {
    const timer = setTimeout(() => { if (openId) void loadDetail(openId); }, 0);
    return () => clearTimeout(timer);
  }, [openId, loadDetail]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try { await work(); }
    catch (error) { gate.failure(error); }
    finally { setBusy(false); }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = createTitle.trim();
    if (!title) return;
    void run(async () => {
      const intent = `create:${session?.user.id}:${title}`;
      await api<InstructorReceipt>("instructor/courses", json({ ...commandFor(intent), title } satisfies CreateCourse));
      setCreating(false);
      setCreateTitle("");
      await loadCourses();
      setNotice("Course created.");
    });
  }

  function saveDraft() {
    if (!detail) return;
    const title = lessonTitle.trim();
    const text = lessonText.trim();
    if (!title || !text || busy) return;
    void run(async () => {
      // The envelope (and its expectedRevision) is pinned per TARGET version
      // count: a lost response replays the same command; the next version
      // mints its own.
      const intent = `draft:${detail.courseId}:${detail.versions.length}`;
      await api<InstructorReceipt>(`instructor/courses/${detail.courseId}/draft`, json({
        ...commandFor(intent),
        expectedRevision: detail.versions.length,
        courseId: detail.courseId,
        lesson: { title, sections: [{ text }] },
      } satisfies SaveDraft));
      setLessonTitle("");
      setLessonText("");
      await loadDetail(detail.courseId);
      await loadCourses();
      setNotice("Draft version saved.");
    });
  }

  function previewRosterRow() {
    if (!detail || busy) return;
    setPreview(null);
    void run(async () => {
      const name = rosterName.trim();
      const email = rosterEmail.trim();
      if (!name || !email) { setNotice("Enter both a name and an email to preview."); return; }
      setPreview(await api<EnrollmentPreviewResult>(`instructor/courses/${detail.courseId}/enrollment-preview`, json({ schemaVersion: 1, name, email })));
    });
  }

  function confirmRosterRow() {
    if (!detail || busy) return;
    void run(async () => {
      const intent = `enroll:${detail.courseId}:${rosterEmail.trim().toLowerCase()}`;
      const receipt = await api<InstructorReceipt>(`instructor/courses/${detail.courseId}/enrollment`, json({ ...commandFor(intent), courseId: detail.courseId, name: rosterName.trim(), email: rosterEmail.trim() }));
      setPreview(null);
      setRosterName("");
      setRosterEmail("");
      await loadDetail(detail.courseId);
      await loadCourses();
      setNotice(receipt.state === "already-enrolled" ? "That learner is already enrolled — no duplicate created." : "Learner enrolled.");
    });
  }

  const pendingDraft = detail ? detail.versions.some(version => !version.approved) : false;

  return (
    <div className={`${st.screen} ${st.narrow}`}>
      <div className={st.pageHead}>
        <div>
          <h1 className={st.title} tabIndex={-1}>Courses</h1>
          <p className={st.sub}>
            Courses you teach, with the version each enrolled student currently sees. Nothing publishes without an
            exact-version approval.
          </p>
        </div>
        <div className={st.pageActions}>
          {session && <button type="button" className={st.quietBtn} onClick={() => { void gate.signOut(); }}>Sign out</button>}
          <button ref={createBtnRef} type="button" className={st.primaryBtn} disabled={!session} onClick={() => { setCreating(true); setCreateTitle(""); }}>Create course</button>
        </div>
      </div>

      <div role="alert" className={notice ? kit.notice : undefined}>{notice}</div>
      {!ready && <output>Checking your session…</output>}
      {ready && !session && (
        <section className={st.panel}>
          <SignInPanel busy={gate.busy} onSubmit={event => { void gate.signIn(event); }} note="Use the operator-provisioned synthetic instructor account." />
        </section>
      )}
      {ready && session && courses.length === 0 && (
        <div className={st.emptyBox}>
          <h2 className={st.emptyTitle}>No courses yet</h2>
          <p className={st.emptyText}>Create your first course, draft one manual mini-course version, then approve that exact version in Approvals.</p>
        </div>
      )}
      {ready && session && courses.length > 0 && (
        <div className={st.courseList}>
          {courses.map(course => {
            const expanded = openId === course.courseId;
            const status = course.approvedVersion === null
              ? { kind: "muted" as const, label: course.pendingDraft ? "Draft" : "Empty" }
              : course.pendingDraft
                ? { kind: "warn" as const, label: "Awaiting approval" }
                : { kind: "success" as const, label: "Published" };
            return (
              <article key={course.courseId} className={st.courseCard}>
                <div className={st.courseTop}>
                  <div>
                    <h2 className={st.courseTitle}>{course.title}</h2>
                    <p className={st.courseMetaLine}>{course.enrolledCount} enrolled · Manual authoring · No AI</p>
                  </div>
                  <div className={st.courseBadges}>
                    <span className={st.verChip}>{course.currentVersion === null ? "v0" : `v${course.currentVersion}`}</span>
                    <StatusPill kind={status.kind} label={status.label} />
                  </div>
                </div>
                <div className={st.courseActions}>
                  <button
                    type="button"
                    className={st.quietBtn}
                    aria-expanded={expanded}
                    aria-controls={`detail-${course.courseId}`}
                    onClick={() => { setOpenId(expanded ? null : course.courseId); setPreview(null); }}
                  >
                    {expanded ? "Close" : "Open course"}
                  </button>
                </div>
                {expanded && detail && detail.courseId === course.courseId && (
                  <div className={st.versions} id={`detail-${course.courseId}`}>
                    <p className={st.verTitle}>Versions — newest first</p>
                    <div className={st.tableScroll}>
                      <table className={`${st.dataTable} ${st.verTable}`}>
                        <thead>
                          <tr><th>Version</th><th>Created</th><th>Digest</th><th>State</th><th>Approver · time</th></tr>
                        </thead>
                        <tbody>
                          {detail.versions.length === 0 && <tr><td colSpan={5} className={st.noData}>No versions yet — draft the first lesson below.</td></tr>}
                          {detail.versions.map(version => (
                            <tr key={version.versionId}>
                              <td className={st.vNum}>v{version.version}</td>
                              <td className={st.vDate}>{version.createdAt.slice(0, 10)}</td>
                              <td className={st.cellMono}>{version.digest.slice(0, 12)}</td>
                              <td><StatusPill kind={version.approved ? "success" : "warn"} label={version.approved ? "Approved" : "Pending approval"} /></td>
                              <td className={st.cellTime}>{version.approval ? `${version.approval.approverName} · ${version.approval.approvedAt.slice(0, 16).replace("T", " ")}` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {!pendingDraft && (
                      <form className={st.importGrid} onSubmit={event => { event.preventDefault(); saveDraft(); }}>
                        <p className={st.verTitle} style={{ marginTop: 16 }}>Draft the next manual version</p>
                        <div className={st.dlgField}>
                          <label htmlFor="lesson-title">Lesson title</label>
                          <input id="lesson-title" className={kit.input} value={lessonTitle} onChange={event => setLessonTitle(event.target.value)} maxLength={200} required />
                        </div>
                        <div className={st.dlgField}>
                          <label htmlFor="lesson-text">Lesson reading text (one required content item)</label>
                          <textarea id="lesson-text" className={kit.textarea} value={lessonText} onChange={event => setLessonText(event.target.value)} maxLength={2000} rows={4} required />
                        </div>
                        <div className={st.importActions}>
                          <button type="submit" className={st.secondaryBtn} disabled={busy}>{busy ? "Saving…" : "Save draft version"}</button>
                        </div>
                        <p className={st.honestyNote}>Manual authoring only — no AI anywhere in this tracer. The draft is invisible to learners until you approve the exact version on the Approvals screen.</p>
                      </form>
                    )}
                    {pendingDraft && <p className={st.honestyNote} style={{ marginTop: 16 }}>A draft version is pending approval — inspect and approve it on the Approvals screen before drafting the next version.</p>}

                    <p className={st.verTitle} style={{ marginTop: 24 }}>Enroll a verified learner — single-row preview/confirm</p>
                    <p className={st.previewNote}>Enter one name and email. The row is previewed against operator-provisioned accounts before anything is committed; association happens server-side only.</p>
                    <div className={st.importGrid}>
                      <div className={st.dlgField}>
                        <label htmlFor="roster-name">Name</label>
                        <input id="roster-name" className={kit.input} value={rosterName} onChange={event => { setRosterName(event.target.value); setPreview(null); }} maxLength={120} required />
                      </div>
                      <div className={st.dlgField}>
                        <label htmlFor="roster-email">Email</label>
                        <input id="roster-email" className={kit.input} type="email" value={rosterEmail} onChange={event => { setRosterEmail(event.target.value); setPreview(null); }} maxLength={254} required />
                      </div>
                      <div className={st.importActions}>
                        <button type="button" className={st.secondaryBtn} disabled={busy} onClick={previewRosterRow}>Preview row</button>
                        <button type="button" className={st.primaryBtn} disabled={busy || !preview || !preview.matched || preview.alreadyEnrolled} onClick={confirmRosterRow}>
                          {preview?.alreadyEnrolled ? "Already enrolled" : "Confirm enrollment"}
                        </button>
                      </div>
                      {preview && (
                        <output className={preview.matched ? st.statusGood : st.dlgMsg}>
                          {preview.matched
                            ? preview.alreadyEnrolled
                              ? `Already enrolled: ${preview.accountName} (${preview.email}). Confirming again creates no duplicate.`
                              : `Matched verified account: ${preview.accountName} (${preview.email}). Confirm to enroll.`
                            : `No verified operator-provisioned account matches ${preview.email}. Nothing was committed.`}
                        </output>
                      )}
                      <div className={st.tableScroll}>
                        <table className={`${st.dataTable} ${st.middleTable}`}>
                          <thead><tr><th>Name</th><th>Email</th><th>Enrolled at</th></tr></thead>
                          <tbody>
                            {detail.enrollments.length === 0 && <tr><td colSpan={3} className={st.noData}>No learners enrolled yet.</td></tr>}
                            {detail.enrollments.map((enrollment: EnrollmentRecord) => (
                              <tr key={enrollment.enrollmentId}>
                                <td className={st.cellName}>{enrollment.name}</td>
                                <td className={st.cellEmail}>{enrollment.email}</td>
                                <td className={st.cellTime}>{enrollment.enrolledAt.slice(0, 16).replace("T", " ")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className={st.rosterLegend}>The roster is never shown to learners. CSV import, removal and revocation come in later entries.</p>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {creating && (
        <DialogFrame labelId="dlg-create-title" onClose={() => setCreating(false)} returnFocusTo={createBtnRef}>
          <form onSubmit={create}>
            <div className={st.dlgHead}>
              <h2 id="dlg-create-title" className={st.dlgTitle}>Create a course</h2>
            </div>
            <div className={st.dlgBody}>
              <div className={st.dlgField}>
                <label htmlFor="create-title">Course title</label>
                <input id="create-title" className={kit.input} value={createTitle} onChange={event => setCreateTitle(event.target.value)} maxLength={160} required />
              </div>
              <p className={st.honestyNote}>Manual authoring only. Generate-from-topic and AI customization arrive in a later, separately gated entry — this tracer drafts one lesson by hand.</p>
            </div>
            <div className={st.dlgFoot}>
              <button type="button" className={st.quietBtn} onClick={() => setCreating(false)}>Cancel</button>
              <button type="submit" className={st.secondaryBtn} disabled={busy || !createTitle.trim()}>{busy ? "Creating…" : "Create course"}</button>
            </div>
          </form>
        </DialogFrame>
      )}
    </div>
  );
}
