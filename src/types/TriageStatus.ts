export const triageStatuses = [
    'open',
    'accepted',
    'false_positive',
    'resolved',
] as const;

export type TriageStatus = (typeof triageStatuses)[number];

export function isTriageStatus(value: string): value is TriageStatus {
    return triageStatuses.includes(value as TriageStatus);
}

export function isTriagedStatus(status: TriageStatus): boolean {
    return status !== 'open';
}
