const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// Get the new author name from the command line arguments
const newAuthor = process.argv[2];

if (!newAuthor) {
    console.error("❌ Please provide a new author name!");
    console.log("👉 Example usage: node change-author.js 'Jane Doe'");
    process.exit(1);
}

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach(function (file) {
        if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
            arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
        } else {
            if (file.endsWith('.md') || file.endsWith('.mdx')) {
                arrayOfFiles.push(path.join(dirPath, file));
            }
        }
    });
    return arrayOfFiles;
}

function updateAuthorInFolder(directory) {
    if (!fs.existsSync(directory)) return;

    const files = getAllFiles(directory);
    let count = 0;

    files.forEach(file => {
        let content = fs.readFileSync(file, 'utf8');
        let parsed = matter(content);
        let data = parsed.data || {};
        let modified = false;

        // TinaCMS schema defines 'authors' as a list (array)
        if (data.authors) {
            data.authors = [newAuthor];
            modified = true;
        } else {
            // If they didn't have an author field before, we add it!
            data.authors = [newAuthor];
            modified = true;
        }

        // Handle edge-cases where someone typed 'author' instead of 'authors'
        if (data.author) {
            delete data.author; // Clean up old singular field if it exists
            data.authors = [newAuthor];
            modified = true;
        }

        if (modified) {
            fs.writeFileSync(file, matter.stringify(parsed.content, data));
            count++;
        }
    });

    console.log(`✅ Updated ${count} files in /${path.basename(directory)}`);
}

console.log(`Working... changing all authors to: "${newAuthor}"`);
updateAuthorInFolder(path.join(process.cwd(), 'docs'));
updateAuthorInFolder(path.join(process.cwd(), 'blog'));
console.log("🎉 Done!");
