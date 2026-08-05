# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.
Format angelehnt an [Keep a Changelog](https://keepachangelog.com/), Versionierung nach
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

Die Versionsnummer steht als einzige Quelle der Wahrheit im `<meta name="app-version">`-Tag in
`index.html` (kein Build-Step, der eine Konstante automatisch einsetzen könnte) und wird zusätzlich
unten in "Konto / Settings" angezeigt.

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
