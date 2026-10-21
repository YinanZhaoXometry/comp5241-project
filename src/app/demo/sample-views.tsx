import Link from 'next/link';
import styles from './demo.module.css';

export function Overview() {
  return (
    <>
      <div className={styles.pageHeading}>
        <p className={styles.overline}>A FIELD GUIDE TO YOUR NEXT IDEA</p>
        <h1>Small steps. Deeper understanding.</h1>
        <p className={styles.lead}>
          A sample path from “I have read it” to “I can explain why it works.”
        </p>
      </div>
      <section className={styles.hero} aria-labelledby="continue-heading">
        <div>
          <span className={styles.heroLabel}>
            YOUR CURRENT MINI-COURSE · SAMPLE
          </span>
          <h2 id="continue-heading">
            Make your code
            <br />
            keep its promises.
          </h2>
          <p>
            Unit testing, without the guesswork. Start with one small function,
            a clear expectation, and a test you can trust.
          </p>
          <Link
            className={styles.limeButton}
            href="/demo/lesson"
            prefetch={false}
          >
            Continue sample lesson <span aria-hidden="true">↗</span>
          </Link>
          <p className={styles.heroMeta}>
            Lesson 02 of 04 · Boundary cases · About 12 minutes
          </p>
        </div>
        <figure className={styles.loopDiagram}>
          <span className={styles.diagramTitle}>THE LEARNING LOOP</span>
          <div>
            <span>01</span>
            <strong>Understand</strong>
            <small>Find the promise.</small>
          </div>
          <div>
            <span>02</span>
            <strong>Try</strong>
            <small>Make it observable.</small>
          </div>
          <div>
            <span>03</span>
            <strong>Reflect</strong>
            <small>Explain the gap.</small>
          </div>
          <figcaption>
            One idea. A little evidence. A better question.
          </figcaption>
        </figure>
      </section>
      <section className={styles.focusStrip} aria-label="Sample study session">
        <div>
          <span className={styles.overline}>TODAY’S FOCUS</span>
          <strong>What happens right at the edge?</strong>
        </div>
        <p>
          Explore a boundary case, then choose the test that would catch a
          subtle bug.
        </p>
        <span className={styles.pill}>Read → Try → Reflect</span>
      </section>
      <section aria-labelledby="path-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.overline}>THE BIGGER PICTURE</p>
            <h2 id="path-heading">A path made of mini-courses</h2>
          </div>
          <span className={styles.muted}>
            Illustrative roadmap · Not a lesson list
          </span>
        </div>
        <ol className={styles.roadmap}>
          <li className={styles.currentCourse}>
            <span className={styles.courseNumber}>01 / EXPLORE NOW</span>
            <h3>Unit testing essentials</h3>
            <p>Turn a requirement into a small, repeatable check.</p>
            <Link href="/demo/lesson" prefetch={false}>
              Explore this sample ↗
            </Link>
          </li>
          <li>
            <span className={styles.courseNumber}>
              02 / ILLUSTRATIVE NEXT STEP
            </span>
            <h3>Working with AI agents</h3>
            <p>Describe the task. Question the output. Verify the result.</p>
            <span className={styles.muted}>
              Proposed mini-course · Not built
            </span>
          </li>
          <li>
            <span className={styles.courseNumber}>
              03 / ILLUSTRATIVE NEXT STEP
            </span>
            <h3>Build the right thing</h3>
            <p>Ask better product questions before writing more code.</p>
            <span className={styles.muted}>
              Proposed mini-course · Not built
            </span>
          </li>
        </ol>
      </section>
      <section className={styles.fluency} aria-labelledby="fluency-heading">
        <div>
          <span className={styles.overline}>RESPONSIBLE BY DESIGN</span>
          <h2 id="fluency-heading">A human stays in the loop.</h2>
          <p>
            How Anthropic’s AI Fluency 4D framework informs the proposed
            platform:
          </p>
        </div>
        <dl className={styles.fourDs}>
          <div>
            <dt>Delegation</dt>
            <dd>Choose what to hand to an agent.</dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>State the promise and constraints.</dd>
          </div>
          <div>
            <dt>Discernment</dt>
            <dd>Question the suggested test.</dd>
          </div>
          <div>
            <dt>Diligence</dt>
            <dd>Verify and own the result.</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

export function Lesson() {
  return (
    <>
      <div className={styles.pageHeading}>
        <p className={styles.overline}>
          UNIT TESTING ESSENTIALS · LESSON 02 / 04 · SAMPLE CONTENT
        </p>
        <h1>A small test. A clear promise.</h1>
        <p className={styles.lead}>
          The most revealing inputs are often the ones sitting right on the
          edge.
        </p>
      </div>
      <div className={styles.lessonGrid}>
        <article className={styles.lessonBody}>
          <section aria-labelledby="promise-heading">
            <span className={styles.pill}>01 · UNDERSTAND</span>
            <h2 id="promise-heading">Start with the rule, not the code.</h2>
            <p>
              A small shop offers free delivery when an order total is{' '}
              <strong>at least 50</strong>. Our function answers one question:
              does this total qualify?
            </p>
            <blockquote className={styles.promise}>
              “At least 50” includes exactly 50.
              <span>That is the promise your test needs to protect.</span>
            </blockquote>
            <pre
              className={styles.code}
              aria-label="JavaScript example, not executed"
            >
              <code>
                <span className={styles.codeComment}>
                  {'// Example only · no code is run here'}
                </span>
                {
                  '\nfunction qualifiesForFreeDelivery(total) {\n  return total >= 50;\n}'
                }
              </code>
            </pre>
          </section>
          <section aria-labelledby="boundary-heading">
            <h2 id="boundary-heading">Look on both sides of the boundary.</h2>
            <p>
              A test at 80 checks an ordinary qualifying order. But it cannot
              tell <code>&gt; 50</code> from <code>&gt;= 50</code>. The value 50
              can.
            </p>
            <figure className={styles.boundaryFigure}>
              <div className={styles.boundaryLine}>
                <div>
                  <span>49</span>
                  <strong>Does not qualify</strong>
                  <small>Just below</small>
                </div>
                <div className={styles.boundaryPoint}>
                  <span>50</span>
                  <strong>Qualifies</strong>
                  <small>Exactly on the boundary</small>
                </div>
                <div>
                  <span>51</span>
                  <strong>Qualifies</strong>
                  <small>Just above</small>
                </div>
              </div>
              <figcaption>
                For whole-number totals, 49 · 50 · 51 gives a compact set around
                the threshold. Decimal totals need nearby decimal cases too.
              </figcaption>
            </figure>
          </section>
          <div className={styles.lessonAction}>
            <p>Now try spotting the most useful test.</p>
            <Link
              className={styles.primary}
              href="/demo/practice"
              prefetch={false}
            >
              Try the practice <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </article>
        <aside className={styles.notebook} aria-labelledby="notebook-heading">
          <span className={styles.overline}>KEEP IN YOUR FIELDNOTES</span>
          <h2 id="notebook-heading">
            Three moves.
            <br />
            One clear test.
          </h2>
          <ol className={styles.aaa}>
            <li>
              <span>A</span>
              <div>
                <h3>Arrange</h3>
                <p>Choose a total of 50.</p>
                <code>const total = 50;</code>
              </div>
            </li>
            <li>
              <span>A</span>
              <div>
                <h3>Act</h3>
                <p>Ask whether it qualifies.</p>
                <code>qualifiesForFreeDelivery(total)</code>
              </div>
            </li>
            <li>
              <span>A</span>
              <div>
                <h3>Assert</h3>
                <p>Expect the answer to be true.</p>
                <code>expected: true</code>
              </div>
            </li>
          </ol>
          <div className={styles.notebookTip}>
            <strong>The useful question</strong>
            <p>
              If someone changed <code>&gt;=</code> to <code>&gt;</code>, would
              my test notice?
            </p>
          </div>
          <p className={styles.muted}>
            Discernment + Diligence: even if an agent suggests a test, you
            remain responsible for checking the requirement and the result.
          </p>
        </aside>
      </div>
    </>
  );
}

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
          <Link href="/demo/practice" prefetch={false}>
            Revisit assisted practice ↗
          </Link>
          <Link href="/demo/lesson" prefetch={false}>
            Read the boundary lesson ↗
          </Link>
        </section>
      </div>
      <div className={styles.bottomNav}>
        <p className={styles.muted}>
          No rewards, mastery claims or completion awards. Just a sample of a
          more transparent learning journey.
        </p>
        <Link className={styles.primary} href="/demo" prefetch={false}>
          Back to overview <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </>
  );
}
