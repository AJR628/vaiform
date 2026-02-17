import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyDir(src, dest) {
  try {
    fs.mkdirSync(dest, { recursive: true });

    const files = fs.readdirSync(src);
    console.log(`Found ${files.length} items in ${src}`);

    files.forEach((file) => {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);

      if (fs.statSync(srcPath).isDirectory()) {
        console.log(`Copying directory: ${file}`);
        copyDir(srcPath, destPath);
      } else {
        console.log(`Copying file: ${file}`);
        fs.copyFileSync(srcPath, destPath);
      }
    });
  } catch (error) {
    console.error('Error copying:', error);
    process.exit(1);
  }
}

// Copy from ../public to ./dist
const publicDir = path.join(__dirname, '..', '..', 'public');
const distDir = path.join(__dirname, '..', 'dist');

console.log(`Copying from ${publicDir} to ${distDir}`);
console.log(`Public dir exists: ${fs.existsSync(publicDir)}`);
console.log(`Dist dir exists: ${fs.existsSync(distDir)}`);

copyDir(publicDir, distDir);
console.log('Copy completed successfully!');
