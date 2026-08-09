# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/), Versionierung nach
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

Die Versionsnummer steht als einzige Quelle der Wahrheit im `<meta name="app-version">`-Tag in
`index.html` (kein Build-Step, der eine Konstante automatisch einsetzen könnte) und wird zusätzlich
unten in "Konto / Settings" angezeigt.

## [1.9.2] - 2026-08-09

### Behoben
- **Geschwindigkeits-Graph war in ALLEN Kartenansichten nur zum Teil sichtbar** (Fahrt-Detail UND
  die neue Gruppen-Route) - Ursache: `<canvas>`-Elemente sind "replaced elements" mit einem
  intrinsischen Seitenverhältnis (Standard 300x150 ohne eigene `width`/`height`-Attribute). Als
  Flex-Kind bekommt ein solches Element ohne `min-height: 0` eine automatische Mindesthöhe aus
  Breite/Seitenverhältnis, unter die `flex-shrink` nicht schrumpfen darf - der Graph-Canvas wurde
  dadurch (deutlich) höher gerendert, als sein 220px-Abschnitt vorsah, nur der obere Teil blieb
  sichtbar. `min-height: 0` auf `#speed-graph-canvas`/`#group-graph-canvas` behebt das.

## [1.9.1] - 2026-08-09

### Behoben
- **Gruppen-Detailseite zeigte fälschlich die volle interaktive Karte + den kombinierten
  Geschwindigkeits-Graph direkt in der normalen Ansicht** statt wie in der App nur eine kleine,
  statische Vorschau. Zusammen mit der Mitgliedsfahrten-Liste sprengte das die Höhe eines
  Viewports, wodurch der Karten-Container (`flex: 1`, einziges Element mit `min-height: 0`) auf
  0px zusammengedrückt wurde - die Karte war dadurch komplett unsichtbar. Jetzt eine statische
  Canvas-Vorschau mit Vergrößerungs-Icon, das Karte + Graph in einem eigenen Screen öffnet -
  spiegelt jetzt korrekt `TripGroupDetailScreen.kt`/`TripGroupRouteScreen.kt` der App.

## [1.9.0] - 2026-08-09

### Hinzugefügt
- **Fahrten gruppieren** – 1:1-Port der App-Funktion (Version 0.13.0). "📁+"-Button neben "Letzte
  Fahrten:" öffnet eine Checkliste zum Erstellen einer neuen Gruppe (Name + Fahrtenauswahl); eine
  Gruppe erscheint danach als EIN zusammengefasster Eintrag in der Fahrtenliste (kombinierte
  Mini-Routenkarte statt Einzel-Thumbnail, "📁 Gruppe"-Hinweis unter dem Namen) statt einzeln.
  - Gruppen-Detailseite: Gesamt-Statistik über alle Mitgliedsfahrten, Liste der einzelnen Fahrten
    (Klick öffnet die normale Fahrt-Detailseite, "✕" entfernt nur aus der Gruppe, löscht die Fahrt
    nicht), "Fahrten hinzufügen" (Fahrten aus einer ANDEREN Gruppe zeigen dort ein Badge - Auswahl
    verschiebt sie, da eine Fahrt nur in einer Gruppe sein kann), "Gruppe löschen" (Mitgliedsfahrten
    bleiben erhalten). Umbenennen über einen Stift-Button (nutzt `prompt()`, kein eigenes Modal-
    System in dieser App).
  - Kombinierte Routenkarte über alle Mitgliedsfahrten (inkl. Umschalter Standard-/
    Geschwindigkeitsfarbe + Legende, wie bei einer einzelnen Fahrt) und ein kombinierter
    Geschwindigkeits-Graph darunter. Die Geschwindigkeit wird dabei NIE über die Nahtstelle
    zwischen zwei Fahrten hinweg berechnet (keine "Teleport"-Ausreißer zwischen dem Ziel der einen
    und dem Start der nächsten Fahrt).
- Server-Backup um Gruppen erweitert (additiv, alte Backups ohne Gruppen bleiben importierbar) -
  synchronisiert sich über alle Geräte wie Fahrten/Autos auch.

## [1.8.1] - 2026-08-09

### Behoben
- **Konfliktsicherer Push zeigte Bearbeitungen von anderen Geräten nicht an**: der Merge in
  `pushBackupConflictSafe()` nutzte bisher `mergeBackupDataAdditive()` (rein additiv - fügt nur
  komplett neue Fahrten hinzu, überspringt bekannte als "Duplikat"). Wurde also z. B. auf dem
  Handy ein Label an einer schon bekannten Fahrt geändert, hat ein anschließendes Speichern auf der
  Web-App diese Änderung beim Konflikt-Merge nie übernommen. Umbenannt/umgebaut zu
  `mergeBackupDataOverwrite()` (überschreibt bekannte Fahrten mit dem neueren Stand statt sie zu
  überspringen - dieselbe Logik wie schon beim Versionsverlauf-Wiederherstellen, jetzt geteilt).
- "🔄 Aktualisieren" zeigt jetzt kurz "✓ Aktualisiert" als Bestätigung statt ohne jede sichtbare
  Rückmeldung zu wirken.

## [1.8.0] - 2026-08-09

### Hinzugefügt
- **"🔄 Aktualisieren"-Button** in der Kopfzeile: lädt sofort neu vom Server, ohne erst in die
  Einstellungen zu müssen - Pendant zum neuen Runterziehen-Gesture in der Android-App (0.12.0).

## [1.7.0] - 2026-08-09

### Hinzugefügt
- **Fahrten bearbeiten** – die Web-App war bisher bewusst rein lesend, das ändert sich hiermit
  erstmals: neuer "Bearbeiten"-Button auf der Fahrt-Detailseite, 1:1 an `TripEditScreen.kt` der
  Android-App angelehnt (App-Versionen 0.8.0–0.11.0):
  - **Zuschneiden**: Anfang bis Punkt A abschneiden, Punkt B bis Ende abschneiden, oder A–B als
    Pause aus der Mitte entfernen (destruktiv – Punkte werden endgültig entfernt). Änderungen
    landen zuerst in einer einsehbaren Liste, werden erst nach "Änderungen anwenden" +
    Bestätigung wirklich übernommen. Die Gesamtdauer bleibt beim Pause-Entfernen unverändert
    (echte Uhrzeiten) – nur die Fahrzeit (und Ø-Geschwindigkeit) sinkt entsprechend.
  - **Markieren**: Fahrt-Labels (⛴ Fähre, ☕ Pause gemacht, 🌙 Nachtfahrt oder eigener Text) sowie
    markierte Streckenabschnitte mit eigener Statistik. Labels/Markierungen werden lokal
    entworfen und erst beim Verlassen der Seite gespeichert (Rückfrage bei ungespeicherten
    Änderungen).
  - Nach dem Speichern sofort auf der Detailseite sichtbar.
- **Markierte Abschnitte ansehen**: Fahrt-Detailseite zeigt Labels als Badges, markierte
  Streckenabschnitte als gestrichelte, je nach Typ farbige Linie auf der Karte (Fähre blau, Pause
  bernstein, Nachtfahrt indigo) sowie eine eigene Distanz-/Dauer-/Geschwindigkeits-Statistik pro
  Abschnitt – unabhängig vom Bearbeiten-Feature, rein anzeigend.
- **Versionsverlauf** in den Einstellungen: jede zuvor gesicherte Server-Version bleibt für immer
  abrufbar, antippen setzt Fahrten mit übereinstimmender Start-/Endzeit gezielt auf diesen Stand
  zurück – das Sicherheitsnetz bei Synchronisierungskonflikten mit der App.
- **Konfliktsicherer Schreibpfad**: vor jedem Speichern wird erst geprüft, ob der Server
  inzwischen eine dieser Sitzung unbekannte, neuere Version hat (z. B. von der Android-App
  gepusht) – falls ja, wird sie erst additiv gemergt, bevor der eigene Stand hochgeladen wird.
  Nichts geht dabei verloren, jede Version bleibt in der Backup-Historie erhalten.

## [1.6.0] - 2026-08-06

### Geändert
- Einstellungen komplett neu gestaltet: Gruppen (👤 Konto, 🔄 Daten, ℹ️ Über) statt der bisherigen
  4 lose gestapelten Einträge in wiederverwendeter Auth-Formular-Optik. Konto zeigt jetzt
  Benutzername UND E-Mail als Kacheln (E-Mail wurde bei der Registrierung zwar erfasst, aber nie
  angezeigt – erforderte einen kleinen Backend-Fix, siehe `drivetrack-api` v1.1.1).
- "Daten neu laden" zeigt jetzt eine kurze eingeblendete Status-Meldung statt eines nativen
  `alert()` (war die einzige Stelle der ganzen App, die alert() genutzt hat).
- "Abmelden" hat jetzt eine leichte Zwei-Klick-Bestätigung ("Wirklich abmelden?") statt sofortigem
  Logout.

## [1.5.6] - 2026-08-06

### Behoben
- Der letzte Fix (1.5.5) kappte GPS-Ausreißer auf `trip.maxSpeedKmh` – bei mehreren aufeinander-
  folgenden Ausreißer-Punkten (z. B. beim Einrasten des GPS-Fixes zu Fahrtbeginn) erzeugte das
  einen verdächtig glatten Plateau exakt auf diesem Wert statt das Problem zu beheben, und
  `trip.maxSpeedKmh` selbst kann durch dasselbe GPS-Problem verfälscht sein. Jetzt: Median-Filter
  von 5 auf 9 Punkte verbreitert (hält deutlich mehr aufeinanderfolgende Ausreißer ab, verifiziert
  per Test), Kappung nutzt eine fahrtunabhängige, für Autos generell unrealistische Grenze
  (260 km/h) statt `trip.maxSpeedKmh`.

## [1.5.5] - 2026-08-06

### Behoben
- Route-Hover/Route-Farbe konnten bei GPS-Aussetzern über mehrere aufeinanderfolgende Punkte
  (nicht nur einen einzelnen) absurd hohe Geschwindigkeiten anzeigen (z. B. "451 km/h" bei einer
  Fahrt mit tatsächlich 140 km/h Maximum) – der 5-Punkte-Median-Filter allein reicht dafür nicht
  immer aus. Zusätzliche harte Kappung auf `trip.maxSpeedKmh` (GPS-Chip-Wert, robuster) ergänzt.

## [1.5.4] - 2026-08-06

### Behoben
- Legende der Geschwindigkeits-Farbskala: "130"- und "180+ km/h"-Label überlappten sich sichtbar
  (verschmolzener/unlesbarer Text), weil der "130"-Tick bei ~72 % sitzt und der lange Endtext
  "180+ km/h" zu breit für den schmalen Legende-Kasten war. Endtext auf "180+" gekürzt, Kasten
  etwas breiter (150px → 175px).

## [1.5.3] - 2026-08-06

### Behoben
- Legende der Geschwindigkeits-Farbskala: der "130"-Tick saß per Flexbox/`space-between` in der
  Mitte des Balkens, obwohl 130 tatsächlich bei 130/180 ≈ 72 % des Gradienten liegt – Farbe an der
  Tick-Position stimmte dadurch nicht mit dem Label überein. Jetzt an der echten Position platziert.

## [1.5.2] - 2026-08-06

### Geändert
- Geschwindigkeits-Farbskala der Route zweistufig statt einer einzelnen Rampe: 0–130 km/h weiterhin
  grün→rot (130 = Richtgeschwindigkeit Autobahn), 130–180 km/h zusätzlich rot→lila zur klaren
  Abhebung sehr hoher Geschwindigkeiten (vorher 130–250, war spürbar zu träge). Legende angepasst.

## [1.5.1] - 2026-08-06

### Geändert
- Geschwindigkeits-Farbskala der Route ist jetzt fest (0–150 km/h, grün→rot) statt relativ zur
  jeweiligen Fahrt – dieselbe Farbe bedeutet dadurch bei jeder Fahrt dieselbe Geschwindigkeit,
  vergleichbar zwischen z. B. Stadt- und Autobahnfahrten. Dazu eine Legende unten links auf der
  Karte, solange der Geschwindigkeits-Modus aktiv ist.

## [1.5.0] - 2026-08-06

### Hinzugefügt
- Routen-Linie in der Fahrt-Detail-Karte kann jetzt nach Geschwindigkeit eingefärbt werden
  (grün = langsam, rot = schnell) statt der einheitlichen orangenen Farbe – Auswahlmenü oben
  rechts auf der Karte, spiegelt dieselbe Funktion in der App (0.4.0). Bei sehr langen Fahrten
  werden die Segmente auf max. 1500 heruntergesampelt, die Karte nutzt jetzt außerdem Leaflets
  Canvas-Renderer (`preferCanvas`) statt SVG für flüssigeres Rendering vieler Segmente. Präferenz
  bleibt über `localStorage` erhalten.

## [1.4.1] - 2026-08-06

### Behoben
- Karte wurde beim Ein-/Ausblenden des Graphen nicht wirklich größer/kleiner: Leaflet passt die
  Kartengröße nicht automatisch an, nur weil der Container per CSS wächst - `invalidateSize()`
  nach dem Umschalten ergänzt, damit die Karte den frei werdenden Platz tatsächlich ausfüllt.

## [1.4.0] - 2026-08-06

### Hinzugefügt
- Geschwindigkeits-Graph in der Fahrt-Detail-Ansicht lässt sich über einen Button in der
  Kopfzeile ein-/ausblenden ("Ausblenden"/"Anzeigen"), die Karte darüber nutzt beim Ausblenden
  automatisch den frei werdenden Platz. Präferenz bleibt über `localStorage` erhalten.

## [1.3.0] - 2026-08-06

### Hinzugefügt
- Hover-Tooltip auf der Routen-Linie in der Fahrt-Detail-Karte: zeigt Uhrzeit/km-Stand/
  Geschwindigkeit des nächstgelegenen Punkts, dieselbe Serie wie der Geschwindigkeits-Graph
  darunter (gemeinsam über neue `getTripSpeedSeries()`-Hilfsfunktion)

## [1.2.3] - 2026-08-06

### Geändert
- Geschwindigkeits-Graph: Cursor/Marker folgt jetzt der Mausposition schon beim reinen Hovern
  (Desktop), nicht mehr erst beim Klicken+Ziehen. Auf Touch-Geräten bleibt es beim bewährten
  Ziehen, da es dort ohne Berührung kein Hover gibt.

## [1.2.2] - 2026-08-06

### Geändert
- Dauer einer Fahrt (Fahrtenliste + Detail-Ansicht) wird ab über 60 Minuten als "Xh Ym" statt in
  Minuten angezeigt, spiegelt `Trip.durationFormatted` aus der App 1:1

## [1.2.1] - 2026-08-05

### Hinzugefügt
- Favicon (`favicon.svg`) – spiegelt das Android-App-Icon 1:1 (weißes Auto auf `#FF7A1A`)

## [1.2.0] - 2026-08-05

### Hinzugefügt
- Automatisches Neuladen des Backups alle 60s im Hintergrund + sofort beim Zurückwechseln in den
  Tab, passend zum automatischen Sync der App (App 0.3.0). Nur aktiv wenn eingeloggt+entsperrt und
  nicht gerade in der Fahrt-Detail-/Settings-Ansicht.

## [1.1.3] - 2026-08-05

### Behoben
- Geschwindigkeits-Graph wirkte durch GPS-Ausreißer unrealistisch (isolierte Nadel-Spitzen statt
  echtem Verlauf): Median-Filter (5-Punkte-Fenster) über die Geschwindigkeit ergänzt, entfernt
  einzelne Ausreißer, ohne echte Beschleunigungs-/Bremstrends zu verlieren
- Fahrt-Detail-Ansicht konnte bei kurzen Browserfenstern über den sichtbaren Bereich hinausragen
  (Graph unten abgeschnitten) - Layout wurde korrigiert (Karte schrumpft jetzt richtig), zusätzlich
  Scroll-Sicherheitsnetz für sehr kurze Fenster

### Hinzugefügt
- Achsenbeschriftung am Geschwindigkeits-Graph (Gitterlinien + km/h-Werte), damit sich die Skala
  ablesen lässt

## [1.1.2] - 2026-08-05

### Behoben
- Geschwindigkeits-Graph: einzelne GPS-Ausreißer (kurzer ungenauer Fix, rechnerisch absurd hohe
  Distanz/Zeit-Geschwindigkeit) stauchten die ganze Skala, sodass der Rest der Fahrt am unteren
  Rand "klebte". Skala nutzt jetzt `trip.maxSpeedKmh` (GPS-Chip, Doppler-basiert, robuster) statt
  des eigenen Segment-Maximums; einzelne Ausreißer werden beim Zeichnen oben gekappt.

## [1.1.1] - 2026-08-05

### Behoben
- Geschwindigkeits-Graph blieb bei Fahrten mit vielen tausend GPS-Punkten komplett leer (auch die
  kleinen Routen-Vorschaubilder in der Fahrtenliste und die Hauptkarte waren betroffen): `Math.max(
  ...array)` / `array.push(...array)` sprengen bei sehr großen Arrays den JS-Aufrufstack
  (`RangeError`), wodurch die jeweilige Funktion lautlos abbricht, bevor irgendwas gezeichnet wird.
  Ersetzt durch schleifenbasierte Berechnung ohne Argumentzahl-Limit.

## [1.1.0] - 2026-08-05

### Hinzugefügt
- Interaktiver Geschwindigkeits-Graph in der Fahrt-Detail-Ansicht (Canvas, ziehbarer/tippbarer
  Punkt zeigt Uhrzeit/km-Stand/Geschwindigkeit, Marker wandert dabei auf der Karte mit) –
  spiegelt `SpeedGraph` aus der Android-App

## [1.0.0] - 2026-08-05

Erster versionierter Stand der bereits produktiv laufenden Web-App
(`https://drivetrack.kornel-riedl.de`).

### Enthalten
- Login / Registrieren / Passwort vergessen
- Read-only Ansicht des Server-Backups: Home-Dashboard, Fahrtenliste, Kartenansicht (Leaflet),
  Fahrt-Detail
- Ende-zu-Ende-Entschlüsselung im Browser (Web Crypto API), spiegelt `ServerCrypto.kt` der App
