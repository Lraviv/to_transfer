"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchContext = void 0;
var datalayer_1 = require("@tinacms/datalayer");
var rest_1 = require("@gitbeaker/rest");
var path_1 = __importDefault(require("path"));
var isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';
var branchContextLocal;
try {
    var AsyncLocalStorage = eval('require')('async_hooks').AsyncLocalStorage;
    branchContextLocal = new AsyncLocalStorage();
}
catch (e) {
    branchContextLocal = { getStore: function () { return undefined; }, run: function (store, cb) { return cb(); } };
}
exports.branchContext = branchContextLocal;
var GitLabProvider = /** @class */ (function () {
    function GitLabProvider() {
        this.projectId = process.env.GITLAB_PROJECT_ID || process.env.GITLAB_PROJECT_PATH || '';
        this.branch = 'dev'; // Hardcoded to dev as requested
        if (!isLocal) {
            this.api = new rest_1.Gitlab({
                host: process.env.GITLAB_HOST || 'https://gitlab.org',
                token: process.env.GITLAB_PERSONAL_ACCESS_TOKEN || '',
            });
        }
    }
    GitLabProvider.prototype.onPut = function (key, value) {
        return __awaiter(this, void 0, void 0, function () {
            var currentBranch, fileExists, e_1, action, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (isLocal || process.env.TINA_DISABLE_GIT === 'true')
                            return [2 /*return*/];
                        currentBranch = exports.branchContext.getStore() || this.branch;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 7, , 8]);
                        fileExists = true;
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.api.RepositoryFiles.show(this.projectId, key, currentBranch)];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        e_1 = _a.sent();
                        fileExists = false;
                        return [3 /*break*/, 5];
                    case 5:
                        action = fileExists ? 'update' : 'create';
                        return [4 /*yield*/, this.api.orgmits.create(this.projectId, currentBranch, "TinaCMS: ".concat(action, " ").concat(key), [
                                {
                                    action: action,
                                    filePath: key,
                                    content: value,
                                },
                            ])];
                    case 6:
                        _a.sent();
                        return [3 /*break*/, 8];
                    case 7:
                        error_1 = _a.sent();
                        console.error('GitLab onPut Error:', error_1);
                        throw error_1;
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    GitLabProvider.prototype.onDelete = function (key) {
        return __awaiter(this, void 0, void 0, function () {
            var currentBranch, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (isLocal || process.env.TINA_DISABLE_GIT === 'true')
                            return [2 /*return*/];
                        currentBranch = exports.branchContext.getStore() || this.branch;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.api.orgmits.create(this.projectId, currentBranch, "TinaCMS: delete ".concat(key), [
                                {
                                    action: 'delete',
                                    filePath: key,
                                },
                            ])];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        error_2 = _a.sent();
                        console.error('GitLab onDelete Error:', error_2);
                        throw error_2;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return GitLabProvider;
}());
var databaseAdapter;
// Hidden require to bypass esbuild AST analysis parsing native C++ modules
// because they fail under ESM module bundling for the browser
var req = eval('require');
if (!isLocal) {
    if (process.env.TINA_DISABLE_GIT === 'true') {
        console.warn('Bypassing LevelDB during Tina Build to prevent Database Lock Errors. Using mockup.');
        databaseAdapter = {
            put: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/];
            }); }); },
            get: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/];
            }); }); },
            del: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/];
            }); }); },
            batch: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/];
            }); }); },
            clear: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                return [2 /*return*/];
            }); }); },
            iterator: function () { return ({ next: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                    return [2 /*return*/, []];
                }); }); }, end: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                    return [2 /*return*/];
                }); }); } }); },
            keys: function () { return ({ next: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                    return [2 /*return*/, []];
                }); }); }, end: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                    return [2 /*return*/];
                }); }); } }); },
            values: function () { return ({ next: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                    return [2 /*return*/, []];
                }); }); }, end: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                    return [2 /*return*/];
                }); }); } }); },
            sublevel: function () { return databaseAdapter; },
        };
    }
    else {
        var dbPath_1 = path_1.default.join(process.cwd(), '.tina-db');
        try {
            databaseAdapter = new (req('level').Level)(dbPath_1, { valueEncoding: 'json' });
            databaseAdapter.open().catch(function (err) { return console.error('\n\n!!! FATAL LEVELDB OPEN ERROR !!!\nPath:', dbPath_1, '\nCause:', err, '\n\n'); });
        }
        catch (e) {
            try {
                var levelPath = path_1.default.join(process.cwd(), 'node_modules', 'level');
                databaseAdapter = new (req(levelPath).Level)(dbPath_1, { valueEncoding: 'json' });
                databaseAdapter.open().catch(function (err) { return console.error('\n\n!!! FATAL LEVELDB OPEN ERROR !!!\nPath:', dbPath_1, '\nCause:', err, '\n\n'); });
            }
            catch (err) {
                console.warn('level not found. Using a mockup for database adapter.');
                databaseAdapter = {
                    put: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                        return [2 /*return*/];
                    }); }); },
                    get: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                        return [2 /*return*/];
                    }); }); },
                    del: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                        return [2 /*return*/];
                    }); }); },
                    batch: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                        return [2 /*return*/];
                    }); }); },
                    clear: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                        return [2 /*return*/];
                    }); }); },
                    iterator: function () { return ({ next: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                            return [2 /*return*/, []];
                        }); }); }, end: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                            return [2 /*return*/];
                        }); }); } }); },
                    keys: function () { return ({ next: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                            return [2 /*return*/, []];
                        }); }); }, end: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                            return [2 /*return*/];
                        }); }); } }); },
                    values: function () { return ({ next: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                            return [2 /*return*/, []];
                        }); }); }, end: function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
                            return [2 /*return*/];
                        }); }); } }); },
                    sublevel: function () { return databaseAdapter; },
                };
            }
        }
    }
}
exports.default = isLocal
    ? (0, datalayer_1.createLocalDatabase)({ tinaDirectory: 'tina' })
    : (0, datalayer_1.createDatabase)({
        tinaDirectory: 'tina',
        gitProvider: new GitLabProvider(),
        databaseAdapter: databaseAdapter,
        namespace: 'dev',
        // We add the FilesystemBridge so it can read local templates
        bridge: new datalayer_1.FilesystemBridge(process.cwd()),
    });
