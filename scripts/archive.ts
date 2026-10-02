import { execFileSync } from "node:child_process";
import path from "node:path";

/** Archive names are data, including shell metacharacters and leading dashes. */
export function readZippedMbox(filePath: string): string {
  return execFileSync("unzip", ["-p", path.resolve(filePath)], {
    maxBuffer: 1024 * 1024 * 1024,
    encoding: "utf-8",
  });
}

export function extractTape(tarPath: string, destination: string): void {
  execFileSync("tar", ["xjf", path.resolve(tarPath), "-C", destination], {
    maxBuffer: 500 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}
