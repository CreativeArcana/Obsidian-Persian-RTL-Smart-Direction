'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { module: { exports: {} }, require: name => {
  assert.equal(name, 'obsidian');
  return { Plugin: class {} };
} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
const { latinRanges, documentDirections, codeComments } = context.module.exports.helpers;
const phrases = text => Array.from(latinRanges(text), range => text.slice(range.from, range.to));

test('keeps a multiword English phrase together inside Persian', () => {
  assert.deepEqual(phrases('ویدئو How to cook pizza? را داشتم می‌دیدم.'), ['How to cook pizza?']);
  assert.deepEqual(phrases('متن How  to\tcook pizza? فارسی'), ['How  to\tcook pizza?']);
});

test('keeps terminal English words and identifiers in source order', () => {
  for (const word of ['Agent', 'human_check', 'AGENTS', 'Unity']) {
    assert.deepEqual(phrases(`در مسیر ${word}`), [word]);
  }
});

test('does not merge across Persian, table cells, or line boundaries', () => {
  assert.deepEqual(phrases('| فارسی Agent | hello world |'), ['Agent', 'hello world']);
  assert.deepEqual(phrases('English\nnext line'), ['English', 'next line']);
  assert.deepEqual(phrases('Agent و Unity'), ['Agent', 'Unity']);
  assert.deepEqual(phrases('Agent، Unity'), ['Agent', 'Unity']);
});

test('preserves balanced brackets around phrases and mixed-language brackets', () => {
  assert.deepEqual(phrases('متن (How to cook pizza?) فارسی'), ['(How to cook pizza?)']);
  assert.deepEqual(phrases('متن (نسخه Agent) فارسی'), ['Agent']);
  assert.deepEqual(phrases('متن (Agent نسخه) فارسی'), ['Agent']);
  assert.deepEqual(phrases('متن [hello world](https://example.com) فارسی'), ['[hello world](https://example.com)']);
  assert.deepEqual(phrases('متن (Cook pizza. Then eat.) فارسی'), ['(Cook pizza. Then eat.)']);
});

test('retains fenced-code, frontmatter and Persian comment classification', () => {
  const result = documentDirections('---\ntitle: نمونه\n---\n\nمتن How to cook pizza? فارسی\n\n```js\nconst a = "متن";\n// متن hello world\n```\n\n| یادداشت |\n| --- |\n| در مسیر Agent |');
  assert.deepEqual(Array.from(result.rtlLines), [2, 5, 9, 12, 14]);
  assert.equal(codeComments(['const url = "https://example.com"; // متن hello world'], 'js').get(0)[0].standalone, false);
});

test('keeps sentence periods outside English runs while preserving internal dots', () => {
  assert.deepEqual(phrases('پیشنهاد فعلی است. LLM استدلال را ارزیابی می‌کند.'), ['LLM']);
  assert.deepEqual(phrases('با هنر 2D در Unity .'), ['2D', 'Unity']);
  assert.deepEqual(phrases('با هنر 2D در Unity.'), ['2D', 'Unity']);
  assert.deepEqual(phrases('متن LLM-Wiki/AGENTS.md و https://example.com و v1.2 و .NET'), ['LLM-Wiki/AGENTS.md', 'https://example.com', 'v1.2', '.NET']);
  assert.deepEqual(phrases('متن `Unity`. LLM فارسی'), ['`Unity`', 'LLM']);
});

test('separates ordered list numbers and English phrases, including nested tasks', () => {
  for (const text of ['1. this task شماره درست نوشته شود', '  12) this task شماره', '> 3. [ ] this task شماره']) {
    const ranges = Array.from(latinRanges(text, true), range => text.slice(range.from, range.to));
    assert.deepEqual(ranges, ['this task']);
  }
});

test('handles Persian text fences as prose and keeps programming statements LTR', () => {
  for (const language of ['text', 'txt', 'plain', 'plaintext', 'TEXT']) {
    const source = '```' + language + '\nپروژهٔ فعلی Vault من است.\nEnglish only\nابتدا Doctor و Status بده.\n```';
    assert.deepEqual(Array.from(documentDirections(source).rtlLines), [2, 4]);
  }
  assert.deepEqual(Array.from(documentDirections('```js\nconst text = "فارسی";\n```').rtlLines), []);
});
