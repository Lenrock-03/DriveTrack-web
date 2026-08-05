# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/), Versionierung nach
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

Die Versionsnummer steht als einzige Quelle der Wahrheit im `<meta name="app-version">`-Tag in
`index.html` (kein Build-Step, der eine Konstante automatisch einsetzen könnte) und wird zusätzlich
unten in "Konto / Settings" angezeigt.

## [1.0.0] - 2026-08-05

Erster versionierter Stand der bereits produktiv laufenden Web-App
(`https://drivetrack.kornel-riedl.de`).

### Enthalten
- Login / Registrieren / Passwort vergessen
- Read-only Ansicht des Server-Backups: Home-Dashboard, Fahrtenliste, Kartenansicht (Leaflet),
  Fahrt-Detail
- Ende-zu-Ende-Entschlüsselung im Browser (Web Crypto API), spiegelt `ServerCrypto.kt` der App
