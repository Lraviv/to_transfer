    const loginHtml = require('fs').readFileSync(path.join(__dirname, 'views', 'login.html'), 'utf8');
    res.send(loginHtml.replace('{{BRANCHES_DROPDOWN}}', branchesDropdown));