import { createDatabase, createLocalDatabase, FilesystemBridge } from '@tinacms/datalayer';
import { Gitlab } from '@gitbeaker/rest';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';

export const branchContext = new AsyncLocalStorage<string>();

class GitLabProvider {
    private api: any;
    private projectId: string;
    private branch: string;

    constructor() {
        this.projectId = process.env.GITLAB_PROJECT_PATH || '';
        this.branch = process.env.GITLAB_BRANCH || 'main'; // Stop hardcoding 'dev' here!

        if (!isLocal) {
            this.api = new Gitlab({
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
                [
                    {
                        action: action,
                        filePath: key,
                        content: value,
                    },
                ]
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
                [
                    {
                        action: 'delete',
                        filePath: key,
                    },
                ]
            );
        } catch (error) {
            console.error('GitLab onDelete Error:', error);
            throw error;
        }
    }
}
export default (async () => {
    const dl = await import('@tinacms/datalayer');

    let databaseAdapter: any;
    if (!isLocal) {
        if (process.env.TINA_DISABLE_GIT === 'true') {
            console.warn('Bypassing LevelDB during Tina Build to prevent Lock Errors. Booting strictly memory-level.');
            const MemoryLevelClass = (await import('memory-level')).MemoryLevel;
            databaseAdapter = new MemoryLevelClass({ valueEncoding: 'json' });
        } else {
            const dbPath = path.join(process.cwd(), '.tina-db');
            try {
                const LevelClass = (await import('level')).Level;
                databaseAdapter = new LevelClass(dbPath, { valueEncoding: 'json' });
                databaseAdapter.open().catch((err: any) => console.error('\n\n!!! FATAL LEVELDB OPEN ERROR !!!\nPath:', dbPath, '\nCause:', err));
            } catch (err) {
                console.warn('Level runtime rejected inside OpenShift. Bouncing universally to memory-level.');
                const MemoryLevelClass = (await import('memory-level')).MemoryLevel;
                databaseAdapter = new MemoryLevelClass({ valueEncoding: 'json' });
            }
        }
    }

    return isLocal
        ? dl.createLocalDatabase({ tinaDirectory: 'tina' })
        : dl.createDatabase({
            tinaDirectory: 'tina',
            gitProvider: new GitLabProvider() as any,
            databaseAdapter: databaseAdapter,
            namespace: process.env.GITLAB_BRANCH || 'main',
            // We add the FilesystemBridge so it can read local templates
            bridge: new dl.FilesystemBridge(process.cwd()),
        });
})();
