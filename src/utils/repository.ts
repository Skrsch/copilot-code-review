import * as path from 'path';

/**
 * Resolve repositoryPath from settings.
 * - empty path: workspace root
 * - relative path: relative to workspace root
 * - absolute path: as-is (normalized)
 */
export function resolveRepositoryRoot(
    workspaceRoot: string,
    repositoryPath?: string
): string {
    const trimmedRepositoryPath = repositoryPath?.trim();
    if (!trimmedRepositoryPath) {
        return workspaceRoot;
    }

    if (path.isAbsolute(trimmedRepositoryPath)) {
        return path.normalize(trimmedRepositoryPath);
    }

    return path.resolve(workspaceRoot, trimmedRepositoryPath);
}

/**
 * Convert an absolute repository root to a setting value for `codeReview.repositoryPath`.
 * - workspace root: empty string
 * - repository inside workspace: workspace-relative path
 * - repository outside workspace: absolute path
 */
export function toRepositorySettingPath(
    workspaceRoot: string,
    repositoryRoot: string
): string {
    const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
    const normalizedRepositoryRoot = path.resolve(repositoryRoot);
    const relativePath = path.relative(
        normalizedWorkspaceRoot,
        normalizedRepositoryRoot
    );

    if (relativePath.length === 0) {
        return '';
    }

    const isWorkspaceRelativePath =
        !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
    if (isWorkspaceRelativePath) {
        return relativePath.replace(/\\/g, '/');
    }

    return path.normalize(normalizedRepositoryRoot);
}
