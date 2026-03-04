import * as vscode from 'vscode';

import { Config, Options } from '@/types/Config';
import type { Logger } from '@/types/Logger';
import type { Model } from '@/types/Model';
import { normalizeReviewMode } from '@/types/ReviewMode';
import { createGit } from '@/utils/git';
import { resolveRepositoryRoot } from '@/utils/repository';
import { LgtmLogger } from './logger';
import { getChatModel } from './model';

// defined when built via `npm run dev`
declare const __GIT_VERSION__: string | undefined;

const defaultModelId = 'gpt-4o';
const configurationScope = 'codeReview';

let config: Config | undefined;
let configChangeSubscription: vscode.Disposable | undefined;

/** Return config */
export async function getConfig(): Promise<Config> {
    if (!config) {
        config = await initializeConfig();
    }
    return config;
}

async function initializeConfig(): Promise<Config> {
    const options = getOptions();
    const logger = new LgtmLogger(options.enableDebugOutput);
    if (__GIT_VERSION__) {
        logger.info(`**codeReview dev build**: ${__GIT_VERSION__}`);
    }

    let mainWorkspace = vscode.workspace.workspaceFolders?.[0];
    if ((vscode.workspace.workspaceFolders?.length || 0) > 1) {
        //if there are multiple workspaces, ask the user to select one
        mainWorkspace = await vscode.window.showWorkspaceFolderPick();
    }

    if (!mainWorkspace) {
        throw new Error(
            'No workspace found. Please open a folder containing a Git repository using `File -> Open Folder`.'
        );
    }

    const workspaceRoot = mainWorkspace.uri.fsPath;
    const repositoryRoot = resolveRepositoryRoot(
        workspaceRoot,
        options.repositoryPath
    );
    let git;
    try {
        git = await createGit(repositoryRoot);
    } catch (error) {
        const message =
            error instanceof Error ? '\n\n```\n' + error.message + '\n```' : '';
        throw new Error(
            `Error opening Git repository at "${repositoryRoot}". Please set "codeReview.repositoryPath" to a valid Git repository path (absolute or workspace-relative) and make sure Git is installed.` +
                message
        );
    }
    const initializedConfig = {
        git,
        workspaceRoot,
        gitRoot: git.getGitRoot(),
        getModel: () => loadModel(getOptions().chatModel, logger),
        getOptions,
        logger,
    };

    configChangeSubscription?.dispose();
    configChangeSubscription = vscode.workspace.onDidChangeConfiguration(
        (ev) => {
            if (!ev.affectsConfiguration(configurationScope)) {
                return;
            }
            if (
                ev.affectsConfiguration(`${configurationScope}.repositoryPath`)
            ) {
                initializedConfig.logger.debug(
                    'Repository path changed, reinitializing config...'
                );
                config = undefined;
                return;
            }

            initializedConfig.logger.debug('Updating config...');
            initializedConfig.logger.setEnableDebug(
                getOptions().enableDebugOutput
            );
        }
    );

    return initializedConfig;
}

/** get desired chat model.
 *
 * If the model is not available, shows an error toast with possible options.
 */
async function loadModel(modelId: string, logger: Logger): Promise<Model> {
    logger.debug(`Loading chat model: ${modelId}`);
    try {
        return await getChatModel(modelId, logger);
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : 'Error loading chat model';
        logger.info(
            `[Error] Failed to load chat model (was trying ${modelId}): ${errorMessage}`
        );

        const resetToDefaultOption = `Reset to Default (${defaultModelId})`;
        const selectChatModelOption = 'Select Chat Model';
        const options = [selectChatModelOption];
        if (modelId !== defaultModelId) {
            options.unshift(resetToDefaultOption);
        }

        // Notify the user
        const option = await vscode.window.showErrorMessage(
            `Failed to load chat model '${modelId}'. Reason: ${errorMessage}\nDo you want to reset to the default model or select a different one?`,
            ...options
        );

        if (option === resetToDefaultOption) {
            await vscode.workspace
                .getConfiguration(configurationScope)
                .update(
                    'chatModel',
                    defaultModelId,
                    vscode.ConfigurationTarget.Global
                );
            logger.info(`Chat model reset to default: ${defaultModelId}`);
            return await loadModel(defaultModelId, logger);
        } else if (option === selectChatModelOption) {
            await vscode.commands.executeCommand('codeReview.selectChatModel');
            return await loadModel(getOptions().chatModel, logger);
        }

        throw new Error(
            `Couldn't find chat model. Please ensure the codeReview.chatModel setting is set to an available model ID. You can use the "codeReview: Select Chat Model" command to pick one.`
        );
    }
}

/** Converts file path relative to gitRoot to a vscode.Uri */
export function toUri(config: Config, file: string): vscode.Uri {
    return vscode.Uri.file(config.gitRoot + '/' + file);
}

function getOptions(): Options {
    const config = vscode.workspace.getConfiguration(configurationScope);

    const minSeverity = config.get<number>('minSeverity', 1);
    const customPrompt = config.get<string>('customPrompt', '');
    const excludeGlobs = config.get<string[]>('exclude', []);
    const repositoryPath = config.get<string>('repositoryPath', '');
    const reviewMode = normalizeReviewMode(
        config.get<string>('reviewMode', 'general')
    );
    const styleguide = config.get<string>('styleguide', '');
    const styleguideUseCopilotInstructions = config.get<boolean>(
        'styleguideUseCopilotInstructions',
        true
    );
    const useGithubInstructions = config.get<boolean>(
        'useGithubInstructions',
        true
    );
    let architecturalContextLines = config.get<number>(
        'architecturalContextLines',
        30
    );
    if (architecturalContextLines < 3) {
        architecturalContextLines = 3;
    } else if (architecturalContextLines > 200) {
        architecturalContextLines = 200;
    }
    const enableDebugOutput = config.get<boolean>('enableDebugOutput', false);
    const incrementalReReview = config.get<boolean>(
        'incrementalReReview',
        true
    );
    const hideTriagedFindings = config.get<boolean>(
        'hideTriagedFindings',
        false
    );
    const baselineFilePath = config.get<string>(
        'baselineFilePath',
        '.codereview-baseline.json'
    );
    const chatModel = config.get<string>('chatModel', defaultModelId);
    const mergeFileReviewRequests = config.get<boolean>(
        'mergeFileReviewRequests',
        true
    );
    let maxInputTokensFraction = config.get<number>(
        'maxInputTokensFraction',
        0.95
    );
    if (maxInputTokensFraction > 0.95) {
        maxInputTokensFraction = 0.95;
    } else if (maxInputTokensFraction < 0.05) {
        maxInputTokensFraction = 0.05;
    }
    // hidden experimental setting for comparing prompts. Comma-separated list of prompt types to compare.
    // if empty, will only create a single review using the default prompt type.
    const comparePromptTypes = config.get<string>('comparePromptTypes');

    return {
        minSeverity,
        customPrompt,
        excludeGlobs,
        repositoryPath,
        reviewMode,
        styleguide,
        styleguideUseCopilotInstructions,
        useGithubInstructions,
        architecturalContextLines,
        incrementalReReview,
        hideTriagedFindings,
        baselineFilePath,
        enableDebugOutput,
        chatModel,
        mergeFileReviewRequests,
        maxInputTokensFraction,
        comparePromptTypes,
    };
}
