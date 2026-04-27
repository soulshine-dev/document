"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addDoc, collection, doc, getDoc } from "firebase/firestore/lite";
import Image from "next/image";
import tickGif from "@/Assets/Done _ Correct _ Tick.gif";
import { db } from "@/lib/firebase";
import { normalizeDeliveryMode, normalizeDocumentType } from "@/lib/record-normalizers";
import { isValidDiplomaId, normalizeDiplomaId } from "@/lib/validation";
import type { DiplomaRecord } from "@/lib/types";

type LoadState = "idle" | "loading" | "done";
type VerificationResult = "found" | "not_found" | "error" | "invalid" | "event";
type EventType = "verification" | "page_view" | "search_submit";

const SUCCESS_TICK_PLAY_MS = 1600;

type IpInfo = {
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
};

async function fetchIpInfo(timeoutMs = 4000): Promise<IpInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://ipapi.co/json/", { signal: controller.signal });
    if (!response.ok) return {};
    const data = (await response.json()) as Record<string, unknown>;
    return {
      ip: typeof data.ip === "string" ? data.ip : undefined,
      city: typeof data.city === "string" ? data.city : undefined,
      region: typeof data.region === "string" ? data.region : undefined,
      country: typeof data.country_name === "string" ? data.country_name : undefined,
      latitude: typeof data.latitude === "number" ? data.latitude : undefined,
      longitude: typeof data.longitude === "number" ? data.longitude : undefined
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

async function logVerificationAttempt(
  diplomaId: string,
  result: VerificationResult,
  eventType: EventType,
  ipInfo?: IpInfo
): Promise<void> {
  try {
    const resolvedInfo = ipInfo ?? (await fetchIpInfo());
    const payload = {
      diplomaId,
      result,
      eventType,
      ip: resolvedInfo.ip ?? "",
      city: resolvedInfo.city ?? "",
      region: resolvedInfo.region ?? "",
      country: resolvedInfo.country ?? "",
      latitude: typeof resolvedInfo.latitude === "number" ? resolvedInfo.latitude : null,
      longitude: typeof resolvedInfo.longitude === "number" ? resolvedInfo.longitude : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      createdAt: new Date().toISOString()
    };
    await addDoc(collection(db, "verification_logs"), payload);
  } catch {
    // Swallow logging errors to avoid blocking verification flow.
  }
}

function normalizeDiploma(id: string, raw: Record<string, unknown>): DiplomaRecord {
  return {
    diplomaId: id,
    documentType: normalizeDocumentType(raw.documentType),
    holderName: String(raw.holderName ?? ""),
    studentNumber: String(raw.studentNumber ?? ""),
    degree: String(raw.degree ?? ""),
    program: String(raw.program ?? ""),
    faculty: String(raw.faculty ?? ""),
    issuedOn: String(raw.issuedOn ?? ""),
    deliveryMode: normalizeDeliveryMode(raw.deliveryMode),
    status: raw.status === "revoked" ? "revoked" : "valid",
    revokedReason: raw.revokedReason ? String(raw.revokedReason) : undefined
  };
}

export default function VerificationClient() {
  const searchParams = useSearchParams();

  const [inputId, setInputId] = useState(searchParams.get("id") ?? "");
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [record, setRecord] = useState<DiplomaRecord | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [successVisualFrozen, setSuccessVisualFrozen] = useState(false);
  const [successVisualKey, setSuccessVisualKey] = useState(0);

  const closeResultModal = useCallback(() => {
    setResultModalOpen(false);
    setState("idle");
    setError(null);
    setNotFound(false);
    setRecord(null);
    setSuccessVisualFrozen(false);

    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const loadDiploma = useCallback(async (diplomaId: string) => {
    const normalizedId = normalizeDiplomaId(diplomaId);
    if (!normalizedId) {
      setRecord(null);
      setNotFound(false);
      setError(null);
      setState("idle");
      setResultModalOpen(false);
      return;
    }
    if (!isValidDiplomaId(normalizedId)) {
      setRecord(null);
      setNotFound(false);
      setError("Invalid document ID format.");
      setState("done");
      setResultModalOpen(true);
      setSuccessVisualFrozen(false);
      void logVerificationAttempt(normalizedId, "invalid", "verification");
      return;
    }

    setState("loading");
    setError(null);
    setNotFound(false);
    setResultModalOpen(true);
    setSuccessVisualFrozen(false);
    setSuccessVisualKey((current) => current + 1);

    try {
      const snapshot = await getDoc(doc(db, "diplomas", normalizedId));

      if (!snapshot.exists()) {
        setRecord(null);
        setNotFound(true);
        setState("done");
        void logVerificationAttempt(normalizedId, "not_found", "verification");
        return;
      }

      const data = snapshot.data() as Record<string, unknown>;
      setRecord(normalizeDiploma(snapshot.id, data));
      setNotFound(false);
      setState("done");
      void logVerificationAttempt(normalizedId, "found", "verification");
    } catch (caught) {
      setRecord(null);
      setNotFound(false);
      setState("done");
      setError(caught instanceof Error ? caught.message : "Unknown error while reading Firestore");
      void logVerificationAttempt(normalizedId, "error", "verification");
    }
  }, []);

  useEffect(() => {
    const queryId = searchParams.get("id") ?? "";
    setInputId(queryId);
    void loadDiploma(queryId);
  }, [searchParams, loadDiploma]);

  useEffect(() => {
    if (!resultModalOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeResultModal();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeResultModal, resultModalOpen]);

  const hasRecord = Boolean(record);

  useEffect(() => {
    if (!(resultModalOpen && hasRecord && state === "done")) {
      return;
    }

    setSuccessVisualFrozen(false);
    const timer = window.setTimeout(() => {
      setSuccessVisualFrozen(true);
    }, SUCCESS_TICK_PLAY_MS);

    return () => window.clearTimeout(timer);
  }, [hasRecord, resultModalOpen, state, successVisualKey]);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedId = normalizeDiplomaId(inputId);
    if (!normalizedId) {
      closeResultModal();
      return;
    }
    if (!isValidDiplomaId(normalizedId)) {
      setNotFound(false);
      setRecord(null);
      setError("Invalid document ID format.");
      setState("done");
      setResultModalOpen(true);
      return;
    }

    if (typeof window !== "undefined") {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("id", normalizedId);
      window.history.replaceState({}, "", `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`);
    }

    void loadDiploma(normalizedId);
  }

  const showDiplomaOnlyFields = !hasRecord || record?.documentType !== "Transcript";
  const shown = record ?? {
    diplomaId: "",
    documentType: "Diploma",
    holderName: "",
    studentNumber: "",
    degree: "",
    program: "",
    faculty: "",
    issuedOn: "",
    deliveryMode: "Traditional Education",
    status: "valid" as const
  };

  function valueOrDash(value: string): string {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "-";
  }

  return (
    <div className="verify-canvas">
      <div className={`stack verify-page page-record${resultModalOpen ? " modal-open" : ""}`}>
        <header className="card stack portal-header">
          <a
            className="portal-website-link"
            href="https://nirmauni.ac.in/"
            target="_blank"
            rel="noreferrer"
          >
            <svg
              className="portal-website-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M10.6 13.4a1 1 0 0 0 1.4 1.4l3.5-3.5a3 3 0 0 0-4.2-4.2L9.7 8.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M13.4 10.6a1 1 0 0 0-1.4-1.4l-3.5 3.5a3 3 0 0 0 4.2 4.2l1.6-1.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Vist Our Website</span>
          </a>
          <Image
            src="https://res.cloudinary.com/dcq0gicq4/image/upload/v1772479100/pageHeaderTitleImage_en_US_x495jz.png"
            alt="Nirma University logo"
            width={560}
            height={120}
            className="portal-logo"
            unoptimized
            priority
          />
          <h1 className="portal-university">Nirma University</h1>
          <h2 className="portal-location">Ahmedabad</h2>
          <h2 className="portal-title">Document Authentication Portal</h2>

          <form className="row" onSubmit={onSearch}>
            <input
              className="id-input"
              placeholder="Enter document ID"
              value={inputId}
              onChange={(event) => setInputId(event.target.value)}
            />
            <button type="submit">Verify</button>
          </form>
        </header>

        {resultModalOpen && (
          <div className="result-modal-shell" role="dialog" aria-modal="true" aria-labelledby="verification-result-title">
            <button
              type="button"
              className="result-modal-backdrop"
              aria-label="Close verification result"
              onClick={closeResultModal}
            />
            <section className="card stack result-modal">
              <div className="result-modal-hero">
                {state === "loading" && (
                  <>
                    <span className="result-modal-spinner" aria-hidden="true" />
                    <p className="result-modal-hero-label">Verifying document...</p>
                  </>
                )}

                {hasRecord && state === "done" && (
                  <>
                    {successVisualFrozen ? (
                      <span className="result-modal-success-mark" aria-hidden="true">
                        <span className="result-modal-success-check" />
                      </span>
                    ) : (
                      <Image
                        key={successVisualKey}
                        src={tickGif}
                        alt="Verification completed"
                        width={92}
                        height={92}
                        className="result-modal-tick-gif"
                        unoptimized
                        priority
                      />
                    )}
                    <p className="result-modal-hero-label">Verification complete</p>
                  </>
                )}
              </div>

              <div className="result-modal-header">
                <h2 id="verification-result-title">Verification Result</h2>
                <button type="button" className="result-modal-close" onClick={closeResultModal}>
                  Close
                </button>
              </div>

              {state === "loading" && <section className="card">Loading diploma record...</section>}

              {error && (
                <section className="card">
                  <p className="invalid">System error</p>
                  <p>{error}</p>
                </section>
              )}

              {notFound && (
                <section className="card">
                  <p className="invalid">Not Found</p>
                  <p>No diploma record exists for this ID.</p>
                </section>
              )}

              {hasRecord && (
                <section className="card stack record-card">
                  <h2 className={shown.status === "valid" ? "valid" : "invalid"}>
                    {shown.status === "valid" ? "Document Information" : "Revoked Diploma"}
                  </h2>

                  <div className="record-table">
                    <div className="record-row">
                      <span className="record-name">Document Type:</span>
                      <span className="record-separator" />
                      <span className="record-data">{shown.documentType}</span>
                    </div>
                    <div className="record-row">
                      <span className="record-name">Holder Name:</span>
                      <span className="record-separator" />
                      <span className="record-data">{valueOrDash(shown.holderName)}</span>
                    </div>
                    <div className="record-row">
                      <span className="record-name">Student Number:</span>
                      <span className="record-separator" />
                      <span className="record-data">{valueOrDash(shown.studentNumber)}</span>
                    </div>
                    {showDiplomaOnlyFields && (
                      <div className="record-row">
                        <span className="record-name">Degree:</span>
                        <span className="record-separator" />
                        <span className="record-data">{valueOrDash(shown.degree)}</span>
                      </div>
                    )}
                    <div className="record-row">
                      <span className="record-name">Program:</span>
                      <span className="record-separator" />
                      <span className="record-data">{valueOrDash(shown.program)}</span>
                    </div>
                    <div className="record-row">
                      <span className="record-name">Faculty:</span>
                      <span className="record-separator" />
                      <span className="record-data">{valueOrDash(shown.faculty)}</span>
                    </div>
                    <div className="record-row">
                      <span className="record-name">Issued On:</span>
                      <span className="record-separator" />
                      <span className="record-data">{valueOrDash(shown.issuedOn)}</span>
                    </div>
                    <div className="record-row">
                      <span className="record-name">Delivery Mode:</span>
                      <span className="record-separator" />
                      <span className="record-data">{shown.deliveryMode}</span>
                    </div>
                  </div>

                  {shown.status === "revoked" && shown.revokedReason && (
                    <p>
                      <strong>Revocation Reason:</strong> {shown.revokedReason}
                    </p>
                  )}
                </section>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}








