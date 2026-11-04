'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const source = `eval(require('fs').readFileSync(${JSON.stringify(path.join(__dirname, 'obsidian-regression.js'))}, 'utf8'))`;
const encoded = Buffer.from(source).toString('base64');
const code = `eval(new TextDecoder().decode(Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0))))`;
const output = execFileSync(process.platform === 'win32' ? 'Obsidian.com' : 'obsidian', [
  `vault=${process.argv[2] || 'Arcanum'}`, 'eval', `code=${code}`,
], { encoding: 'utf8' });
process.stdout.write(output);
if (!output.includes('"failed":0')) process.exitCode = 1;
