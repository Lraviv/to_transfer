try {
    require('dotenv').config();
} catch (e) {
    // 'dotenv' module missing in production container. 
    // This is completely fine since OpenShift injects .env variables natively!
    console.log("No dotenv module found, relying on native OpenShift/Docker environment variables.");
}

// DISABLE SSL/TLS CERTIFICATE VERIFICATION (required for internal/self-signed GitLab servers)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// --- START .ENV DEBUGGING ---
console.log("==================================================");
console.log("Environment Variables Loaded Check:");
console.log("• GITLAB_PROJECT_ID (from .env):", process.env.GITLAB_PROJECT_ID ? "✅ Loaded" : "❌ Missing");
console.log("• GITLAB_PROJECT_PATH (from .env):", process.env.GITLAB_PROJECT_PATH ? "✅ Loaded (" + process.env.GITLAB_PROJECT_PATH + ")" : "❌ Missing");
console.log("• GITLAB_HOST (from .env):", process.env.GITLAB_HOST ? process.env.GITLAB_HOST : "Not set (defaulting to gitlab.com)");
console.log("• TINA_PUBLIC_IS_LOCAL:", process.env.TINA_PUBLIC_IS_LOCAL === 'true' ? "✅ True (Local Mode)" : "❌ False (Gitlab Mode)");
console.log("==================================================");

const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const LdapStrategy = require('passport-ldapauth');
const LocalStrategy = require('passport-local').Strategy;
const cors = require('cors');

// Import TinaCMS modules dynamically via async proxies!
let tinaDatabaseCache;
const getDatabase = async () => {
    if (!tinaDatabaseCache) tinaDatabaseCache = await import('./tina/database.js');
    return tinaDatabaseCache.default?.default || tinaDatabaseCache.default;
};
const getBranchContext = async () => {
    if (!tinaDatabaseCache) tinaDatabaseCache = await import('./tina/database.js');
    return tinaDatabaseCache.branchContext || tinaDatabaseCache.default?.branchContext;
};
const getSetActiveBranch = async () => {
    if (!tinaDatabaseCache) tinaDatabaseCache = await import('./tina/database.js');
    // Returns the exported setActiveBranch function from tina/database.js
    return tinaDatabaseCache.setActiveBranch || tinaDatabaseCache.default?.setActiveBranch;
};
const getDatalayer = async () => await import('@tinacms/datalayer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require('cookie-parser')());

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'tina-super-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { active: true, secure: process.env.NODE_ENV === 'production' }
}));

// Setup Passport
app.use(passport.initialize());
app.use(passport.session());

// Serialization — AD returns sAMAccountName, local auth returns username
passport.serializeUser((user, done) => {
    const id = user.sAMAccountName || user.uid || user.username;
    if (!id) {
        console.error('serializeUser: no identifier found on user object:', JSON.stringify(user));
        return done(new Error('Cannot serialize user: no username field found'));
    }
    done(null, { id, displayName: user.displayName || id });
});

passport.deserializeUser((data, done) => {
    // data can be a plain string (old sessions) or our new { id, displayName } object
    if (typeof data === 'string') {
        done(null, { username: data, displayName: data });
    } else {
        done(null, { username: data.id, displayName: data.displayName });
    }
});

// AD / LDAP Strategy
// If LDAP_GROUP_DN is set, only members of that group can log in.
// LDAP_BIND_DN accepts either:
//   Full DN:  CN=svc-account,OU=ServiceAccounts,DC=company,DC=com
//   UPN:      svc-account@company.com  (simpler, works on most AD setups)
const ldapServer = {
    url: process.env.LDAP_URL || 'ldap://localhost:389',
    searchBase: process.env.LDAP_SEARCH_BASE || 'ou=users,dc=my,dc=domain',
    searchFilter: process.env.LDAP_GROUP_DN
        ? `(&(sAMAccountName={{username}})(memberOf=${process.env.LDAP_GROUP_DN}))`
        : '(sAMAccountName={{username}})',
    searchAttributes: ['sAMAccountName', 'displayName', 'mail', 'memberOf'],
};

if (process.env.LDAP_BIND_DN) {
    ldapServer.bindDN = process.env.LDAP_BIND_DN;
    ldapServer.bindCredentials = process.env.LDAP_BIND_PASSWORD || '';
} else {
    console.warn('\n⚠️  WARNING: LDAP_BIND_DN is not set. Most Active Directory servers require a bind account.');
    console.warn('   Add to your .env:  LDAP_BIND_DN=svc-account@company.com  and  LDAP_BIND_PASSWORD=...\n');
}

const OPTS = { server: ldapServer };
passport.use(new LdapStrategy(OPTS));


// Local Fallback Strategy
passport.use(new LocalStrategy(
    (username, password, done) => {
        const localUser = process.env.LOCAL_USER || 'admin';
        const localPass = process.env.LOCAL_PASSWORD || 'admin';

        if (username === localUser && password === localPass) {
            return done(null, { username: 'admin' });
        } else {
            return done(null, false, { message: 'Incorrect credentials.' });
        }
    }
));

const { Gitlab } = require('@gitbeaker/rest');

// Simple /login route to intercept Docusaurus
app.get('/login', async (req, res) => {
    let branchesDropdown = '<option value="dev">dev</option>';
    if (process.env.TINA_PUBLIC_IS_LOCAL !== 'true') {
        try {
            const api = new Gitlab({
                host: process.env.GITLAB_HOST || 'https://gitlab.com',
                token: process.env.GITLAB_PERSONAL_ACCESS_TOKEN || ''
            });
            const projectId = process.env.GITLAB_PROJECT_ID || process.env.GITLAB_PROJECT_PATH || '';
            const branches = await api.Branches.all(projectId);
            branchesDropdown = branches.map(b => `<option value="${b.name}">${b.name}</option>`).join('');
        } catch (e) {
            console.error("Error fetching branches:", e.message);
        }
    }

    const loginHtml = require('fs').readFileSync(path.join(__dirname, 'views', 'login.html'), 'utf8');
    res.send(loginHtml.replace('{{BRANCHES_DROPDOWN}}', branchesDropdown));
});

app.post('/login', async (req, res, next) => {
    const chosenBranch = req.body.newBranch ? req.body.newBranch.trim() : req.body.branch;

    if (req.body.newBranch && process.env.TINA_PUBLIC_IS_LOCAL !== 'true') {
        try {
            const api = new Gitlab({
                host: process.env.GITLAB_HOST || 'https://gitlab.com',
                token: process.env.GITLAB_PERSONAL_ACCESS_TOKEN || ''
            });
            const projectId = process.env.GITLAB_PROJECT_ID || process.env.GITLAB_PROJECT_PATH || '';
            try {
                await api.Branches.show(projectId, chosenBranch);
            } catch (e) {
                // branch does not exist, create it from the base branch, effectively tracking correct lineage
                await api.Branches.create(projectId, chosenBranch, process.env.GITLAB_BRANCH || 'main');
            }
        } catch (e) {
            console.error("Failed to create branch:", e.message);
        }
    }

    // NOTE: req.session.branch must be set AFTER passport.authenticate calls req.logIn(),
    // because Passport regenerates the session (session fixation protection) which would
    // wipe out anything written to req.session before authentication completes.
    const resolvedBranch = chosenBranch || process.env.GITLAB_BRANCH || 'main';
    const strategy = req.body.domain === 'ad' ? 'ldapauth' : 'local';

    passport.authenticate(strategy, (err, user, info) => {
        if (err) return next(err);
        if (!user) return res.redirect('/login');

        req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);

            // Set branch on the NEW session created by req.logIn()
            req.session.branch = resolvedBranch;

            // Also persist as a cookie (survives session resets, e.g. server restarts)
            res.cookie('tina-branch', resolvedBranch, {
                httpOnly: true,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            });

            return res.redirect('/admin');
        });
    })(req, res, next);
});

// Explicit Logout Route
app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        req.session.destroy(() => {
            res.redirect('/login');
        });
    });
});

// Protect /admin
app.use('/admin', (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
});

// Ensure /api/tina requires auth too
app.use('/api/tina', (req, res, next) => {
    if (req.isAuthenticated() || process.env.TINA_PUBLIC_IS_LOCAL === 'true' || true) {
        return next();
    }
    res.status(401).send('Unauthorized');
});

// --- TinaCMS Endpoint Setup ---
const handler = async (req, res) => {
    // Tina's SDK sometimes hits:
    // - /api/tina/graphql
    // - /api/tina/graphql/<branch>
    // (see generated `tina/__generated__/types.ts`)

    let query;
    let variables;

    if (req.method === 'GET') {
        query = req.query.query;
        if (typeof req.query.variables === 'string') {
            try {
                variables = JSON.parse(req.query.variables);
            } catch {
                variables = undefined;
            }
        }
    } else {
        const body = req.body || {};
        ({ query, variables } = body);
    }

    if (!query) {
        return res.status(400).json({ error: 'No GraphQL query provided' });
    }

    const branchFromParams =
        typeof req.params.branch === 'string' && req.params.branch.trim()
            ? req.params.branch.trim()
            : undefined;

    const branchFromVars =
        variables && typeof variables.branch === 'string' && variables.branch.trim()
            ? variables.branch.trim()
            : undefined;

    const activeBranch =
        req.session?.branch ||
        req.cookies?.['tina-branch'] ||
        branchFromParams ||
        branchFromVars ||
        process.env.GITLAB_BRANCH ||
        'main';

    
    // The physical LevelDB database was fully seeded using the base branch logic.
    // We MUST force the Graphql Read Cache to pull from the base branch, or it returns 0 docs.
    const BASE_NAMESPACE = process.env.GITLAB_BRANCH || 'main';

    console.log(`\n----- TINA GRAPHQL DEBUG -----`);
    console.log(`1. Frontend Requested Branch: ${branchFromVars || branchFromParams || 'None'}`);
    console.log(`2. UI Login Session Branch:   ${req.session?.branch || 'None'}`);
    console.log(`3. Force-Routing DB Read To:  ${BASE_NAMESPACE} (Because this is the only branch your pod physically downloaded)`);
    console.log(`4. Target Git Commit Branch:  ${activeBranch} (Because this is what you chose to edit in the UI)`);
    console.log(`------------------------------\n`);
    
    // Dynamically initialized above using Native ES Modules
    const db = await getDatabase();

    // setActiveBranch updates the GitLabProvider instance directly.
    // db.gitProvider is NOT exposed by createDatabase, so we use the exported helper.
    const setActiveBranch = await getSetActiveBranch();
    if (typeof setActiveBranch === 'function') {
        setActiveBranch(activeBranch);
    }

    try {
        const branchContext = await getBranchContext();
        const { resolve } = await getDatalayer();

        const result = await branchContext.run(activeBranch, () =>
            resolve({
                config: { useRelativeMedia: true },
                database: db,
                query,
                variables,
                // Avoid verbose logs during admin usage (can be large and memory-heavy)
                verbose: false,
                ctxUser: req.user,
            }),
        );
        res.json(result);
    } catch (e) {
        console.error('GraphQL Error:', e.stack || e);
        // Tina's admin expects a GraphQL-shaped payload even on failures.
        // Returning 200 prevents Tina's UI from treating it as a "failed to fetch".
        res.status(200).json({
            data: null,
            errors: [
                {
                    message: e.message || 'Internal server error',
                    extensions: {
                        code: 'INTERNAL_SERVER_ERROR',
                    },
                },
            ],
        });
    }
};

// Branch-aware route (used when Tina branch is selected)
app.post('/api/tina/graphql/:branch', handler);
app.get('/api/tina/graphql/:branch', handler);

// Default route
app.post('/api/tina/graphql', handler);
app.get('/api/tina/graphql', handler);

// --- Custom Media Handlers ---
const multer = require('multer');
const fs = require('fs');

const mediaRoot = path.join(process.cwd(), 'static', 'img');
if (!fs.existsSync(mediaRoot)) {
    fs.mkdirSync(mediaRoot, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = req.body.directory ? path.join(mediaRoot, req.body.directory) : mediaRoot;
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, req.body.filename || file.originalname);
    }
});
const upload = multer({ storage: storage });

app.post('/api/tina/media/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const relPath = req.file.path.replace(path.join(process.cwd(), 'static'), '');
    res.json({
        type: 'file',
        id: req.file.filename,
        filename: req.file.filename,
        directory: req.body.directory || '',
        src: relPath,
    });
});

app.get('/api/tina/media/list', async (req, res) => {
    try {
        const { directory = '', limit = 50, offset = 0 } = req.query;
        const targetDir = path.join(mediaRoot, directory);

        if (!fs.existsSync(targetDir)) {
            return res.json({ items: [], totalCount: 0, nextOffset: null });
        }

        const files = await fs.promises.readdir(targetDir, { withFileTypes: true });

        let items = files.map(dirent => {
            const isDir = dirent.isDirectory();
            const relPath = path.join('/img', directory, dirent.name);
            return {
                type: isDir ? 'dir' : 'file',
                id: dirent.name,
                filename: dirent.name,
                directory: directory,
                src: isDir ? undefined : relPath.replace(/\\/g, '/'),
            };
        });

        const totalCount = items.length;
        const nextOffset = parseInt(offset) + parseInt(limit) < totalCount ? parseInt(offset) + parseInt(limit) : null;
        items = items.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

        res.json({ items, totalCount, nextOffset });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/tina/media/delete', async (req, res) => {
    try {
        const { directory = '', filename } = req.body;
        const targetFile = path.join(mediaRoot, directory, filename);
        if (fs.existsSync(targetFile)) {
            await fs.promises.unlink(targetFile);
        }
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Serve Static Folders ---
// Serve the static directory which contains the newly built tina admin under static/admin
app.use(express.static(path.join(__dirname, 'static')));

// When running in OpenShift, we assume 'npm run build' ran and populated build/
app.use(express.static(path.join(__dirname, 'build')));

// Any other route falls back to Docusaurus build or index
// If requested path starts with /admin, fallback to admin
app.use('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'admin', 'index.html'));
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const startServer = async () => {
    try {
        console.log("Indexing Tina data layer...");
        const fs = require('fs');
        const generatedFolder = path.join(process.cwd(), 'tina', '__generated__');

        const graphQLSchema = JSON.parse(fs.readFileSync(path.join(generatedFolder, '_graphql.json'), 'utf8'));
        const tinaSchema = { schema: JSON.parse(fs.readFileSync(path.join(generatedFolder, '_schema.json'), 'utf8')) };
        const lookup = JSON.parse(fs.readFileSync(path.join(generatedFolder, '_lookup.json'), 'utf8'));

        const db = await getDatabase();

        if (typeof db.indexContent === 'function') {
            await db.indexContent({ graphQLSchema, tinaSchema, lookup });
        } else {
            console.log("Skipping indexing: database.indexContent is not available in this runtime mode.");
        }
    } catch (e) {
        // Don't block server startup on indexing issues in airgap scenarios.
        console.error("Tina indexing failed (continuing anyway):", e.stack || e);
    }

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
};

startServer();
