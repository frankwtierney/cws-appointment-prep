# CWS Appointment Prep

CWS Appointment Prep converts University at Buffalo Federal Work-Study appointment forms into HR-ready PDFs. It supports individual and batch processing, reusable department Entry Types, appointment-log CSV exports, and organized ZIP downloads.

## Privacy

PDF processing happens entirely in the browser. Uploaded forms, generated PDFs, Entry Types, and appointment-log data are not sent to an application server. Entry Types and the appointment log are stored only in the browser being used.

Do not commit student appointment forms, generated PDFs, exported CSV files, or other student records to this repository.

## Development

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Validation:

```bash
npm run lint
npm run build:pages
```

## Deployment

GitHub Actions builds the static application and publishes it to GitHub Pages whenever a commit is pushed to `main`. The Pages build automatically applies the `/cws-appointment-prep` repository base path.
