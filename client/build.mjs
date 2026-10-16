// Bundles the two entry points into wwwroot/app/. No framework runtime: the
// board writes transforms straight to the DOM, so a vdom would only sit in the
// hot path of every drag frame.
import * as esbuild from 'esbuild';

const options = {
  entryPoints: {
    board: 'src/main.ts',
    admin: 'src/admin.ts',
  },
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome111', 'firefox115', 'safari16'],
  outdir: '../wwwroot/app',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching client/src …');
} else {
  await esbuild.build(options);
}
