# DriveTrack – Web-App

Statische Web-Oberfläche (reines HTML/CSS/JavaScript, **kein Build-Step**, kein Framework) für
DriveTrack. Läuft live auf `https://drivetrack.kornel-riedl.de`. Zeigt an, was die Android-App per
Server-Backup hochgeladen hat (kein GPS im Browser, also kein Aufzeichnen hier). Kein GPS-Tracking
im Browser.

**Seit v2.0.0 bewusst wieder rein lesend** ("reiner Spiegel" der App): v1.7.0–v1.10.x hatten hier
einen eigenen Schreibpfad (Zuschneiden/Markieren, Gruppen anlegen/umbenennen/löschen,
Versionsverlauf-Wiederherstellung), der über `pushBackupConflictSafe()`/`mergeBackupDataOverwrite()`
konfliktsicher mit der App synchronisiert werden sollte. In der Praxis führte das trotzdem zu
Daten-Bugs, weil Fahrten kein stabiles Identitäts-Feld im Backup-JSON haben (Abgleich nur über
Start-/Endzeitpunkt) - ein Zuschneiden auf dem Handy änderte diese Zeitstempel, wodurch die Web-Seite
(oder ein anderes Gerät) die bearbeitete Fahrt beim nächsten Sync als NEU statt als Update erkannte
und die alte Kopie als Karteileiche stehen blieb (Duplikate), teils sogar mit einer über den Merge
verschleppten, aus korrupten GPS-Punkten stammenden falschen Höchstgeschwindigkeit. Statt die
Merge-Logik weiter zu härten, wurde die Ursache stattdessen strukturell entfernt: **die App ist die
einzige Quelle der Wahrheit**, hier wird nur noch angezeigt (`loadAndRenderBackup()` lädt einmalig
das aktuelle Server-Backup und ERSETZT `backupData` komplett - kein Merge mehr nötig, weil nie mehr
lokal mutiert wird). Bearbeiten/Gruppieren/Umbenennen/Löschen gibt es dadurch nur noch in der App.

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
js/api.js            Fetch-Wrapper für die Backend-Endpunkte - seit v2.0.0 nur noch
                     `downloadBackup()` (kein Schreibpfad mehr, siehe oben)
js/app.js            Komplette UI-Logik, State, Leaflet-Karten-Rendering, Geschwindigkeits-Graph
                     (Canvas, `buildSpeedSeries()`/`renderSpeedGraph()` – spiegelt `SpeedGraph()`
                     aus `TripDetailScreen.kt` der App 1:1, gleiche Haversine-Formel). Seit v2.0.0
                     kein Schreibpfad mehr (reiner Spiegel, siehe oben) - `js/api.js` hat dafür nur
                     noch `downloadBackup()`
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
der Android-App (0.12.0). Seit v2.0.0 ist das (neben dem 60s-Intervall) die einzige Art, wie diese
Seite überhaupt mit dem Server interagiert – reines Pull, kein Push mehr (siehe oben).

## Fahrt-Detail: Labels + markierte Abschnitte ansehen (seit v1.7.0)

Rein lesend, 1:1-Port der Anzeige-Funktionen aus `data/TripGeoMath.kt` der App (Bearbeiten selbst
gibt es seit v2.0.0 nur noch dort, siehe oben - `#trip-detail-segments` etc. zeigen nur an, was die
App in `labels`/`segmentMarksJson` abgelegt hat). `openTripDetail()` zeigt Fahrt-Labels
(`labelList()`/`labelIcon()`/`labelColor()` – Fähre blau/Pause bernstein/Nacht indigo/sonst türkis,
exakt dieselben Hex-Werte wie `labelColor()` in `data/TripGeoMath.kt`) als Badges, `renderRouteLine()`
zeichnet zusätzlich je markiertem Abschnitt eine gestrichelte `L.polyline` in dessen Farbe
(`renderSegmentMarkLines()`), `#trip-detail-segments` listet pro Abschnitt eine eigene Distanz/Dauer/
Ø-/Höchstgeschwindigkeit (`computeSegmentStats()`, spiegelt `Trip.segmentStats()`) – unabhängig von
den Gesamt-Fahrt-Werten.

## Datums-Überschriften in der Fahrtenliste (seit v2.1.0)

Nur im Fahrten-Tab (`currentTab === "fahrten"`), NICHT in der kompakten "Letzte Fahrten"-Vorschau
auf dem Home-Tab (dort weiterhin nur die neuesten 5 Einträge ohne Überschriften) - `renderTripList()`
bekam dafür einen zweiten Parameter `showDateHeaders` (Default `false`, damit der Home-Aufruf
unverändert bleibt), `renderTab()`s Fahrten-Tab-Zweig ruft `renderTripList(entries, true)`.

Da `entries` (aus `buildTripListEntries()`) bereits absteigend nach `sortTimestamp` sortiert ist,
reicht ein einfacher Kalendertag-Vergleich mit dem vorherigen Eintrag während des Durchlaufs
(`localDayKey()` - über lokale Jahr/Monat/Tag-Komponenten, bewusst NICHT `ts / 86400000`, das würde
bei Zeitzonen-Offsets ungleich UTC falsche Tagesgrenzen ziehen) - wechselt der Tag, wird eine
`.trip-list-date-header`-Zeile vor den Eintrag eingefügt. Ein Gruppen-Eintrag zählt dabei zum Tag
seiner NEUESTEN Mitgliedsfahrt (`sortTimestamp`), konsistent mit der bestehenden Sortierung.

`formatDateHeading()` (volles Datum mit Wochentag) ist aus der bisher inline in
`renderTripDetailScreen()` stehenden Formatierung extrahiert - beide Stellen nutzen jetzt dieselbe
Funktion statt eines doppelt gepflegten Format-Strings. Spiegelt `formatTripDateHeading()` +
`withDateHeaders()` in `data/TripGrouping.kt` der App.

## Fahrten gruppieren (seit v1.9.0, seit v2.0.0 nur noch Ansicht)

1:1-Port der Anzeige-Seite von `data/TripGrouping.kt`/`TripGroupDetailScreen.kt`/
`TripGeoMath.kt::buildGroupSpeedSeries()`/`GroupRouteMap.kt` der App. Gruppen anlegen/umbenennen/
löschen sowie Fahrten hinzufügen/entfernen geht seit v2.0.0 nur noch in der App (`TripGroupPickerScreen.kt`)
– hier nur noch Ansicht. `backupData` hat weiterhin ein `groups`-Array (`{id, name}`), Trips ein
`groupId` (nullable, spiegelt `carId`), beides kommt unverändert aus dem Server-Backup.

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
- `#trip-group-screen` (`renderTripGroupScreen()`): Statistik-Kacheln, eine nicht-interaktive
  Kartenvorschau (`renderGroupThumbnailPreview()` - echte Leaflet-Karte mit Kartenkacheln + Route,
  aber `dragging`/`scrollWheelZoom`/etc. alle deaktiviert und zusätzlich `pointer-events: none` per
  CSS, damit sie nicht mit dem Scrollen der Seite kollidiert; seit v1.10.0 KEIN reiner Canvas-Pfad
  mehr, spiegelt jetzt `GroupRouteMap(interactive=false)` der App statt nur `drawRouteThumbnail()`
  zu erweitern), ein Vergrößerungs-Icon darauf öffnet `#trip-group-route-screen` (siehe unten),
  darunter nur noch die Mitgliedsfahrten-Liste (Tap öffnet die normale Fahrt-Detailseite) - seit
  v2.0.0 kein Umbenennen-/Löschen-Button und kein "✕" zum Entfernen mehr, das geht nur noch in der
  App.
- `#trip-group-route-screen` (`renderTripGroupRouteScreen()`) - eigener Screen NUR für die
  interaktive Vollbild-Karte + den Graphen, erreichbar über das Vergrößerungs-Icon oben (ursprünglich
  in v1.9.0 Teil von `#trip-group-screen` selbst, in v1.9.1 ausgelagert: zusammen mit der
  Mitgliedsfahrten-Liste sprengte das sonst die Höhe eines Viewports - spiegelt jetzt
  `TripGroupRouteScreen.kt` der App, die dasselbe schon immer als eigenen Screen hatte).
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
    - **min-height:0-Falle** (v1.9.2): `<canvas>` ist ein "replaced element" mit intrinsischem
      Seitenverhältnis (Standard 300x150 ohne eigene `width`/`height`-Attribute) - als Flex-Kind
      OHNE `min-height: 0` bekommt es eine automatische Mindesthöhe aus Breite/Seitenverhältnis,
      unter die `flex-shrink` nicht schrumpfen darf. Betraf `#speed-graph-canvas` genauso wie
      `#group-graph-canvas` (beide über dieselbe CSS-Regel behoben).

## Echte Zurück-Navigation (seit v1.10.0)

Diese App ist eine Single-Page-App ohne eigenes URL-Routing - ohne Weiteres wäre die Zurück-Taste
des Browsers (bzw. Wischen-zurück auf Mobilgeräten) beim Öffnen eines Screens wirkungslos oder würde
die Seite ganz verlassen. Pendant zu `BackHandler` in der Android-App (`MainActivity.kt`).

`overlayStack` (Array von Render-Funktionen, kein HTML/keine eingefrorenen Objekt-Referenzen) bildet
die aktuell offenen Screens als Stack ab. `pushOverlay(renderFn)` registriert einen
`history.pushState({depth}, "")`-Eintrag UND die Render-Funktion für diese Ebene; der generische
`popstate`-Handler kürzt den Stack anhand von `event.state.depth` und ruft den jetzt obersten
Eintrag erneut auf (oder zeigt "main", wenn der Stack leer ist) - jede Render-Funktion liest ihre
Daten dabei selbst frisch (z.B. Gruppen-Mitgliedschaft direkt aus `backupData.trips`), keine
veralteten Objekt-Referenzen. Aktualisierungen OHNE Navigation (z.B. nach Umbenennen einer Gruppe,
man bleibt auf derselben Ebene) laufen stattdessen über `refreshTopOverlay()` - ersetzt nur die
oberste Stack-Position, ohne einen neuen History-Eintrag zu erzeugen. Alle "Zurück"-Buttons rufen
seitdem einheitlich `history.back()` auf (nicht mehr direkt `showScreen(...)`), damit Button-Klick
und echte Browser-Zurück-Taste garantiert denselben Weg nehmen.

(Der Bearbeiten-Screen hatte hier bis v1.10.x einen Sonderfall für die "ungespeicherte Änderungen"-
Rückfrage beim Verlassen - mit dem Bearbeiten-Screen selbst in v2.0.0 entfernt, siehe oben.)

## Versionierung

Seit 2026-08-05 einheitlich über alle drei Projekte (App, Backend, Web):

- **Semantic Versioning** (`MAJOR.MINOR.PATCH`) – `<meta name="app-version">` in `index.html` ist
  die einzige Quelle der Wahrheit (kein Build-Step, der eine Konstante automatisch einsetzen könnte),
  `js/app.js` liest sie von dort und zeigt sie unter "Konto / Settings" an
- **MAJOR**: Breaking Change am Backup-JSON-Format/Verschlüsselungsschema (betrifft dann zwangsläufig
  auch App + Backend) - **oder** eine ebenso grundlegende Verhaltensänderung dieser Seite selbst
  (Ausnahme bisher nur v2.0.0: Entfernung des kompletten Schreibpfads, siehe oben - kein
  Formatbruch, aber für den Nutzer sichtbar mehrere Features weg)
- **MINOR**: neues Feature, abwärtskompatibel
- **PATCH**: Bugfix, kein Verhaltensunterschied
- Bei jedem Bump: **beide** Stellen ändern (Meta-Tag UND `CHANGELOG.md`), Git-Tag `vX.Y.Z` setzen,
  `git push --tags`
- Releases aktuell **manuell** per `gh release create vX.Y.Z --notes-file CHANGELOG.md` – kein
  CI/CD dafür eingerichtet
- Repo: `github.com/Lenrock-03/drivetrack-web`
