import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  fs.readdirSync(src).forEach((file) => {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);

    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

// Copy from ../public to ./dist
const publicDir = path.join(__dirname, '..', '..', 'public');
const distDir = path.join(__dirname, '..', 'dist');

console.log(`Copying from ${publicDir} to ${distDir}`);
copyDir(publicDir, distDir);
console.log('Copy completed!');
