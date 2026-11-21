// Copies non-TypeScript assets (prompt files) next to the compiled code in dist/
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', 'src', 'modules', 'ai', 'prompts');
const to = path.join(__dirname, '..', 'dist', 'modules', 'ai', 'prompts');

fs.mkdirSync(to, { recursive: true });
for (const file of fs.readdirSync(from)) {
    if (file.endsWith('.md')) fs.copyFileSync(path.join(from, file), path.join(to, file));
}
console.log(`Copied prompts to ${path.relative(process.cwd(), to)}`);
