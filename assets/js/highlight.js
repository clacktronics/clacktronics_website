/* ClackOS syntax highlighter — one small tokeniser shared by the Markdown
 * renderer (desktop windows and the plain HTML mirror) and by the Markdown
 * editor's preview.
 *
 * There is no colour in here. Every token is wrapped in a `tok-*` span and
 * assets/css/code.css derives the actual colours from the active theme, so a
 * new theme file recolours code without touching this script.
 *
 * Usage:
 *   ClackHighlight.resolve(infoString, code) -> language id ('' = leave plain)
 *   ClackHighlight.highlight(code, id)       -> HTML string
 *   ClackHighlight.apply(root)               -> highlight every <pre> under root
 */
(() => {
'use strict';

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ grammars
 * A grammar is an ordered list of rules; the first rule that matches at a
 * position wins, so comments and strings must come before everything else.
 * Rule patterns must not contain capturing groups — use (?: ) — because the
 * compiler wraps each one in a group of its own to find out which rule fired.
 */

const word = (...words) => '\\b(?:' + words.join('|') + ')\\b';

const C_NUMBER = '\\b(?:0[xX][0-9a-fA-F_\']+|0[bB][01_\']+|\\d[\\d_\']*(?:\\.[\\d_\']*)?(?:[eE][+-]?\\d+)?)(?:[uUlLfF]*)\\b';
const C_COMMENT = '//[^\\n]*|/\\*[\\s\\S]*?\\*/';
const DQ_STRING = '"(?:\\\\[\\s\\S]|[^"\\\\\\n])*"';
const SQ_STRING = "'(?:\\\\[\\s\\S]|[^'\\\\\\n])*'";
const CALL = '[A-Za-z_$][\\w$]*(?=\\s*\\()';

const GRAMMARS = {
  python: [
    { cls: 'tok-com', re: '#[^\\n]*' },
    { cls: 'tok-str', re: '(?:[rRbBuUfF]{0,3})(?:"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|' + DQ_STRING + '|' + SQ_STRING + ')' },
    { cls: 'tok-meta', re: '@[A-Za-z_][\\w.]*' },
    { cls: 'tok-fn', re: '(?<=\\b(?:def|class)\\s+)[A-Za-z_]\\w*' },
    { cls: 'tok-key', re: word('False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
        'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
        'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
        'raise', 'return', 'try', 'while', 'with', 'yield') },
    { cls: 'tok-bui', re: word('abs', 'all', 'any', 'bin', 'bool', 'bytes', 'chr', 'dict', 'dir',
        'divmod', 'enumerate', 'eval', 'filter', 'float', 'format', 'getattr', 'hasattr', 'hex',
        'input', 'int', 'isinstance', 'iter', 'len', 'list', 'map', 'max', 'min', 'next', 'object',
        'open', 'ord', 'pow', 'print', 'range', 'repr', 'reversed', 'round', 'self', 'set',
        'setattr', 'sorted', 'str', 'sum', 'super', 'tuple', 'type', 'zip',
        '__init__', '__main__', '__name__') },
    { cls: 'tok-num', re: '\\b(?:0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?[jJ]?)\\b' },
    { cls: 'tok-fn', re: CALL },
    { cls: 'tok-op', re: '[+\\-*/%=<>!&|^~:]+|[()\\[\\]{},.;]' }
  ],

  cpp: [
    { cls: 'tok-com', re: C_COMMENT },
    { cls: 'tok-meta', re: '^[ \\t]*#[ \\t]*[a-z]+(?:[^\\n\\\\]|\\\\\\r?\\n)*' },
    { cls: 'tok-str', re: 'R"[^(]*\\([\\s\\S]*?\\)[^"]*"|' + DQ_STRING + '|' + SQ_STRING },
    { cls: 'tok-key', re: word('alignas', 'alignof', 'and', 'asm', 'auto', 'break', 'case', 'catch',
        'class', 'concept', 'const', 'consteval', 'constexpr', 'constinit', 'const_cast',
        'continue', 'co_await', 'co_return', 'co_yield', 'decltype', 'default', 'delete', 'do',
        'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'for', 'friend',
        'goto', 'if', 'inline', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'nullptr',
        'operator', 'or', 'private', 'protected', 'public', 'register', 'reinterpret_cast',
        'requires', 'return', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct',
        'switch', 'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef', 'typeid',
        'typename', 'union', 'using', 'virtual', 'volatile', 'while') },
    { cls: 'tok-typ', re: word('bool', 'char', 'char8_t', 'char16_t', 'char32_t', 'double', 'float',
        'int', 'long', 'short', 'signed', 'unsigned', 'void', 'wchar_t', 'size_t', 'ssize_t',
        'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t',
        'std', 'string', 'vector', 'map', 'array', 'pair', 'shared_ptr', 'unique_ptr', 'byte',
        'String', 'HardwareSerial') },
    { cls: 'tok-bui', re: word('cout', 'cerr', 'cin', 'endl', 'printf', 'sprintf', 'malloc', 'free',
        'memcpy', 'memset', 'sizeof', 'nullptr_t', 'digitalWrite', 'digitalRead', 'analogRead',
        'analogWrite', 'pinMode', 'delay', 'delayMicroseconds', 'millis', 'micros', 'Serial',
        'setup', 'loop') },
    { cls: 'tok-num', re: C_NUMBER },
    { cls: 'tok-fn', re: CALL },
    { cls: 'tok-op', re: '::|->\\*?|[+\\-*/%=<>!&|^~?:]+|[()\\[\\]{},.;]' }
  ],

  javascript: [
    { cls: 'tok-com', re: C_COMMENT },
    { cls: 'tok-str', re: '`(?:\\\\[\\s\\S]|[^`\\\\])*`|' + DQ_STRING + '|' + SQ_STRING },
    { cls: 'tok-fn', re: '(?<=\\b(?:function|class)\\s+)[A-Za-z_$][\\w$]*' },
    { cls: 'tok-key', re: word('async', 'await', 'break', 'case', 'catch', 'class', 'const',
        'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
        'finally', 'for', 'from', 'function', 'get', 'if', 'import', 'in', 'instanceof', 'let',
        'new', 'null', 'of', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw', 'true',
        'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield') },
    { cls: 'tok-bui', re: word('Array', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number',
        'Object', 'Promise', 'RegExp', 'Set', 'String', 'Symbol', 'console', 'document', 'fetch',
        'globalThis', 'localStorage', 'module', 'navigator', 'parseFloat', 'parseInt', 'process',
        'querySelector', 'querySelectorAll', 'require', 'setInterval', 'setTimeout', 'window') },
    { cls: 'tok-num', re: C_NUMBER },
    { cls: 'tok-fn', re: CALL },
    { cls: 'tok-op', re: '=>|\\.{3}|[+\\-*/%=<>!&|^~?:]+|[()\\[\\]{},.;]' }
  ],

  css: [
    { cls: 'tok-com', re: '/\\*[\\s\\S]*?\\*/' },
    { cls: 'tok-str', re: DQ_STRING + '|' + SQ_STRING },
    { cls: 'tok-meta', re: '@[\\w-]+|![\\w-]+' },
    { cls: 'tok-att', re: '(?:--)?[-A-Za-z][\\w-]*(?=\\s*:)' },
    { cls: 'tok-num', re: '#[0-9a-fA-F]{3,8}\\b|\\b\\d*\\.?\\d+(?:px|em|rem|ex|ch|%|s|ms|vh|vw|vmin|vmax|fr|deg|turn|pt)?\\b' },
    { cls: 'tok-fn', re: '[\\w-]+(?=\\()' },
    { cls: 'tok-key', re: '[.#][-A-Za-z][\\w-]*|::?[a-z-]+|\\b[a-z]+(?=[^;{}]*\\{)' },
    { cls: 'tok-op', re: '[{}();,:>+~*]' }
  ],

  json: [
    { cls: 'tok-att', re: '"(?:\\\\[\\s\\S]|[^"\\\\])*"(?=\\s*:)' },
    { cls: 'tok-str', re: '"(?:\\\\[\\s\\S]|[^"\\\\])*"' },
    { cls: 'tok-key', re: word('true', 'false', 'null') },
    { cls: 'tok-num', re: '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b' },
    { cls: 'tok-op', re: '[{}\\[\\],:]' }
  ],

  bash: [
    { cls: 'tok-com', re: '#[^\\n]*' },
    { cls: 'tok-str', re: '"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'[^\']*\'' },
    { cls: 'tok-var', re: '\\$(?:\\{[^}]*\\}|[\\w@?#*!-]+)' },
    { cls: 'tok-meta', re: '(?:^|(?<=\\s))--?[A-Za-z][\\w-]*' },
    { cls: 'tok-key', re: word('if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do',
        'done', 'case', 'esac', 'in', 'function', 'return', 'exit', 'break', 'continue', 'local',
        'export', 'source', 'set', 'unset', 'trap') },
    { cls: 'tok-bui', re: word('apt', 'awk', 'cat', 'cd', 'chmod', 'chown', 'cp', 'curl', 'cut',
        'docker', 'echo', 'find', 'git', 'grep', 'head', 'kill', 'ls', 'make', 'mkdir', 'mv',
        'npm', 'pip', 'pip3', 'ps', 'python', 'python3', 'rm', 'sed', 'sort', 'ssh', 'sudo',
        'tail', 'tar', 'touch', 'uniq', 'wget', 'which', 'xargs') },
    { cls: 'tok-num', re: '\\b\\d+\\b' },
    { cls: 'tok-op', re: '&&|\\|\\||[|&;<>()=]' }
  ],

  openscad: [
    { cls: 'tok-com', re: C_COMMENT },
    { cls: 'tok-str', re: DQ_STRING },
    { cls: 'tok-meta', re: '\\$[A-Za-z_]\\w*' },
    { cls: 'tok-fn', re: '(?<=\\b(?:module|function)\\s+)[A-Za-z_]\\w*' },
    { cls: 'tok-key', re: word('module', 'function', 'if', 'else', 'for', 'intersection_for', 'let',
        'each', 'true', 'false', 'undef', 'include', 'use', 'echo', 'assert', 'children') },
    { cls: 'tok-bui', re: word('circle', 'color', 'cube', 'cylinder', 'difference', 'hull',
        'import', 'intersection', 'linear_extrude', 'minkowski', 'mirror', 'multmatrix', 'offset',
        'polygon', 'polyhedron', 'projection', 'render', 'resize', 'rotate', 'rotate_extrude',
        'scale', 'sphere', 'square', 'surface', 'text', 'translate', 'union') },
    { cls: 'tok-num', re: C_NUMBER },
    { cls: 'tok-fn', re: CALL },
    { cls: 'tok-op', re: '[+\\-*/%=<>!&|^~?:]+|[()\\[\\]{},.;#]' }
  ],

  markdown: [
    { cls: 'tok-meta', re: '^```[^\\n]*' },
    { cls: 'tok-key', re: '^#{1,6}[ \\t][^\\n]*' },
    { cls: 'tok-com', re: '^>[^\\n]*' },
    { cls: 'tok-str', re: '`[^`\\n]+`' },
    { cls: 'tok-fn', re: '\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__' },
    { cls: 'tok-att', re: '!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)' },
    { cls: 'tok-op', re: '^[ \\t]*(?:[-*+]|\\d+\\.)(?=\\s)|^[ \\t]*(?:---+|===+)[ \\t]*$' }
  ]
};

/* The tag interior of HTML/XML: element name, attribute names and values. */
const TAG_GRAMMAR = [
  { cls: 'tok-tag', re: '</?[A-Za-z][\\w:.-]*|/?>' },
  { cls: 'tok-str', re: DQ_STRING + '|' + SQ_STRING },
  { cls: 'tok-att', re: '[A-Za-z_:@][\\w:.-]*' },
  { cls: 'tok-op', re: '=' }
];

/* ------------------------------------------------------------------ compiler */

const compiled = new Map();

function compile(rules) {
  if (!compiled.has(rules))
    compiled.set(rules, new RegExp(rules.map(rule => '(' + rule.re + ')').join('|'), 'gm'));
  return compiled.get(rules);
}

function run(code, rules) {
  const re = compile(rules);
  re.lastIndex = 0;
  let out = '';
  let copiedTo = 0;
  let match;

  while ((match = re.exec(code))) {
    if (match[0] === '') { re.lastIndex++; continue; }
    let index = 0;
    while (index < rules.length && match[index + 1] === undefined) index++;
    const rule = rules[index];
    out += esc(code.slice(copiedTo, match.index));
    out += rule.render ? rule.render(match[0]) : `<span class="${rule.cls}">${esc(match[0])}</span>`;
    copiedTo = re.lastIndex;
  }
  return out + esc(code.slice(copiedTo));
}

/* HTML needs a tokeniser of its own: quotes and angle brackets mean different
 * things inside a tag, in text, and inside <script>/<style> bodies. */
const embed = language => text => {
  const open = /^<[^>]*>/.exec(text);
  const close = /<\/[A-Za-z][\w:.-]*\s*>$/.exec(text);
  if (!open) return esc(text);
  const body = text.slice(open[0].length, close ? text.length - close[0].length : undefined);
  return run(open[0], TAG_GRAMMAR) + run(body, GRAMMARS[language]) +
    (close ? run(close[0], TAG_GRAMMAR) : '');
};

GRAMMARS.html = [
  { cls: 'tok-com', re: '<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>' },
  { cls: 'tok-meta', re: '<![A-Za-z][^>]*>' },
  { cls: 'tok-tag', re: '<script\\b[^>]*>[\\s\\S]*?</script\\s*>', render: embed('javascript') },
  { cls: 'tok-tag', re: '<style\\b[^>]*>[\\s\\S]*?</style\\s*>', render: embed('css') },
  { cls: 'tok-tag', re: '</?[A-Za-z][^>]*>', render: text => run(text, TAG_GRAMMAR) },
  { cls: 'tok-meta', re: '&(?:#\\d+|#[xX][0-9a-fA-F]+|[A-Za-z]\\w*);' }
];

/* ------------------------------------------------------------------ language ids */

const ALIASES = {
  py: 'python', python: 'python', python3: 'python', micropython: 'python',
  c: 'cpp', 'c++': 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  ino: 'cpp', arduino: 'cpp', pde: 'cpp', processing: 'cpp', java: 'cpp',
  js: 'javascript', javascript: 'javascript', jsx: 'javascript', mjs: 'javascript',
  node: 'javascript', ts: 'javascript', typescript: 'javascript',
  htm: 'html', html: 'html', svg: 'html', xml: 'html', vue: 'html',
  css: 'css', scss: 'css', json: 'json',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
  scad: 'openscad', openscad: 'openscad',
  md: 'markdown', markdown: 'markdown'
};

/* Fence tags that explicitly ask for no highlighting. */
const PLAIN = new Set(['text', 'txt', 'plain', 'none', 'output', 'log', 'csv', 'tsv', 'ascii']);

/* ------------------------------------------------------------------ detection
 * Each signature is worth points; the language with the most points wins, and
 * only if it clears MIN_SCORE. Prose and program output score nothing and are
 * left as plain monospace, which is the right answer for them.
 */
const MIN_SCORE = 3;

const SIGNATURES = {
  python: [
    [/^\s*def\s+\w+\s*\(.*\)\s*:/m, 4], [/^\s*(?:from\s+[\w.]+\s+)?import\s+[\w.*]/m, 3],
    [/^\s*class\s+\w+(?:\(.*\))?\s*:/m, 3], [/\bself\./, 2], [/\bprint\s*\(/, 2],
    [/^\s*(?:elif|else|try|except|finally|with)\b.*:\s*$/m, 2], [/#!.*python/, 4],
    [/\b(?:None|True|False)\b/, 1], [/^\s*@\w+\s*$/m, 1], [/\bf"[^"]*\{/, 2],
    [/;\s*$/m, -2], [/\{\s*$/m, -1]
  ],
  cpp: [
    [/^\s*#\s*include\s*[<"]/m, 5], [/\bstd::/, 4], [/\bint\s+main\s*\(/, 4],
    [/^\s*(?:public|private|protected)\s*:/m, 3], [/\btemplate\s*</, 3],
    [/\b(?:void|int|float|double|bool|char)\s+\w+\s*\([^)]*\)\s*\{/, 3],
    [/\b(?:nullptr|constexpr|namespace)\b/, 2], [/\bcout\s*<</, 3],
    [/->\w/, 1], [/;\s*$/m, 1], [/\bpinMode\s*\(|\bdigitalWrite\s*\(/, 3]
  ],
  javascript: [
    [/\b(?:const|let|var)\s+[\w$]+\s*=/, 3], [/=>\s*[{(\w'"`]/, 3], [/\bconsole\.(?:log|warn|error)\s*\(/, 4],
    [/\bfunction\s*[\w$]*\s*\(/, 3], [/\bdocument\.(?:getElementById|querySelector)/, 4],
    [/===|!==/, 2], [/\brequire\s*\(|\bimport\s+.*\bfrom\s+['"]/, 2], [/`[^`]*\$\{/, 3],
    [/\.(?:then|catch|forEach|map|addEventListener)\s*\(/, 2], [/\bawait\s+\w/, 1]
  ],
  html: [
    [/<!DOCTYPE\s+html/i, 5], [/<\/(?:div|p|span|a|body|html|head|section|li|ul|ol|table|td|tr|h[1-6]|script|style|main|nav|header|footer|button|form|label)\s*>/i, 4],
    [/<(?:div|p|span|img|br|hr|input|meta|link|body|html)\b[^>]*>/i, 3],
    [/<\w+[^>]*\s(?:class|id|href|src|style)\s*=\s*["']/i, 3], [/<!--[\s\S]*?-->/, 1]
  ],
  css: [
    [/^[^{}\n]*\{[^{}]*[-\w]+\s*:\s*[^;{}]+;/m, 4], [/@media\b|@keyframes\b|@import\b/, 3],
    [/^\s*[.#][\w-]+[^{\n]*\{/m, 3], [/\bvar\(--[\w-]+\)/, 3],
    [/:\s*#[0-9a-fA-F]{3,8}\s*;/, 2], [/<\w/, -3]
  ],
  json: [
    [/^\s*[{[]/, 2], [/"[^"\n]*"\s*:\s*(?:"[^"\n]*"|\d|true|false|null|[{[])/, 4],
    [/^\s*\/\//m, -3], [/=/, -2], [/;/, -2]
  ],
  bash: [
    [/^\s*#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:ba|z)?sh/m, 5], [/^\s*\$\s+\S/m, 4],
    [/\bsudo\s+\w/, 3], [/^\s*(?:git|npm|pip3?|apt|docker|make|cd|ls|curl|wget|chmod|mkdir)\s+[\w./-]/m, 3],
    [/\|\s*(?:grep|awk|sed|sort|head|tail|xargs)\b/, 3], [/\$\{?\w+\}?/, 1],
    [/\b(?:if|for|while)\b.*;\s*(?:then|do)\b/, 3], [/^\s*fi\s*$|^\s*done\s*$/m, 2]
  ],
  openscad: [
    [/\b(?:cube|sphere|cylinder|polyhedron)\s*\(/, 4], [/\b(?:difference|union|intersection|hull|minkowski)\s*\(\s*\)/, 4],
    [/\b(?:translate|rotate|scale|mirror)\s*\(\s*\[/, 4], [/\$f[nas]\b|\$t\b/, 4],
    [/^\s*module\s+\w+\s*\(/m, 5], [/\blinear_extrude\s*\(|\brotate_extrude\s*\(/, 3]
  ],
  markdown: [
    [/^#{1,6}\s+\S/m, 3], [/^\s*[-*+]\s+\S/m, 1], [/\[[^\]\n]+\]\([^)\n]+\)/, 3],
    [/\*\*[^*\n]+\*\*/, 2], [/^```/m, 3], [/^\s*>\s+\S/m, 1], [/^\|.*\|\s*$/m, 2]
  ]
};

function detect(code) {
  if (!code || code.length < 8) return '';
  let best = '';
  let bestScore = 0;
  for (const [language, signatures] of Object.entries(SIGNATURES)) {
    let score = 0;
    signatures.forEach(([pattern, points]) => { if (pattern.test(code)) score += points; });
    if (score > bestScore) { bestScore = score; best = language; }
  }
  return bestScore >= MIN_SCORE ? best : '';
}

/* An explicit fence tag always wins — including one that asks for no colour —
 * and only an unrecognised or missing tag falls back to sniffing the code. */
function resolve(info, code) {
  const tag = String(info || '').trim().toLowerCase().replace(/^\.|[{}].*$/g, '');
  if (PLAIN.has(tag)) return '';
  if (ALIASES[tag]) return ALIASES[tag];
  return detect(code || '');
}

function highlight(code, language) {
  const rules = GRAMMARS[ALIASES[language] || language];
  if (!rules) return esc(code);
  try {
    return run(String(code), rules);
  } catch {
    return esc(code);   /* never lose the code to a bad pattern */
  }
}

/* Highlight every code block under `root` that has not been done already.
 * Works on our own <pre class="code" data-lang="…"> and on the
 * <pre><code class="language-…"> that Markdown libraries produce. */
function apply(root) {
  const scope = root || document;
  scope.querySelectorAll('pre:not([data-highlighted])').forEach(pre => {
    const target = pre.querySelector('code') || pre;
    const code = target.textContent;
    const declared = pre.dataset.lang ||
      (target.className.match(/(?:language|lang)-([\w+#.-]+)/) || [])[1] || '';
    const language = resolve(declared, code);
    pre.dataset.highlighted = language || 'plain';
    if (!language) return;
    pre.dataset.lang = language;
    target.innerHTML = highlight(code, language);
  });
}

window.ClackHighlight = { resolve, detect, highlight, apply, languages: Object.keys(GRAMMARS) };

/* The plain HTML mirror is static, so highlight its blocks once on load. */
if (document.currentScript && document.currentScript.hasAttribute('data-auto')) {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => apply(document));
  else
    apply(document);
}
})();
