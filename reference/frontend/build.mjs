import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const here = dirname(fileURLToPath(import.meta.url));
const result = await build({ entryPoints: [resolve(here, "tiptap-entry.js")], bundle: true, minify: true,
    format: "iife", globalName: "SurveyTiptap", target: "es2020", legalComments: "eof", metafile: true,
    outfile: resolve(here, "../../frontend/vendor/tiptap/tiptap.min.js") });
const packages = [...new Set(Object.keys(result.metafile.inputs).map(file => {
    const match = file.replaceAll("\\", "/").match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    return match?.[1];
}).filter(Boolean))].sort();
const notices = await Promise.all(packages.map(async name => {
    const base = resolve(here, "node_modules", name);
    const pkg = JSON.parse(await readFile(resolve(base, "package.json"), "utf8"));
    let license;
    for (const filename of ["LICENSE", "LICENSE.md", "LICENSE-MIT", "license"]) {
        try { license = await readFile(resolve(base, filename), "utf8"); break; } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (!license) throw new Error(`Missing license: ${name}`);
    return `${name}@${pkg.version} (${pkg.license})\n${license.trim()}\n`;
}));
await writeFile(resolve(here, "../../frontend/vendor/tiptap/LICENSES.txt"), notices.join("\n---\n\n"));
console.log(`Built self-hosted Tiptap with ${packages.length} dependency licenses.`);
