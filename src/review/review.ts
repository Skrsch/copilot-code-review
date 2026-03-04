import type { CancellationToken, Progress } from 'vscode';

import { Config, Options } from '@/types/Config';
import { ModelError } from '@/types/ModelError';
import { normalizeReviewMode } from '@/types/ReviewMode';
import { ReviewComment } from '@/types/ReviewComment';
import { ReviewRequest } from '@/types/ReviewRequest';
import { ReviewResult } from '@/types/ReviewResult';
import { isTriagedStatus } from '@/types/TriageStatus';
import { correctFilename } from '@/utils/filenames';
import { DiffFile } from '@/utils/git';
import { isPathNotExcluded } from '@/utils/glob';
import type { PromptType } from '../types/PromptType';
import {
    BaselineFindingRecord,
    BaselineScopeRecord,
    createFindingId,
    ensureScopeRecord,
    getScopeKey,
    getScopeRecord,
    hashDiff,
    loadBaseline,
    saveBaseline,
    toReviewComment,
} from './baseline';
import { parseResponse, sortFileCommentsBySeverity } from './comment';
import { getGithubInstructionsContext } from './instructions';
import { ModelRequest } from './ModelRequest';
import { defaultPromptType, toPromptTypes } from './prompt';
import { getStyleguideContext } from './styleguide';

type AggregatedDiffs = {
    modelRequests: ModelRequest[];
    fileDiffHashes: Map<string, string>;
    reviewedFiles: string[];
    skippedUnchangedFiles: string[];
};

type BaselineMergeResult = {
    commentsPerFile: Map<string, ReviewComment[]>;
    findingsById: Record<string, BaselineFindingRecord>;
    findingsNew: number;
    findingsCarried: number;
    findingsResolved: number;
};

export async function reviewDiff(
    config: Config,
    request: ReviewRequest,
    progress?: Progress<{ message?: string; increment?: number }>,
    cancellationToken?: CancellationToken
): Promise<ReviewResult> {
    const options = config.getOptions();
    const reviewMode = normalizeReviewMode(options.reviewMode);
    const diffFiles = await config.git.getChangedFiles(request.scope);
    const files = diffFiles.filter(
        (file) =>
            isPathNotExcluded(file.file, options.excludeGlobs) &&
            file.status !== 'D' // ignore deleted files
    );

    const loadedBaseline = await loadBaseline(config, options);
    const scopeKey = getScopeKey(request.scope);
    const previousScope = getScopeRecord(loadedBaseline.baseline, scopeKey);
    const changedFiles = files.map((file) => file.file);
    const styleguideContext = await getStyleguideContext(config, options);
    const githubInstructionsContext = await getGithubInstructionsContext(
        config,
        options,
        changedFiles
    );
    const incrementalEnabled = options.incrementalReReview ?? true;
    const hideTriagedFindings = options.hideTriagedFindings ?? false;

    // TODO reorder to get relevant input files together, e.g.
    // order by distance: file move < main+test < same dir (levenshtein) < parent dir (levenshtein) < ...
    const aggregated = await aggregateFileDiffs(
        config,
        request,
        files,
        options,
        styleguideContext,
        githubInstructionsContext,
        previousScope,
        incrementalEnabled,
        progress,
        cancellationToken
    );
    config.logger.debug(
        `Assigned ${aggregated.reviewedFiles.length} files to ${aggregated.modelRequests.length} model requests.`
    );

    const { commentsPerFile, errors } = await generateReviewComments(
        config,
        aggregated.modelRequests,
        progress,
        cancellationToken
    );

    const nowIso = new Date().toISOString();
    const merged = mergeWithBaseline({
        nowIso,
        modelComments: commentsPerFile,
        previousScope,
        currentFiles: files.map((file) => file.file),
        reviewedFiles: aggregated.reviewedFiles,
        skippedUnchangedFiles: aggregated.skippedUnchangedFiles,
        incrementalEnabled,
    });

    const scopeRecord = ensureScopeRecord(
        loadedBaseline.baseline,
        scopeKey,
        reviewMode,
        nowIso
    );
    scopeRecord.files = {};
    for (const [file, diffHash] of aggregated.fileDiffHashes) {
        scopeRecord.files[file] = {
            diffHash,
            updatedAt: nowIso,
        };
    }
    scopeRecord.findings = merged.findingsById;

    try {
        await saveBaseline(
            loadedBaseline.baselineFile,
            loadedBaseline.baseline
        );
    } catch (error) {
        if (error instanceof Error) {
            errors.push(error);
        }
    }

    const visibleComments = filterVisibleComments(
        merged.commentsPerFile,
        hideTriagedFindings
    );
    const fileComments = Array.from(visibleComments, ([target, comments]) => ({
        target,
        comments,
    }));

    const activeFindings = Object.values(merged.findingsById).filter(
        (finding) => finding.status !== 'resolved'
    );
    const severityCounts = countSeverities(activeFindings);
    const findingsOpen = activeFindings.filter(
        (finding) => finding.status === 'open'
    ).length;
    const findingsTriaged = activeFindings.filter((finding) =>
        isTriagedStatus(finding.status)
    ).length;
    const modelUsed = options.chatModel || 'unknown';
    const resourcesUsed = collectResourcesUsed(
        options,
        styleguideContext,
        githubInstructionsContext
    );
    const toolsUsed = collectToolsUsed(options);

    return {
        request,
        fileComments: sortFileCommentsBySeverity(fileComments),
        errors,
        summary: {
            reviewMode,
            scopeKey,
            incrementalEnabled,
            totalFiles: files.length,
            reviewedFiles: aggregated.reviewedFiles.length,
            skippedUnchangedFiles: aggregated.skippedUnchangedFiles.length,
            findingsTotal: activeFindings.length,
            findingsOpen,
            findingsTriaged,
            findingsNew: merged.findingsNew,
            findingsCarried: merged.findingsCarried,
            findingsResolved: merged.findingsResolved,
            severityCounts,
            modelUsed,
            resourcesUsed,
            toolsUsed,
        },
    };
}

function collectResourcesUsed(
    options: Options,
    styleguideContext: string | undefined,
    githubInstructionsContext: string | undefined
): string[] {
    const resources: string[] = [];

    if (options.customPrompt?.trim()) {
        resources.push('Setting: codeReview.customPrompt');
    }
    if (options.reviewMode === 'styleguide' && options.styleguide?.trim()) {
        resources.push('Setting: codeReview.styleguide');
    }

    resources.push(...extractContextSources(styleguideContext));
    resources.push(...extractContextSources(githubInstructionsContext));

    return dedupe(resources);
}

function collectToolsUsed(options: Options): string[] {
    const tools: string[] = ['Git diff'];

    if (options.incrementalReReview ?? true) {
        const baselinePath =
            options.baselineFilePath ?? '.codereview-baseline.json';
        tools.push(`Baseline tracking (${baselinePath})`);
    }
    if (options.mergeFileReviewRequests) {
        tools.push('Merged file review requests');
    }
    if (options.comparePromptTypes?.trim()) {
        tools.push(`Prompt variants (${options.comparePromptTypes.trim()})`);
    } else {
        tools.push(`Prompt type (${defaultPromptType})`);
    }

    return dedupe(tools);
}

function extractContextSources(context: string | undefined): string[] {
    if (!context) {
        return [];
    }
    const sources: string[] = [];
    const pattern = /^From ([^:\n]+):/gm;
    for (const match of context.matchAll(pattern)) {
        const source = match[1]?.trim();
        if (source) {
            sources.push(source);
        }
    }
    return sources;
}

function dedupe(values: string[]): string[] {
    return Array.from(new Set(values));
}

type MergeWithBaselineInput = {
    nowIso: string;
    modelComments: Map<string, ReviewComment[]>;
    previousScope: BaselineScopeRecord | undefined;
    currentFiles: string[];
    reviewedFiles: string[];
    skippedUnchangedFiles: string[];
    incrementalEnabled: boolean;
};

function mergeWithBaseline(input: MergeWithBaselineInput): BaselineMergeResult {
    const previousFindings = input.previousScope?.findings ?? {};
    const previousActiveFindings = Object.values(previousFindings).filter(
        (finding) => finding.status !== 'resolved'
    );
    const reviewedFileSet = new Set(input.reviewedFiles);
    const skippedFileSet = new Set(input.skippedUnchangedFiles);
    const currentFileSet = new Set(input.currentFiles);

    const nextCommentsPerFile = new Map<string, ReviewComment[]>();
    const findingsById: Record<string, BaselineFindingRecord> = {};
    let findingsNew = 0;
    let findingsCarried = 0;
    let findingsResolved = 0;

    for (const [file, comments] of input.modelComments) {
        for (const comment of comments) {
            const findingId = createFindingId(comment);
            const previousFinding = previousFindings[findingId];
            const status = previousFinding?.status ?? 'open';
            const isNewFinding =
                !previousFinding || previousFinding.status === 'resolved';

            const normalized: ReviewComment = {
                ...comment,
                findingId,
                triageStatus: status,
                findingState: isNewFinding ? 'new' : 'existing',
            };
            addComment(nextCommentsPerFile, file, normalized);

            findingsById[findingId] = {
                id: findingId,
                file,
                line: normalized.line,
                comment: normalized.comment,
                severity: normalized.severity,
                promptType: normalized.promptType,
                proposedAdjustment: normalized.proposedAdjustment,
                status,
                firstSeenAt: previousFinding?.firstSeenAt ?? input.nowIso,
                lastSeenAt: input.nowIso,
            };

            if (isNewFinding) {
                findingsNew++;
            } else {
                findingsCarried++;
            }
        }
    }

    if (input.incrementalEnabled) {
        for (const previousFinding of previousActiveFindings) {
            if (!skippedFileSet.has(previousFinding.file)) {
                continue;
            }
            if (findingsById[previousFinding.id]) {
                continue;
            }

            addComment(
                nextCommentsPerFile,
                previousFinding.file,
                toReviewComment(previousFinding, previousFinding.status)
            );
            findingsById[previousFinding.id] = {
                ...previousFinding,
                lastSeenAt: input.nowIso,
            };
            findingsCarried++;
        }
    }

    for (const previousFinding of previousActiveFindings) {
        if (findingsById[previousFinding.id]) {
            continue;
        }

        const fileStillInScope = currentFileSet.has(previousFinding.file);
        const fileWasReviewed = reviewedFileSet.has(previousFinding.file);

        if (!fileStillInScope || fileWasReviewed) {
            findingsById[previousFinding.id] = {
                ...previousFinding,
                status: 'resolved',
                lastSeenAt: input.nowIso,
            };
            findingsResolved++;
            continue;
        }

        findingsById[previousFinding.id] = previousFinding;
    }

    for (const previousFinding of Object.values(previousFindings)) {
        if (findingsById[previousFinding.id]) {
            continue;
        }
        findingsById[previousFinding.id] = previousFinding;
    }

    return {
        commentsPerFile: nextCommentsPerFile,
        findingsById,
        findingsNew,
        findingsCarried,
        findingsResolved,
    };
}

function addComment(
    commentsByFile: Map<string, ReviewComment[]>,
    file: string,
    comment: ReviewComment
) {
    const existing = commentsByFile.get(file);
    if (existing) {
        existing.push(comment);
        return;
    }
    commentsByFile.set(file, [comment]);
}

function filterVisibleComments(
    commentsByFile: Map<string, ReviewComment[]>,
    hideTriagedFindings: boolean
) {
    if (!hideTriagedFindings) {
        return commentsByFile;
    }

    const visible = new Map<string, ReviewComment[]>();
    for (const [file, comments] of commentsByFile) {
        const filtered = comments.filter((comment) => {
            const status = comment.triageStatus ?? 'open';
            return status === 'open';
        });
        if (filtered.length > 0) {
            visible.set(file, filtered);
        }
    }
    return visible;
}

function countSeverities(
    findings: BaselineFindingRecord[]
): Record<number, number> {
    const severityCounts: Record<number, number> = {};
    for (const finding of findings) {
        const severity = Math.max(1, Math.min(5, finding.severity));
        severityCounts[severity] = (severityCounts[severity] ?? 0) + 1;
    }
    return severityCounts;
}

async function aggregateFileDiffs(
    config: Config,
    request: ReviewRequest,
    files: DiffFile[],
    options: Options,
    styleguideContext: string | undefined,
    githubInstructionsContext: string | undefined,
    previousScope: BaselineScopeRecord | undefined,
    incrementalEnabled: boolean,
    progress?: Progress<{ message?: string; increment?: number }>,
    cancellationToken?: CancellationToken
): Promise<AggregatedDiffs> {
    const diffContextLines =
        options.reviewMode === 'architectural'
            ? (options.architecturalContextLines ?? 30)
            : 3;
    const modelRequests: ModelRequest[] = [];
    const fileDiffHashes = new Map<string, string>();
    const reviewedFiles: string[] = [];
    const skippedUnchangedFiles: string[] = [];

    for (const file of files) {
        if (cancellationToken?.isCancellationRequested) {
            break;
        }

        progress?.report({
            message: `Gathering changes for ${files.length} files...`,
            increment: 100 / files.length,
        });

        const diff = await config.git.getFileDiff(
            request.scope,
            file,
            diffContextLines
        );
        if (diff.length === 0) {
            config.logger.debug('No changes in file:', file);
            continue;
        }
        config.logger.debug(`Diff for ${file.file}:`, diff);

        const diffHash = hashDiff(diff);
        fileDiffHashes.set(file.file, diffHash);
        const previousFileHash = previousScope?.files[file.file]?.diffHash;
        if (incrementalEnabled && previousFileHash === diffHash) {
            skippedUnchangedFiles.push(file.file);
            continue;
        }

        reviewedFiles.push(file.file);

        // if merging is off, create a new request for each file
        if (modelRequests.length === 0 || !options.mergeFileReviewRequests) {
            const modelRequest = new ModelRequest(
                config,
                request.scope.changeDescription,
                {
                    reviewMode: options.reviewMode,
                    styleguide: styleguideContext,
                    githubInstructions: githubInstructionsContext,
                }
            );
            modelRequests.push(modelRequest);
        }

        // try adding this diff to the last model request
        try {
            await modelRequests[modelRequests.length - 1].addDiff(
                file.file,
                diff
            );
        } catch {
            // if the diff cannot be added to the last request, create a new one
            const modelRequest = new ModelRequest(
                config,
                request.scope.changeDescription,
                {
                    reviewMode: options.reviewMode,
                    styleguide: styleguideContext,
                    githubInstructions: githubInstructionsContext,
                }
            );
            await modelRequest.addDiff(file.file, diff); // adding the first diff will never throw
            modelRequests.push(modelRequest);
        }
    }

    return {
        modelRequests,
        fileDiffHashes,
        reviewedFiles,
        skippedUnchangedFiles,
    };
}

async function generateReviewComments(
    config: Config,
    modelRequests: ModelRequest[],
    progress?: Progress<{ message?: string; increment?: number }>,
    cancellationToken?: CancellationToken
) {
    const promptTypes = toPromptTypes(config.getOptions().comparePromptTypes);

    const totalRequests = modelRequests.length * promptTypes.length;
    let requestCounter = 0;
    const updateProgress = () => {
        requestCounter++;
        const isSingle = totalRequests <= 1;
        const increment = isSingle ? -100 : 100 / totalRequests;
        const message = isSingle
            ? 'Reviewing...'
            : `Reviewing (${requestCounter}/${totalRequests})...`;
        progress?.report({ message, increment });
    };

    const errors: Error[] = [];
    const commentsPerFile = new Map<string, ReviewComment[]>();
    for (const modelRequest of modelRequests) {
        for (const promptType of promptTypes) {
            if (cancellationToken?.isCancellationRequested) {
                return { commentsPerFile, errors };
            }

            updateProgress();
            try {
                await processRequest(
                    config,
                    modelRequest,
                    commentsPerFile,
                    promptType,
                    cancellationToken
                );
            } catch (error) {
                // it's entirely possible that something bad happened for a request, let's store the error and continue if possible
                if (error instanceof ModelError) {
                    errors.push(error);
                    // would also fail for the remaining files
                    return { commentsPerFile, errors };
                } else if (error instanceof Error) {
                    errors.push(error);
                    continue;
                }
                continue;
            }
        }
    }

    return { commentsPerFile, errors };
}

async function processRequest(
    config: Config,
    modelRequest: ModelRequest,
    commentsPerFile: Map<string, ReviewComment[]>,
    promptType?: PromptType,
    cancellationToken?: CancellationToken
) {
    const reviewStart = Date.now();
    const { response, promptTokens, responseTokens } =
        await modelRequest.sendRequest(cancellationToken, promptType);
    const reviewDuration = Date.now() - reviewStart;
    config.logger.debug(
        `Received review response. Took=${reviewDuration}ms, Files=${modelRequest.files.length}, prompt type=${promptType ?? defaultPromptType}, request tokens=${promptTokens}, response tokens=${responseTokens}, Response=${response}`
    );

    const comments = parseResponse(response);
    for (const comment of comments) {
        // check file name
        if (!modelRequest.files.includes(comment.file)) {
            const closestFile = correctFilename(
                comment.file,
                modelRequest.files
            );
            config.logger.info(
                `File name mismatch, correcting "${comment.file}" to "${closestFile}"!`
            );
            comment.file = closestFile;
        }

        comment.promptType = promptType;
        addComment(commentsPerFile, comment.file, comment);
    }
}
