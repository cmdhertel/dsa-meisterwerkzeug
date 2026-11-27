# DSA Meisterwerkzeug

[![CI](https://github.com/cmdhertel/dsa-meisterwerkzeug/actions/workflows/ci.yml/badge.svg)](https://github.com/cmdhertel/dsa-meisterwerkzeug/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Ein [Obsidian](https://obsidian.md)-Plugin für Spielleiter:innen von **Das Schwarze Auge 5 (DSA5)**: Regelwerk-Engine, Kampf-Cockpit, Proben, Magie, aventurischer Kalender und eine Sitzungsregie – direkt in deinem Vault.

*English: an Obsidian plugin for game masters of the German tabletop RPG "The Dark Eye" 5th edition. The UI is in German.*

> **Inoffizielles Fanprojekt.** „Das Schwarze Auge“ ist eine eingetragene Marke von Ulisses Spiele GmbH. Dieses Plugin steht in keiner Verbindung zu Ulisses und enthält keine Regeltexte, Bestiarien oder Heldendaten des Verlags. Du brauchst die Regelwerke weiterhin selbst.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Kampf-Cockpit** | Initiative, LeP/AsP/KaP, Zustände und Effekte, Angriff/Parade/Ausweichen, optionale Trefferzonen (Fokusregel). Kompakt-Ansicht für die Seitenleiste, Detail-Ansicht im Vollbild. |
| **Begegnungen** | `dsa-kampf`-Codeblöcke in Notizen, Begegnungs-Builder mit Schwierigkeitsabschätzung, Kampf aus Notiz laden. |
| **Bestiarium** | Liest Kreaturen aus einem Ordner deines Vaults sowie NSCs mit ```` ```statblock ````-Block. |
| **Heldenimport** | Importiert Helden als `.dsahero.json` (Heldenschmiede-Export) und legt bereinigte Datenkopien sowie Spielwerte-Blöcke an. |
| **Proben** | Einzel-, Gruppen-, Sammel- und Gruppensammelproben mit Talentsuche, Modifikatoren und Patzer-Handling. |
| **Magie** | Zauber und Liturgien wirken (Probe, Kosten, Ergebnis) auf Basis von Regelnotizen in deinem Vault. |
| **Aventurischer Kalender** | Datum, Mondphase, Jahreszeit, Feiertage, Wetter, Rast und Datumswechsel. |
| **Sitzungsregie** | Szenen, Mitschrift (automatisch), offene Geheimnisse aus früheren Sessions, Schnellnotizen, Spielerübersicht. |
| **Spielerbildschirm** | Zeigt den Kampf über das Plugin „TTRPG Tools – Player Screen“ (optional) im aventurischen oder schlichten Stil. |

Alle Befehle findest du in der Befehlspalette (`Strg/Cmd + P`) unter Namen mit Bereichs-Präfix wie *Kampf-Cockpit: Öffnen*, *Proben: Probe würfeln*, *Magie: Zauber wirken*, *Kalender: Aventurischen Kalender öffnen* oder *Sitzungsregie: Öffnen*.

## Installation

### Über die Community-Plugins

Sobald das Plugin im Obsidian-Verzeichnis freigeschaltet ist: *Einstellungen → Community-Plugins → Durchsuchen*, nach „DSA Meisterwerkzeug“ suchen, installieren und aktivieren.

### Manuell

1. Lade `main.js`, `manifest.json` und `styles.css` aus dem [neuesten Release](https://github.com/cmdhertel/dsa-meisterwerkzeug/releases/latest) herunter.
2. Lege sie in `<Vault>/.obsidian/plugins/dsa-meisterwerkzeug/` ab.
3. Aktiviere das Plugin unter *Einstellungen → Community-Plugins*.

### Mit BRAT

Installiere [BRAT](https://github.com/TfTHacker/obsidian42-brat) und füge `cmdhertel/dsa-meisterwerkzeug` als Beta-Plugin hinzu.

## Einrichtung

Das Plugin braucht keine bestimmte Vault-Struktur. Unter *Einstellungen → DSA Meisterwerkzeug* legst du fest, wo Bestiarium, Kampagnen, Zauber, Liturgien und Helden liegen. Notizen erkennt es am Frontmatter-Feld `typ` (`kampagne`, `session`, `szene`, `nsc`, `sc` …).

**Welche Felder und Formate das Plugin liest, steht mit Beispielen in [docs/VAULT.md](docs/VAULT.md).**

## Entwicklung

```bash
npm ci
npm test          # Vitest
npm run typecheck
npm run build     # erzeugt main.js im Repo-Root
```

Zum direkten Bauen in einen Vault: `OBSIDIAN_PLUGIN_DIR=<Vault>/.obsidian/plugins/dsa-meisterwerkzeug npm run dev` (Watch-Modus). Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Mitmachen

Fehler und Wünsche gern als [Issue](https://github.com/cmdhertel/dsa-meisterwerkzeug/issues). Bitte keine urheberrechtlich geschützten Regeltexte posten.

## Lizenz

[MIT](LICENSE) – gilt für den Code dieses Plugins, nicht für DSA-Inhalte von Ulisses Spiele.
