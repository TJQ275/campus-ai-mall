/**
 * WXML 静态检查（不需要微信开发者工具）。
 *
 * 小程序没法在 CI 里跑，但最容易出的三类错是纯静态可查的：
 *   1. 模板里绑定的事件处理函数在 .js 里不存在 → 点击无反应
 *   2. 标签没闭合 / 闭合错位 → 页面直接编译失败
 *   3. 跳转的页面路径没在 app.json 里注册 → 跳转失败
 * 这个脚本把这三类提前查出来。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', 'apps', 'miniapp');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const pages = new Set(appJson.pages);
const tabPages = new Set((appJson.tabBar && appJson.tabBar.list || []).map((t) => t.pagePath));

const problems = [];
const warnings = [];
let filesChecked = 0;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const wxmlFiles = files.filter((f) => f.endsWith('.wxml'));

const VOID_TAGS = new Set(['image', 'input', 'icon', 'progress', 'import', 'include', 'wxs', 'slot']);

for (const wxml of wxmlFiles) {
  filesChecked += 1;
  const rel = path.relative(ROOT, wxml).split(path.sep).join('/');
  const source = fs.readFileSync(wxml, 'utf8');
  const jsPath = wxml.replace(/\.wxml$/, '.js');
  const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';

  // 1) 事件处理函数是否存在
  const handlers = new Set();
  for (const m of source.matchAll(/(?:bind|catch|capture-bind|capture-catch):?([a-zA-Z]+)\s*=\s*"([^"]+)"/g)) {
    const expr = m[2].trim();
    if (expr && !expr.includes('{{')) handlers.add(expr);
  }
  for (const handler of handlers) {
    const pattern = new RegExp('(^|[^\\w.])' + handler + '\\s*[:(]', 'm');
    if (!pattern.test(js)) problems.push(rel + '：绑定了 ' + handler + '，但对应 .js 里找不到这个方法');
  }

  // 2) 标签闭合
  // 注意：标签可能跨行，必须在整个文件上匹配（之前按行匹配会把跨行标签误判成未闭合）
  const stack = [];
  const lineOf = (index) => source.slice(0, index).split('\n').length;
  for (const m of source.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClosed = m[4] === '/' || VOID_TAGS.has(tag);
    const line = lineOf(m.index);
    if (closing) {
      const last = stack.pop();
      if (!last) problems.push(rel + ':' + line + '：多了一个 </' + tag + '>');
      else if (last.tag !== tag) problems.push(rel + ':' + line + '：</' + tag + '> 与 <' + last.tag + '>（第 ' + last.line + ' 行）不匹配');
    } else if (!selfClosed) {
      stack.push({ tag, line });
    }
  }
  for (const open of stack) problems.push(rel + ':' + open.line + '：<' + open.tag + '> 没有闭合');

  // 3) wx:for 缺 wx:key
  for (const m of source.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)(?:"[^"]*"|'[^']*'|[^>"'])*?\/?>/g)) {
    const tagText = m[0];
    if (/wx:for\s*=/.test(tagText) && !/wx:key\s*=/.test(tagText)) {
      warnings.push(rel + ':' + lineOf(m.index) + '：wx:for 未配 wx:key');
    }
  }

  // 4) 跳转路径是否注册
  for (const m of js.matchAll(/url:\s*'(\/pages\/[a-zA-Z0-9_/-]+)/g)) {
    const target = m[1].replace(/^\//, '');
    if (!pages.has(target)) problems.push(rel.replace(/\.wxml$/, '.js') + '：跳转到未注册的页面 ' + m[1]);
  }
  for (const m of js.matchAll(/switchTab\(\{\s*url:\s*'(\/pages\/[a-zA-Z0-9_/-]+)/g)) {
    const target = m[1].replace(/^\//, '');
    if (!tabPages.has(target)) problems.push(rel.replace(/\.wxml$/, '.js') + '：switchTab 目标不是 tabBar 页面 ' + m[1]);
  }
}

// 5) WXML 用到的 class 必须在 wxss 里有定义（防止类名写错导致「样式没生效」）
const appWxss = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8');
for (const wxml of wxmlFiles) {
  const rel = path.relative(ROOT, wxml).split(path.sep).join('/');
  const source = fs.readFileSync(wxml, 'utf8');
  const pageWxssPath = wxml.replace(/\.wxml$/, '.wxss');
  const css = (fs.existsSync(pageWxssPath) ? fs.readFileSync(pageWxssPath, 'utf8') : '') + '\n' + appWxss;
  const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

  const used = new Set();
  for (const m of source.matchAll(/class\s*=\s*"([^"]*)"/g)) {
    const raw = m[1];
    // {{ }} 整体去掉；只有三元表达式 ? / : 后面的字面量才是 class 名，
    // 比较用的值（scene === 'shopping'）不是，不能算进来
    const literals = [];
    for (const expr of raw.match(/\{\{[^}]*\}\}/g) || []) {
      for (const m of expr.matchAll(/[?:]\s*'([^']*)'|[?:]\s*"([^"]*)"/g)) {
        const value = m[1] !== undefined ? m[1] : m[2];
        if (value) literals.push(value);
      }
    }
    const chunks = [raw.replace(/\{\{[^}]*\}\}/g, ' ')].concat(literals);
    for (const chunk of chunks) {
      for (const token of chunk.split(/\s+/)) {
        if (/^[a-zA-Z][\w-]*$/.test(token)) used.add(token);
      }
    }
  }
  for (const cls of used) {
    if (!defined.has(cls)) problems.push(rel + '：class="' + cls + '" 在 wxss 里没有定义（样式不会生效）');
  }
}

// 6) 禁止数组解构：SWC 会把它编译成 _sliced_to_array，进而 require @swc/runtime/_array_with_holes.js，
//    而开发者工具没有注册这个助手模块，一用整个页面就报错起不来。
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (/^\s*(const|let|var)\s*\[[^\]]*\]\s*=/.test(line) && !/^\s*\/\//.test(line)) {
      problems.push(rel + ':' + (index + 1) + '：不要用数组解构（会触发 @swc/runtime/_array_with_holes 缺失）；改成 const r = await ... 然后 r[0] / r[1]');
    }
  });
}

// 7) app.json 里注册的页面文件是否齐全
for (const page of appJson.pages) {
  for (const ext of ['.js', '.json', '.wxml']) {
    const f = path.join(ROOT, page + ext);
    if (!fs.existsSync(f)) problems.push('app.json 注册的 ' + page + ' 缺少 ' + ext);
  }
}

console.log('检查了 ' + filesChecked + ' 个 wxml 文件，' + appJson.pages.length + ' 个注册页面');
if (warnings.length) {
  console.log('\n警告 ' + warnings.length + ' 条：');
  for (const w of [...new Set(warnings)]) console.log('  ! ' + w);
}
if (problems.length) {
  console.log('\n错误 ' + problems.length + ' 条：');
  for (const p of problems) console.log('  x ' + p);
  process.exit(1);
}
console.log('\nRESULT: WXML 静态检查通过（事件绑定 / 标签闭合 / 页面跳转 均无问题）');