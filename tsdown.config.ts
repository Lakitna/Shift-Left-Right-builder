import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'tsdown';

/**
 * Minify the static assets that `copy` drops next to the web bundle (HTML + CSS).
 * Registered on tsdown's `build:done` hook, which fires after the bundle is
 * written and the copied files are on disk — in build and watch mode alike.
 */
async function minifyStaticAssets(directory = 'dist/web') {
    const cssPath = `${directory}/styles.css`;
    await writeFile(
        cssPath,
        new CleanCSS({ level: 1 }).minify(await readFile(cssPath, 'utf8')).styles
    );
    const htmlPath = `${directory}/index.html`;
    await writeFile(
        htmlPath,
        await minifyHtml(await readFile(htmlPath, 'utf8'), {
            collapseWhitespace: true,
            conservativeCollapse: true, // keep one space where whitespace is semantic
            removeComments: true,
            removeOptionalTags: true,
        })
    );
}

/**
 * Web app bundle: src/index.ts -> dist/web/app.js (ES module, minified).
 * Static assets are copied to dist/web (and watched in watch mode); the copied
 * HTML/CSS are minified afterwards via the `build:done` hook.
 */
export default defineConfig({
    entry: { app: 'src/index.ts' },
    format: 'esm',
    outDir: 'dist/web',
    platform: 'browser',
    target: 'esnext',
    minify: true,
    // clean: true is the default and empties dist/web before each build
    copy: [
        { from: 'src/index.html', to: 'dist/web' },
        { from: 'src/styles.css', to: 'dist/web' },
        { from: 'src/fonts/*.woff2', to: 'dist/web/fonts' },
    ],
    hooks: {
        'build:done': () => minifyStaticAssets(),
    },
});
