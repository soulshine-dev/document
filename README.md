# University Diploma Verification (Firebase + Single Page)

This project is a single-page web app that verifies university diplomas from QR code URLs.

## How the flow works

1. University creates a Firestore document in `diplomas/{diplomaId}`.
2. University prints QR on diploma with URL format:

`https://your-domain.com/?id=<diplomaId>`

3. Verifier scans QR.
4. Browser opens this page and reads that Firestore record.
5. Page shows holder and diploma details with status:
   - `valid` -> authentic
   - `revoked` -> not valid anymore
   - missing ID -> not found

## Pages

- `/` public verifier page
- `/admin` university admin page (Firebase Auth login, create/update records, generate QR)

## Firestore document model

Collection: `diplomas`
Document ID: `<diplomaId>` (for example `DIP-2026-000123`)

Required fields:

```json
{
  "documentType": "Diploma",
  "holderName": "Jane Doe",
  "studentNumber": "202100045",
  "degree": "Bachelor of Science",
  "program": "Computer Science",
  "faculty": "Engineering",
  "issuedOn": "2026-07-01",
  "deliveryMode": "Traditional Education",
  "status": "valid"
}
```

For `documentType: "Transcript"`:
- `degree` is not required and should be omitted.

Optional field:

- `revokedReason`: string (recommended when `status` is `revoked`)

## Admin workflow

1. Open `/admin`.
2. Sign in with a Firebase Auth account.
3. Enter `diplomaId` and click `Load` (optional; useful for edits).
4. Fill document details (`documentType`, holder info, `deliveryMode`) and choose status (`valid` or `revoked`).
5. Click `Save Record`.
6. Click `Generate QR` and print that QR on the diploma.

## Environment setup

Create `.env.local` from `.env.example` and set Firebase Web App config:

```powershell
Copy-Item .env.example .env.local
```

Also enable Firebase Authentication (Email/Password) in the Firebase console and create admin user accounts.

## Firebase wiring check

Run this before `dev`/`build` if you changed config:

```powershell
npm run firebase:check
```

This validates:
- required `NEXT_PUBLIC_FIREBASE_*` keys in `.env.local`
- `.firebaserc` exists
- `.firebaserc` default project matches `.env.local` project ID

The app uses Firestore Lite (REST transport) to improve reliability in restricted networks.

## Run locally

```powershell
npm install
npm run dev
```

Open: `http://localhost:3000`

## QR payload format

Use this URL format in the QR code:

`https://your-domain.com/?id=<diplomaId>`

## Deploy to Firebase Hosting

```powershell
npm run build
firebase login
firebase init hosting
firebase deploy --only hosting,firestore:rules
```

This project exports a static app (`out/`) so it works on Firebase Hosting.

## Security recommendation (important)

- Keep this page public-read only for fields safe to disclose.
- Do not store sensitive personal data you do not want public.
- Use Firestore security rules so only university admins can write or revoke records.
- Configure anti-indexing (`robots` metadata + `robots.txt` + `X-Robots-Tag` header).

This project now includes strict schema validation in `firestore.rules`.
Before production deploy, update the admin allow-list placeholder email:

`replace-with-your-admin-email@example.com`

or set Firebase Auth custom claim `admin: true` for authorized admin accounts.
