# Vault-Aufbau

Das Plugin arbeitet mit normalen Markdown-Notizen. Es braucht **keine** feste Ordnerstruktur: alle Ordner stellst du unter *Einstellungen → DSA Meisterwerkzeug* ein. Notizen erkennt es an ihrem Frontmatter-Feld `typ`.

## Ordner (Einstellungen)

| Einstellung | Standard | Inhalt |
|---|---|---|
| Bestiarium-Ordner | `DSA/Bestiarium` | Eine Notiz pro Kreatur |
| Kampagnen-Ordner | `DSA/Kampagnen` | Optional: ein Unterordner pro Kampagne |
| Zauber-Ordner | `DSA/Regeln/Zauber` | Eine Regelnotiz pro Zauber |
| Liturgie-Ordner | `DSA/Regeln/Liturgien` | Eine Regelnotiz pro Liturgie |
| Helden-Ordner | `DSA/Helden` | Heldennotizen (`typ: sc`) |
| Helden-Daten-Ordner | `DSA/Helden/_Daten` | Vom Import angelegte `.dsahero.json`-Kopien |
| Schlüssel-Zuordnung | `DSA/Helden/_Daten/heldenschmiede-keys.json` | Wird beim Import angelegt und ergänzt |
| Vorlage für neue Helden | leer (eingebaut) | Optionale Vorlagennotiz |

Fehlende Ordner sind kein Fehler: die jeweilige Funktion findet dann einfach nichts.

Beispielstruktur:

```
DSA/
├── Bestiarium/        Wolf.md, Ork.md …
├── Helden/            Thorwin.md …
│   └── _Daten/        (vom Plugin verwaltet)
├── Kampagnen/
│   └── Die Nebelfurt/
│       ├── Die Nebelfurt.md      typ: kampagne
│       ├── Sessions/Session 1.md  typ: session
│       └── NSC/Brodo.md           typ: nsc
└── Regeln/
    ├── Zauber/        Ignifaxius.md …
    └── Liturgien/     Blendstrahl.md …
```

## Notiztypen (`typ`)

| `typ` | Wofür | Wichtige Felder |
|---|---|---|
| `kampagne` | Kampagne. Erscheint im Kalender und beim Heldenimport. | – |
| `sc` | Spielerheld | `kampagne`, `spieler`, `heldenschmiede_uid` (setzt der Import) |
| `session` | Spielsitzung (Sitzungsregie) | `kampagne`, `datum` (reales Datum, `JJJJ-MM-TT`) |
| `szene`, `kapitel`, `abenteuer` | Szenen und Gliederung einer Session | `teil_von: "[[Session 1]]"`, optional `szenentyp`, `kurz`, `position`, `image` |
| `nsc`, `fraktion` | NSCs. Mit ```` ```statblock ````-Block auch als Gegner nutzbar. | `kurz`, `profession`, `nsc_rolle`, `image` |
| `ort` | Orte (Bühne der Sitzungsregie) | `kurz`, `image` |
| `ereignis` | Ereignis im Kalender | aventurisches Datum (s. u.) |

`kampagne` ist ein Link oder eine Liste von Links, z. B. `kampagne: "[[Die Nebelfurt]]"`.

**Kampagne der aktuellen Notiz:** Der Kalender und die Heldenauswahl richten sich zuerst nach `kampagne` im Frontmatter, sonst nach dem Unterordner im Kampagnen-Ordner.

**Kalender:** `ereignis`, `session`, `szene`, `kapitel` und `abenteuer` erscheinen im Kalender, wenn sie ein aventurisches Datum in `datum_bf`, `datum_aventurisch` oder `aventurisches_datum` haben (z. B. `12. Praios 1040 BF`).

**Sitzungsregie:** Aufgaben (`- [ ]`) unter Überschriften, die mit *Geheimnis* oder *Hinweis* beginnen, gelten als offene Geheimnisse. Ein Abschnitt `## Kurzprofil` in NSC-Notizen wird als Karte angezeigt.

## Bestiarium

Kreaturen-Notizen tragen ihre Werte im Frontmatter (Format ähnlich dem Plugin Fantasy Statblocks):

```yaml
---
name: Wolf
lep: 30            # oder "variabel"
ini: 12+1W6
rs: 1
vw: 6
aktionen: 2
typus: Tier, nicht humanoid
attacks:
  - name: Biss
    desc: "**AT** 12 **PA** 0 **TP** 1W6+2 **RW** kurz"
---
```

Optional: `zauber`, `liturgien`, `asp`, `kap`, Eigenschaften (`mu`, `kl` …), `sk`, `zk`, `groessenkategorie`, `koerperbau`, `rs_zonen`, `ko`.

## Zauber und Liturgien

Eine Notiz pro Zauber oder Liturgie, Werte als fette Aufzählungspunkte:

```markdown
# Ignifaxius

- **Probe:** MU/KL/CH
- **Zauberdauer:** 2 Aktionen
- **Reichweite:** 16 Schritt
- **AsP-Kosten:** 8 AsP
- **Wirkungsdauer:** sofort
- **Zielkategorie:** Lebewesen, Objekte
- **Merkmal:** Elementar
```

Bei Liturgien heißt es `KaP-Kosten` und `Liturgiedauer`. Fehlt eine Regelnotiz, fragt der Dialog die Werte ab und merkt sie sich.

## Helden

Helden kommen per *Held aus JSON importieren* aus einem Heldenschmiede-Export (`*.dsahero.json` irgendwo im Vault). Der Import legt eine Notiz im Helden-Ordner an oder aktualisiert eine bestehende `typ: sc`-Notiz. Die Spielwerte schreibt er in einen markierten Block der Notiz. Aktuelle AsP/KaP stehen in `AsP_aktuell` / `KaP_aktuell`.

Ohne eingestellte Vorlage erzeugt der Import eine schlichte Notiz (`typ: sc`, `kampagne`, `spieler`). Eine eigene Vorlage kann die Platzhalter `<% k.titel %>` und `<% k.kampagne %>` verwenden. Ein führender Templater-Block `<%* … %>` wird entfernt.

## Inline-Befehle in Notizen

| Code | Wirkung |
|---|---|
| `` `probe: Sinnesschärfe +2 \| QS2: Text \| Misslungen: Text` `` | Probe-Knopf |
| `` `zauber: Ignifaxius +2 @Thorwin` `` / `` `liturgie: Blendstrahl` `` | Zauber/Liturgie wirken |
| `` `gruppenprobe: …` `` / `` `sammelprobe: …` `` / `` `gruppensammelprobe: …` `` | Gruppen- und Sammelproben |
| `` `datum: heute` `` (`morgen`, `gestern`) | Aktuelles aventurisches Datum |

## Begegnungen

````markdown
```dsa-kampf
name: Hinterhalt am Fluss
helden: Die Nebelfurt
- 3x Wolf
- 1W6x Ork
- 2x Wegelagerer | LeP 28 | INI 12 | RS 1 | AT 11 | PA 6 | TP 1W6+3
```
````

Gegner werden im Bestiarium und unter den NSCs gesucht. Unbekannte Gegner kannst du mit Werten direkt im Block angeben.
