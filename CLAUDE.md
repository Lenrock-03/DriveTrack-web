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
js/app.js            Komplette UI-Logik, State, Leaflet-Karten-Rendering
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
  4er-Grid-Reihe oben), darunter/dahinter ein interaktiver Geschwindigkeit/Zeit-Graph wie in der
  Android-App (`SpeedGraph` in `TripDetailScreen.kt` dort als Vorbild – Canvas-basiert, ziehbarer Punkt,
  zeigt Uhrzeit/km-Stand/Geschwindigkeit an der gewählten Stelle). Noch nicht umgesetzt.
- **Automatische Synchronisation** während man eingeloggt ist (periodisches Neuladen des Backups im
  Hintergrund, z. B. per `setInterval` + Refresh bei Tab-Fokus) – angefragt, aber noch nicht gebaut.
