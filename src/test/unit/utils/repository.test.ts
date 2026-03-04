import * as path from 'path';
import { describe, expect, it } from 'vitest';

import {
    resolveRepositoryRoot,
    toRepositorySettingPath,
} from '@/utils/repository';

describe('resolveRepositoryRoot', () => {
    it('returns workspace root for empty repository path', () => {
        expect(resolveRepositoryRoot('/workspace', '')).toBe('/workspace');
    });

    it('returns workspace root for undefined repository path', () => {
        expect(resolveRepositoryRoot('/workspace', undefined)).toBe(
            '/workspace'
        );
    });

    it('resolves relative repository path from workspace root', () => {
        const resolved = resolveRepositoryRoot('/workspace', 'services/api');

        expect(resolved).toBe(path.resolve('/workspace', 'services/api'));
    });

    it('normalizes absolute repository path', () => {
        const resolved = resolveRepositoryRoot(
            '/workspace',
            '/tmp/repos/project/../api'
        );

        expect(resolved).toBe(path.normalize('/tmp/repos/project/../api'));
    });

    it('trims whitespace before resolving', () => {
        const resolved = resolveRepositoryRoot('/workspace', '  apps/web  ');

        expect(resolved).toBe(path.resolve('/workspace', 'apps/web'));
    });
});

describe('toRepositorySettingPath', () => {
    it('returns empty for workspace root', () => {
        expect(toRepositorySettingPath('/workspace', '/workspace')).toBe('');
    });

    it('returns workspace-relative path for repository in subdir', () => {
        expect(
            toRepositorySettingPath('/workspace', '/workspace/services/api')
        ).toBe('services/api');
    });

    it('returns absolute path for repository outside workspace', () => {
        expect(toRepositorySettingPath('/workspace', '/opt/repos/api')).toBe(
            path.normalize('/opt/repos/api')
        );
    });
});
