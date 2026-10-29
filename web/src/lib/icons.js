// Line icons on a 24-unit grid, drawn in currentColor.
const svg = (paths, size = 14, stroke = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icon = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 13, 2.8),
  checkSm: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 14, 2.4),
  branch: svg('<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 7.2v9.6M18 10.2c0 3.6-3.6 4.4-9.6 6.2"/>', 13, 1.9),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 13, 1.9),
  retry: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>', 12, 2),
  send: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 12, 2.2),
  chev: svg('<path d="M9 6l6 6-6 6"/>', 12, 2.2),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 13, 2.2),
  plug: svg('<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>', 15, 1.8),
  alert: svg('<path d="M12 3.5l9 16H3z"/><path d="M12 10v4M12 17v.1"/>', 15, 1.9),
  terminal: svg('<path d="M5 17l5-5-5-5"/><path d="M12 18h7"/>', 15, 2),
  sync: svg('<path d="M20 12a8 8 0 0 1-14 5.3L4 15.5"/><path d="M4 20v-4.5h4.5"/><path d="M4 12a8 8 0 0 1 14-5.3L20 8.5"/><path d="M20 4v4.5h-4.5"/>', 15, 1.9),
  package: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>', 15, 1.8),
  up: svg('<path d="M12 20V8"/><path d="M7 13l5-5 5 5"/><path d="M5 4h14"/>', 15, 2),
  layers: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', 15, 1.8),
  shield: svg('<path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>', 15, 1.8),
  commit: svg('<circle cx="12" cy="12" r="3.2"/><path d="M3 12h5.8M15.2 12H21"/>', 13, 1.9),
  merge: svg('<circle cx="6" cy="18" r="2.2"/><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 8.2v7.6"/><path d="M6 8.5c0 2.5 3 3.5 9.8 3.5"/>', 13, 1.9),
  down: svg('<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>', 13, 1.9),
  external: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 13, 1.9),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', 13, 1.9),
};
