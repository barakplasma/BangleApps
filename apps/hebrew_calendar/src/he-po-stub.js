// Empty Hebrew locale — we display English only; no Hebrew translation strings needed.
// Must have the shape Locale.copyLocaleNoNikud expects: {headers, contexts: {'': {}}}.
export default { headers: {}, contexts: { '': {} } };
