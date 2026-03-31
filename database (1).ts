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
let databaseAdapter: any;

// Hidden require to bypass esbuild AST analysis parsing native C++ modules
// because they fail under ESM module bundling for the browser
const req = eval('require');
if (!isLocal) {
    if (process.env.TINA_DISABLE_GIT === 'true') {
        console.warn('Bypassing LevelDB during Tina Build to prevent Database Lock Errors. Using MemoryLevel.');
        const memLevelPath = path.join(process.cwd(), 'node_modules', 'memory-level');
        databaseAdapter = new (req(memLevelPath).MemoryLevel)({ valueEncoding: 'json' });
    } else {
        const dbPath = path.join(process.cwd(), '.tina-db');
        try {
            databaseAdapter = new (req('level').Level)(dbPath, { valueEncoding: 'json' });
            databaseAdapter.open().catch((err: any) => console.error('\n\n!!! FATAL LEVELDB OPEN ERROR !!!\nPath:', dbPath, '\nCause:', err, '\n\n'));
        } catch (e) {
            try {
                const levelPath = path.join(process.cwd(), 'node_modules', 'level');
                databaseAdapter = new (req(levelPath).Level)(dbPath, { valueEncoding: 'json' });
                databaseAdapter.open().catch((err: any) => console.error('\n\n!!! FATAL LEVELDB OPEN ERROR !!!\nPath:', dbPath, '\nCause:', err, '\n\n'));
            } catch (err) {
                console.warn('level not found. Using MemoryLevel fallback.');
                const memLevelPath = path.join(process.cwd(), 'node_modules', 'memory-level');
                databaseAdapter = new (req(memLevelPath).MemoryLevel)({ valueEncoding: 'json' });
            }
        }
    }
}

export default isLocal
    ? createLocalDatabase({ tinaDirectory: 'tina' })
    : createDatabase({
        tinaDirectory: 'tina',
        gitProvider: new GitLabProvider() as any,
        databaseAdapter: databaseAdapter,
        // Namespace should not vary by Git branch; branch selection is handled separately.
        namespace: 'dev',
        bridge: new FilesystemBridge(process.cwd()),
    });
