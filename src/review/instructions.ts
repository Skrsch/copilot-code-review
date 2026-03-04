import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';

import { minimatch } from 'minimatch';

import type { Config, Options } from '@/types/Config';

const githubInstructionsDir = '.github/instructions';
const maxGithubInstructionsChars = 12000;

type ParsedInstructionFile = {
    applyTo: string[];
    body: string;
};

export async function getGithubInstructionsContext(
    config: Config,
    options: Options,
    changedFiles: string[]
): Promise<string | undefined> {
    const enabled = options.useGithubInstructions ?? true;
    if (!enabled) {
        return undefined;
    }

    const instructionFiles = await loadInstructionFiles(config.gitRoot);
    if (instructionFiles.length === 0) {
        return undefined;
    }

    const sections: string[] = [];
    for (const instructionFile of instructionFiles) {
        const parsed = parseInstructionFile(instructionFile.content);
        if (!parsed.body) {
            continue;
        }
        if (!matchesApplyTo(parsed.applyTo, changedFiles)) {
            continue;
        }

        sections.push(`From ${instructionFile.relativePath}:\n${parsed.body}`);
    }

    if (sections.length === 0) {
        return undefined;
    }

    const merged = sections.join('\n\n');
    if (merged.length <= maxGithubInstructionsChars) {
        return merged;
    }

    config.logger.info(
        `GitHub instructions context truncated from ${merged.length} to ${maxGithubInstructionsChars} characters`
    );
    return merged.slice(0, maxGithubInstructionsChars);
}

type InstructionFile = {
    relativePath: string;
    content: string;
};

async function loadInstructionFiles(
    gitRoot: string
): Promise<InstructionFile[]> {
    const instructionsRoot = path.join(gitRoot, githubInstructionsDir);
    const markdownFiles = await listMarkdownFilesRecursive(instructionsRoot);
    const loaded: InstructionFile[] = [];

    for (const fileName of markdownFiles.sort()) {
        const relativePath = toPosixPath(
            `${githubInstructionsDir}/${fileName}`
        );
        const absolutePath = path.join(gitRoot, relativePath);
        const content = await readFileIfExists(absolutePath);
        if (!content) {
            continue;
        }
        loaded.push({
            relativePath,
            content,
        });
    }

    return loaded;
}

async function listMarkdownFilesRecursive(
    rootDir: string,
    relativeDir = ''
): Promise<string[]> {
    const absoluteDir = path.join(rootDir, relativeDir);
    const entries = await readDirEntriesIfExists(absoluteDir);
    if (!entries) {
        return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
        const entryRelativePath = relativeDir
            ? `${relativeDir}/${entry.name}`
            : entry.name;

        if (entry.isDirectory()) {
            const nestedFiles = await listMarkdownFilesRecursive(
                rootDir,
                entryRelativePath
            );
            files.push(...nestedFiles);
            continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
            continue;
        }

        files.push(entryRelativePath);
    }

    return files;
}

function parseInstructionFile(content: string): ParsedInstructionFile {
    const frontmatterMatch = content.match(
        /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/
    );
    if (!frontmatterMatch) {
        return {
            applyTo: [],
            body: content.trim(),
        };
    }

    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2].trim();
    return {
        applyTo: parseApplyTo(frontmatter),
        body,
    };
}

function parseApplyTo(frontmatter: string): string[] {
    const lines = frontmatter.split(/\r?\n/);
    const applyToIndex = lines.findIndex((line) =>
        line.trim().startsWith('applyTo:')
    );
    if (applyToIndex === -1) {
        return [];
    }

    const line = lines[applyToIndex];
    const colonIndex = line.indexOf(':');
    const inlineValue =
        colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : '';
    if (inlineValue) {
        return parseApplyToValues(inlineValue);
    }

    const values: string[] = [];
    for (let index = applyToIndex + 1; index < lines.length; index++) {
        const rawLine = lines[index];
        const trimmed = rawLine.trim();
        if (!trimmed) {
            continue;
        }
        if (/^[A-Za-z0-9_-]+\s*:/.test(trimmed)) {
            break;
        }
        if (trimmed.startsWith('-')) {
            values.push(trimYamlScalar(trimmed.slice(1)));
        } else {
            values.push(trimYamlScalar(trimmed));
        }
    }
    return values.filter((value) => value.length > 0);
}

function parseApplyToValues(value: string): string[] {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return trimmed
            .slice(1, -1)
            .split(',')
            .map((item) => trimYamlScalar(item))
            .filter((item) => item.length > 0);
    }
    return trimmed
        .split(',')
        .map((item) => trimYamlScalar(item))
        .filter((item) => item.length > 0);
}

function trimYamlScalar(value: string): string {
    const cleaned = value.trim().replace(/,$/, '');
    if (
        (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
        return cleaned.slice(1, -1).trim();
    }
    return cleaned;
}

function matchesApplyTo(patterns: string[], changedFiles: string[]): boolean {
    if (patterns.length === 0 || changedFiles.length === 0) {
        return true;
    }
    return changedFiles.some((file) =>
        patterns.some((pattern) =>
            minimatch(file, pattern, { matchBase: true, dot: true })
        )
    );
}

async function readDirEntriesIfExists(
    dirPath: string
): Promise<Dirent[] | undefined> {
    try {
        return await readdir(dirPath, { withFileTypes: true });
    } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) {
            return undefined;
        }
        throw error;
    }
}

function toPosixPath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
    try {
        return await readFile(filePath, 'utf8');
    } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) {
            return undefined;
        }
        if (isErrnoCode(error, 'EISDIR')) {
            return undefined;
        }
        throw error;
    }
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
