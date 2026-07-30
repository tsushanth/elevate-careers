import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';

// Build mount.js with Transformers.js bundled
await esbuild.build({
  entryPoints: ['src/mount.js'],
  bundle: true,
  outfile: 'dist/mount.js',
  format: 'iife',
  target: 'es2020',
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

// Copy other files
mkdirSync('dist', { recursive: true });
mkdirSync('dist/assets', { recursive: true });
copyFileSync('src/detect.js',      'dist/detect.js');
copyFileSync('src/detect-ats.js', 'dist/detect-ats.js');
copyFileSync('src/discover.js', 'dist/discover.js');
copyFileSync('src/sw.js', 'dist/sw.js');
copyFileSync('src/options.js', 'dist/options.js');
copyFileSync('src/options.html', 'dist/options.html');
copyFileSync('src/manifest.json', 'dist/manifest.json');
copyFileSync('src/assets/resume.pdf', 'dist/assets/resume.pdf');
copyFileSync('src/assets/cover_letter.pdf', 'dist/assets/cover_letter.pdf');

console.log('✅ Build complete!');