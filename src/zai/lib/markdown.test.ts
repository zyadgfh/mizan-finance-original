import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdownSafe, extractCodeBlocks } from "./markdown.ts";

test("renderMarkdownSafe strips <script> tags entirely", () => {
  const html = renderMarkdownSafe("hello <script>alert(1)</script> world");
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("alert(1)"));
});

test("renderMarkdownSafe strips inline event handlers like onerror/onclick", () => {
  const html = renderMarkdownSafe('<img src="x" onerror="alert(1)">');
  assert.ok(!/onerror/i.test(html));
});

test("renderMarkdownSafe blocks javascript: URLs", () => {
  const html = renderMarkdownSafe("[click me](javascript:alert(1))");
  assert.ok(!/javascript:/i.test(html));
});

test("renderMarkdownSafe still renders safe Markdown constructs", () => {
  const html = renderMarkdownSafe("# عنوان\n\n**غامق** و*مائل*\n\n- عنصر واحد\n- عنصر آخر");
  assert.ok(html.includes("<h1>"));
  assert.ok(html.includes("<strong>"));
  assert.ok(html.includes("<li>"));
});

test("extractCodeBlocks returns fenced code bodies only", () => {
  const md = "نص\n```js\nconst a = 1;\n```\nنص آخر\n```python\nprint(1)\n```";
  const blocks = extractCodeBlocks(md);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /const a = 1;/);
  assert.match(blocks[1], /print\(1\)/);
});
