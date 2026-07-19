// Filename-level tokenization for v1 local search. Deliberately simple:
// split on non-alphanumeric, lowercase, drop empties. Matching is AND over
// query tokens (every query token must appear in the target's search text).

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((t) => t.length > 0);
}

/** Space-joined normalized tokens, used as the stored/queried search text. */
export function searchText(...parts: Array<string | null | undefined>): string {
    return tokenize(parts.filter(Boolean).join(' ')).join(' ');
}
