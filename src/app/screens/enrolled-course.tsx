"use client";

// LIVE enrolled-course study view (epic-5 entry 1 learner path): the approved
// lesson exactly as the instructor approved it — numbered lesson, reading
// sections, the one required content item. The server serves only the latest
// approved version behind the enrollment fence; every non-enrolled visitor
// (another learner, a second instructor, an ordinary admin) gets the same
// "This item is unavailable" denial with no existence leak.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import kit from "../kit.module.css";
import css from "./enrolled.module.css";
import { api } from "../client";
import { SignInPanel, useSessionGate } from "../live-session";
import type { EnrolledCourseView } from "../../contracts/instructor-courses";

export function EnrolledCourse({ courseId }: Readonly<{ courseId: string }>) {
  const gate = useSessionGate();
  const { session, ready, notice } = gate;
  const [course, setCourse] = useState<EnrolledCourseView | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const value = await api<EnrolledCourseView>(`enrollments/${courseId}`);
      setCourse(value);
      setDenied(false);
    } catch (error) {
      setCourse(null);
      setDenied(true);
      gate.failure(error);
    }
  }, [courseId, gate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (session) void load();
      else { setCourse(null); setDenied(false); }
    }, 0);
    return () => clearTimeout(timer);
  }, [session, load]);

  return (
    <div className={css.screen}>
      <div className={css.sectionHead}>
        <div>
          <Link href="/enrolled" prefetch={false} className={kit.metaText}>← Enrolled courses</Link>
          <h1 className={kit.display2}>Approved lesson</h1>
          <p className={css.subtitle}>
            You study the exact version your instructor personally approved — nothing else is ever served on this path.
          </p>
        </div>
      </div>
      <div role="alert" className={notice ? kit.notice : undefined}>{notice}</div>
      {!ready && <output>Checking your session…</output>}
      {ready && !session && (
        <section className={css.signIn}>
          <SignInPanel busy={gate.busy} onSubmit={event => { void gate.signIn(event); }} />
        </section>
      )}
      {ready && session && denied && (
        <div className={css.courseRow}>
          <div>
            <h2 className={css.courseName}>This item is unavailable</h2>
            <p className={css.courseMeta}>If you believe you should have access, contact your instructor — there is no public directory.</p>
          </div>
        </div>
      )}
      {ready && session && course?.state === "pending-approval" && (
        <div className={css.courseRow}>
          <div>
            <h2 className={css.courseName}>{course.title}</h2>
            <p className={css.courseMeta}>Pending instructor approval — no approved version is visible yet.</p>
          </div>
        </div>
      )}
      {ready && session && course?.state === "ready" && (
        <article className={css.lessonBody}>
          <header className={css.lessonHeading}>
            <span className={css.lessonNumber}>v{course.version} · approved {course.approvedAt.slice(0, 10)}</span>
            <h2 className={css.lessonTitle}>{course.title}</h2>
          </header>
          <div className={css.lessonHeading}>
            <span className={css.lessonNumber}>Lesson {course.lesson.number}</span>
            <h3 className={css.lessonTitle}>{course.lesson.title}</h3>
          </div>
          {course.lesson.sections.map((section, index) => (
            <p key={index} className={css.sectionText}>{section.text}</p>
          ))}
          <p className={css.requiredNote}>Required: {course.item.title} — manual content approved by your instructor · no AI.</p>
        </article>
      )}
      <p className={css.fine}>Sample prototype · No live AI · Local synthetic data only.</p>
    </div>
  );
}
