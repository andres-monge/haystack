import * as fs from "node:fs";

export function atomicWriteFile(
  filePath: string,
  contents: string | Buffer,
): void {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, contents);
  fs.renameSync(temporaryPath, filePath);
}
