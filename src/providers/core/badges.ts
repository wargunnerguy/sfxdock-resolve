// Central badge derivation — the ONLY place badge logic lives. The badge
// answers "what does a click cost the user right now": Owned beats Paid
// beats Login required beats Free.

import type { Badge, Provider, ProviderContext } from './types';

export interface BadgeFacts {
    /** Sound already in the local library / a watched folder. */
    owned?: boolean;
    /** Provider marks this specific sound as requiring payment. */
    paid?: boolean;
}

export function deriveBadge(provider: Provider, ctx: ProviderContext, facts: BadgeFacts = {}): Badge {
    if (facts.owned) return 'owned';
    if (facts.paid) return 'paid';
    if (provider.downloadAuthType === 'oauth2' && !ctx.hasOAuth) return 'login-required';
    if (provider.downloadAuthType === 'apiKey' && !ctx.apiKey) return 'login-required';
    return 'free';
}

export const BADGE_LABELS: Record<Badge, string> = {
    free: 'Free',
    'login-required': 'Login required',
    paid: 'Paid',
    owned: 'Owned',
};
