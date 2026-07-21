// Auto-generiert von build.js — nicht manuell bearbeiten!
export const BUILD      = '0.13';
export const BUILD_HASH = '3fa7193';

export const CHANGELOG = [
  {
    "version": "0.13",
    "date": "21.07.2026",
    "changes": [
      "„Verwerfen\" steht jetzt bei JEDEM Bon unten neben Speichern: bei bearbeiteten Bons stellt es den alten Stand wieder her, bei neuen Entwürfen löscht es den Entwurf, und hängen gebliebene Entwürfe werden wieder abgeschlossen"
    ]
  },
  {
    "version": "0.12",
    "date": "21.07.2026",
    "changes": [
      "Prozent-Editor: Regler lassen sich per Schloss sperren — gesperrte Werte bleiben stehen, nur die offenen gleichen sich ab, der letzte offene nimmt automatisch den Rest"
    ]
  },
  {
    "version": "0.11",
    "date": "21.07.2026",
    "changes": [
      "Bearbeiten ohne Risiko: beim Bearbeiten eines ausgewerteten Bons gibt es jetzt „Verwerfen\" — der Bon springt unverändert zur Auswertung zurück",
      "Prozent-Editor: bewegt man einen Regler, gleichen sich die übrigen sofort sichtbar ab (zusammen immer 100 %)"
    ]
  },
  {
    "version": "0.10",
    "date": "21.07.2026",
    "changes": [
      "Startseite aufgeräumt: der Untertitel zeigt nur noch die Personen (Erklärsatz entfernt)"
    ]
  },
  {
    "version": "0.9",
    "date": "21.07.2026",
    "changes": [
      "Original-Fotos/PDFs werden jetzt lokal am Bon gespeichert: „Original ansehen\" im Review und in der Auswertung zeigt jederzeit die Originaldateien zum Nachprüfen",
      "Die Original-Dateien sind im JSON-Backup enthalten (Export/Import) — die Sicherungsdatei wird dadurch entsprechend größer"
    ]
  },
  {
    "version": "0.8",
    "date": "21.07.2026",
    "changes": [
      "Beliebig viele Personen: in den Einstellungen (oder per KI-Chat) Personen hinzufügen und entfernen — Tom & Tara bleiben der Standard",
      "Prozent-Editor mit einem Slider je Person: jede Person lässt sich an jeder Position frei prozentual beteiligen (Regler werden automatisch auf 100 % skaliert)",
      "„teilen\" heißt bei mehr als zwei Personen: exakt gleichmäßig auf alle — auch Pfand und Leergut"
    ]
  },
  {
    "version": "0.7",
    "date": "21.07.2026",
    "changes": [
      "Einen Bon über mehrere Fotos/Seiten einscannen: beim Upload einfach mehrere Dateien auswählen — die KI führt alles zu einem Bon zusammen und erkennt überlappende Positionen an den Übergängen"
    ]
  },
  {
    "version": "0.6",
    "date": "21.07.2026",
    "changes": [
      "Datumsfeld im Bon-Formular passt sich jetzt sauber ins Layout ein (ragte vorher aus dem Bildschirm)",
      "Bearbeiten eines ausgewerteten Bons speichert nur noch lokal („Änderungen speichern\") — komplett kostenlos, keine neue KI-Analyse",
      "Jede KI-Analyse muss jetzt explizit bestätigt werden, mit Kostenschätzung aus deinen letzten Analysen",
      "Neuer Button „Neu analysieren\" am Bon (mit Warnhinweis) für den seltenen Fall, dass die KI wirklich nochmal ranmuss",
      "Kostenhinweis im KI-Chat ergänzt"
    ]
  },
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
