/**
 * Recursively scan directories for Git repositories and report which have uncommitted changes.
 */
import { existsSync, statSync } from "fs";
import { readdir } from "fs/promises";
import { join, relative } from "path";
import { execSync } from "child_process";

interface ScanOptions {
  path: string;
}

/**
 * Check if path is a Git repository.
 */
function isGitRepo(path: string): boolean {
  return (
    existsSync(join(path, ".git")) && statSync(join(path, ".git")).isDirectory()
  );
}

/**
 * Run 'git status --porcelain' and return output.
 */
function getGitStatus(path: string): string {
  try {
    const result = execSync("git status --porcelain", {
      cwd: path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return result.trim();
  } catch {
    return "";
  }
}

/**
 * Recursively find all Git repositories under root (with parallel directory scanning).
 */
async function findGitRepos(root: string): Promise<string[]> {
  const repos: string[] = [];

  async function scan(dir: string): Promise<void> {
    if (isGitRepo(dir)) {
      repos.push(dir);
      return; // Don't scan inside git repos
    }

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const subdirs = entries
        .filter((entry) => entry.isDirectory() && entry.name !== ".git")
        .map((entry) => join(dir, entry.name));

      // Scan subdirectories in parallel
      await Promise.all(subdirs.map((subdir) => scan(subdir)));
    } catch {
      // Skip directories we can't read
    }
  }

  await scan(root);
  return repos;
}

/**
 * Main function to scan and report Git repositories.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: ScanOptions = {
    path: args[0] || ".",
  };

  if (args.includes("-h") || args.includes("--help")) {
    console.log("Usage: git-scanner [path]");
    console.log("");
    console.log("Find Git repositories with uncommitted changes.");
    console.log("");
    console.log("Arguments:");
    console.log("  path    Directory to scan (default: current directory)");
    process.exit(0);
  }

  if (!existsSync(options.path)) {
    console.error(`Error: Path '${options.path}' does not exist.`);
    process.exit(1);
  }

  if (!statSync(options.path).isDirectory()) {
    console.error(`Error: Path '${options.path}' is not a directory.`);
    process.exit(1);
  }

  const repos = await findGitRepos(options.path);

  // Check Git status for all repos in parallel
  const statusChecks = await Promise.all(
    repos.map(async (repo) => ({
      repo,
      status: getGitStatus(repo),
      relPath: relative(options.path, repo) || ".",
    })),
  );

  let dirtyCount = 0;

  for (const { repo, status, relPath } of statusChecks) {
    const icon = status ? "❌" : "✅";
    const statusText = status ? "uncommitted changes" : "clean";
    const padding = " ".repeat(Math.max(1, 40 - relPath.length));

    console.log(`${icon} ${relPath}${padding} → ${statusText}`);

    if (status) {
      dirtyCount++;
    }
  }

  if (dirtyCount > 0) {
    console.log(
      `\n⚠️  Found ${dirtyCount} repository(s) with uncommitted changes.`,
    );
  } else {
    console.log("\n🎉 All repositories are clean!");
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
