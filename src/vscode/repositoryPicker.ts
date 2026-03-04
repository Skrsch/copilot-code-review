import { readdir } from 'node:fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import type { Config } from '@/types/Config';
import {
    resolveRepositoryRoot,
    toRepositorySettingPath,
} from '@/utils/repository';

type RepositoryQuickPickItem = vscode.QuickPickItem & {
    repositoryRoot: string;
    repositoryPathSetting: string;
};

export type RepositorySelection = {
    repositoryRoot: string;
    repositoryPathSetting: string;
    displayPath: string;
};

type GitRepositoryLike = {
    rootUri: vscode.Uri;
};

type GitExtensionApi = {
    repositories: GitRepositoryLike[];
};

type GitExtensionExports = {
    getAPI(version: number): GitExtensionApi;
};

async function getGitExtensionRepositories(): Promise<string[]> {
    const gitExtension =
        vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
    if (!gitExtension) {
        return [];
    }

    try {
        const exports = gitExtension.isActive
            ? gitExtension.exports
            : await gitExtension.activate();
        if (!exports || typeof exports.getAPI !== 'function') {
            return [];
        }

        const api = exports.getAPI(1);
        if (!api || !Array.isArray(api.repositories)) {
            return [];
        }

        return api.repositories
            .map((repo) => repo.rootUri?.fsPath)
            .filter((repoPath): repoPath is string => !!repoPath)
            .map((repoPath) => path.resolve(repoPath));
    } catch {
        return [];
    }
}

async function discoverRepositoryRootsFromFs(
    workspaceRoot: string
): Promise<string[]> {
    const repositoryRoots = new Set<string>();
    const pending: Array<{ dir: string; depth: number }> = [
        { dir: path.resolve(workspaceRoot), depth: 0 },
    ];
    const visited = new Set<string>();
    const maxDepth = 12;
    const maxDirs = 6000;

    while (pending.length > 0 && visited.size < maxDirs) {
        const current = pending.pop();
        if (!current) {
            break;
        }
        if (visited.has(current.dir)) {
            continue;
        }
        visited.add(current.dir);

        let entries;
        try {
            entries = await readdir(current.dir, { withFileTypes: true });
        } catch {
            continue;
        }

        const hasGitEntry = entries.some((entry) => entry.name === '.git');
        if (hasGitEntry) {
            repositoryRoots.add(current.dir);
        }

        if (current.depth >= maxDepth) {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (
                entry.name === '.git' ||
                entry.name === 'node_modules' ||
                entry.name === '.pnpm-store'
            ) {
                continue;
            }

            pending.push({
                dir: path.join(current.dir, entry.name),
                depth: current.depth + 1,
            });
        }
    }

    return Array.from(repositoryRoots);
}

/** Discover repositories in the current workspace. */
async function discoverRepositoryRoots(
    workspaceRoot: string
): Promise<string[]> {
    const repositoryRoots = new Set<string>([path.resolve(workspaceRoot)]);
    for (const repositoryRoot of await getGitExtensionRepositories()) {
        repositoryRoots.add(repositoryRoot);
    }
    for (const repositoryRoot of await discoverRepositoryRootsFromFs(
        workspaceRoot
    )) {
        repositoryRoots.add(path.resolve(repositoryRoot));
    }

    return Array.from(repositoryRoots).sort((a, b) => a.localeCompare(b));
}

function getDisplayPath(workspaceRoot: string, repositoryRoot: string): string {
    const settingPath = toRepositorySettingPath(workspaceRoot, repositoryRoot);
    return settingPath.length > 0 ? settingPath : '(workspace root)';
}

export async function pickRepository(
    config: Config
): Promise<RepositorySelection | undefined> {
    const repositoryRoots = await discoverRepositoryRoots(config.workspaceRoot);
    const currentRoot = resolveRepositoryRoot(
        config.workspaceRoot,
        config.getOptions().repositoryPath
    );
    repositoryRoots.push(path.resolve(currentRoot));
    const uniqueRoots = Array.from(new Set(repositoryRoots)).sort((a, b) =>
        a.localeCompare(b)
    );

    const items: RepositoryQuickPickItem[] = uniqueRoots.map((root) => {
        const displayPath = getDisplayPath(config.workspaceRoot, root);
        const isCurrent = path.resolve(root) === path.resolve(currentRoot);
        return {
            label: `${isCurrent ? '$(check)' : '\u2003 '} ${displayPath}`,
            description: isCurrent ? 'Current repository' : undefined,
            detail: root,
            repositoryRoot: root,
            repositoryPathSetting: toRepositorySettingPath(
                config.workspaceRoot,
                root
            ),
        };
    });

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Select Repository',
        placeHolder: 'Choose a repository to review',
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!selected) {
        return undefined;
    }

    return {
        repositoryRoot: selected.repositoryRoot,
        repositoryPathSetting: selected.repositoryPathSetting,
        displayPath: getDisplayPath(
            config.workspaceRoot,
            selected.repositoryRoot
        ),
    };
}

export async function selectRepository(config: Config): Promise<boolean> {
    const selected = await pickRepository(config);
    if (!selected) {
        return false;
    }

    const currentRoot = resolveRepositoryRoot(
        config.workspaceRoot,
        config.getOptions().repositoryPath
    );
    if (path.resolve(currentRoot) === path.resolve(selected.repositoryRoot)) {
        return false;
    }

    await vscode.workspace
        .getConfiguration('codeReview')
        .update(
            'repositoryPath',
            selected.repositoryPathSetting,
            vscode.ConfigurationTarget.Workspace
        );

    vscode.window.showInformationMessage(
        `codeReview repository set to: ${selected.displayPath}`
    );
    return true;
}
