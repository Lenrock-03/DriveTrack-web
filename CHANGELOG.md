# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/), Versionierung nach
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

Die Versionsnummer steht als einzige Quelle der Wahrheit im `<meta name="app-version">`-Tag in
`index.html` (kein Build-Step, der eine Konstante automatisch einsetzen könnte) und wird zusätzlich
unten in "Konto / Settings" angezeigt.

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
