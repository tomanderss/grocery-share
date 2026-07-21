// claude.js — Anbindung an die Claude-API (direkt aus dem Browser, raw fetch —
// kein SDK/Bundler in dieser App). Der API-Key kommt aus den Einstellungen und
// verlässt das Gerät nur Richtung api.anthropic.com. Der Header
// 'anthropic-dangerous-direct-browser-access' schaltet CORS für Browser-Aufrufe
// frei (bewusste Entscheidung: private Einzelnutzer-App mit eigenem Key).
//
// Zwei Funktionen:
//   analyzeReceipt(...)  — Bon-Bild/PDF → strukturierte Positionsliste
//   assistantChat(...)   — Konfigurations-Chat → { reply, actions[] }
// Beide nutzen Structured Outputs (output_config.format json_schema), damit die
// Antwort garantiert parsebares JSON ist.

import { log } from './debuglog.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude({ apiKey, body }) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    log('api', 'network error', { message: e?.message });
    throw new Error('Keine Verbindung zur Claude-API. Bist du online?');
  }
  const tookMs = Date.now() - t0;
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    log('api', `http ${res.status}`, { tookMs, detail: detail.slice(0, 200) });
    if (res.status === 401) throw new Error('API-Key ungültig. Bitte in den Einstellungen prüfen.');
    if (res.status === 429) throw new Error('Rate-Limit erreicht. Bitte kurz warten und erneut versuchen.');
    if (res.status === 529) throw new Error('Claude-API ist gerade überlastet. Bitte gleich nochmal versuchen.');
    throw new Error(`Claude-API-Fehler (${res.status}). ${detail}`.trim());
  }
  const data = await res.json();
  log('api', 'ok', {
    tookMs,
    model: data.model,
    in: data.usage?.input_tokens,
    out: data.usage?.output_tokens,
    stop: data.stop_reason,
  });
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude hat die Anfrage abgelehnt. Bitte anderes Bild versuchen.');
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (data.stop_reason === 'max_tokens') {
    log('api', 'truncated at max_tokens');
  }
  try {
    return {
      data: JSON.parse(text),
      // Token-Verbrauch fürs Kosten-Tracking (js/cost.js); model = tatsächlich
      // benutztes Modell laut API-Antwort.
      usage: {
        model: data.model,
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      },
    };
  } catch (e) {
    log('api', 'json parse failed', { head: text.slice(0, 120) });
    throw new Error('Antwort der KI war nicht lesbar. Bitte erneut versuchen.');
  }
}

// ── Bon-Analyse ───────────────────────────────────────────────────────────────
function extractionSchema(settings) {
  const categoryIds = settings.categories.map((c) => c.id);
  const assignments = ['shared', 'unknown', ...settings.persons.map((p) => p.id)];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['store', 'date', 'total', 'items', 'notes'],
    properties: {
      store: { type: 'string', description: 'Name des Geschäfts, z.B. REWE, EDEKA, Rossmann, ALDI. Leer wenn unlesbar.' },
      date: { type: 'string', description: 'Kaufdatum als YYYY-MM-DD, leer wenn unlesbar.' },
      total: { type: 'number', description: 'Zu zahlender Gesamtbetrag des Bons in Euro (nach allen Rabatten und Pfand).' },
      notes: { type: 'string', description: 'Kurzer Hinweis auf Unklarheiten (unleserliche Zeilen etc.), sonst leer.' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'qty', 'totalPrice', 'kind', 'categoryId', 'assignment'],
          properties: {
            name: { type: 'string', description: 'Artikelname wie auf dem Bon (lesbar aufbereitet).' },
            qty: { type: 'number', description: 'Menge/Stückzahl, 1 wenn nicht angegeben.' },
            totalPrice: { type: 'number', description: 'Gesamtpreis dieser Position in Euro NACH Artikelrabatt. Negativ bei Leergut/Pfandrückgabe und Gutschriften.' },
            kind: {
              type: 'string',
              enum: ['normal', 'deposit', 'deposit_return'],
              description: 'deposit = Pfand beim Kauf (z.B. "PFAND 0,25"), deposit_return = Pfandrückgabe/Leergut, sonst normal.',
            },
            categoryId: { type: 'string', enum: categoryIds },
            assignment: {
              type: 'string',
              enum: assignments,
              description: 'Vermutete Zuordnung: shared = beide teilen 50/50, Personen-ID wenn eindeutig einer Person zuzuordnen, unknown wenn unklar.',
            },
          },
        },
      },
    },
  };
}

function extractionPrompt(settings, ruleLines) {
  const cats = settings.categories.map((c) => `- ${c.id}: ${c.name}`).join('\n');
  const persons = settings.persons.map((p) => `- ${p.id}: ${p.name}`).join('\n');
  const rules = ruleLines.length
    ? `\nBisher gelernte Zuordnungen (Produkt → Kategorie, Aufteilung). Nutze sie, um auch ähnliche neue Produkte im selben Stil zuzuordnen:\n${ruleLines.map((l) => `- ${l}`).join('\n')}`
    : '';
  return `Du analysierst einen deutschen Kassenbon (typisch REWE, EDEKA, Rossmann, ALDI, dm, Lidl).

Extrahiere ALLE Positionen einzeln und vollständig:
- Artikelrabatte (z.B. "Rabatt -0,50", "AKTION", Coupon direkt unter einem Artikel) rechnest du in den totalPrice des zugehörigen Artikels ein — sie sind KEINE eigene Position.
- Pfand beim Kauf ("PFAND", "+PFAND 0,25") ist eine EIGENE Position mit kind=deposit (positiver Betrag).
- Pfandrückgabe/Leergut ("LEERGUT", "PFANDBON", negative Beträge) ist eine eigene Position mit kind=deposit_return (negativer Betrag).
- Gewichtsartikel (z.B. "0,486 kg x 2,99 €/kg") als eine Position mit dem Endpreis.
- Mehrfachpositionen ("2 x 1,29") als eine Position mit qty und Gesamtpreis.
- Die Summe aller totalPrice-Werte muss dem Bon-Gesamtbetrag entsprechen. Prüfe das; wenn es nicht aufgeht, beschreibe das Problem kurz in notes.

Kategorien (wähle die passendste je Position):
${cats}
Getränke (auch Säfte, Limo, Bier, Wein) gehören in die Getränke-Kategorie, falls vorhanden. Duschgel, Zahnpasta, Putzmittel, Küchenrolle etc. in Drogerie/Haushalt. Blumen, Geschenke, Zeitschriften und andere Einmalkäufe in Sonstiges. Alle normalen Lebensmittel in Einkaufen.

Personen:
${persons}
${rules}
Wenn du keine belastbare Vermutung zur Person hast: assignment=shared für typische gemeinsame Lebensmittel, sonst unknown.`;
}

// file: { base64, mediaType } — Bilder als image-Block, PDFs als document-Block.
// Rückgabe: { data, usage } (usage → Kosten-Tracking am Bon).
export async function analyzeReceipt({ settings, file, ruleLines }) {
  const source = { type: 'base64', media_type: file.mediaType, data: file.base64 };
  const block = file.mediaType === 'application/pdf'
    ? { type: 'document', source }
    : { type: 'image', source };
  log('api', 'analyzeReceipt start', { model: settings.model, mediaType: file.mediaType });
  return callClaude({
    apiKey: settings.apiKey,
    body: {
      model: settings.model,
      max_tokens: 16000,
      system: extractionPrompt(settings, ruleLines),
      output_config: { format: { type: 'json_schema', schema: extractionSchema(settings) } },
      messages: [{
        role: 'user',
        content: [block, { type: 'text', text: 'Analysiere diesen Kassenbon.' }],
      }],
    },
  });
}

// ── Assistent-Chat ────────────────────────────────────────────────────────────
// Der Assistent kann die App-Konfiguration LIVE ändern: er antwortet mit reply
// (Anzeige) + actions (werden von app.js angewandt). Alle Felder sind required
// mit null-Union, damit das Schema Structured-Outputs-kompatibel bleibt.
function chatSchema(settings) {
  const categoryIds = settings.categories.map((c) => c.id);
  const personIds = settings.persons.map((p) => p.id);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'actions'],
    properties: {
      reply: { type: 'string', description: 'Antwort an den Nutzer, Deutsch, kurz und freundlich.' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'personId', 'name', 'categoryId', 'productName', 'split'],
          properties: {
            type: {
              type: 'string',
              enum: ['rename_person', 'add_category', 'rename_category', 'remove_category', 'set_rule', 'remove_rule', 'set_default_category'],
            },
            personId: { anyOf: [{ type: 'string', enum: personIds }, { type: 'null' }] },
            name: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Neuer Name (Person/Kategorie).' },
            categoryId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: `Kategorie-ID. Bestehend: ${categoryIds.join(', ')} — bei add_category eine neue kurze ID aus Kleinbuchstaben.` },
            productName: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Produktname für set_rule/remove_rule.' },
            split: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: personIds,
                  properties: Object.fromEntries(personIds.map((pid) => [pid, { type: 'number' }])),
                },
                { type: 'null' },
              ],
              description: 'Aufteilung in Prozent je Personen-ID (Summe 100), für set_rule.',
            },
          },
        },
      },
    },
  };
}

function chatSystemPrompt(settings, rules) {
  const persons = settings.persons.map((p) => `${p.id} = ${p.name}`).join(', ');
  const cats = settings.categories.map((c) => `${c.id} = ${c.name}`).join(', ');
  const ruleLines = rules.slice(0, 80).map((r) => {
    const parts = settings.persons.map((p) => `${p.name} ${r.split[p.id] || 0}%`).join(' / ');
    return `${r.name} → ${r.categoryId}, ${parts}`;
  }).join('\n');
  return `Du bist der eingebaute Assistent der App "Grocery Share". Die App teilt Kassenbon-Kosten zwischen zwei Personen auf.

Aktuelle Konfiguration:
- Personen: ${persons}
- Kategorien: ${cats} (jede hat automatisch die Auswertungszeilen "einzeln" und "teilen")
- Pfand-Kategorie: ${settings.depositCategoryId} (Pfand & Leergut immer 50/50, nicht änderbar per Chat)
- Gelernte Regeln (Auszug):
${ruleLines || '(noch keine)'}

Du kannst die Konfiguration über actions direkt ändern (die App wendet sie sofort an):
- rename_person (personId + name), rename_category (categoryId + name)
- add_category (categoryId = neue kurze ID + name), remove_category (categoryId)
- set_rule (productName + categoryId + split), remove_rule (productName)
- set_default_category (categoryId)
Beantworte auch Verständnisfragen zur App (Aufteilung, Pfand-Logik, Kategorien).
Wenn ein Wunsch unklar ist, frag kurz nach statt zu raten. Antworte immer auf Deutsch, kurz. actions leer lassen, wenn nichts zu ändern ist.`;
}

export async function assistantChat({ settings, rules, history }) {
  log('api', 'assistantChat start', { model: settings.model, turns: history.length });
  return callClaude({
    apiKey: settings.apiKey,
    body: {
      model: settings.model,
      max_tokens: 4000,
      system: chatSystemPrompt(settings, rules),
      output_config: { format: { type: 'json_schema', schema: chatSchema(settings) } },
      messages: history.map((m) => ({ role: m.role, content: m.text })),
    },
  });
}
