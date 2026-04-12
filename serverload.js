const getSetActiveBranch = async () => {
    if (!tinaDatabaseCache) tinaDatabaseCache = await import('./tina/database.js');
    // Returns the exported setActiveBranch function from tina/database.js
    return tinaDatabaseCache.setActiveBranch || tinaDatabaseCache.default?.setActiveBranch;
};


    // setActiveBranch updates the GitLabProvider instance directly.
    // db.gitProvider is NOT exposed by createDatabase, so we use the exported helper.
    const setActiveBranch = await getSetActiveBranch();
    if (typeof setActiveBranch === 'function') {
        setActiveBranch(activeBranch);
    }


        const fromContext = branchContext.getStore();
        const currentBranch = fromContext || this.branch;
        console.log(`[GitLabProvider] onPut: branch=${currentBranch} (from=${fromContext ? 'AsyncLocalStorage' : 'this.branch fallback'}) file=${key}`);



        const fromContext = branchContext.getStore();
        const currentBranch = fromContext || this.branch;
        console.log(`[GitLabProvider] onPut: branch=${currentBranch} (from=${fromContext ? 'AsyncLocalStorage' : 'this.branch fallback'}) file=${key}`);
        



// Keep a module-level reference so server.js can set the active branch directly.
// (createDatabase does not expose gitProvider on the returned db object)
const gitLabProvider = new GitLabProvider();

/** Called by server.js before each GraphQL mutation to ensure the correct branch is used */
export const setActiveBranch = (branch: string) => {
    gitLabProvider.branch = branch;
};
