# DriveTrack – Web-App

Statische Web-Oberfläche (reines HTML/CSS/JavaScript, **kein Build-Step**, kein Framework) für
DriveTrack. Läuft live auf `https://drivetrack.kornel-riedl.de`. Zeigt an, was die Android-App per
Server-Backup hochgeladen hat (kein GPS im Browser, also kein Aufzeichnen hier). Bis v1.6.0 bewusst
rein lesend – seit **v1.7.0** kann hier auch bearbeitet werden (Zuschneiden/Markieren, siehe unten),
der erste Schreibpfad der Web-App überhaupt. Weiterhin **kein** GPS-Tracking im Browser.

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
js/api.js            Fetch-Wrapper für die Backend-Endpunkte (inkl. uploadBackup/getBackupHistory/
                     getBackupVersion seit v1.7.0, siehe unten)
js/app.js            Komplette UI-Logik, State, Leaflet-Karten-Rendering, Geschwindigkeits-Graph
                     (Canvas, `buildSpeedSeries()`/`renderSpeedGraph()` – spiegelt `SpeedGraph()`
                     aus `TripDetailScreen.kt` der App 1:1, gleiche Haversine-Formel), seit v1.7.0
                     zusätzlich der komplette Bearbeiten-Screen (`openTripEdit()` und alles was mit
                     `edit`-Präfix beginnt) + der Schreibpfad (`pushBackupConflictSafe()`)
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

## Einstellungen (seit v1.6.0)

`#settings-screen` ist in Gruppen gegliedert (`.settings-group-header` + `.settings-section`,
CSS-Klassen ohne JS-Logik) statt der vorherigen 4 Einträge in wiederverwendeter `.auth-card`-Optik:
👤 Konto (Benutzername + E-Mail als `.settings-info-tile`-Kacheln, Abmelden mit Zwei-Klick-
Bestätigung), 🔄 Daten ("Daten neu laden" mit eingeblendeter `.settings-status-msg` statt `alert()`
– war die einzige Stelle der ganzen App mit einem nativen alert()), ℹ️ Über (Version). Die E-Mail
kommt aus `session.email`, die der Login-Endpunkt erst seit Backend v1.1.1 überhaupt zurückgibt
(vorher stand dort ein Bug: `email: session?.email` las sich selbst aus, war dadurch immer leer).

## Routen-Farbmodus (seit v1.5.0)

Auswahlmenü oben rechts auf der Fahrt-Detail-Karte (`#route-color-mode`): "Standard" (einheitliche
orangene Linie) oder "Nach Geschwindigkeit" (grün→rot, `speedToColor()`). Bei Geschwindigkeit
zeichnet `renderRouteLine()` die Route als mehrere kurze `L.polyline`-Segmente (max.
`MAX_ROUTE_COLOR_SEGMENTS` = 1500, sonst zu viele Layer bei langen Fahrten) plus eine unsichtbare,
breitere Linie über die vollen Punkte nur fürs Hover/Tap (`setupRouteHover()` bleibt unverändert).
Präferenz bleibt über `localStorage` erhalten. Die Detail-Karte nutzt seitdem `preferCanvas: true`
(Leaflet rendert Vektor-Layer dann per Canvas statt SVG-DOM-Knoten – deutlich flüssiger bei vielen
Segmenten). Die Farbskala ist seit v1.5.1 **fest**, nicht relativ zur einzelnen Fahrt – dazu eine
Legende (`#route-color-legend`) unten links, deren Gradient direkt aus `speedToColor()` gebaut wird
(keine separat gepflegte CSS-Farbskala). Seit v1.5.2 zweistufig: 0–130 km/h grün→rot
(`ROUTE_COLOR_RED_KMH`), 130–180 km/h zusätzlich rot→lila (`ROUTE_COLOR_PURPLE_KMH`, danach
gekappt). Spiegelt sich 1:1 in der App (`RouteColorMode`/`speedToColor()` in `TripDetailScreen.kt`).

## Auto-Refresh (seit v1.2.0)

`loadAndRenderBackup()` läuft automatisch alle 60s (`AUTO_REFRESH_INTERVAL_MS`) im Hintergrund
sowie sofort beim Zurückwechseln in den Tab (`visibilitychange`), passend zum automatischen Sync
der App (seit App 0.3.0). Nur aktiv, wenn eingeloggt+entsperrt UND man gerade auf Home/Fahrten ist
(`canAutoRefreshNow()`) – bewusst NICHT in der Fahrt-Detail- oder Settings-Ansicht, damit kein
Reload mitten in einer Interaktion die Ansicht wegreißt.

Seit v1.8.0 zusätzlich manuell per **"🔄 Aktualisieren"-Button** in der Kopfzeile (`#refresh-btn`,
ruft direkt `loadAndRenderBackup()` auf) – Pendant zum Runterziehen-Gesture auf der Fahrtenliste
der Android-App (0.12.0). Rein lesend (pullt nur); lokale Bearbeitungen werden bereits beim
Speichern selbst gepusht (`pushBackupConflictSafe()`), kein zusätzlicher Push hier nötig.

## Fahrten bearbeiten + Abschnitte ansehen (seit v1.7.0)

1:1-Port der Android-App-Funktionen aus 0.8.0–0.11.0 (`data/TripGeoMath.kt`/`TripEditScreen.kt`).

- **Ansehen** (rein lesend, unabhängig vom Bearbeiten-Feature): `openTripDetail()` zeigt Fahrt-
  Labels (`labelList()`/`labelIcon()`/`labelColor()` – Fähre blau/Pause bernstein/Nacht indigo/
  sonst türkis, exakt dieselben Hex-Werte wie `labelColor()` in `data/TripGeoMath.kt`) als Badges,
  `renderRouteLine()` zeichnet zusätzlich je markiertem Abschnitt eine gestrichelte `L.polyline` in
  dessen Farbe (`renderSegmentMarkLines()`), `#trip-detail-segments` listet pro Abschnitt eine
  eigene Distanz/Dauer/Ø-/Höchstgeschwindigkeit (`computeSegmentStats()`, spiegelt
  `Trip.segmentStats()`) – unabhängig von den Gesamt-Fahrt-Werten.
- **Bearbeiten** (`#trip-edit-screen`, `openTripEdit()`): eigene, vom Detail-Screen unabhängige
  Leaflet-Karte (`editMap`) + ein eigenständiger Canvas-Graph (`renderEditGraph()` – bewusst NICHT
  `renderSpeedGraph()` wiederverwendet, das ist fest an `detailMap`/`#speed-graph-canvas` gebunden;
  stattdessen ein eigener, schlankerer Klon mit zusätzlichen A/B-Markern + hervorgehobenen
  Bereichen). Tippen/Ziehen im Graph wählt eine Position, "Punkt A/B setzen" merkt sich deren
  Zeitstempel. Zwei Kategorien:
  - **Zuschneiden** (destruktiv): `applyTripEditPlanJs()` ist der JS-Port von
    `applyTripEditPlan()` – identische Lauf-Gruppierung nach Original-Index-Nachbarschaft (gegen
    Distanz-Artefakte über Schnittlücken), `pausedMinutes` akkumuliert, Gesamtdauer bleibt bei
    einem Pause-Cut unverändert. Änderungen sammeln sich erst in `editPendingActions`
    (Änderungsliste + Lösch-Icon), werden erst nach `confirm()` (kein eigenes Modal-System in
    dieser App, siehe unten) tatsächlich angewendet.
  - **Markieren** (nicht-destruktiv): Labels/Markierungen sind bis zum Verlassen der Seite nur
    lokaler Entwurf (`editPendingLabels`/`editPendingMarks`), NICHT sofort gespeichert.
    `attemptEditBack()` fragt bei ungespeicherten Änderungen nach ("Änderungen speichern?") –
    bewusst `confirm()` statt eines dritten "Bleiben"-Buttons (OK = Speichern, Abbrechen =
    Verwerfen), da diese App kein Custom-Modal-System hat und `alert()`/`confirm()`/`prompt()` an
    anderen Stellen (Registrieren, Passwort-Reset) bereits akzeptierter Stil sind. Aus demselben
    Grund nutzt "A–B als Abschnitt markieren…" einen `prompt()` statt eines Chip-Auswahl-Dialogs
    wie in der App.
  - Nach dem Speichern: `pushBackupConflictSafe()` (siehe unten), dann direkt zurück zur jetzt
    aktualisierten Detailseite (`openTripDetail(updatedTrip)`).

## Konfliktsicherer Schreibpfad + Versionsverlauf (seit v1.7.0)

Die Web-App war bis v1.6.0 rein lesend – `syncFullBackupIfPossible()` in der App ist aber ein reiner
Push ohne Konfliktprüfung, hätte also jede Web-Bearbeitung beim nächsten App-Sync stillschweigend
überschrieben. Beide Seiten (App 0.11.0, hier v1.7.0) wurden deshalb gemeinsam auf **Pull-Check-
Merge-Push** umgestellt:

- `pushBackupConflictSafe()` in `js/app.js`: lädt vor jedem Push erst `GET /api/backup` (liefert
  auch dessen `id`), vergleicht sie mit der zuletzt bekannten (`localStorage`-Key
  `drivetrack_last_known_backup_id`, Pendant zu `ServerAuthPreferences.getLastKnownBackupId()` in
  der App). Weicht sie ab (die App hat inzwischen gepusht), wird diese Version in `backupData`
  übernommen (`mergeBackupDataOverwrite()` – Trips über Start-/Endzeitpunkt, Users/Cars über Namen
  abgeglichen; ÜBERSCHREIBT bekannte Fahrten mit dem neueren Stand statt sie als Duplikat zu
  überspringen, seit v1.8.1 – siehe unten "Versionsverlauf": beide teilen sich dieselbe Funktion),
  bevor der eigentliche Push passiert. Anders als die App (die Fehler still verschluckt) wirft
  diese Funktion bei einem Fehler – ein vom Nutzer ausgelöstes Speichern soll sichtbar
  fehlschlagen können. **v1.8.1-Fix**: hieß vorher `mergeBackupDataAdditive()` und war rein
  additiv (nie überschrieben) – das ließ Bearbeitungen an einer bereits bekannten Fahrt (z. B. ein
  auf dem Handy geändertes Label) beim Web-seitigen Speichern einfach verschwinden, weil "gleicher
  Start-/Endzeitpunkt" als Duplikat übersprungen wurde.
- **Versionsverlauf** (Einstellungen → "Versionsverlauf anzeigen"): `api.getBackupHistory()` +
  `api.getBackupVersion()` (Backend speichert jede gepushte Version für immer, `POST /api/backup`
  überschreibt nie – reines Append). Antippen einer Version ruft `restoreFromJsonWeb()` auf – anders
  als der additive Merge werden dabei bestehende Fahrten mit übereinstimmender Start-/Endzeit
  gezielt auf den gewählten (älteren) Stand ZURÜCKGESETZT statt übersprungen, danach sofort
  `pushBackupConflictSafe()`, damit die Wiederherstellung auch tatsächlich persistiert wird (die
  Web-App hat anders als die App keine lokale DB, die den wiederhergestellten Stand über einen
  Seiten-Reload hinweg behalten würde – ohne den Push wäre der nächste Reload wieder auf dem alten
  Stand). Pendant zu `BackupExporter.restoreFromJson()`/`ServerBackupScreen.kt`s Versionsverlauf.

## Fahrten gruppieren (seit v1.9.0)

1:1-Port von `data/TripGrouping.kt`/`TripGroupDetailScreen.kt`/`TripGroupPickerScreen.kt`/
`TripGeoMath.kt::buildGroupSpeedSeries()`/`GroupRouteMap.kt` der App (Version 0.13.0). `backupData`
bekommt ein zusätzliches `groups`-Array (`{id, name}`), Trips ein zusätzliches `groupId` (nullable,
serialisiert/gemergt wie `carId` - `mergeBackupDataOverwrite()` bekam dafür eine `groupIdMap` nach
demselben Muster wie die bestehende `carIdMap`).

- `buildTripListEntries(trips, groups)`/`computeGroupStats(trips)`: baut aus Fahrten + Gruppen eine
  gemischte, nach der jeweils neuesten Fahrt sortierte Liste für `renderTripList()` - eine Gruppe
  erscheint dort als EIN zusammengefasster Eintrag (kombiniertes Mini-Thumbnail über
  `drawGroupRouteThumbnail()`, spiegelt `drawRouteThumbnail()` nur mit einem eigenen,
  unverbundenen Canvas-Pfad je Fahrt statt einem durchgehenden - sonst würde eine gerade
  "Teleport"-Linie zwischen dem Ziel einer Fahrt und dem Start der nächsten gezeichnet).
  `computeGroupStats()` nutzt bewusst dieselbe Formel wie `List<Trip>.groupStats()` in der App
  (inkl. `pausedMinutes`-Abzug für die Fahrzeit über `tripDrivingMinutes()`) - `renderStats()`
  weiter oben ist davon unberührt, rechnet weiterhin ohne `pausedMinutes`-Abzug (noch nicht
  umgestellter, älterer Code, kein Bug dieser Funktion).
- `#trip-group-screen` (`openTripGroup()`): Statistik-Kacheln, Mitgliedsfahrten-Liste ("✕"-Button
  entfernt nur aus der Gruppe, löscht die Fahrt nie - setzt nur `groupId = null` via
  `replaceTripInBackupData()`), "Fahrten hinzufügen" (öffnet `#trip-group-picker-screen` im
  Hinzufügen-Modus), "Gruppe löschen" (setzt `groupId` aller Mitglieder zurück, bevor die Gruppe
  selbst aus `backupData.groups` entfernt wird). Umbenennen über einen eigenen Stift-Button +
  `prompt()` (kein eigenes Modal-System in dieser App, siehe "Fahrten bearbeiten" oben) - bewusst
  NICHT inline im Screen, wie es die App zunächst hatte, bevor sie ebenfalls auf einen Dialog
  umgestellt wurde.
  - Eigene Leaflet-Karte (`groupMap`, `#trip-group-map`) mit den Routen ALLER Mitgliedsfahrten
    (`renderGroupRouteLine()`) inkl. Standard-/Geschwindigkeitsfarb-Umschalter (`#group-route-color-
    mode`, teilt sich den `ROUTE_COLOR_MODE_KEY`-localStorage-Eintrag mit der Einzelfahrt-Ansicht)
    und eigener Legende (`#group-route-color-legend`) - die Farbe pro Fahrt kommt dabei aus deren
    EIGENER `getTripSpeedSeries()`, nicht aus der kombinierten Graph-Serie (die Nahtstellen-
    Problematik unten betrifft nur den Graphen, nicht die Kartenfarbe pro Punkt).
  - Eigener kombinierter Geschwindigkeits-Graph (`renderGroupSpeedGraph()`, `#group-graph-canvas`)
    - bewusst ein eigenständiger Klon von `renderSpeedGraph()` statt Wiederverwendung (dieselbe
      Begründung wie bei `renderEditGraph()`: fest an eigene DOM-Elemente/Karte gebunden).
      `buildGroupSpeedSeries()`/`getGroupSpeedSeries()` reihen die Fahrten chronologisch aneinander
      (`offsetSeconds`/`cumulativeKm` laufen durchgehend weiter, keine echte Kalenderzeit-Lücke im
      Graphen), berechnen die Geschwindigkeit dabei aber NIE über die Nahtstelle zwischen zwei
      Fahrten hinweg (jede Fahrt läuft als eigene, isolierte Punktreihe durch `buildSpeedSeries()`) -
      sonst würde die Luftlinien-"Geschwindigkeit" zwischen dem Ziel einer Fahrt und dem Start der
      nächsten (oft über Tage hinweg) als astronomischer Ausreißer erscheinen.
- `#trip-group-picker-screen` (`openGroupPicker()`): `targetGroupId == null` → Erstellen-Modus
  (Namensfeld + Checkliste aller Fahrten), sonst Hinzufügen-Modus (kein Namensfeld, Checkliste aller
  Fahrten, die noch NICHT in dieser Gruppe sind). Da eine Fahrt nur in EINER Gruppe sein kann
  (spiegelt `carId`), zeigen Fahrten aus einer ANDEREN Gruppe ein `.picker-check-badge` - Auswahl
  verschiebt sie dorthin, statt es stillschweigend passieren zu lassen.

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
