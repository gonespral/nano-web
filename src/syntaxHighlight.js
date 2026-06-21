// Lightweight per-line regex tokenizer, loosely standing in for nano's
// `include /usr/share/nano/*.nanorc` syntax-coloring files. Each language
// only sees one line at a time, so constructs that span lines (block
// comments, triple-quoted strings) aren't colored across the break — an
// accepted simplification for this POC.

const JS_RULES = [
  { type: "comment", re: /\/\*[\s\S]*?\*\// },
  { type: "comment", re: /\/\/.*/ },
  { type: "string", re: /`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/ },
  { type: "number", re: /\b\d+(?:\.\d+)?\b/ },
  {
    type: "keyword",
    re: /\b(?:const|let|var|function|return|if|else|for|while|import|export|from|default|class|extends|new|this|async|await|try|catch|finally|throw|switch|case|break|continue|typeof|instanceof|super|null|undefined|true|false|of|in|do|yield|static|get|set|interface|type|implements)\b/,
  },
];

const PYTHON_RULES = [
  { type: "string", re: /'''[\s\S]*?'''|"""[\s\S]*?"""/ },
  { type: "comment", re: /#.*/ },
  { type: "string", re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/ },
  { type: "number", re: /\b\d+(?:\.\d+)?\b/ },
  {
    type: "keyword",
    re: /\b(?:def|class|return|import|from|if|elif|else|for|while|try|except|finally|with|as|pass|break|continue|lambda|yield|None|True|False|and|or|not|in|is|global|nonlocal|raise|assert|del)\b/,
  },
];

const CSS_RULES = [
  { type: "comment", re: /\/\*[\s\S]*?\*\// },
  { type: "string", re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/ },
  { type: "hex", re: /#[0-9a-fA-F]{3,8}\b/ },
  { type: "atrule", re: /@[a-zA-Z-]+/ },
  { type: "number", re: /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b/ },
];

const JSON_RULES = [
  { type: "key", re: /"(?:[^"\\]|\\.)*"(?=\s*:)/ },
  { type: "string", re: /"(?:[^"\\]|\\.)*"/ },
  { type: "number", re: /-?\b\d+(?:\.\d+)?\b/ },
  { type: "bool", re: /\b(?:true|false|null)\b/ },
];

const HTML_RULES = [
  { type: "comment", re: /<!--[\s\S]*?-->/ },
  { type: "tag", re: /<\/?[a-zA-Z][^>]*>/ },
];

const SHELL_RULES = [
  { type: "comment", re: /#.*/ },
  { type: "string", re: /"(?:[^"\\]|\\.)*"|'[^'\n]*'/ },
  {
    type: "keyword",
    re: /\b(?:if|then|else|elif|fi|for|do|done|while|case|esac|function|return|export|local|in|until)\b/,
  },
];

const MARKDOWN_RULES = [
  { type: "header-6", re: /^#{6}\s.*$/ },
  { type: "header-5", re: /^#{5}\s.*$/ },
  { type: "header-4", re: /^#{4}\s.*$/ },
  { type: "header-3", re: /^#{3}\s.*$/ },
  { type: "header-2", re: /^#{2}\s.*$/ },
  { type: "header-1", re: /^#\s.*$/ },
  { type: "bold", re: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
  { type: "code", re: /`[^`\n]+`/ },
  { type: "quote", re: /^>\s?.*$/ },
  { type: "link", re: /\[[^\]\n]*\]\([^)\n]*\)/ },
  { type: "italic", re: /\*[^*\n]+\*|_[^_\n]+_/ },
];

const LANGUAGES = {
  markdown: MARKDOWN_RULES,
  js: JS_RULES,
  python: PYTHON_RULES,
  css: CSS_RULES,
  json: JSON_RULES,
  html: HTML_RULES,
  shell: SHELL_RULES,
};

const EXT_TO_LANGUAGE = {
  md: "markdown",
  markdown: "markdown",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  ts: "js",
  tsx: "js",
  py: "python",
  css: "css",
  json: "json",
  html: "html",
  htm: "html",
  sh: "shell",
  bash: "shell",
};

export function detectLanguage(filename) {
  if (!filename) return null;
  const ext = filename.split(".").pop()?.toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? null;
}

const combinedCache = new Map();
function getCombined(lang) {
  if (!combinedCache.has(lang)) {
    const rules = LANGUAGES[lang];
    const regex = new RegExp(rules.map((r) => `(${r.re.source})`).join("|"), "g");
    combinedCache.set(lang, { regex, rules });
  }
  return combinedCache.get(lang);
}

export function tokenizeLine(line, lang) {
  if (line === "") return [{ text: " ", type: null }];
  if (!lang || !LANGUAGES[lang]) return [{ text: line, type: null }];

  const { regex, rules } = getCombined(lang);
  regex.lastIndex = 0;
  const tokens = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(line))) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index), type: null });
    }
    const groupIndex = match.slice(1).findIndex((g) => g !== undefined);
    tokens.push({ text: match[0], type: rules[groupIndex]?.type ?? null });
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), type: null });
  }
  return tokens;
}
