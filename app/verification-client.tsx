"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore/lite";
import Image from "next/image";
import { db } from "@/lib/firebase";
import { normalizeDeliveryMode, normalizeDocumentType } from "@/lib/record-normalizers";
import { isValidDiplomaId, normalizeDiplomaId } from "@/lib/validation";
import type { DiplomaRecord } from "@/lib/types";

type LoadState = "idle" | "loading" | "done";

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
  const router = useRouter();

  const [inputId, setInputId] = useState(searchParams.get("id") ?? "");
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [record, setRecord] = useState<DiplomaRecord | null>(null);

  const loadDiploma = useCallback(async (diplomaId: string) => {
    const normalizedId = normalizeDiplomaId(diplomaId);
    if (!normalizedId) {
      setRecord(null);
      setNotFound(false);
      setError(null);
      setState("idle");
      return;
    }
    if (!isValidDiplomaId(normalizedId)) {
      setRecord(null);
      setNotFound(false);
      setError("Invalid document ID format.");
      setState("done");
      return;
    }

    setState("loading");
    setError(null);
    setNotFound(false);

    try {
      const snapshot = await getDoc(doc(db, "diplomas", normalizedId));

      if (!snapshot.exists()) {
        setRecord(null);
        setNotFound(true);
        setState("done");
        return;
      }

      const data = snapshot.data() as Record<string, unknown>;
      setRecord(normalizeDiploma(snapshot.id, data));
      setNotFound(false);
      setState("done");
    } catch (caught) {
      setRecord(null);
      setNotFound(false);
      setState("done");
      setError(caught instanceof Error ? caught.message : "Unknown error while reading Firestore");
    }
  }, []);

  useEffect(() => {
    const queryId = searchParams.get("id") ?? "";
    setInputId(queryId);
    void loadDiploma(queryId);
  }, [searchParams, loadDiploma]);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedId = normalizeDiplomaId(inputId);
    if (!normalizedId) {
      router.push("/");
      return;
    }
    if (!isValidDiplomaId(normalizedId)) {
      setError("Invalid document ID format.");
      return;
    }

    router.push(`/?id=${encodeURIComponent(normalizedId)}`);
  }

  const hasRecord = Boolean(record);
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
    return trimmed.length > 0 ? trimmed : "—";
  }

  return (
    <div className="verify-canvas">
      <div className="stack verify-page page-record">
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

        <section className="card stack record-card">
        <h2 className={shown.status === "valid" ? "valid" : "invalid"}>
          {shown.status === "valid" ? "Document Information" : "Revoked Diploma"}
        </h2>

        <div className="record-table">
          <div className="record-row">
            <span className="record-name">Document Type:</span>
            <span className="record-separator" />
            <span className={`record-data ${!hasRecord ? "record-placeholder" : ""}`}>
              {hasRecord ? shown.documentType : "—"}
            </span>
          </div>
          <div className="record-row">
            <span className="record-name">Holder Name:</span>
            <span className="record-separator" />
            <span className={`record-data ${!hasRecord ? "record-placeholder" : ""}`}>
              {valueOrDash(shown.holderName)}
            </span>
          </div>
          <div className="record-row">
            <span className="record-name">Student Number:</span>
            <span className="record-separator" />
            <span className={`record-data ${!hasRecord ? "record-placeholder" : ""}`}>
              {valueOrDash(shown.studentNumber)}
            </span>
          </div>
          {showDiplomaOnlyFields && (
            <div className="record-row">
              <span className="record-name">Degree:</span>
              <span className="record-separator" />
              <span className={`record-data ${!hasRecord ? "record-placeholder" : ""}`}>
                {valueOrDash(shown.degree)}
              </span>
            </div>
          )}
          <div className="record-row">
            <span className="record-name">Program:</span>
            <span className="record-separator" />
            <span className={`record-data ${!hasRecord ? "record-placeholder" : ""}`}>
              {valueOrDash(shown.program)}
            </span>
          </div>
          <div className="record-row">
            <span className="record-name">Faculty:</span>
            <span className="record-separator" />
            <span className={`record-data ${!hasRecord ? "record-placeholder" : ""}`}>
              {valueOrDash(shown.faculty)}
            </span>
          </div>
          <div className="record-row">
            <span className="record-name">Issued On:</span>
            <span className="record-separator" />
            <span className={`record-data ${!hasRecord ? "record-placeholder" : ""}`}>
              {valueOrDash(shown.issuedOn)}
            </span>
          </div>
          <div className="record-row">
            <span className="record-name">Delivery Mode:</span>
            <span className="record-separator" />
            <span className={`record-data ${!hasRecord ? "record-placeholder" : ""}`}>
              {hasRecord ? shown.deliveryMode : "—"}
            </span>
          </div>
        </div>

        {shown.status === "revoked" && shown.revokedReason && (
          <p>
            <strong>Revocation Reason:</strong> {shown.revokedReason}
          </p>
        )}
        </section>
      </div>
    </div>
  );
}
