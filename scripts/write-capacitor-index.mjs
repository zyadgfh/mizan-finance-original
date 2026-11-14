import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const staticDir = join(root, ".vercel", "output", "static");
const assetsDir = join(staticDir, "assets");
const assets = await readdir(assetsDir);
const entry = assets.find((name) => /^web-[^/]+\.js$/.test(name));
const stylesheet = assets.find((name) => /^styles-[^/]+\.css$/.test(name));
if (!entry) throw new Error("Capacitor entry asset was not found in .vercel/output/static/assets");

const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f2f2f7" />
    <meta name="mobile-web-app-capable" content="yes" />
    ${stylesheet ? `<link rel="stylesheet" href="./assets/${stylesheet}" />` : ""}
    <title>ميزان</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/${entry}"></script>
  </body>
</html>
`;

await writeFile(join(staticDir, "index.html"), html);
console.log(`[capacitor] wrote ${join(staticDir, "index.html")} using ${entry}`);
