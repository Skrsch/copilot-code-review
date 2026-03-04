import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'path';

import type { Config, Options } from '@/types/Config';
import type { PromptType } from '@/types/PromptType';
import type { ProposedAdjustment, ReviewComment } from '@/types/ReviewComment';
import type { ReviewMode } from '@/types/ReviewMode';
import type { ReviewScope } from '@/types/ReviewRequest';
import type { TriageStatus } from '@/types/TriageStatus';

export const defaultBaselineFilePath = '.codereview-baseline.json';

export type BaselineFileRecord = {
    diffHash: string;
    updatedAt: string;
};

export type BaselineFindingRecord = {
    id: string;
    file: string;
    line: number;
    comment: string;
    severity: number;
    promptType?: PromptType;
    proposedAdjustment?: ProposedAdjustment;
    status: TriageStatus;
    firstSeenAt: string;
    lastSeenAt: string;
};

export type BaselineScopeRecord = {
    key: string;
    mode: ReviewMode;
    updatedAt: string;
    files: Record<string, BaselineFileRecord>;
    findings: Record<string, BaselineFindingRecord>;
};

type BaselineStore = {
    version: 1;
    scopes: Record<string, BaselineScopeRecord>;
};

export type LoadedBaseline = {
    baseline: BaselineStore;
    baselineFile?: string;
};

function createEmptyBaseline(): BaselineStore {
    return {
        version: 1,
        scopes: {},
    };
}

function isErrnoCode(
    error: unknown,
    code: string
): error is NodeJS.ErrnoException {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === code
    );
}

function toPlainString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export function getBaselineFilePath(
    config: Config,
    options: Options
): string | undefined {
    const gitRoot = toPlainString(config.gitRoot);
    if (!gitRoot) {
        return undefined;
    }

    const configuredPath = toPlainString(options.baselineFilePath);
    const baselinePath = configuredPath ?? defaultBaselineFilePath;
    if (path.isAbsolute(baselinePath)) {
        return path.normalize(baselinePath);
    }
    return path.resolve(gitRoot, baselinePath);
}

function parseBaseline(raw: string): BaselineStore {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') {
            return createEmptyBaseline();
        }
        if (
            !('version' in parsed) ||
            (parsed as { version?: unknown }).version !== 1
        ) {
            return createEmptyBaseline();
        }
        if (!('scopes' in parsed)) {
            return createEmptyBaseline();
        }
        const scopes = (parsed as { scopes?: unknown }).scopes;
        if (!scopes || typeof scopes !== 'object') {
            return createEmptyBaseline();
        }
        return parsed as BaselineStore;
    } catch {
        return createEmptyBaseline();
    }
}

export async function loadBaseline(
    config: Config,
    options: Options
): Promise<LoadedBaseline> {
    const baselineFile = getBaselineFilePath(config, options);
    if (!baselineFile) {
        return { baseline: createEmptyBaseline() };
    }

    try {
        const raw = await readFile(baselineFile, 'utf8');
        return { baseline: parseBaseline(raw), baselineFile };
    } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) {
            return { baseline: createEmptyBaseline(), baselineFile };
        }
        throw error;
    }
}

export async function saveBaseline(
    baselineFile: string | undefined,
    baseline: BaselineStore
) {
    if (!baselineFile) {
        return;
    }

    await mkdir(path.dirname(baselineFile), { recursive: true });
    await writeFile(baselineFile, JSON.stringify(baseline, null, 2), 'utf8');
}

export function getScopeKey(scope: ReviewScope): string {
    if (!scope.isCommitted) {
        return `uncommitted:${scope.target}`;
    }
    return `committed:${scope.revisionRangeDiff}`;
}

export function getScopeRecord(
    baseline: BaselineStore,
    scopeKey: string
): BaselineScopeRecord | undefined {
    return baseline.scopes[scopeKey];
}

export function ensureScopeRecord(
    baseline: BaselineStore,
    scopeKey: string,
    reviewMode: ReviewMode,
    nowIso: string
): BaselineScopeRecord {
    const existing = baseline.scopes[scopeKey];
    if (existing) {
        existing.mode = reviewMode;
        existing.updatedAt = nowIso;
        return existing;
    }

    const created: BaselineScopeRecord = {
        key: scopeKey,
        mode: reviewMode,
        updatedAt: nowIso,
        files: {},
        findings: {},
    };
    baseline.scopes[scopeKey] = created;
    return created;
}

export function hashDiff(diff: string): string {
    return createHash('sha256').update(diff).digest('hex');
}

export function createFindingId(
    comment: Pick<ReviewComment, 'file' | 'line' | 'comment'>
): string {
    const canonical = `${comment.file}\n${comment.line}\n${comment.comment
        .trim()
        .replace(/\s+/g, ' ')}`;
    return `f_${createHash('sha1').update(canonical).digest('hex').slice(0, 16)}`;
}

export function toReviewComment(
    finding: BaselineFindingRecord,
    triageStatus?: TriageStatus
): ReviewComment {
    return {
        file: finding.file,
        line: finding.line,
        comment: finding.comment,
        severity: finding.severity,
        promptType: finding.promptType,
        proposedAdjustment: finding.proposedAdjustment,
        findingId: finding.id,
        triageStatus: triageStatus ?? finding.status,
        findingState: 'existing',
    };
}

export async function updateFindingTriageStatus(
    config: Config,
    options: Options,
    scopeKey: string,
    findingId: string,
    status: TriageStatus
): Promise<boolean> {
    const loaded = await loadBaseline(config, options);
    const scope = getScopeRecord(loaded.baseline, scopeKey);
    if (!scope) {
        return false;
    }

    const finding = scope.findings[findingId];
    if (!finding) {
        return false;
    }

    finding.status = status;
    finding.lastSeenAt = new Date().toISOString();
    scope.updatedAt = finding.lastSeenAt;

    await saveBaseline(loaded.baselineFile, loaded.baseline);
    return true;
}
