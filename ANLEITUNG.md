# Leonida Atlas – Installation auf Tablet und Smartphone

Die App ist eine installierbare Web-App (PWA). Sie braucht einmalig eine HTTPS-Adresse,
danach läuft sie auf dem Tablet wie eine normale App – mit eigenem Symbol, Vollbild und Offline-Betrieb.

## 1. Kostenlos online stellen (GitHub Pages, ca. 5 Minuten)
1. Auf github.com ein kostenloses Konto anlegen und ein neues, öffentliches Repository erstellen, z. B. `leonida-atlas`.
2. „Add file“ → „Upload files“ → den gesamten Inhalt dieses Ordners hineinziehen (inklusive Ordner `icons`) → „Commit changes“.
3. Im Repository: Settings → Pages → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → Save.
4. Nach etwa einer Minute ist die App erreichbar unter `https://DEINNAME.github.io/leonida-atlas/`.

## 2. Auf dem Redmi Pad 2 installieren
1. Die Adresse in **Google Chrome** öffnen (nicht im Mi-Browser).
2. Menü ⋮ → **„App installieren“** (bzw. „Zum Startbildschirm hinzufügen“ → „Installieren“).
3. Xiaomi-Besonderheit: Erscheint kein Symbol, unter Einstellungen → Apps → Chrome → Weitere Berechtigungen
   „Verknüpfungen auf dem Startbildschirm erstellen“ erlauben und Schritt 2 wiederholen.
4. Für Hintergrund-Aktualisierungen: Einstellungen → Apps → Chrome → Akkusparmodus → „Keine Einschränkungen“.

## Optional: echte APK
Auf pwabuilder.com die GitHub-Pages-Adresse eingeben → „Package for stores“ → Android → herunterladen.
Die APK lässt sich auf dem Tablet installieren, nachdem „Installation aus unbekannten Quellen“ für den Dateimanager erlaubt wurde.

## Sprachen
Deutsch, Englisch, Spanisch, Französisch, Japanisch und Arabisch (mit gespiegeltem Layout).
Beim ersten Start übernimmt die App die Gerätesprache; ändern lässt sie sich jederzeit über den Globus-Knopf oben rechts.
Die Sprache gilt für Oberfläche, eingebautes Grundwissen und die Wikipedia-Quelle. Das GTA-Wiki und die Reddit-News gibt es nur auf Englisch.

## Smartphone
Dieselbe Adresse funktioniert auch auf dem Handy: in Chrome öffnen und „App installieren“ wählen.
Auf schmalen Bildschirmen wandert die Navigation nach unten, Bereiche werden als wischbare Leiste angezeigt.

## Aktualisierung der Inhalte
- Beim Öffnen und alle 15 Minuten (Release-Phase) bzw. stündlich, solange die App offen ist.
- Im Hintergrund, wenn die App installiert ist (Android entscheidet über den Zeitpunkt).
- Jederzeit über den Knopf **„Aktualisieren“** oben rechts.

## Dateien
index.html (Oberfläche) · app.js (App-Logik) · data.js (Quellen & Speicher) · i18n.js (Übersetzungen) · seed.js (Grundwissen in 6 Sprachen)
sw.js (Offline & Hintergrund) · manifest.webmanifest · icons/

App-Updates: Geänderte Dateien einfach erneut hochladen und in sw.js die Zeile `VERSION = 'la-v2'` hochzählen.
Die App meldet dann „Eine neue Version der App ist bereit“.
