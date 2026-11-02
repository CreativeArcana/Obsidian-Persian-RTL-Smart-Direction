'use strict';

const { Plugin } = require('obsidian');
const RTL_CLASS = 'persian-smart-direction-rtl';
const LTR_CLASS = 'persian-smart-direction-ltr';
const COMMENT_CLASS = 'persian-smart-direction-comment';
const TEXT_BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,td,th,figcaption';
const IGNORED_CONTENT = 'pre,script,style,svg,math,.math,.internal-embed,.metadata-container';
const UI_FIELDS = '.inline-title,.view-header-title,.workspace-tab-header-inner-title,.nav-file-title-content,.metadata-property-value,.metadata-property-value input,.metadata-property-value textarea,.metadata-property-value [contenteditable],.metadata-property-value .multi-select-pill-content';
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const WORDS = /[\p{L}\p{M}]+(?:[\u200c\u200d][\p{L}\p{M}]+)*/gu;

function visibleText(text) {
  return text
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[![a-z-]+\]/gi, ' ');
}

function analyzeText(text, markdown = true) {
  let persianWords = 0;
  let latinWords = 0;
  for (const word of (markdown ? visibleText(text) : text).match(WORDS) || []) {
    if (ARABIC_SCRIPT.test(word)) persianWords++;
    else if (LATIN_SCRIPT.test(word)) latinWords++;
  }
  return { persianWords, latinWords, rtl: persianWords > 0 };
}

// Keep Latin tokens and their symbols together, without separating bracket pairs
// across isolates. Mixed-language or multi-word parentheses stay in the parent
// bidi context so the Unicode bracket-pair algorithm can resolve both ends.
function latinRanges(text) {
  const ranges = [];
  const opening = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
  const closing = new Set(opening.values());
  const stack = [];
  const pairs = new Map();
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (opening.has(character)) stack.push({ index, close: opening.get(character) });
    else if (closing.has(character) && stack.at(-1)?.close === character) {
      const start = stack.pop().index;
      pairs.set(start, index);
      pairs.set(index, start);
    }
  }
  const tokens = /[^\s\p{Script=Arabic}\u200c\u200d\u060c\u061b\u061f\u06d4]+/gu;
  for (const token of text.matchAll(tokens)) {
    if (!LATIN_SCRIPT.test(token[0])) continue;
    const end = token.index + token[0].length;
    let from = token.index;
    function flush(to) {
      if (LATIN_SCRIPT.test(text.slice(from, to))) ranges.push({ from, to });
    }
    for (let index = from; index < end; index++) {
      if (!opening.has(text[index]) && !closing.has(text[index])) continue;
      const paired = pairs.get(index);
      if (paired === undefined || paired < token.index || paired >= end) {
        flush(index);
        from = index + 1;
      }
    }
    flush(end);
  }
  return ranges;
}

// Scan comments without mistaking comment markers inside quoted strings for comments.
// Ranges are line-local, allowing mixed code/comment lines to keep their code LTR.
function codeComments(lines, language = '') {
  const result = new Map();
  const hash = /^(?:py(?:thon)?|sh|bash|zsh|shell|fish|rb|ruby|perl|r|yaml|yml|toml|conf|ini|powershell|ps1)$/i.test(language);
  const dash = /^(?:sql|lua|haskell|hs)$/i.test(language);
  const html = /^(?:html|xml|svg|markup|vue|svelte)$/i.test(language);
  const slash = !hash && !dash && !html || /^(?:php|powershell|ps1)$/i.test(language);
  let blockEnd = null;
  let quote = null;
  for (let number = 0; number < lines.length; number++) {
    const text = lines[number];
    const comments = [];
    let index = 0;
    while (index < text.length) {
      if (blockEnd) {
        const end = text.indexOf(blockEnd, index);
        const to = end < 0 ? text.length : end + blockEnd.length;
        comments.push({ from: index, to });
        index = to;
        if (end >= 0) blockEnd = null;
        continue;
      }
      if (quote) {
        if (text[index] === '\\') index += 2;
        else if (text.startsWith(quote, index)) { index += quote.length; quote = null; }
        else index++;
        continue;
      }
      if ((slash && text.startsWith('//', index)) || (hash && text[index] === '#') || (dash && text.startsWith('--', index))) {
        comments.push({ from: index, to: text.length });
        break;
      }
      const opener = html && text.startsWith('<!--', index) ? '<!--' : slash && text.startsWith('/*', index) ? '/*' : null;
      if (opener) {
        blockEnd = opener === '<!--' ? '-->' : '*/';
        const end = text.indexOf(blockEnd, index + opener.length);
        const to = end < 0 ? text.length : end + blockEnd.length;
        comments.push({ from: index, to });
        index = to;
        if (end >= 0) blockEnd = null;
        continue;
      }
      if (/["'`]/.test(text[index])) {
        quote = hash && (text.startsWith('"""', index) || text.startsWith("'''", index)) ? text.slice(index, index + 3) : text[index];
        index += quote.length;
      } else index++;
    }
    if (quote?.length === 1 && quote !== '`') quote = null;
    const persian = comments.filter(range => analyzeText(text.slice(range.from, range.to), false).rtl);
    if (persian.length) result.set(number, persian.map(range => ({
      ...range,
      standalone: !text.slice(0, range.from).trim() && !text.slice(range.to).trim(),
    })));
  }
  return result;
}

function documentDirections(documentText) {
  const lines = documentText.split('\n');
  const rtlLines = new Set();
  const comments = new Map();
  let paragraph = [];
  let fence = null;
  let mathBlock = false;
  let frontmatter = lines[0]?.replace(/^\uFEFF/, '').trim() === '---';
  let previousQuote = false;

  function flush() {
    if (paragraph.length && analyzeText(paragraph.map(item => item.text).join(' ')).rtl) {
      for (const item of paragraph) rtlLines.add(item.number);
    }
    paragraph = [];
  }
  function flushCode() {
    if (!fence) return;
    for (const [offset, ranges] of codeComments(fence.lines.map(line => line.text), fence.language)) {
      const line = fence.lines[offset];
      comments.set(line.number, ranges);
      if (ranges.some(range => range.standalone)) rtlLines.add(line.number);
    }
  }
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const text = raw.replace(/^\s*(?:>\s*)+/, '');
    const trimmed = text.trim();
    if (frontmatter) {
      if (index > 0 && /^(?:---|\.\.\.)$/.test(trimmed)) frontmatter = false;
      else if (index > 0 && analyzeText(text.slice(text.indexOf(':') + 1), false).rtl) rtlLines.add(index + 1);
      continue;
    }
    if (fence) {
      const closing = trimmed.match(/^(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        flushCode();
        fence = null;
      } else fence.lines.push({ number: index + 1, text: raw });
      continue;
    }
    const opening = text.match(/^\s*(?:(?:[-+*]|\d+[.)])\s+)?(`{3,}|~{3,})\s*([^\s`]*)/);
    if (opening) {
      flush();
      fence = { character: opening[1][0], length: opening[1].length, language: opening[2], lines: [] };
      continue;
    }
    if (trimmed === '$$') { flush(); mathBlock = !mathBlock; continue; }
    if (mathBlock) continue;
    if (!trimmed || /^(?:[-*_]\s*){3,}$/.test(trimmed)) { flush(); continue; }
    const list = /^\s*(?:[-+*]|\d+[.)])\s+/.test(text);
    const quote = /^\s*>/.test(raw);
    const heading = /^\s{0,3}#{1,6}\s/.test(text);
    const table = /^\s*\|/.test(text);
    if (list || heading || table || quote !== previousQuote) flush();
    previousQuote = quote;
    paragraph.push({ number: index + 1, text });
    if (heading || table) flush();
  }
  flush();
  flushCode();
  return { rtlLines, comments };
}

function classifyDocument(text) { return documentDirections(text).rtlLines; }

function ownText(element) {
  const parts = [];
  function visit(node) {
    if (node.nodeType === 3) { parts.push(node.nodeValue || ''); return; }
    if (node.nodeType !== 1 || node.matches(IGNORED_CONTENT)) return;
    if (node !== element && /^(UL|OL)$/.test(node.tagName)) return;
    for (const child of node.childNodes) visit(child);
  }
  visit(element);
  return parts.join('');
}

function toggleRtl(element, rtl) {
  if (element.classList.contains(RTL_CLASS) === rtl) return 0;
  element.classList.toggle(RTL_CLASS, rtl);
  return 1;
}

function clearIsolates(root) {
  for (const span of root.querySelectorAll('.' + LTR_CLASS)) span.replaceWith(...span.childNodes);
  root.normalize();
}

// Reading View only: wrap text ranges without changing textContent or Markdown.
function isolateLatin(root) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    const nestedList = parent.closest('ul,ol');
    const excluded = parent.closest('.' + LTR_CLASS + ',' + IGNORED_CONTENT + ',[contenteditable="true"]') ||
      nestedList && root.contains(nestedList);
    text += excluded ? ' '.repeat(node.length) : node.nodeValue;
  }
  for (const range of latinRanges(text).reverse()) {
    const span = wrapTextRange(root, range.from, range.to, LTR_CLASS);
    if (span) span.dir = 'ltr';
  }
}

function wrapTextRange(root, from, to, className) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  let offset = 0;
  let start = null;
  let end = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!start && from < offset + node.length) start = { node, offset: from - offset };
    if (to <= offset + node.length) { end = { node, offset: to - offset }; break; }
    offset += node.length;
  }
  if (!start || !end) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const span = root.ownerDocument.createElement('span');
  span.className = className;
  span.append(range.extractContents());
  range.insertNode(span);
  return span;
}

function applyCodeDirections(root) {
  const codes = [...root.querySelectorAll('pre > code')];
  if (root.matches?.('pre > code')) codes.unshift(root);
  for (const code of codes) {
    const text = code.textContent;
    // Reprocessing is cheap and leaves existing syntax-highlight elements intact.
    if (code._persianDirectionText === text && (!code._persianDirectionHasComments || code.querySelector('.' + COMMENT_CLASS))) continue;
    for (const span of code.querySelectorAll('.' + COMMENT_CLASS)) {
      clearIsolates(span);
      span.replaceWith(...span.childNodes);
    }
    code.normalize();
    const language = (code.className + ' ' + code.parentElement.className).match(/(?:language|lang)-([\w#+-]+)/)?.[1] || '';
    const lines = text.split('\n');
    const ranges = [];
    let offset = 0;
    const comments = codeComments(lines, language);
    for (let index = 0; index < lines.length; index++) {
      for (const range of comments.get(index) || []) ranges.push({
        ...range,
        from: offset + (range.standalone ? 0 : range.from),
        to: offset + (range.standalone ? lines[index].length : range.to),
      });
      // Indented Markdown prose is rendered as a plain code block by Markdown.
      if (!language && !comments.has(index) && analyzeText(lines[index], false).rtl) ranges.push({ from: offset, to: offset + lines[index].length, standalone: true });
      offset += lines[index].length + 1;
    }
    for (const range of ranges.reverse()) {
      const span = wrapTextRange(code, range.from, range.to, COMMENT_CLASS + ' ' + RTL_CLASS);
      if (span) {
        if (range.standalone) span.classList.add(COMMENT_CLASS + '-line');
        for (const token of latinRanges(span.textContent).reverse()) {
          const mark = wrapTextRange(span, token.from, token.to, LTR_CLASS);
          if (mark) mark.dir = 'ltr';
        }
      }
    }
    code._persianDirectionText = text;
    code._persianDirectionHasComments = ranges.length > 0;
  }
}

function applyReadingDirections(root) {
  const elements = [...root.querySelectorAll(TEXT_BLOCKS)];
  if (root.matches?.(TEXT_BLOCKS)) elements.unshift(root);
  let changed = 0;
  for (const element of elements) {
    const ignored = element.closest(IGNORED_CONTENT);
    const explicit = element.closest('[dir="ltr"],[dir="rtl"]');
    const rtl = !ignored && !explicit && analyzeText(ownText(element), false).rtl;
    changed += toggleRtl(element, rtl);
    if (rtl) isolateLatin(element);
    else if (element.querySelector('.' + LTR_CLASS)) clearIsolates(element);
  }
  applyCodeDirections(root);
  return changed;
}

function applyUiDirections(root) {
  const fields = [...root.querySelectorAll(UI_FIELDS)];
  if (root.matches?.(UI_FIELDS)) fields.unshift(root);
  for (const element of fields) {
    // Style the value, never the property name or the entire metadata row.
    const text = /^(INPUT|TEXTAREA)$/.test(element.tagName) ? element.value : element.textContent;
    toggleRtl(element, analyzeText(text || '', false).rtl);
  }
}

function createEditorExtension() {
  const { StateField, Prec } = require('@codemirror/state');
  const { Decoration, EditorView, ViewPlugin, Direction } = require('@codemirror/view');
  const directions = StateField.define({
    create(state) { return documentDirections(state.doc.toString()); },
    update(value, transaction) { return transaction.docChanged ? documentDirections(transaction.newDoc.toString()) : value; },
  });
  const extension = ViewPlugin.fromClass(class {
    constructor(view) { this.build(view); }
    update(update) { if (update.docChanged || update.viewportChanged) this.build(update.view); }
    build(view) {
      const wanted = view.state.field(directions);
      const marks = [];
      const isolates = [];
      const seen = new Set();
      for (const range of view.visibleRanges) {
        let line = view.state.doc.lineAt(range.from);
        while (line.from <= range.to) {
          if (!seen.has(line.number)) {
            const rtl = wanted.rtlLines.has(line.number);
            if (rtl) marks.push(Decoration.line({ attributes: { dir: 'rtl', class: RTL_CLASS } }).range(line.from));
            const comments = wanted.comments.get(line.number) || [];
            for (const comment of comments) if (!comment.standalone) {
              const mark = Decoration.mark({ class: RTL_CLASS, attributes: { dir: 'rtl' }, bidiIsolate: Direction?.RTL ?? 1 }).range(line.from + comment.from, line.from + comment.to);
              marks.push(mark); isolates.push(mark);
            }
            const segments = rtl ? [{ from: 0, to: line.length }] : comments;
            for (const segment of segments) for (const token of latinRanges(line.text.slice(segment.from, segment.to))) {
              const mark = Decoration.mark({ class: LTR_CLASS, attributes: { dir: 'ltr' }, bidiIsolate: Direction?.LTR ?? 0 }).range(line.from + segment.from + token.from, line.from + segment.from + token.to);
              marks.push(mark); isolates.push(mark);
            }
          }
          seen.add(line.number);
          if (line.number === view.state.doc.lines) break;
          line = view.state.doc.line(line.number + 1);
        }
      }
      this.decorations = Decoration.set(marks, true);
      this.isolates = Decoration.set(isolates, true);
    }
  }, {
    decorations: value => value.decorations,
    provide: plugin => EditorView.bidiIsolatedRanges ? EditorView.bidiIsolatedRanges.of(view => view.plugin(plugin)?.isolates || Decoration.none) : [],
  });
  return [directions, EditorView.perLineTextDirection.of(true), Prec.highest(extension)];
}

class PersianSmartDirection extends Plugin {
  onload() {
    this.registerEditorExtension(createEditorExtension());
    this.registerMarkdownPostProcessor(element => applyReadingDirections(element));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleRefresh()));
    this.app.workspace.onLayoutReady(() => this.refreshReadingViews());
    this.addCommand({ id: 'refresh-persian-direction', name: 'Refresh Persian text direction', callback: () => this.refreshReadingViews() });
    const root = this.app.workspace.containerEl;
    this.observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => {
        const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
        return !element?.closest('.cm-editor') || element?.closest('.metadata-container,.inline-title');
      })) this.scheduleRefresh();
    });
    this.observer.observe(root, { subtree: true, childList: true, characterData: true });
    this.registerDomEvent(root, 'input', () => this.scheduleRefresh());
    this.register(() => {
      this.observer.disconnect();
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
    });
  }
  scheduleRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; this.refreshReadingViews(); }, 40);
  }
  refreshReadingViews() {
    const root = this.app.workspace.containerEl;
    for (const reading of root.querySelectorAll('.markdown-preview-view,.markdown-source-view .markdown-rendered')) applyReadingDirections(reading);
    applyUiDirections(root);
  }
  onunload() {
    const root = this.app.workspace.containerEl;
    this.observer?.disconnect();
    for (const span of root.querySelectorAll('.' + COMMENT_CLASS)) { clearIsolates(span); span.replaceWith(...span.childNodes); }
    for (const span of root.querySelectorAll('.' + LTR_CLASS + ':not(.cm-editor *)')) span.replaceWith(...span.childNodes);
    root.querySelectorAll('.' + RTL_CLASS).forEach(element => element.classList.remove(RTL_CLASS));
  }
}

module.exports = PersianSmartDirection;
module.exports.helpers = { analyzeText, classifyDocument, documentDirections, latinRanges, codeComments, applyReadingDirections, applyUiDirections, ownText, createEditorExtension, RTL_CLASS, LTR_CLASS, COMMENT_CLASS };
