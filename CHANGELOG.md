# Changelog

## 1.0.4 (2026-11-28)

- Release 1.0.3 hatte keine Dateien (`main.js`, `manifest.json`, `styles.css`) angehängt. Der Release-Workflow hängt sie jetzt auch an Releases an, die vorher in der GitHub-Oberfläche angelegt wurden.
- Weitere Hinweise aus dem Review des Plugin-Verzeichnisses behoben (Callbacks ohne Promise-Rückgabe, Spielerbildschirm nutzt `createEl`).

## 1.0.3 (2026-11-28)

- Manifest: Autor ist jetzt „Gian Luca Hertel“.

## 1.0.2 (2026-11-28)

Anpassungen an das Review des Obsidian-Plugin-Verzeichnisses:

- Mindestversion von Obsidian auf 1.7.2 angehoben (`revealLeaf` gibt erst ab dieser Version ein Promise zurück).
- Einstellungen: Unter Obsidian 1.13+ werden sie über die neue Einstellungs-API definiert und sind damit in der Einstellungssuche auffindbar. Ältere Versionen zeigen dieselbe Seite wie bisher.
- „Gefährliche“ Schaltflächen (Schaden, Entfernen, Ersetzen) nutzen ab Obsidian 1.13 den neuen Destructive-Stil.
- Timer und DOM-Aufrufe sind auch in ausgelagerten Fenstern sicher; Fehler in Klick-Handlern werden protokolliert statt verschluckt.
- Spielerbildschirm: Das Lebenszustands-Band hat statt der eingekerbten Enden abgerundete Ecken, die Durchstreichung gefallener Kämpfer nutzt die Standardstärke (bessere CSS-Kompatibilität).
- README: Abschnitt „Datenzugriff und Datenschutz“ (Vault-Durchsuchung, Zwischenablage nur schreibend).
- Releases tragen jetzt GitHub-Attestierungen (Build-Provenienz) für `main.js`, `manifest.json` und `styles.css`.
- Entwicklung: ESLint mit `eslint-plugin-obsidianmd` (`npm run lint`, auch in CI); TypeScript 6; `builtin-modules` entfernt; `npm version` übernimmt auch `package-lock.json`.

## 1.0.1 (2026-11-27)

- Plugin-Beschreibung an die Vorgaben des Obsidian-Plugin-Verzeichnisses angepasst (Aktionssatz, Punkt am Ende).
- README: Installation über die Community-Plugins ergänzt.

## 1.0.0 (2026-11-27)

Erste öffentliche Version. Änderungen gegenüber der internen Vorabversion 0.1.0:

- Alle Vault-Pfade sind jetzt einstellbar: neue Einstellungen für Zauber-, Liturgie- und Kampagnen-Ordner sowie die Heldenvorlage.
- Neutrale Standardordner unter `DSA/` für Neuinstallationen. Bestehende Installationen behalten ihre bisherigen Pfade.
- Heldenimport funktioniert ohne Vorlagennotiz (eingebaute Vorlage) und ohne Kampagnen-Notiz.
- Der Kalender erkennt Kampagnen auch an Notizen mit `typ: kampagne` und am `kampagne`-Feld der geöffneten Notiz.
- Neue Doku zum Vault-Aufbau: `docs/VAULT.md`.

### Allgemein & Einstellungen

- Mindestversion von Obsidian auf 1.5.7 angehoben (Vault-Funktion `getFileByPath`).
- Einstellungen: Abschnittsüberschriften nach Obsidian-Richtlinien; Ordnerpfade werden beim Tippen verzögert gespeichert, normalisiert (z. B. abschließende Schrägstriche entfernt) und Bestiarium bzw. Helden werden sofort neu eingelesen.
- Einstellungen verlinken die Vault-Anleitung (docs/VAULT.md).
- Befehlsnamen einheitlich mit Bereichs-Präfix, z. B. „Kalender: Einen Tag weiter“, „Spielerbildschirm: Kampf zeigen (Aventurisch)“. Tastenkürzel bleiben erhalten.
- Beschreibung im Manifest ergänzt um „(German UI)“.
- Entwicklung: Release-Tags ohne v-Präfix (`.npmrc`); der Talent-Generator bekommt den Pfad zur Regelnotiz als Argument oder über `DSA_TALENT_NOTE`.
- Beispiele in Doku und Tests verwenden neutrale Namen; Tests gegen echte Dateien werden über `DSA_VAULT`, `DSA_HERO_JSON` und `DSA_NPC_NOTE` aktiviert.

### Kampf

- Kampf: Der Zug bleibt bei dem Kämpfer, der ihn hat, wenn Kämpfer entfernt, hinzugefügt oder Initiativewürfe geändert werden. Gespeicherte Kämpfe werden übernommen.
- Kampf: „Fehlende Initiative würfeln“ setzt den Zug nicht mehr auf den ersten Kämpfer zurück.
- Kampf: Doppelte Namen erhalten die kleinste freie Nummer (Wolf, Wolf 2, Wolf 3).
- Kampf: Helden, die bereits im Kampf sind, lassen sich nicht erneut hinzufügen.
- Kampf: Effekt-Chips lassen sich per × entfernen (auch auf Touch-Geräten).
- Kampf: Die Rückgängig-Historie wird nicht mehr in data.json gespeichert (nur für die laufende Sitzung).
- Kampf: Bei LeP 0 oder weniger ist die Verteidigung überall einheitlich blockiert.

### Begegnungen, Bestiarium & Spielerbildschirm

- Begegnungen: „2 Xorn“ wird jetzt als 2 × Xorn erkannt; der Multiplikator muss ein eigenes Wort sein (2x, 2 x, 2×).
- Bestiarium: Statt eines fest eingestellten Ordners „Templates/“ wird jetzt der Ordner des Core-Plugins „Vorlagen“ von der NSC-Suche ausgenommen.
- Begegnungs-Baukasten: Bei doppelten Kreaturnamen gilt überall der erste Eintrag; Trefferlisten sind per Tastatur bedienbar.
- Begegnungen: Der Bestiarium-Katalog wird nur neu aufgebaut, wenn sich das Bestiarium ändert.
- Begegnungen: Tabellen sind auf kleinen Bildschirmen horizontal scrollbar.
- Spielerbildschirm und Stylesheet: keine Inline-Styles mehr, alle CSS-Klassen mit dsa- präfixiert, kein !important.

### Proben & Magie

- Zauber: Eine beschädigte zauber-eigenschaften.json wird nicht mehr überschrieben; es erscheint ein Hinweis.
- Zauber-Dialog: Fehlende Eigenschaftswerte werden nicht mehr vom ersten Attribut übernommen; der Fertigkeitswert (FW) des gewählten Zaubers wird angezeigt.
- Zauber: Der Modifikator akzeptiert Gedankenstrich (–) und Minuszeichen (−) wie ein normales Minus.
- Zauber ohne lesbare Probe-Zeile werden mit Hinweis markiert; die Standardwerte MU/KL/IN bleiben erhalten.
- Proben und Zauber im Text werden ohne Lookbehind-Regex erkannt: Das Plugin lädt wieder auf iOS vor 16.4.
- Gruppen-/Sammelprobe: Bei mehrfach vorkommenden Proben wird das Ergebnis unter der benutzten Probe eingefügt.
- Gruppen-/Sammelprobe: Warnungen bei ignorierten oder leeren Angaben; Eigenschaftswerte müssen als Zahl eingegeben werden.
- Gruppen-/Sammelprobe: Hinweis, wenn der Sammel-Fortschritt nicht gespeichert werden kann; Fortschrittsbalken ohne Inline-Styles.

### Heldenimport

- Heldenimport bricht ab, wenn die Zuordnungsdatei nicht gelesen werden kann, statt sie mit Platzhaltern zu überschreiben.
- Handgeschriebene Namen in der Zuordnungsdatei (z. B. "534": "Feuerball") bleiben beim Import erhalten.
- Heldenimport: Dateinamen-Kollisionen werden unabhängig von Groß-/Kleinschreibung erkannt.
- Erzeugte Notizen beginnen nicht mehr mit einem Punkt (keine versteckten Notizen).
- Kampagnen-Notizen werden beim Heldenimport unabhängig von der Groß-/Kleinschreibung von `typ` erkannt.
- Warnungen im Import-Dialog erscheinen in der Warnfarbe des Themes.

### Kalender & Rast

- Kalender: Eine beschädigte calendar.json wird nicht mehr überschrieben. Sie wird als calendar.json.bak gesichert und beim Start gemeldet.
- Kalender: Befehle und Dateiöffnung warten jetzt auf das Laden des Kalenders.
- Rast: Eine Änderung des Modifikators würfelt nur noch den betroffenen Helden neu; manuelle Korrekturen bleiben erhalten.
- Kalender: Die Kampagnenliste wird zwischengespeichert; die Ansicht aktualisiert sich bei Notizänderungen gebündelt.
- Kalender: Auf Touch-Geräten lässt sich ein Tag über „Als heutiges Datum setzen“ im Tagesfenster setzen; Tage und Navigation sind per Tastatur bedienbar.

### Sitzungsregie

- Sitzungsregie: Eine beschädigte regie.json wird nicht mehr überschrieben. Die Datei wird als regie.json.bak gesichert, es erscheint ein Hinweis, und es wird nicht gespeichert, bis die Datei repariert ist.
- Sitzungsregie: Wird eine Szene manuell auf „läuft“ gesetzt, während eine andere läuft, stoppt die Zeit der bisherigen Szene (keine doppelte Zeitzählung mehr).
- Sitzungsregie: Ungespeicherte Änderungen beim Bearbeiten eines Mitschrift-Eintrags gehen nicht mehr verloren, wenn während des Bearbeitens automatisch Einträge hinzukommen.
- Sitzungsregie: Weniger Neuberechnungen bei jedem Speichern im Vault (Metadaten-Events entprellt, Szenenlisten zwischengespeichert).
- Sitzungsregie: Die Schnellerfassung zeigt einen Hinweis, wenn keine Session gewählt ist.
- Sitzungsregie: Als Hinweise gelten nur noch Aufgaben unter Überschriften mit „Geheimnis“ oder „Hinweis“, nicht mehr alle Aufgaben der Szene.

## 0.1.0

Interne Vorabversion (nicht veröffentlicht): rules engine, Kampf-Cockpit, Begegnungen, Bestiarium-Adapter, Heldenimport, Proben (Einzel/Gruppe/Sammel), Magie, aventurischer Kalender, Sitzungsregie, Spielerbildschirm.
