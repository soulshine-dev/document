import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const targets = [".next"];

function tryRemoveDir(absolutePath, attempts = 6) {
  let lastError;

  for (let index = 0; index < attempts; index += 1) {
    try {
      fs.rmSync(absolutePath, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 120
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn(
      `Warning: could not fully remove ${absolutePath}. Continuing without blocking dev startup.`
    );
  }

  return false;
}

for (const relative of targets) {
  const absolute = path.join(projectRoot, relative);
  if (fs.existsSync(absolute)) {
    const removed = tryRemoveDir(absolute);
    if (removed && !fs.existsSync(absolute)) {
      console.log(`Removed ${relative}`);
    }
  }
}
