---
title: Adaptive Learning Platform — Discovery Addendum
status: draft
created: 2026-10-19
updated: 2026-10-20
---

# Discovery Addendum

Detailed learning examples, user-confirmed product decisions and proposed journeys supporting the [product brief](brief-adaptive-learning.md). Proposals are labeled separately from confirmed decisions; this is not an approved implementation specification.

## Audience contexts and intended value

These user-supplied contexts overlap; they are not validated market segments or mutually exclusive personas.

| User context | Need | Intended value |
| --- | --- | --- |
| Studying a course | Find gaps and make steady progress | A visible knowledge map and targeted mini-lessons instead of repeated full-course rereading |
| Preparing for an exam | Decide where limited study time should go | An explainable priority list of weak or untested concepts |
| Non-CS background | Understand software-development ideas without assumed technical background | Plain-language explanations, familiar examples, and explicit prerequisites |
| CS graduate | Apply ideas to technical and professional situations | Deeper application questions and scenario-based activities |
| Instructor | Create, adapt, and oversee learning | Editable mini-courses, student import, and participation/learning evidence |

Software development/engineering is the main domain; other subjects and learner-generated topics/paths remain supported. The user's objective is a suitable course for the chosen theme, not merely readable source material. Broader audience/problem discovery is deferred. Course study has been suggested as a pilot context, but neither it nor exam preparation has been selected.

## Candidate learning loop and evidence guardrails — coach proposals

A candidate loop is gather evidence → explain priorities → targeted learning/practice with deeper explanations → retrieval attempt and learner feedback → scheduled review → reassess and update the learning plan/map. The user has confirmed several component behaviors, but has not approved a detailed orchestration or scheduling algorithm.

Keep perceived retention separate from demonstrated recall/application. Unassessed concepts should remain unknown rather than be labeled weak; assisted success is not independent mastery. Failure alone does not distinguish forgetting from an initial misunderstanding, a slip or an unclear task. Engagement and completion alone are not proof of learning.

For deeper “why?” questions, connect a concept to its purpose, assumptions, trade-offs and limitations; use sources and admit uncertainty. A plausible rationale need not be a verified historical origin, and not every concept has one ultimate root. Learner-controlled depth and progressive disclosure remain suggestions rather than approved interaction rules.

## Goal-first course creation — coach proposal

The user wants a course suited to the learner and the theme they want to study, and asks for suggestions about the experience after uploading materials. The user subsequently sets a firm constraint: use selectable options and only critical questions, without long written purpose descriptions unless necessary. The flow below is revised to respect that constraint; remaining details are recommendations, not approved requirements.

1. **Clarify the destination through choices:** suggest themes from the uploaded material for confirmation or correction, then offer concise goal choices. The user's examples are exam preparation, personal interest, and getting a grasp of related topics. These are examples, not a finalized or necessarily exclusive taxonomy. A goal choice can suggest outcomes for confirmation rather than require the learner to write them.
2. **Ask only questions that change the course:** use short selections for necessary context, with follow-ups conditional on the chosen goal. An exam date may matter for an exam plan; it should not become a required question for everyone. Background and study time are not automatically mandatory fields. Recommend optional customization and an “Other” escape hatch rather than a compulsory writing exercise.
3. **Consider a short starting check:** a few prerequisite or explanation tasks could gather evidence of current understanding. The coach recommends making it optional to reduce friction; the user has not yet approved inclusion or optionality. Skipped or unassessed concepts remain unknown, not weak, and confidence is not treated as demonstrated mastery.
4. **Propose a course plan before generating everything:** show intended outcomes, prerequisite order, short lessons, suitable practice, approximate effort and why this route fits the stated goal. Let the learner correct it. Identify source coverage and missing or conflicting material. The user requires supplementation with clearly identified external sources when uploads do not explain necessary concepts; verification and conflict-handling rules remain open.
5. **Start small and adapt:** deliver an initial lesson with an explanation, a deeper-why opportunity, retrieval/application practice and feedback. Adjust later support using learning evidence and separate self-report, and schedule spaced review. Activity selection should serve the outcome rather than use every format in every lesson.

For instructor-created courses, the coach recommends preserving instructor-defined required outcomes while personalizing explanations, support and pacing. This authority boundary has not been approved.

“Best course” should become testable criteria rather than a guarantee: alignment to the learner's goal, factual/source reliability, suitable prerequisites and effort, and evidence of later recall/application. Completion, engagement and polished AI output alone do not demonstrate learning. No thresholds, scheduling algorithm or comparative effectiveness claims are established.

## Supplementary learning sources — user requirement

If uploaded materials do not explain a necessary concept, the platform should supplement them with clearly identified external sources. The user explicitly establishes this as expected gap-filling behavior, not merely an option or unrestricted replacement of the supplied materials. Source selection, verification and conflicting explanations remain unresolved. In instructor courses, the instructor must approve supplementary sources before students use them. The requirement to supplement is not evidence that retrieved or AI-generated explanations are correct.

## Privacy, instructor approval and delivery — user decisions

- **Personal-upload visibility:** uploaded learner materials are visible only to that learner, not other learners or instructors. This is an access boundary, not a claim that storage services or AI providers never process the data. Processing disclosure, retention and deletion policies remain to be specified.
- **Instructor approval:** the instructor personally approves AI-generated lessons, tests and supplementary sources before students use them. Course access remains limited to enrolled students. Detailed approval records, versioning, regeneration and role distinctions are unresolved.
- **Review reminders:** reminders are required for spaced review. Channel, cadence, learner controls and scheduling/adaptation rules have not been chosen; email, browser notifications and SMS are not implicitly approved.
- **Web-first delivery:** the early product is web first. This does not select a stack or authorize implementation.

## Skill-tree roadmap — user proposal

After the learner's goal is set, the user proposes a roadmap showing current status and future unfinished nodes, similar to a game skill tree. This gives a more concrete direction to the earlier visible knowledge-map idea, but does not settle a layout or progression policy.

**User-confirmed completion rule:** finish the course and pass all related tests. Both conditions are necessary; finishing the content alone is not enough. Passing every test does not necessarily mean answering every question correctly: pass thresholds are not yet defined. Detailed retake policies and how smaller roadmap nodes map to this course-level rule remain open; the targeted recovery workflow is recorded below. Passing these tests provides evidence at that time, not proof of permanent retention.

Coach recommendations, pending confirmation:

- **Explain the path:** connect learning nodes to the chosen goal and show a recommended next step. The material can suggest topics and prerequisites, not establish what the individual learner already knows.
- **Separate progress from learning evidence:** distinguish not started, in progress and lesson completed from evidence of recall or application. Self-reported understanding should remain identifiable as self-report. Course completion follows the confirmed content-plus-tests rule; detailed node states and evidence presentation remain open.
- **Make review visible without erasing progress:** indicate when a studied node is due for review, rather than implying that all prior work is lost. Review due status is a scheduling signal, not proof of forgetting.
- **Avoid inventing game mechanics:** hard prerequisite locks, XP, rewards, cross-course aggregation and mastery thresholds are not approved features. The skill-tree analogy does not require them.

## Failed-test recovery — user decision

The user specifies a targeted recovery sequence:

1. Examine the failed test and the particular questions the learner failed.
2. Identify the knowledge that was not learned well.
3. Offer a focused review of that knowledge.
4. After review, offer a new test tailored to those specific concepts.

This is targeted remediation, not a requirement to restart the entire course. The wording establishes offers of review and reassessment, not mandatory participation or unlimited retries. Pass thresholds, attempt limits, test scope and how passing a targeted retest satisfies the original failed test remain undecided; the existing course-completion requirement is not waived.

**Coach recommendations, pending confirmation:** connect failed responses to likely concept or prerequisite gaps and explain the evidence without claiming certainty about the cause. A wrong answer can reflect a slip or an unclear question as well as a knowledge gap. Where evidence is insufficient, use a clarifying task rather than confidently label the learner. Use new questions assessing the same target knowledge rather than simply repeat answers the learner has just seen; equivalent difficulty and assessment quality still need verification.

## One-user validation — confirmed scope and proposed plan

**Confirmed scope:** the user will be an early-version participant and wants initial validation with one user, potentially themselves. Broader audience/problem and current-alternative discovery is deferred until a later iteration. A self-test is suitable for finding friction and checking a learning workflow, but does not validate broader demand or generalize across the intended CS/non-CS audiences.

Pilot material, topic, learning goal, journey and detailed protocol can be chosen before validation; none is required to finish or approve the product brief. No material needs to be supplied now.

**Proposed protocol, pending agreement:**

1. **Choose a bounded case:** select one material set, a small topic and a concrete learning goal. Recommend the personal-upload journey for a first end-to-end run; the user has not selected it. The TCP example is not automatically the pilot.
2. **Record a baseline:** attempt a few recall/application questions before studying and note relevant prior familiarity. This is a pilot measurement proposal, not a mandatory onboarding test or a change to selection-first setup.
3. **Try the learning journey:** upload, select the goal, inspect the course/roadmap, study and take related tests. Record confusing steps, unnecessary typing, time/effort, source gaps and factual or assessment errors. Check explanations and grading against credible reference material and a stated rubric, not solely the generator's own judgment.
4. **Exercise recovery:** when actual failures occur, check whether failed-question analysis points to relevant knowledge, the offered review addresses it and new tailored questions reassess it. If no failures occur, a separate scripted failure case can test the workflow but must not be reported as a genuine learning gap or measured improvement.
5. **Return after a delay:** agree the delay in advance, check that a review reminder appears through the selected channel, then attempt fresh questions on the same outcomes before viewing the review. Record whether answers are unaided or assisted; feedback and review follow the attempt. No exact interval or production scheduling algorithm is established.
6. **Inspect the evidence:** compare answers against the rubric and baseline, log errors and usability issues, and identify what to change. Agree concrete acceptance criteria before running the pilot; no numerical improvement threshold has been approved. Practice effects, differing question difficulty, prior knowledge and self-evaluation bias limit interpretation. Observed improvement cannot by itself be attributed causally to the product.

**Separate functional checks:** use test accounts to verify that one learner cannot access another learner's uploads, that only enrolled students access instructor courses and that unapproved AI content is unavailable to students. These checks do not require more study participants, and do not substitute for real instructor usability feedback or a security assessment.

No validation has been executed. One participant cannot establish product–market fit, comparative effectiveness, retention across populations or the usefulness of the instructor-authoring journey. Both input routes and the wider assignment obligations remain in scope even if the first pilot exercises only one route.

## Landscape notes and differentiation limits

A light official-source scan was conducted on 2026-10-19. These are vendor documentation claims, not hands-on comparisons, independent learning evidence or customer research; publication dates were not established. Broader investigation is deferred, and feature overlap does not prove either equivalence or differentiation.

- **NotebookLM / help branded “Gemini Notebook”:** source-based maps, quizzes/flashcards and missed-card review. Sources: [mind maps](https://support.google.com/gemininotebook/answer/16212283?hl=en) and [flashcards/quizzes](https://support.google.com/gemininotebook/answer/16958963?hl=en).
- **Khanmigo:** scaffolded learner tutoring and coding feedback. Source: [learner offering](https://www.khanmigo.ai/learners). Teacher-help access was blocked by security verification, so teacher capabilities were not verified in this scan.
- **Quizlet Learn:** study paths based on goals/familiarity and targeted practice. Sources: [Learn](https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn) and [setting up a study path](https://help.quizlet.com/hc/en-us/articles/360048314692-Setting-up-a-study-path).
- **ALEKS:** knowledge-state modeling, ready-to-learn topics, Knowledge Checks and instructor reports. Sources: [overview](https://www.aleks.com/about_aleks) and [student Knowledge Checks overview](https://www.aleks.com/resources/ALEKS_Knowledge_Checks_Overview_for_Students.pdf).

Maps, tutoring, adaptive practice and reassessment should not be claimed as unique. A candidate hypothesis is the usefulness of the combined goal-led, explainable software-learning and retention workflow; its advantage remains untested. Earlier mission/simulation-centered brainstorm concepts are alternatives or possible activities, not the agreed product center. No pricing, buyer or commercial validation is established.

## TCP handshake example

### User-contributed learning need

The user wants to understand why TCP normally establishes a connection through three messages rather than two. A human greeting seems to need only an initial message and a reply; memorizing the TCP message sequence does not explain why that analogy is insufficient. The user tentatively describes the issue as uncertainty about what the two endpoints know, without claiming a complete technical explanation.

### Source-checked explanation

For the basic client-initiated handshake, omitting options and application data:

| Message | Information exchanged |
| --- | --- |
| Client → server: SYN, sequence x | Announces the client's initial sequence number. |
| Server → client: SYN+ACK, sequence y, acknowledgment x+1 | Acknowledges the client's SYN and announces the server's initial sequence number. |
| Client → server: ACK, acknowledgment y+1 | Acknowledges the server's SYN. |

SYN occupies one sequence number, which explains the +1 acknowledgments in this no-data example. Each peer must both announce its own initial sequence number and have it acknowledged. The server combines its acknowledgment and its SYN into the second message, producing three messages rather than four separate ones.

After only the first two messages, the server has not received confirmation that the client received the server's SYN and current initial sequence number. The third message supplies that confirmation. RFC 9293 also identifies avoiding confusion from old duplicate connection initiations as the principal reason for the handshake. An old SYN can reach a server without representing a current connection attempt; replying alone is not sufficient to establish a synchronized connection.

This is not an assertion that three messages create perfect shared certainty, authenticate the peer cryptographically, or guarantee future delivery. Human conversations do not impose the same explicit sequence synchronization and stale-message handling requirements. This example covers the basic exchange, not simultaneous open or every TCP extension.

Sources, consulted 2026-10-19:
- [RFC 9293 §3.4.1 — Initial Sequence Number Selection](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.4.1): sequence synchronization, acknowledgments, and combination of the middle two operations.
- [RFC 9293 §3.5 — Establishing a Connection](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.5): basic handshake and recovery from old duplicate SYNs.

### Product implication — coach proposal

A deeper explanation could connect a rule to its purpose, compare an alternative, expose a failure case, and explain how the mechanism addresses it. For this example, a learner could reason about what remains unconfirmed after two messages, then inspect an old-duplicate scenario. Later retrieval could ask the learner to explain the consequence rather than merely list SYN/SYN+ACK/ACK.

This proposed teaching pattern connects deeper understanding, active recall, and spaced review. Whether it is learner-requested or automatically prompted, how much depth it exposes, and whether TCP belongs in the first validation activity remain undecided. The example does not replace the required software-engineering, AI-agent, and soft/product-skills coverage.