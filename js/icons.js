// icons.js — kleines Custom-SVG-Icon-Set (24×24, Strich-Icons in currentColor),
// gerendert via v-html (ic(name) in app.js). Keine System-Emojis in der UI.

const P = (d, extra = '') => `<path d="${d}" ${extra}/>`;

const ICONS = {
  camera: P('M4 8h3l2-3h6l2 3h3v11H4z') + '<circle cx="12" cy="13" r="3.2"/>',
  receipt: P('M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21z') + P('M9 8h6M9 12h6M9 16h4'),
  cart: P('M3 5h2l2.2 10.5h9.6L20 8H7') + '<circle cx="9" cy="19" r="1.6"/><circle cx="15.5" cy="19" r="1.6"/>',
  bottle: P('M10 3h4v3c2 1.4 3 3 3 5v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8c0-2 1-3.6 3-5z'),
  soap: P('M8 9h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z') + P('M10 9V6h4M14 6V3h-3'),
  gift: P('M4 10h16v11H4z') + P('M12 10v11M4 10V7h16v3M12 7c-1.5-3.5-6-3.5-6-1s4 1.5 6 1c2 .5 6 1.5 6-1s-4.5-2.5-6 1z'),
  chat: P('M4 5h16v11H9l-5 4z') + P('M8 9h8M8 12.5h5'),
  // Echtes Zahnrad mit Zahnkranz (Feather-Icons-Form) — der frühere Kreis mit
  // Strahlen sah aus wie eine Sonne.
  settings: '<circle cx="12" cy="12" r="3"/>' + P('M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'),
  home: P('M4 11l8-7 8 7v9h-5v-6h-6v6H4z'),
  plus: P('M12 5v14M5 12h14'),
  trash: P('M5 7h14M10 7V4h4v3M8 7l1 13h6l1-13'),
  edit: P('M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z'),
  check: P('M4.5 12.5l5 5L19.5 7'),
  x: P('M6 6l12 12M18 6L6 18'),
  back: P('M15 5l-7 7 7 7'),
  next: P('M9 5l7 7-7 7'),
  mic: P('M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z') + P('M6 11a6 6 0 0 0 12 0M12 17v4'),
  send: P('M3 12l18-8-6 8 6 8z'),
  upload: P('M12 16V4M7 9l5-5 5 5M5 20h14'),
  table: P('M4 5h16v14H4zM4 10h16M10 5v14'),
  copy: P('M9 9h11v11H9z') + P('M6 15H4V4h11v2'),
  download: P('M12 4v12M7 11l5 5 5-5M5 20h14'),
  key: '<circle cx="8" cy="12" r="3.5"/>' + P('M11.5 12H21M17 12v3.5M20 12v2.5'),
  sparkle: P('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z'),
  bulb: P('M9 18h6M10 21h4M12 3a6 6 0 0 1 3.6 10.8c-.7.6-.6 1.3-.6 2.2h-6c0-.9.1-1.6-.6-2.2A6 6 0 0 1 12 3z'),
  warn: P('M12 3l10 17H2z') + P('M12 9.5V14M12 16.8v.2'),
  info: '<circle cx="12" cy="12" r="9"/>' + P('M12 10.5V16.5M12 7.4v.2'),
  refresh: P('M20 12a8 8 0 1 1-2.3-5.7M20 3v4h-4'),
  users: '<circle cx="8.5" cy="9" r="3"/><circle cx="16" cy="10" r="2.4"/>' + P('M3.5 19c.5-3 2.5-4.6 5-4.6s4.5 1.6 5 4.6M13.7 15.2c2.5-.6 5.3.6 5.8 3.8'),
  calendar: P('M4 6h16v14H4zM4 10h16M8 3v4M16 3v4'),
  euro: P('M17 6.5A6.5 6.5 0 0 0 6.7 12 6.5 6.5 0 0 0 17 17.5M4.5 10.4h8M4.5 13.6h7'),
  wallet: P('M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z') + P('M4 7V6a2 2 0 0 1 2-2h11v3M15 13.5h2.5'),
  lock: P('M6 11h12v10H6z') + P('M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11') + P('M12 15v2.5'),
  lockOpen: P('M6 11h12v10H6z') + P('M8.5 11V7.5a3.5 3.5 0 0 1 6.9-.9') + P('M12 15v2.5'),
};

export function icon(name, { size = 22, cls = '' } = {}) {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hasIcon(name) { return !!ICONS[name]; }
export const ICON_NAMES = Object.keys(ICONS);
