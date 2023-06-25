const fs = require('fs');
const zlib = require('zlib');
const archiver = require('archiver');

export function zipFolder(sourceFolder: any, zipFilePath: any) {
  return new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve();
    });

    archive.on('error', (err: any) => {
      reject(err);
    });

    archive.pipe(output);

    // Recursively add files and folders to the archive
    archive.directory(sourceFolder, false);

    archive.finalize();
  });
}