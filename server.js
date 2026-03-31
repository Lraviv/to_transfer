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

// Import TinaCMS modules compiled or executed dynamically
const tinaDatabase = require('./tina/database');
const database = tinaDatabase.default;
const branchContext = tinaDatabase.branchContext;
const { resolve } = require('@tinacms/datalayer');

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

// Serialization
passport.serializeUser((user, done) => {
    done(null, user.uid || user.username);
});

passport.deserializeUser((id, done) => {
    done(null, { username: id });
});

// AD / LDAP Strategy
const OPTS = {
    server: {
        url: process.env.LDAP_URL || 'ldap://localhost:389',
        bindDN: process.env.LDAP_BIND_DN || 'cn=root',
        bindCredentials: process.env.LDAP_BIND_PASSWORD || 'secret',
        searchBase: process.env.LDAP_SEARCH_BASE || 'ou=users,dc=my,dc=domain',
        searchFilter: '(uid={{username}})'
    }
};
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

    res.send(`
    <html><body>
      <h2>Login to Edit Docs</h2>
      <form action="/login" method="post">
        <div><label>Username:</label><input type="text" name="username"/></div>
        <div><label>Password:</label><input type="password" name="password"/></div>
        <div>
          <label>Domain (Optional/Local):</label>
          <select name="domain">
            <option value="local">Local</option>
            <option value="ad">Active Directory</option>
          </select>
        </div>
        <div>
          <label>Select Branch:</label>
          <select name="branch">
            ${branchesDropdown}
          </select>
        </div>
        <div>
          <label>Or Create New Branch:</label>
          <input type="text" name="newBranch" placeholder="my-new-feature" />
        </div>
        <button type="submit">Log In</button>
      </form>
    </body></html>
  `);
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
                // branch does not exist, create it from dev
                await api.Branches.create(projectId, chosenBranch, 'dev');
            }
        } catch (e) {
            console.error("Failed to create branch:", e.message);
        }
    }

    req.session.branch = chosenBranch || 'dev';

    const strategy = req.body.domain === 'ad' ? 'ldapauth' : 'local';
    passport.authenticate(strategy, {
        successRedirect: '/admin',
        failureRedirect: '/login',
    })(req, res, next);
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
    if (req.isAuthenticated() || process.env.TINA_PUBLIC_IS_LOCAL === 'true') {
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
        branchFromParams ||
        branchFromVars ||
        req.session?.branch ||
        process.env.GITLAB_BRANCH ||
        'main';

    try {
        const result = await branchContext.run(activeBranch, () =>
            resolve({
                config: { useRelativeMedia: true },
                database,
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

        if (typeof database.indexContent === 'function') {
            await database.indexContent({ graphQLSchema, tinaSchema, lookup });
            console.log("Finished indexing.");
        } else {
            // In some datalayer modes (notably local DB mode), `indexContent` isn't available.
            // In that case, Tina should already be indexed via `tina-build` / filesystem reads.
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
