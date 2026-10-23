import Link from "next/link";
import styles from "./progress.module.css";

export function Progress() {
  return (
    <>
      <div className={styles.pageHeading}>
        <p className={styles.overline}>A CLEARER VIEW OF THE JOURNEY</p>
        <h1>See the learning, not just the clicks.</h1>
        <p className={styles.lead}>
          Content covered is one signal. Evidence of understanding is another.
        </p>
      </div>
      <div className={styles.sampleNotice}>
        <strong>Illustrative progress · Sample data</strong>
        <span>
          Fixed examples, not your activity. Practice does not update these
          values or award credit.
        </span>
      </div>
      <section
        aria-label="Sample learning evidence"
        className={styles.evidence}
      >
        <div className={styles.evidenceHeader}>
          <div>
            <p className={styles.overline}>MINI-COURSE 01</p>
            <h2>Unit testing essentials</h2>
          </div>
          <span className={styles.pill}>In progress · Sample</span>
        </div>
        <div className={styles.evidenceColumns}>
          <div>
            <span className={styles.overline}>CONTENT COMPLETION</span>
            <p className={styles.bigMetric}>
              2 <span>/ 4 lessons</span>
            </p>
            <meter
              min={0}
              max={4}
              value={2}
              aria-label="Sample content read: 2 of 4 lessons"
            >
              2 of 4
            </meter>
            <p className={styles.muted}>Illustrative reading progress only.</p>
          </div>
          <div>
            <span className={styles.overline}>REQUIRED TEST</span>
            <h3>Not attempted</h3>
            <p>
              No test evidence recorded in this prototype. Assisted practice is
              not a passing result.
            </p>
          </div>
          <div>
            <span className={styles.overline}>REVIEW & RECOVERY</span>
            <h3>Revisit the boundary</h3>
            <p>
              Illustrative next step: explain why exactly 50 matters, then try
              again without a hint.
            </p>
          </div>
        </div>
      </section>
      <div className={styles.progressGrid}>
        <section className={styles.panel} aria-labelledby="coverage-heading">
          <p className={styles.overline}>SAMPLE CONTENT COVERAGE</p>
          <h2 id="coverage-heading">What has been explored?</h2>
          <ol className={styles.coverage}>
            <li>
              <span>01</span>
              <div>
                <strong>A test is a promise</strong>
                <small>Arrange, act, assert</small>
              </div>
              <span>Read · Sample</span>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Boundary cases</strong>
                <small>Just below, exactly on, just above</small>
              </div>
              <span>Read · Sample</span>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Independent expectations</strong>
                <small>Do not copy the implementation</small>
              </div>
              <span>Not read · Sample</span>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>Tests that earn trust</strong>
                <small>Deterministic, small, meaningful</small>
              </div>
              <span>Not read · Sample</span>
            </li>
          </ol>
        </section>
        <section
          className={styles.reflectionCard}
          aria-labelledby="evidence-heading"
        >
          <span className={styles.overline}>COMPLETION ≠ MASTERY</span>
          <h2 id="evidence-heading">
            Reading is a start. <br />
            Evidence is the next step.
          </h2>
          <p>
            The proposed study loop separates finishing content from passing
            required tests and recovering weak areas. None of those academic
            outcomes is recorded here.
          </p>
          <Link href="/practice" prefetch={false}>
            Revisit assisted practice ↗
          </Link>
          <Link href="/course" prefetch={false}>
            Read the boundary lesson ↗
          </Link>
        </section>
      </div>
      <div className={styles.bottomNav}>
        <p className={styles.muted}>
          No rewards, mastery claims or completion awards. Just a sample of a
          more transparent learning journey.
        </p>
        <Link className={styles.primary} href="/library" prefetch={false}>
          Back to library <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </>
  );
}
