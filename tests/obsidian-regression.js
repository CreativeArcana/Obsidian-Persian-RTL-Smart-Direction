// Run with run-obsidian.cjs against an installed, enabled copy of the plugin.
// Uses disposable DOM fixtures: no notes, focus changes, or screenshots.
(async () => {
  const helpers = app.plugins.plugins['persian-rtl-smart-direction'].constructor.helpers;
  const { applyReadingDirections, RTL_CLASS, LTR_CLASS, createEditorExtension } = helpers;
  const results = [];
  const editors = [];
  const host = document.createElement('div');
  host.className = 'workspace markdown-source-view mod-cm6';
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1200px;pointer-events:none;';
  document.body.append(host);
  function check(name, fn) {
    try { fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  }
  function assert(value, message) { if (!value) throw new Error(message); }
  function fixture(html) {
    const root = document.createElement('div');
    root.className = 'markdown-rendered';
    root.innerHTML = html;
    host.append(root);
    return root;
  }
  function letterOrder(root, phrase) {
    const from = root.textContent.indexOf(phrase);
    assert(from >= 0, 'Missing phrase: ' + phrase);
    const walker = document.createTreeWalker(root, 4);
    const nodes = [];
    let offset = 0;
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, from: offset, to: offset + walker.currentNode.length });
      offset += walker.currentNode.length;
    }
    let previous = null;
    for (let index = 0; index < phrase.length; index++) {
      if (!/[A-Za-z_]/.test(phrase[index])) continue;
      const position = from + index;
      const item = nodes.find(item => item.from <= position && position < item.to);
      const range = document.createRange();
      range.setStart(item.node, position - item.from);
      range.setEnd(item.node, position - item.from + 1);
      const rect = range.getBoundingClientRect();
      assert(rect.width > 0, 'Fixture has no layout');
      if (previous && Math.abs(rect.top - previous.top) < 2) {
        assert(rect.left > previous.left, 'English letters or words are visually reversed in ' + phrase);
      }
      previous = rect;
    }
  }
  function characterRect(root, index) {
    const walker = document.createTreeWalker(root, 4);
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (index < offset + node.length) {
        const range = document.createRange();
        range.setStart(node, index - offset);
        range.setEnd(node, index - offset + 1);
        return range.getBoundingClientRect();
      }
      offset += node.length;
    }
    throw new Error('Missing character at ' + index);
  }
  function sentenceOrder(root) {
    const period = root.textContent.indexOf('. LLM');
    const dot = characterRect(root, period);
    const previous = characterRect(root, period - 1);
    const english = characterRect(root, period + 2);
    assert(dot.width > 0 && previous.left > dot.left && dot.left > english.left,
      'The sentence period did not stay between Persian text and the following LLM');
  }
  function terminalPeriod(root) {
    const index = root.textContent.lastIndexOf('.');
    const dot = characterRect(root, index);
    const word = characterRect(root, root.textContent.lastIndexOf('Unity'));
    assert(dot.width > 0 && dot.left < word.left, 'Terminal period appeared before Unity in RTL reading order');
  }
  try {
    check('Reading View: multiword English phrase, including inline formatting', () => {
      const root = fixture('<p>ویدئو How <em>to cook</em> pizza? را داشتم می‌دیدم.</p>');
      const before = root.textContent;
      applyReadingDirections(root);
      assert(root.querySelectorAll('.' + LTR_CLASS).length === 1, 'English phrase was split into multiple isolates');
      assert(root.textContent === before, 'Text changed');
      letterOrder(root, 'How to cook pizza?');
      const markup = root.innerHTML;
      applyReadingDirections(root);
      assert(root.innerHTML === markup, 'Repeated processing changed markup');
    });
    check('Reading View: dynamic edits merge an existing isolate with appended words', () => {
      const root = fixture('<p>متن How</p>');
      applyReadingDirections(root);
      root.firstChild.append(' to cook pizza?');
      applyReadingDirections(root);
      assert(root.querySelectorAll('.' + LTR_CLASS).length === 1, 'Edited phrase was split');
      letterOrder(root, 'How to cook pizza?');
    });
    check('Live Preview: generated table directions and terminal English words', () => {
      const root = fixture('<div class="cm-embed-block cm-table-widget" contenteditable="false" dir="rtl"><table class="table-editor"><tbody><tr><td dir="rtl"><div class="table-cell-wrapper">در مسیر Agent</div></td><td dir="rtl"><div class="table-cell-wrapper">English only</div></td></tr><tr><td dir="rtl"><div class="table-cell-wrapper">متن تمام شد human_check</div></td><td dir="rtl"><div class="table-cell-wrapper">ویدئو How to cook pizza? را دیدم</div></td></tr></tbody></table></div>');
      const before = root.textContent;
      applyReadingDirections(root);
      const cells = [...root.querySelectorAll('.table-cell-wrapper')];
      assert(getComputedStyle(cells[0]).direction === 'rtl', 'Persian cell is not RTL');
      assert(getComputedStyle(cells[1]).direction === 'ltr', 'English cell inherited RTL');
      assert(getComputedStyle(cells[0]).unicodeBidi === 'isolate', 'Obsidian plaintext rule still wins');
      letterOrder(cells[0], 'Agent');
      letterOrder(cells[1], 'English only');
      letterOrder(cells[2], 'human_check');
      letterOrder(cells[3], 'How to cook pizza?');
      assert(root.textContent === before, 'Cell text changed');
      const markup = root.innerHTML;
      applyReadingDirections(root);
      assert(root.innerHTML === markup, 'Table processing is not idempotent');
    });
    check('Reading View: independent table cells and explicit HTML direction', () => {
      const root = fixture('<table><tbody><tr><th>یادداشت</th><th>English</th></tr><tr><td>متن تمام شد human_check</td><td>English only</td></tr></tbody></table><p dir="ltr">متن Agent</p>');
      applyReadingDirections(root);
      assert(root.querySelector('th').classList.contains(RTL_CLASS), 'Header is not RTL');
      assert(getComputedStyle(root.querySelectorAll('td')[1]).direction === 'ltr', 'English cell is not LTR');
      assert(!root.querySelector('p').classList.contains(RTL_CLASS), 'Explicit HTML direction was overridden');
      letterOrder(root.querySelector('td'), 'human_check');
    });
    check('Nested lists, hard breaks, and repeated processing retain their boundaries', () => {
      const root = fixture('<ul><li>متن first phrase<br>second phrase<ul><li>متن nested phrase</li></ul></li></ul>');
      applyReadingDirections(root);
      const markup = root.innerHTML;
      for (let i = 0; i < 3; i++) applyReadingDirections(root);
      assert(root.innerHTML === markup, 'Nested isolates were repeatedly removed and recreated');
      assert(root.querySelectorAll('.' + LTR_CLASS).length === 3, 'Block boundaries were merged');
      const englishParent = fixture('<ul><li>English parent<ul><li>متن nested phrase</li></ul></li></ul>');
      applyReadingDirections(englishParent);
      const nested = englishParent.querySelector('.' + LTR_CLASS);
      applyReadingDirections(englishParent);
      assert(englishParent.querySelector('.' + LTR_CLASS) === nested, 'English parent recreated its nested list isolates');
    });
    check('Editable table content remains owned by its editor', () => {
      const root = fixture('<div class="cm-table-widget" dir="rtl"><table><tbody><tr><td dir="rtl"><div class="table-cell-wrapper"><div class="cm-content" contenteditable="true"><div class="cm-line">در مسیر Agent</div></div></div></td></tr></tbody></table></div>');
      const editor = root.querySelector('.cm-content');
      const markup = editor.innerHTML;
      applyReadingDirections(root);
      assert(editor.innerHTML === markup, 'Plugin rewrote editor-owned content');
    });
    check('Reading View: a new English-led sentence starts after the Persian period', () => {
      const root = fixture('<p><code>FairValue</code> ارزش پنهان مستقل از معامله، <code>OpeningAskPrice</code> قیمت اولیه و <code>CurrentOfferPrice</code> پیشنهاد فعلی است. LLM استدلال را ارزیابی و سیستم بازی قیمت را محاسبه می‌کند.</p>');
      const before = root.textContent;
      applyReadingDirections(root);
      sentenceOrder(root);
      assert(root.textContent === before, 'Source punctuation changed');
    });
    check('Reading View: a terminal period follows the final English word', () => {
      for (const ending of ['Unity .', 'Unity.']) {
        const root = fixture('<p><strong>AI Paw Shop: Dungeon Haven</strong> یک Cozy Shopkeeper Sim موبایلی برای Android و iOS است؛ تجربه‌ای UI-driven با هنر 2D در ' + ending + '</p>');
        applyReadingDirections(root);
        terminalPeriod(root);
        letterOrder(root, 'AI Paw Shop: Dungeon Haven');
      }
    });
    check('Reading View: English phrases in ordered lists stay independent of numbering', () => {
      const root = fixture('<ol><li>this task شماره بدرستی نوشته شود</li><li>متن How to cook pizza? فارسی</li></ol>');
      applyReadingDirections(root);
      const item = root.querySelector('li');
      assert(getComputedStyle(item).direction === 'rtl', 'Mixed list item is not RTL');
      assert(item.querySelector('.' + LTR_CLASS).textContent === 'this task', 'List content was split');
      letterOrder(item, 'this task');
    });
    const prose = 'پروژهٔ فعلی Vault من است. LLM-Wiki/AGENTS.md و LLM-Wiki/SKILL.md را بخوان. ویکی فارسی است و منابع خام ممکن است هر زبانی باشند. با ابزار همین Agent و بدون API Key جداگانه کار کن. ابتدا Doctor و Status بده.';
    for (const language of ['text', 'txt', 'plaintext', 'js']) {
      const root = fixture('');
      const markdown = '```' + language + '\n' + (language === 'js' ? 'const text = "فارسی";\n// متن hello world' : prose) + '\n```';
      await helpers.MarkdownRenderer.render(app, markdown, root, '', app.plugins.plugins['persian-rtl-smart-direction']);
      check('Actual Markdown renderer: ' + language + ' fence direction and English order', () => {
        const before = root.textContent;
        applyReadingDirections(root);
        if (language === 'js') {
          const line = root.querySelector('.' + helpers.COMMENT_CLASS + '-line');
          assert(line && !line.textContent.includes('const text'), 'Programming statement was styled as prose');
          letterOrder(line, 'hello world');
        } else {
          const line = root.querySelector('.' + helpers.COMMENT_CLASS + '-line');
          assert(line && getComputedStyle(line).direction === 'rtl', 'Persian text fence is not RTL');
          letterOrder(line, 'LLM-Wiki/AGENTS.md');
          letterOrder(line, 'API Key');
          assert(line.querySelectorAll('.' + LTR_CLASS).length > 0, 'English words lost their isolates');
        }
        assert(root.textContent === before, 'Code source changed');
        const markup = root.innerHTML;
        applyReadingDirections(root);
        assert(root.innerHTML === markup, 'Repeated code processing changed markup');
      });
    }
    const source = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.editor?.cm)?.view.editor.cm;
    assert(source, 'Open a Markdown editor before running CodeMirror integration checks');
    for (const text of ['ویدئو How to cook pizza? را داشتم می‌دیدم.', 'در مسیر Agent', '| یادداشت | English |\n| --- | --- |\n| در مسیر Agent | hello world |']) {
      const parent = document.createElement('div');
      host.append(parent);
      const view = new source.constructor({
        state: source.state.constructor.create({ doc: text, extensions: createEditorExtension() }), parent,
      });
      editors.push(view);
      await new Promise(resolve => setTimeout(resolve, 50));
      view.measure();
      check('CodeMirror visual order: ' + text.split('\n').at(-1), () => {
        letterOrder(view.contentDOM, text.includes('How') ? 'How to cook pizza?' : 'Agent');
        if (text.includes('hello')) letterOrder(view.contentDOM, 'hello world');
        assert(view.state.doc.toString() === text, 'Editor source changed');
      });
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'متن How to cook pizza?' } });
      await new Promise(resolve => setTimeout(resolve, 50));
      view.measure();
      check('CodeMirror updates decorations after editing', () => letterOrder(view.contentDOM, 'How to cook pizza?'));
    }
    for (const text of ['پیشنهاد فعلی است. LLM استدلال را ارزیابی می‌کند.', 'با هنر 2D در Unity .', 'با هنر 2D در Unity.', '1. this task شماره بدرستی نوشته شود', '12. this task شماره بدرستی نوشته شود', '> 12) this task شماره بدرستی نوشته شود', '```text\n' + prose + '\n```']) {
      const parent = document.createElement('div');
      host.append(parent);
      const view = new source.constructor({ state: source.state.constructor.create({ doc: text, extensions: createEditorExtension() }), parent });
      editors.push(view);
      await new Promise(resolve => setTimeout(resolve, 50));
      view.measure();
      check('CodeMirror: sentence punctuation, text fences and list numbers: ' + text.slice(0, 40), () => {
        if (text.includes('. LLM')) sentenceOrder(view.contentDOM);
        if (text.includes('Unity')) terminalPeriod(view.contentDOM);
        if (text.includes('this task')) {
          letterOrder(view.contentDOM, 'this task');
          const marker = text.match(/\d+[.)]/)[0];
          const spans = [...view.contentDOM.querySelectorAll('.' + LTR_CLASS)];
          assert(!spans.some(span => span.textContent.includes(marker)), 'List number was forced into LTR');
          assert(spans.some(span => span.textContent === 'this task'), 'List marker merged into the English phrase');
          const number = characterRect(view.contentDOM, text.indexOf(marker));
          const english = characterRect(view.contentDOM, text.indexOf('this task'));
          assert(number.left > english.left, 'List marker appears after its English phrase');
          const dot = characterRect(view.contentDOM, text.indexOf(marker) + marker.length - 1);
          assert(dot.left < number.left, 'RTL list punctuation must be to the LEFT of the number');
        }
        if (text.startsWith('```')) {
          const line = view.contentDOM.querySelectorAll('.cm-line')[1];
          assert(getComputedStyle(line).direction === 'rtl', 'Text fence editor line is not RTL');
          letterOrder(line, 'LLM-Wiki/AGENTS.md');
          letterOrder(line, 'API Key');
        }
        assert(view.state.doc.toString() === text, 'Editor source changed');
      });
    }
    return JSON.stringify({ passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length, results });
  } finally {
    for (const view of editors) view.destroy();
    host.remove();
  }
})()
