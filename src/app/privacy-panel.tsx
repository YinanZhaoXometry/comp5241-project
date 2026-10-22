"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, command, json } from "./client";
import { errorCode, messages } from "../platform/errors";
import type { DecisionReceipt, Disclosure } from "../contracts/consent";

// U3 processing disclosure and controls. Processor policy is a separate axis
// from learner consent: an ineligible configuration is never solicited, nothing
// is preselected, and withdrawal fails closed without touching saved work.
export function PrivacyPanel() {
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [offering, setOffering] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const keys = useRef(new Map<string, ReturnType<typeof command>>());
  const generation = useRef(0);
  function key(intent: string) {
    let value = keys.current.get(intent);
    if (!value) {
      value = command();
      keys.current.set(intent, value);
    }
    return value;
  }
  const load = useCallback(async () => {
    const stamp = generation.current;
    try {
      const value = await api<Disclosure>("processing");
      if (stamp === generation.current) {
        setDisclosure(value);
        setOffering(false);
        setConfirming(false);
      }
    } catch (error) {
      if (stamp === generation.current) {
        setDisclosure(null);
        setNotice(messages[errorCode(error)]);
      }
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => {
      void load();
    }, 0);
    return () => {
      clearTimeout(initial);
      generation.current += 1;
    };
  }, [load]);
  async function act(work: () => Promise<void>) {
    const stamp = generation.current;
    setBusy(true);
    setNotice("");
    setStatus("");
    try {
      await work();
    } catch (error) {
      if (stamp === generation.current) setNotice(messages[errorCode(error)]);
    } finally {
      if (stamp === generation.current) setBusy(false);
    }
  }
  function decideAction(decision: "granted" | "declined") {
    if (!disclosure) return;
    const intent = key(`decision:${decision}:${disclosure.configuration.version}`);
    void act(async () => {
      const receipt = await api<DecisionReceipt>(
        "processing/decision",
        json({
          ...intent,
          configurationVersion: disclosure.configuration.version,
          decision,
          acknowledgedTerms: true,
        }),
      );
      setStatus(
        decision === "granted"
          ? `Allowed disclosure version ${receipt.disclosureVersion}. Every dispatch still passes session, lineage and policy checks; you can withdraw at any time.`
          : "AI processing declined. Manual topic and plan editing stay available.",
      );
      await load();
    });
  }
  function withdrawAction() {
    void act(async () => {
      const receipt = await api<DecisionReceipt>("processing/withdrawal", json(key("withdrawal")));
      setConfirming(false);
      setStatus(
        `Withdrawn at disclosure version ${receipt.disclosureVersion}. Future processing is stopped; prior disclosed processing cannot be undone.`,
      );
      await load();
    });
  }
  const configuration = disclosure?.configuration;
  const showOffer =
    configuration &&
    configuration.eligibility === "eligible" &&
    (disclosure!.decision === "none" || (disclosure!.decision === "declined" && offering));
  return (
    <section className="panel" aria-label="AI processing disclosure">
      <h2>AI processing</h2>
      <output>{status}</output>
      <div role="alert" className={notice ? "notice" : undefined}>
        {notice}
      </div>
      {!disclosure && <output>Checking processing disclosure…</output>}
      {configuration && (
        <>
          {configuration.syntheticTest && (
            <p className="notice" role="note">
              <strong>Synthetic test configuration — not compliant live AI.</strong> Nothing leaves this
              machine; any allowed effect stays on the local synthetic test path and is discarded.
            </p>
          )}
          {configuration.eligibility === "ineligible" ? (
            <p>
              AI processing is unavailable under the current privacy policy. Manual setup, saving,
              export and deletion remain available.
            </p>
          ) : disclosure!.decision === "granted" ? (
            <>
              <p>
                Allowed · disclosure version {configuration.version}. Only minimized allowed data is in
                scope, and every dispatch still passes session, lineage, budget and policy checks.
              </p>
              {!confirming ? (
                <button className="danger" disabled={busy} onClick={() => setConfirming(true)}>
                  Review withdrawal
                </button>
              ) : (
                <fieldset>
                  <legend>Withdraw AI processing consent?</legend>
                  <p>
                    Future processing stops immediately. Prior disclosed processing cannot be undone;
                    retained copies are tracked for deletion. Your saved work is not deleted.
                  </p>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false);
                    }}
                  >
                    Keep consent
                  </button>
                  <button className="danger" disabled={busy} onClick={() => void withdrawAction()}>
                    Withdraw consent
                  </button>
                </fieldset>
              )}
            </>
          ) : disclosure!.decision === "withdrawn" ? (
            <p>
              Processing is stopped for the future. Prior disclosed processing cannot be undone. You can
              delete materials and their dependent plans from the study workspace at any time.
            </p>
          ) : showOffer ? (
            <>
              <h3>Current disclosure · version {configuration.version}</h3>
              <p>Provider: {configuration.provider}</p>
              <p>Purpose: {configuration.purpose}</p>
              <p>Categories: {configuration.categories.join(", ")}</p>
              <p>Retention and exceptions: {configuration.retentionNotice}</p>
              <p className="fine">
                Nothing is preselected. Re-consent is required whenever the processor, purpose,
                categories or retention terms change. Declining keeps all manual work.
              </p>
              <button className="quiet" disabled={busy} onClick={() => decideAction("declined")}>
                Not now
              </button>
              <button disabled={busy} onClick={() => decideAction("granted")}>
                Allow AI processing
              </button>
            </>
          ) : (
            <p>
              AI processing declined. Manual topic and plan editing stay available; no external call is
              made.
              <button className="quiet" disabled={busy} onClick={() => setOffering(true)}>
                Enable AI later
              </button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
