import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, ".env.local");
const firebasercPath = path.join(projectRoot, ".firebaserc");

const requiredKeys = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID"
];

function parseDotEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) continue;
    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    result[key] = value;
  }
  return result;
}

if (!fs.existsSync(envPath)) {
  console.error("Firebase check failed: .env.local is missing in qr-doc-verify.");
  console.error("Create it from .env.example first.");
  process.exit(1);
}

const env = parseDotEnv(fs.readFileSync(envPath, "utf8"));
const missing = requiredKeys.filter((key) => !env[key]);

if (missing.length > 0) {
  console.error("Firebase check failed: missing keys in .env.local:");
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  process.exit(1);
}

const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const authDomain = env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
const storageBucket = env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

if (!authDomain.includes(projectId)) {
  console.error("Firebase check failed: authDomain does not match project ID.");
  console.error(`projectId=${projectId}`);
  console.error(`authDomain=${authDomain}`);
  process.exit(1);
}

const storageLooksValid =
  storageBucket === `${projectId}.appspot.com` ||
  storageBucket === `${projectId}.firebasestorage.app` ||
  storageBucket.includes(projectId);

if (!storageLooksValid) {
  console.error("Firebase check failed: storageBucket does not appear to match project ID.");
  console.error(`projectId=${projectId}`);
  console.error(`storageBucket=${storageBucket}`);
  process.exit(1);
}

if (!fs.existsSync(firebasercPath)) {
  console.error("Firebase check failed: .firebaserc is missing.");
  console.error("Add a default Firebase project so deploy targets the right backend.");
  process.exit(1);
}

let firebasercProject = "";
try {
  const firebaserc = JSON.parse(fs.readFileSync(firebasercPath, "utf8"));
  firebasercProject = String(firebaserc?.projects?.default ?? "").trim();
} catch (error) {
  console.error("Firebase check failed: .firebaserc is not valid JSON.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!firebasercProject) {
  console.error("Firebase check failed: .firebaserc does not contain projects.default.");
  process.exit(1);
}

if (firebasercProject !== projectId) {
  console.error("Firebase check failed: .firebaserc project and .env.local project differ.");
  console.error(`.firebaserc default=${firebasercProject}`);
  console.error(`.env.local NEXT_PUBLIC_FIREBASE_PROJECT_ID=${projectId}`);
  process.exit(1);
}

console.log("Firebase check passed.");
console.log(`projectId=${projectId}`);
