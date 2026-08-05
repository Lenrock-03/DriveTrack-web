# DriveTrack – Web-App

Statische Web-Oberfläche (reines HTML/CSS/JavaScript, **kein Build-Step**, kein Framework) für
DriveTrack. Läuft live auf `https://drivetrack.kornel-riedl.de`. Bewusst nur **lesend** – zeigt an,
was die Android-App per Server-Backup hochgeladen hat (kein GPS im Browser, also kein Aufzeichnen hier).

## Zugehörige Projekte

1. **Android-App** – `C:\Users\korne\Downloads\DriveTrack\DriveTrack` (Kotlin/Compose), der Haupt-Client,
   zeichnet Fahrten auf und lädt sie verschlüsselt hoch
2. **Backend-API** – `C:\Users\korne\OneDrive\Dokumente\Programmieren\DriveTrack` (Node.js/Express),
   läuft live auf `https://drivetrack-api.kornel-riedl.de` (andere Subdomain als diese Web-App!)
3. **Diese Web-App** (hier)

Nutzt dasselbe Backup-JSON-Format und dieselbe Verschlüsselung wie die Android-App – Änderungen daran
müssen in beiden Projekten synchron gehalten werden (`js/crypto.js` hier entspricht `ServerCrypto.kt`
in der App, Web Crypto API statt `javax.crypto`).

## Struktur

```
index.html          Alle Screens als einzelne divs (login/register/forgot/unlock/main/detail/settings),
                     per JS ein-/ausgeblendet über die Klasse "hidden"
style.css            Dunkles Theme, orange Akzentfarbe (#ff7a1a) – an die Android-App angelehnt
js/crypto.js         PBKDF2 + AES-256-GCM über die Web Crypto API, spiegelt ServerCrypto.kt 1:1
js/api.js            Fetch-Wrapper für die Backend-Endpunkte
js/app.js            Komplette UI-Logik, State, Leaflet-Karten-Rendering, Geschwindigkeits-Graph
                     (Canvas, `buildSpeedSeries()`/`renderSpeedGraph()` – spiegelt `SpeedGraph()`
                     aus `TripDetailScreen.kt` der App 1:1, gleiche Haversine-Formel)
```

Karten: **Leaflet.js** (über CDN eingebunden) statt osmdroid, gleiche CartoDB-Dark-Matter-Kacheln wie
in der App, per CSS-`filter` aufgehellt (`brightness(1.65)` – die Standard-Kacheln sind sonst kaum lesbar).

## Bekannte Stolpersteine (bereits gelöst, für Kontext)

- **Leaflet-Karte bleibt schwarz beim ersten Laden**: Wird eine Leaflet-Map erzeugt, während ihr
  Container noch `display:none` hat, berechnet sie die Kachelgröße falsch und lädt nie richtig nach.
  Fix: Screen IMMER erst per `showScreen(...)` sichtbar machen, DANACH erst `L.map(...)` aufrufen
  (siehe `ensureMainMap()` / der `setTimeout(...)`-Wrapper bei der Detail-Karte).
- **`scp` von Windows nach Linux setzt kaputte Dateirechte**: Nach jedem Upload auf den VPS ggf.
  `chmod 755` (Ordner) / `chmod 644` (Dateien) nötig, sonst 403 Forbidden von Nginx.

## Deployment

- Rein statische Dateien, **kein Docker-Container** – liegen direkt unter `/var/www/drivetrack-web/`
  auf dem VPS, ausgeliefert vom host-seitigen Nginx
- Nginx-Config: `/etc/nginx/sites-available/drivetrack.kornel-riedl.de`
- SSL via Certbot/Let's Encrypt

**Deploy-Ablauf** (kein CI/CD, manuell):
```powershell
git add . && git commit -m "..." && git push   # optional, Repo liegt auf GitHub
scp -r "C:\Users\korne\OneDrive\Dokumente\Programmieren\DriveTrack-Web\*" root@5.45.110.201:/var/www/drivetrack-web/
ssh root@5.45.110.201 "find /var/www/drivetrack-web -type d -exec chmod 755 {} \; && find /var/www/drivetrack-web -type f -exec chmod 644 {} \;"
```

## Noch offen / geplant

- **Fahrt-Detail-Ansicht umbauen**: Stats sollen vertikal am linken Rand stehen (statt der aktuellen
  4er-Grid-Reihe oben), der Geschwindigkeits-Graph (siehe unten, seit v1.1.0 vorhanden) davor/danach
  statt als eigener Abschnitt unter der Karte. Layout-Umbau selbst noch nicht umgesetzt.
## Auto-Refresh (seit v1.2.0)

`loadAndRenderBackup()` läuft automatisch alle 60s (`AUTO_REFRESH_INTERVAL_MS`) im Hintergrund
sowie sofort beim Zurückwechseln in den Tab (`visibilitychange`), passend zum automatischen Sync
der App (seit App 0.3.0). Nur aktiv, wenn eingeloggt+entsperrt UND man gerade auf Home/Fahrten ist
(`canAutoRefreshNow()`) – bewusst NICHT in der Fahrt-Detail- oder Settings-Ansicht, damit kein
Reload mitten in einer Interaktion die Ansicht wegreißt.

## Versionierung

Seit 2026-08-05 einheitlich über alle drei Projekte (App, Backend, Web):

- **Semantic Versioning** (`MAJOR.MINOR.PATCH`) – `<meta name="app-version">` in `index.html` ist
  die einzige Quelle der Wahrheit (kein Build-Step, der eine Konstante automatisch einsetzen könnte),
  `js/app.js` liest sie von dort und zeigt sie unter "Konto / Settings" an
- **MAJOR**: Breaking Change am Backup-JSON-Format/Verschlüsselungsschema (betrifft dann zwangsläufig
  auch App + Backend)
- **MINOR**: neues Feature, abwärtskompatibel
- **PATCH**: Bugfix, kein Verhaltensunterschied
- Bei jedem Bump: **beide** Stellen ändern (Meta-Tag UND `CHANGELOG.md`), Git-Tag `vX.Y.Z` setzen,
  `git push --tags`
- Releases aktuell **manuell** per `gh release create vX.Y.Z --notes-file CHANGELOG.md` – kein
  CI/CD dafür eingerichtet
- Repo: `github.com/Lenrock-03/drivetrack-web`
