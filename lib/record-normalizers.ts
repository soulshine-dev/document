import type { DeliveryMode, DocumentType } from "@/lib/types";

export function normalizeDocumentType(value: unknown): DocumentType {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "transcript") {
    return "Transcript";
  }

  return "Diploma";
}

export function normalizeDeliveryMode(value: unknown): DeliveryMode {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized.includes("webinar")) {
    return "Webinar";
  }

  return "Traditional Education";
}
