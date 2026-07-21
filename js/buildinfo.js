// Auto-generiert von build.js — nicht manuell bearbeiten!
export const BUILD      = '0.5';
export const BUILD_HASH = '550a420';

export const CHANGELOG = [
  {
    "version": "0.5",
    "date": "21.07.2026",
    "changes": [
      "Rabatte werden konsequenter erkannt: Positionsrabatte fließen in den Artikelpreis ein und werden als „inkl. … Rabatt\" an der Position angezeigt; Gesamtrabatte werden als eigene Position geführt",
      "Auswertung mit Zwischensummen: je Kategorie zusätzlich eine „… gesamt\"-Zeile; bei Sonstiges stehen die Artikelnamen in Klammern dabei",
      "Gelernte Regeln matchen jetzt unscharf (z.B. „Puddingprotein\" trifft „Proteinpudding\") statt nur bei exaktem Wortlaut",
      "Regeln merken sich alle bisherigen Zuordnungen als Wahrscheinlichkeit (z.B. 81 % nur Tom) — die häufigste wird vorausgewählt und die Verteilung als Begründung an der Position angezeigt"
    ]
  },
  {
    "version": "0.4",
    "date": "21.07.2026",
    "changes": [
      "Startseite zeigt das verbleibende API-Guthaben (in den Einstellungen setzbar) und schätzt anhand der letzten Analysen, für wie viele Bons es noch reicht"
    ]
  },
  {
    "version": "0.3",
    "date": "21.07.2026",
    "changes": [
      "Jeder per KI analysierte Bon zeigt jetzt die API-Kosten der Analyse (in Bon-Liste, Auswertung und als Monatssumme)"
    ]
  },
  {
    "version": "0.2",
    "date": "21.07.2026",
    "changes": [
      "Einstellungen-Icon durch ein echtes Zahnrad ersetzt (sah vorher aus wie eine Sonne)"
    ]
  },
  {
    "version": "0.1",
    "date": "21.07.2026",
    "changes": [
      "Erste Version: Bon-Foto/PDF-Analyse per Claude-KI (Positionen, Rabatte, Pfand, Leergut)",
      "Zuordnung pro Position: Tom / Tara / 50:50 / beliebige Prozente, Kategorien wählbar",
      "Auswertungstabelle pro Bon und Monat (einzeln/teilen je Kategorie), kopierbar für Excel",
      "Mitlernende Zuordnung: bestätigte Bons werden zu Regeln, die künftige Bons vorbelegen",
      "KI-Assistent mit Text- und Spracheingabe zum Live-Umkonfigurieren (Personen, Kategorien, Regeln)",
      "PWA mit Offline-Shell, Homescreen-Installation, Update-Mechanik und JSON-Backup"
    ]
  }
];
