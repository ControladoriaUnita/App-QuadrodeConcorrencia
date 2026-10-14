/** Minúsculas e sem acentos: "Edifício" casa com "edificio". */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Termos da busca (separados por espaço), já sem acento */
export const searchTerms = (query: string) => fold(query).split(/\s+/).filter(Boolean)

/** O texto contém todos os termos (texto já passado por `fold`)? Sem termos, casa sempre. */
export const matchesTerms = (foldedText: string, terms: string[]) => terms.every((t) => foldedText.includes(t))
