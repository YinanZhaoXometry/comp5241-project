"use client";

// LIVE enrolled-courses index (epic-5 entry 1 learner path): the signed-in
// learner's enrolled instructor courses, served only through the enrollment
// fence. This is the LEARNER shell — the instructor studio is a separate
// surface and its data never appears here. The roster is invisible; each row
// shows only course title, the approved version the learner studies, and its
// approval time.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import kit from "../kit.module.css";
import css from "./enrolled.module.css";
import { api } from "../client";
import { SignInPanel, useSessionGate } from "../live-session";
import type { EnrolledCourseSummary } from "../../contracts/instructor-courses";

export function EnrolledList() {
  const gate = useSessionGate();
  const { session, ready, notice } = gate;
  const [courses, setCourses] = useState<EnrolledCourseSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const value = await api<{ courses: EnrolledCourseSummary[] }>("enrollments");
      setCourses(value.courses);
    } catch (error) {
      gate.failure(error);
    }
  }, [gate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (session) void load();
      else setCourses([]);
    }, 0);
    return () => clearTimeout(timer);
  }, [session, load]);

  return (
    <div className={css.screen}>
      <div className={css.sectionHead}>
        <div>
          <h1 className={kit.display2}>Enrolled courses</h1>
          <p className={css.subtitle}>
            Courses your instructor enrolled you in. You always study the approved version — drafts and other versions
            are never visible.
          </p>
        </div>
        {session && <button type="button" className={kit.btnQuiet} onClick={() => { void gate.signOut(); }}>Sign out</button>}
      </div>
      <div role="alert" className={notice ? kit.notice : undefined}>{notice}</div>
      {!ready && <output>Checking your session…</output>}
      {ready && !session && (
        <section className={css.signIn}>
          <SignInPanel busy={gate.busy} onSubmit={event => { void gate.signIn(event); }} />
        </section>
      )}
      {ready && session && courses.length === 0 && (
        <div className={css.courseRow}>
          <div>
            <h2 className={css.courseName}>No enrolled courses yet</h2>
            <p className={css.courseMeta}>Your instructor enrolls you from their course studio — there is no public directory or self-enrollment.</p>
          </div>
        </div>
      )}
      {ready && session && courses.length > 0 && (
        <div className={css.courseList}>
          {courses.map(course => (
            <article key={course.courseId} className={css.courseRow}>
              <div>
                <h2 className={css.courseName}>{course.title}</h2>
                <p className={css.courseMeta}>
                  {course.state === "ready"
                    ? `Studying approved version v${course.version} · approved ${course.approvedAt?.slice(0, 10) ?? ""}`
                    : "Pending instructor approval — no approved version yet"}
                </p>
              </div>
              {course.state === "ready" ? (
                <Link href={`/enrolled/${course.courseId}`} prefetch={false} className={kit.btnPrimary}>
                  Study lesson
                </Link>
              ) : (
                <span className={kit.pillWarn}>
                  <span className={kit.dot} />
                  Pending instructor approval
                </span>
              )}
            </article>
          ))}
        </div>
      )}
      <p className={css.fine}>Sample prototype · No live AI · Local synthetic data only.</p>
    </div>
  );
}
