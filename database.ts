import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';

export const branchContext = new AsyncLocalStorage<string>();

class GitLabProvider {
    private api: any;
    private projectId: string;
    private branch: string;

    constructor(gitlabModule: any) {
        this.projectId = process.env.GITLAB_PROJECT_PATH || '';
        this.branch = process.env.GITLAB_BRANCH || 'main';

        if (!isLocal) {
            this.api = new gitlabModule.Gitlab({
                host: process.env.GITLAB_HOST || 'https://gitlab.org',
                token: process.env.GITLAB_PERSONAL_ACCESS_TOKEN || '',
            });
        }
    }

    async onPut(key: string, value: string) {
        if (isLocal || process.env.TINA_DISABLE_GIT === 'true') return;
        const currentBranch = branchContext.getStore() || this.branch;
        try {
            let fileExists = true;
            try {
                await this.api.RepositoryFiles.show(this.projectId, key, currentBranch);
            } catch (e) {
                fileExists = false;
            }

            const action = fileExists ? 'update' : 'create';
            await this.api.Commits.create(
                this.projectId,
                currentBranch,
                `TinaCMS: ${action} ${key}`,
                [{ action, filePath: key, content: value }]
            );
        } catch (error) {
            console.error('GitLab onPut Error:', error);
            throw error;
        }
    }

    async onDelete(key: string) {
        if (isLocal || process.env.TINA_DISABLE_GIT === 'true') return;
        const currentBranch = branchContext.getStore() || this.branch;
        try {
            await this.api.Commits.create(
                this.projectId,
                currentBranch,
                `TinaCMS: delete ${key}`,
                [{ action: 'delete', filePath: key }]
            );
        } catch (error) {
            console.error('GitLab onDelete Error:', error);
            throw error;
        }
    }
}

// Export a Promise that resolves to the database instance.
// Using dynamic import() for all ESM-only packages (@tinacms/datalayer,
// @gitbeaker/rest, level, memory-level) so this file can be compiled to
// CommonJS by tsc without triggering ERR_REQUIRE_ESM.
const databasePromise: Promise<any> = (async () => {
    const datalayer = await import('@tinacms/datalayer');
    const { createDatabase, createLocalDatabase, FilesystemBridge } = datalayer;

    if (isLocal) {
        return createLocalDatabase({ tinaDirectory: 'tina' });
    }

    // ── LevelDB / MemoryLevel adapter ────────────────────────────────────────
    let databaseAdapter: any;

    if (process.env.TINA_DISABLE_GIT === 'true') {
        console.warn('Bypassing LevelDB (TINA_DISABLE_GIT=true). Using MemoryLevel.');
        const { MemoryLevel } = await import('memory-level');
        databaseAdapter = new MemoryLevel({ valueEncoding: 'json' });
    } else {
        const dbPath = path.join(process.cwd(), '.tina-db');
        try {
            const { Level } = await import('level');
            databaseAdapter = new Level(dbPath, { valueEncoding: 'json' });
            await databaseAdapter.open().catch((err: any) =>
                console.error('\n\n!!! FATAL LEVELDB OPEN ERROR !!!\nPath:', dbPath, '\nCause:', err, '\n\n')
            );
        } catch (e) {
            console.warn('level open failed. Using MemoryLevel fallback.');
            const { MemoryLevel } = await import('memory-level');
            databaseAdapter = new MemoryLevel({ valueEncoding: 'json' });
        }
    }

    // ── GitLab provider ───────────────────────────────────────────────────────
    const gitlabModule = await import('@gitbeaker/rest');

    return createDatabase({
        tinaDirectory: 'tina',
        gitProvider: new GitLabProvider(gitlabModule) as any,
        databaseAdapter,
        namespace: 'dev',
        bridge: new FilesystemBridge(process.cwd()),
    });
})();

export default databasePromise;
