"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore/lite";
import QRCode from "qrcode";
import Image from "next/image";
import { auth, db } from "@/lib/firebase";
import { normalizeDeliveryMode, normalizeDocumentType } from "@/lib/record-normalizers";
import { isIsoDate, isValidDiplomaId, normalizeDiplomaId, sanitizeText } from "@/lib/validation";
import type { DeliveryMode, DiplomaRecord, DiplomaStatus, DocumentType } from "@/lib/types";

const FIRESTORE_TIMEOUT_MS = 30000;

type AdminForm = {
  diplomaId: string;
  documentType: DocumentType;
  holderName: string;
  studentNumber: string;
  degree: string;
  program: string;
  faculty: string;
  issuedOn: string;
  deliveryMode: DeliveryMode;
  status: DiplomaStatus;
  revokedReason: string;
};

function emptyForm(): AdminForm {
  return {
    diplomaId: "",
    documentType: "Diploma",
    holderName: "",
    studentNumber: "",
    degree: "",
    program: "",
    faculty: "",
    issuedOn: "",
    deliveryMode: "Traditional Education",
    status: "valid",
    revokedReason: ""
  };
}

function fromRecord(record: DiplomaRecord): AdminForm {
  return {
    diplomaId: record.diplomaId,
    documentType: record.documentType,
    holderName: record.holderName,
    studentNumber: record.studentNumber,
    degree: record.degree,
    program: record.program,
    faculty: record.faculty,
    issuedOn: record.issuedOn,
    deliveryMode: record.deliveryMode,
    status: record.status,
    revokedReason: record.revokedReason ?? ""
  };
}

function normalizeRecord(id: string, raw: Record<string, unknown>): DiplomaRecord {
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

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    operation
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function runWithRetry<T>(operation: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (caught) {
      lastError = caught;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }
  throw lastError;
}

function explainFirebaseError(caught: unknown): string {
  if (!(caught instanceof Error)) {
    return "Operation failed due to an unknown error.";
  }

  const code = (caught as Error & { code?: string }).code;
  if (!code) {
    return caught.message;
  }

  switch (code) {
    case "permission-denied":
      return "Permission denied. Check Firestore rules and ensure this account is allowed to write.";
    case "unauthenticated":
      return "You are not authenticated. Sign in again and retry.";
    case "unavailable":
      return "Firestore is unavailable right now. Check internet/VPN and retry.";
    case "failed-precondition":
      return "Firestore is not configured correctly (often missing indexes or setup mismatch).";
    case "deadline-exceeded":
      return "Firestore request timed out. Check network/VPN/proxy settings.";
    default:
      return `${code}: ${caught.message}`;
  }
}

export default function AdminPage() {
  const [form, setForm] = useState<AdminForm>(emptyForm());
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  const verificationUrl = useMemo(() => {
    const id = normalizeDiplomaId(form.diplomaId);
    if (!id) return "";
    if (typeof window === "undefined") return `/?id=${encodeURIComponent(id)}`;
    return `${window.location.origin}/?id=${encodeURIComponent(id)}`;
  }, [form.diplomaId]);

  const isTranscript = form.documentType === "Transcript";

  function update<K extends keyof AdminForm>(key: K, value: AdminForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateDocumentType(value: DocumentType) {
    setForm((prev) => ({
      ...prev,
      documentType: value,
      degree: value === "Transcript" ? "" : prev.degree
    }));
  }

  async function buildQr() {
    if (!verificationUrl) {
      setQrDataUrl(null);
      return;
    }
    const data = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6
    });
    setQrDataUrl(data);
  }

  async function onLoadById(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!user) {
      setError("Sign in first.");
      return;
    }

    const diplomaId = normalizeDiplomaId(form.diplomaId);
    if (!diplomaId) {
      setError("Enter a diploma ID first.");
      return;
    }
    if (!isValidDiplomaId(diplomaId)) {
      setError("Invalid diploma ID format. Use 3-64 chars: letters, numbers, '_' or '-'.");
      return;
    }

    setLoading(true);
    try {
      const snapshot = await runWithRetry(
        () =>
          withTimeout(getDoc(doc(db, "diplomas", diplomaId)), FIRESTORE_TIMEOUT_MS, "Firestore read"),
        1
      );
      if (!snapshot.exists()) {
        setMessage("No record exists for this ID. You can create a new one.");
        await buildQr();
        return;
      }

      const data = snapshot.data() as Record<string, unknown>;
      setForm(fromRecord(normalizeRecord(snapshot.id, data)));
      setMessage("Record loaded.");
      await buildQr();
    } catch (caught) {
      setError(explainFirebaseError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!user) {
      setError("Sign in first.");
      return;
    }

    const diplomaId = normalizeDiplomaId(form.diplomaId);
    if (!diplomaId) {
      setError("Diploma ID is required.");
      return;
    }
    if (!isValidDiplomaId(diplomaId)) {
      setError("Invalid diploma ID format. Use 3-64 chars: letters, numbers, '_' or '-'.");
      return;
    }
    if (form.status === "revoked" && !form.revokedReason.trim()) {
      setError("Revoked records require a revoked reason.");
      return;
    }

    const transcriptMode = form.documentType === "Transcript";
    const holderName = sanitizeText(form.holderName, 120);
    const studentNumber = sanitizeText(form.studentNumber, 80);
    const degree = sanitizeText(form.degree, 120);
    const program = sanitizeText(form.program, 120);
    const faculty = sanitizeText(form.faculty, 120);
    const issuedOn = form.issuedOn.trim();
    const revokedReason = sanitizeText(form.revokedReason, 240);

    if (!holderName || !studentNumber || !program || !faculty) {
      setError("Holder name, student number, program, and faculty are required.");
      return;
    }
    if (!isIsoDate(issuedOn)) {
      setError("Issued On must be in YYYY-MM-DD format.");
      return;
    }
    if (!transcriptMode) {
      if (!degree) {
        setError("Degree is required for Diploma.");
        return;
      }
    }
    if (form.status === "revoked" && revokedReason.length < 3) {
      setError("Revoked reason must be at least 3 characters.");
      return;
    }

    setLoading(true);
    try {
      const payload: {
        documentType: DocumentType;
        holderName: string;
        studentNumber: string;
        degree?: string;
        program: string;
        faculty: string;
        issuedOn: string;
        deliveryMode: DeliveryMode;
        status: DiplomaStatus;
        revokedReason?: string;
      } = {
        documentType: normalizeDocumentType(form.documentType),
        holderName,
        studentNumber,
        program,
        faculty,
        issuedOn,
        deliveryMode: normalizeDeliveryMode(form.deliveryMode),
        status: form.status
      };

      if (!transcriptMode) {
        payload.degree = degree;
      }
      if (form.status === "revoked") {
        payload.revokedReason = revokedReason;
      }

      await runWithRetry(
        () =>
          withTimeout(
            setDoc(doc(db, "diplomas", diplomaId), payload),
            FIRESTORE_TIMEOUT_MS,
            "Firestore write"
          ),
        1
      );
      setMessage("Diploma saved to Firestore.");
      await buildQr();
    } catch (caught) {
      setError(explainFirebaseError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function onCopyUrl() {
    if (!verificationUrl) return;
    try {
      await navigator.clipboard.writeText(verificationUrl);
      setMessage("Verification URL copied.");
      setError(null);
    } catch {
      setError("Unable to copy. Copy URL manually.");
    }
  }

  async function onDownloadSvg() {
    if (!verificationUrl) return;
    setMessage(null);
    setError(null);

    try {
      const svg = await QRCode.toString(verificationUrl, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2
      });

      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const id = normalizeDiplomaId(form.diplomaId) || "document";

      anchor.href = url;
      anchor.download = `${id}-verification-qr.svg`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setMessage("SVG downloaded.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed generating SVG.");
    }
  }

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword("");
      setMessage("Signed in.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  async function onLogout() {
    setMessage(null);
    setError(null);
    setLoading(true);
    try {
      await signOut(auth);
      setMessage("Signed out.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-out failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h2>Admin Authentication</h2>
        {!authReady && <p>Checking sign-in session...</p>}
        {authReady && !user && (
          <form className="stack" onSubmit={onLogin}>
            <label>
              Admin email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
        {authReady && user && (
          <div className="row">
            <p>
              Signed in as <strong>{user.email ?? user.uid}</strong>
            </p>
            <button type="button" onClick={onLogout} disabled={loading}>
              Sign out
            </button>
          </div>
        )}
      </section>

      {user && (
        <form className="card stack" onSubmit={onLoadById}>
          <h2>Load by ID</h2>
          <div className="row">
            <input
              className="id-input"
              placeholder="Diploma ID (example: DIP-2026-000123)"
              value={form.diplomaId}
              onChange={(event) => update("diplomaId", event.target.value)}
            />
            <button type="submit" disabled={loading}>
              {loading ? "Loading..." : "Load"}
            </button>
          </div>
        </form>
      )}

      {user && (
        <form className="card stack" onSubmit={onSave}>
          <h2>Edit Diploma Record</h2>

          <label>
            Document Type
            <select
              value={form.documentType}
              onChange={(event) => updateDocumentType(event.target.value as DocumentType)}
            >
              <option value="Diploma">Diploma</option>
              <option value="Transcript">Transcript</option>
            </select>
          </label>

          <label>
            Holder Name
            <input
              value={form.holderName}
              onChange={(event) => update("holderName", event.target.value)}
              required
            />
          </label>

          <label>
            Student Number
            <input
              value={form.studentNumber}
              onChange={(event) => update("studentNumber", event.target.value)}
              required
            />
          </label>

          {!isTranscript && (
            <label>
              Degree
              <input value={form.degree} onChange={(event) => update("degree", event.target.value)} required />
            </label>
          )}

          <label>
            Program
            <input
              value={form.program}
              onChange={(event) => update("program", event.target.value)}
              required
            />
          </label>

          <label>
            Faculty
            <input
              value={form.faculty}
              onChange={(event) => update("faculty", event.target.value)}
              required
            />
          </label>

          <label>
            Issued On
            <input
              type="date"
              value={form.issuedOn}
              onChange={(event) => update("issuedOn", event.target.value)}
              required
            />
          </label>

          <label>
            Delivery Mode
            <select
              value={form.deliveryMode}
              onChange={(event) => update("deliveryMode", event.target.value as DeliveryMode)}
            >
              <option value="Traditional Education">Traditional Education</option>
              <option value="Webinar">Webinar</option>
            </select>
          </label>

          <label>
            Status
            <select
              value={form.status}
              onChange={(event) => update("status", event.target.value as DiplomaStatus)}
            >
              <option value="valid">valid</option>
              <option value="revoked">revoked</option>
            </select>
          </label>

          {form.status === "revoked" && (
            <label>
              Revoked Reason
              <input
                value={form.revokedReason}
                onChange={(event) => update("revokedReason", event.target.value)}
                required
              />
            </label>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save Record"}
          </button>
        </form>
      )}

      {user && (
        <section className="card stack">
          <h2>Verification QR</h2>
          <p>
            URL: {verificationUrl ? <code>{verificationUrl}</code> : "Enter diploma ID to generate URL"}
          </p>
          <input
            className="id-input"
            placeholder="Diploma ID"
            value={form.diplomaId}
            onChange={(event) => update("diplomaId", event.target.value)}
          />
          <div className="row">
            <button type="button" onClick={buildQr} disabled={!verificationUrl}>
              Generate QR
            </button>
            <button type="button" onClick={onCopyUrl} disabled={!verificationUrl}>
              Copy URL
            </button>
            <button type="button" onClick={onDownloadSvg} disabled={!verificationUrl}>
              Download SVG
            </button>
          </div>
          {qrDataUrl && (
            <Image src={qrDataUrl} alt="Diploma verification QR code" width={280} height={280} />
          )}
        </section>
      )}

      {message && <section className="card valid">{message}</section>}
      {error && <section className="card invalid">{error}</section>}
    </div>
  );
}
