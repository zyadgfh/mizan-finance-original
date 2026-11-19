import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8");

test("tokens.css defines all four required theme selectors", () => {
  for (const theme of ["greenapple-dark", "greenapple-light", "dark", "light"]) {
    assert.match(tokensCss, new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{`), `missing [data-theme="${theme}"] block`);
  }
});

/** Extracts every selector list (the text before each `{`) from a CSS source. */
function extractSelectorLists(css: string): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const lists: string[] = [];
  const re = /([^{}]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    const prelude = m[1].trim();
    if (prelude.startsWith("@")) continue; // skip at-rules like @supports/@media
    lists.push(prelude.replace(/\s+/g, " "));
  }
  return lists;
}

test("tokens.css never mixes a bare [data-theme] branch with a descendant-class branch in one rule", () => {
  // The reference bug was exactly this shape:
  //   [data-theme='light'], [data-theme='greenapple-light'] .glass { ... }
  // One comma branch is a BARE theme attribute selector (applies to the root
  // element itself) while the other branch targets `.glass` inside it — so
  // the light-glass background leaked onto every element under [data-theme='light'].
  for (const list of extractSelectorLists(tokensCss)) {
    if (!list.includes(",")) continue;
    const branches = list.split(",").map((b) => b.trim());
    const hasBareThemeBranch = branches.some((b) => /^\[data-theme=['"][\w-]+['"]\]$/.test(b) || /^\[data-theme=['"][\w-]+['"]\]\[data-contrast=['"][\w-]+['"]\]$/.test(b));
    const hasDescendantBranch = branches.some((b) => /\[data-theme=['"][\w-]+['"]\]\s+\S/.test(b));
    assert.ok(!(hasBareThemeBranch && hasDescendantBranch), `ambiguous mixed selector list: "${list}"`);
  }
});

test("every .zai-glass / .zai-rim::before / .zai-icon-btn::before theme override repeats its own class on each branch", () => {
  for (const list of extractSelectorLists(tokensCss)) {
    if (!/\.zai-(glass|rim|icon-btn)/.test(list) || !list.includes(",")) continue;
    const branches = list.split(",").map((b) => b.trim());
    for (const b of branches) {
      assert.match(b, /\.zai-(glass|rim|icon-btn)/, `branch "${b}" in "${list}" must repeat the target class`);
    }
  }
});
