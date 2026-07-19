export type ProviderErrorKind = 'auth' | 'network' | 'rate-limit' | 'provider';

export class ProviderError extends Error {
    readonly kind: ProviderErrorKind;
    readonly providerId: string;

    constructor(providerId: string, kind: ProviderErrorKind, message: string) {
        super(message);
        this.name = 'ProviderError';
        this.providerId = providerId;
        this.kind = kind;
    }
}

export class ProviderAuthError extends ProviderError {
    constructor(providerId: string, message = 'Missing or invalid API key') {
        super(providerId, 'auth', message);
        this.name = 'ProviderAuthError';
    }
}
