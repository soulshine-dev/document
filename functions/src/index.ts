import { setGlobalOptions } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";

setGlobalOptions({ maxInstances: 10 });

const MAILGUN_API_KEY = defineSecret("MAILGUN_API_KEY");
const MAILGUN_DOMAIN = defineSecret("MAILGUN_DOMAIN");
const MAILGUN_FROM = defineSecret("MAILGUN_FROM");
const MAILGUN_TO = defineSecret("MAILGUN_TO");

const required = (value: unknown, label: string) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Missing ${label} secret.`);
  return text;
};

const normalizeText = (value: unknown) => String(value || "").trim();

const buildLocation = (data: Record<string, unknown>) => {
  const city = normalizeText(data.city);
  const region = normalizeText(data.region);
  const country = normalizeText(data.country);
  return [city, region, country].filter(Boolean).join(", ");
};

const formatCatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(date);
  return `${formatted} CAT (UTC+2)`;
};

export const notifyVerificationLog = onDocumentCreated(
  {
    document: "verification_logs/{logId}",
    secrets: [MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM, MAILGUN_TO]
  },
  async (event) => {
    const sendMode = normalizeText(process.env.MAILGUN_SEND_MODE || "immediate").toLowerCase();
    if (sendMode !== "immediate") return;

    const snapshot = event.data;
    if (!snapshot) return;
    const data = snapshot.data() as Record<string, unknown>;

    const apiKey = required(MAILGUN_API_KEY.value(), "MAILGUN_API_KEY");
    const domain = required(MAILGUN_DOMAIN.value(), "MAILGUN_DOMAIN");
    const fromEmail = required(MAILGUN_FROM.value(), "MAILGUN_FROM");
    const toEmail = required(MAILGUN_TO.value(), "MAILGUN_TO");
    const baseUrlRaw = normalizeText(process.env.MAILGUN_BASE_URL || "https://api.mailgun.net/v3");
    const baseUrl = baseUrlRaw.replace(/\/+$/, "");

    const diplomaId = normalizeText(data.diplomaId || "unknown");
    const eventType = normalizeText(data.eventType || "verification");
    const result = normalizeText(data.result || "event");
    const ip = normalizeText(data.ip || "");
    const location = buildLocation(data);
    const createdAtRaw = normalizeText(data.createdAt || "");
    const createdAt = formatCatTime(createdAtRaw);
    const userAgent = normalizeText(data.userAgent || "");
    const latitude = data.latitude === null || data.latitude === undefined ? "" : String(data.latitude);
    const longitude = data.longitude === null || data.longitude === undefined ? "" : String(data.longitude);
    const coordinates = latitude && longitude ? `${latitude}, ${longitude}` : "-";

    const subject = `Document verification log: ${diplomaId} (${eventType})`;
    const text = [
      `Document ID: ${diplomaId}`,
      `Event: ${eventType}`,
      `Result: ${result}`,
      `Time: ${createdAt}`,
      `IP: ${ip}`,
      `Location: ${location || "-"}`,
      `Coordinates: ${coordinates}`,
      `User Agent: ${userAgent || "-"}`
    ].join("\n");

    const html = `
      <div style="font-family: Arial, sans-serif; color: #111;">
        <h2 style="margin: 0 0 12px; font-size: 18px;">Document Verification Log</h2>
        <table style="border-collapse: collapse; width: 100%; max-width: 640px;">
          <tr><td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: bold;">Document ID</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${diplomaId}</td></tr>
          <tr><td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: bold;">Event</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${eventType}</td></tr>
          <tr><td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: bold;">Result</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${result}</td></tr>
          <tr><td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: bold;">Time</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${createdAt}</td></tr>
          <tr><td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: bold;">IP</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${ip || "-"}</td></tr>
          <tr><td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${location || "-"}</td></tr>
          <tr><td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: bold;">Coordinates</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${coordinates}</td></tr>
          <tr><td style="padding: 8px 10px; border: 1px solid #ddd; font-weight: bold;">User Agent</td><td style="padding: 8px 10px; border: 1px solid #ddd;">${userAgent || "-"}</td></tr>
        </table>
      </div>
    `;

    try {
      const auth = Buffer.from(`api:${apiKey}`).toString("base64");
      const body = new URLSearchParams();
      body.set("from", fromEmail);
      body.set("to", toEmail);
      body.set("subject", subject);
      body.set("text", text);
      body.set("html", html);

      const response = await fetch(`${baseUrl}/${domain}/messages`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}` },
        body
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Mailgun send failed", {
          status: response.status,
          body: errorText,
          logId: event.params.logId
        });
      }
    } catch (error) {
      logger.error("Mailgun send error", { error, logId: event.params.logId });
    }
  }
);
