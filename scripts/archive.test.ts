import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extractTape, readZippedMbox } from "./archive";

// Exercise the real archive programs, without any production database or archive.
test("archive filenames cannot execute shell substitutions and still import", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "usenet-archives-test-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(directory);
    const content = "From: reader@example.test\nNewsgroups: test.group\n\nFixture article\n";
    fs.writeFileSync("article", content);
    execFileSync("zip", ["-q", "fixture.zip", "article"]);
    execFileSync("tar", ["cjf", "fixture.tar.bz2", "article"]);

    fs.copyFileSync("fixture.zip", ".mbox.zip");
    fs.copyFileSync("fixture.tar.bz2", ".tar.bz2");
    for (const basename of ["$(touch${IFS}SHELL_RAN)", "`touch${IFS}SHELL_RAN`",
      "ordinary", "has spaces", 'has"quote', "-leading-dash"]) {
      const zipName = `${basename}.mbox.zip`;
      const tarName = `${basename}.tar.bz2`;
      fs.copyFileSync("fixture.zip", zipName);
      fs.copyFileSync("fixture.tar.bz2", tarName);
      assert.equal(readZippedMbox(zipName), content);
      const destination = fs.mkdtempSync(path.join(directory, "extract-"));
      extractTape(tarName, destination);
      assert.equal(fs.readFileSync(path.join(destination, "article"), "utf8"), content);
      assert.equal(fs.existsSync("SHELL_RAN"), false, basename);
    }
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("missing archives retain the importers' error path", () => {
  assert.throws(() => readZippedMbox("/nonexistent-usenet-test/archive.mbox.zip"));
  assert.throws(() => extractTape("/nonexistent-usenet-test/archive.tar.bz2", os.tmpdir()));
});
