import { existsSync, statSync, readdirSync } from "fs";
import { join, relative } from "path";
import { execSync } from "child_process";
import { cpus } from "os";

interface ScanOptions {
  path: string;
  verbose: boolean;
  ignorePatterns: Set<string>;
  maxDepth: number;
  concurrency: number;
}

interface RepoStatus {
  repo: string;
  status: string;
  branch: string;
  unpushed: number;
  stashCount: number;
  lastCommit?: { author: string; date: string; message: string } | null;
  relPath: string;
}

/**
 * Check if path is a Git repository.
 */
function isGitRepo(path: string): boolean {
  const gitPath = join(path, ".git");
  return existsSync(gitPath) && statSync(gitPath).isDirectory();
}

/**
 * Run Git command and return output.
 */
function runGitCommand(path: string, command: string): string {
  try {
    const result = execSync(command, {
      cwd: path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000, // Add timeout to prevent hanging
    });
    return result.trim();
  } catch {
    return "";
  }
}

/**
 * Get Git status with a single command instead of multiple.
 */
function getGitStatus(path: string): {
  status: string;
  branch: string;
  unpushed: number;
  stashCount: number;
} {
  const status = runGitCommand(path, "git status --porcelain");
  const branch =
    runGitCommand(path, "git rev-parse --abbrev-ref HEAD") || "unknown";
  const unpushedStr = runGitCommand(path, "git rev-list @{u}..HEAD --count");
  const unpushed = parseInt(unpushedStr, 10) || 0;
  const stashList = runGitCommand(path, "git stash list");
  const stashCount = stashList
    ? stashList.split("\n").filter((line) => line.length > 0).length
    : 0;

  return { status, branch, unpushed, stashCount };
}

/**
 * Get last commit information.
 */
function getLastCommitInfo(
  path: string,
): { author: string; date: string; message: string } | null {
  try {
    const result = execSync('git log -1 --format="%an|%ar|%s"', {
      cwd: path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 2000,
    }).trim();

    const [author, date, message] = result.split("|");
    return { author, date, message };
  } catch {
    return null;
  }
}

/**
 * Check if a directory name matches any ignore pattern.
 */
function shouldIgnoreDirectory(
  dirName: string,
  ignorePatterns: Set<string>,
): boolean {
  // Quick check for exact matches first
  if (ignorePatterns.has(dirName)) {
    return true;
  }

  // Then check wildcard patterns
  for (const pattern of ignorePatterns) {
    if (pattern.includes("*")) {
      const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
      if (new RegExp(`^${regexPattern}$`).test(dirName)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Synchronous directory scanning for better performance.
 * Uses Set for ignore patterns for O(1) lookups.
 */
function findGitReposSync(
  root: string,
  ignorePatterns: Set<string>,
  maxDepth: number,
): string[] {
  const repos: string[] = [];
  const dirsToScan = [{ path: root, depth: 0 }];

  while (dirsToScan.length > 0) {
    const { path: currentPath, depth } = dirsToScan.pop()!;

    // Skip if we've reached max depth
    if (depth >= maxDepth) {
      continue;
    }

    // Check if this is a Git repository
    if (isGitRepo(currentPath)) {
      repos.push(currentPath);
      continue; // Don't scan inside git repos
    }

    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });

      // Process directories in reverse order for better stack performance
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];

        if (!entry.isDirectory() || entry.name === ".git") {
          continue;
        }

        // Check if directory should be ignored
        if (shouldIgnoreDirectory(entry.name, ignorePatterns)) {
          continue;
        }

        dirsToScan.push({
          path: join(currentPath, entry.name),
          depth: depth + 1,
        });
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return repos;
}

/**
 * Process repositories in batches with controlled concurrency.
 */
async function processRepositories(
  repos: string[],
  options: Pick<ScanOptions, "verbose" | "path">,
  concurrency: number,
): Promise<RepoStatus[]> {
  const results: RepoStatus[] = [];

  // Process in batches
  for (let i = 0; i < repos.length; i += concurrency) {
    const batch = repos.slice(i, i + concurrency);

    const batchPromises = batch.map(async (repo) => {
      const { status, branch, unpushed, stashCount } = getGitStatus(repo);

      let lastCommit;
      if (options.verbose) {
        lastCommit = getLastCommitInfo(repo);
      }

      const relPath = relative(options.path, repo) || ".";

      return {
        repo,
        status,
        branch,
        unpushed,
        stashCount,
        lastCommit,
        relPath,
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Progress indicator
    const processed = Math.min(i + concurrency, repos.length);
    const percentage = Math.floor((processed / repos.length) * 100);
    process.stdout.write(
      `\rChecking Git status: ${percentage}% (${processed}/${repos.length})`,
    );
  }

  process.stdout.write("\r\x1b[K"); // Clear the line
  return results;
}

/**
 * Main function to scan and report Git repositories.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Default ignore patterns - using Set for O(1) lookups
  const defaultIgnorePatterns = new Set([
    "node_modules",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    "vendor",
    "target",
    "build",
    "dist",
    ".next",
    ".nuxt",
    "out",
    ".git",
    ".svn",
    ".hg",
    "tmp",
    "temp",
    "cache",
    ".cache",
  ]);

  const options: ScanOptions = {
    path: args.find((arg) => !arg.startsWith("-")) || ".",
    verbose: args.includes("-v") || args.includes("--verbose"),
    ignorePatterns: defaultIgnorePatterns,
    maxDepth: Infinity,
    concurrency: Math.min(cpus().length, 8), // Use CPU count but max at 8
  };

  // Process flags
  const maxDepthArgIndex = args.findIndex((arg) => arg === "--max-depth");
  if (maxDepthArgIndex !== -1 && args[maxDepthArgIndex + 1]) {
    const depth = parseInt(args[maxDepthArgIndex + 1], 10);
    if (!isNaN(depth) && depth > 0) {
      options.maxDepth = depth;
    }
  }

  // Process custom ignore patterns
  const ignoreArgIndex = args.findIndex((arg) => arg === "--ignore");
  if (ignoreArgIndex !== -1 && args[ignoreArgIndex + 1]) {
    const customPatterns = args[ignoreArgIndex + 1]
      .split(",")
      .map((p) => p.trim());
    customPatterns.forEach((p) => options.ignorePatterns.add(p));
  }

  // Process no-default-ignore flag
  if (args.includes("--no-default-ignore")) {
    options.ignorePatterns.clear();
    const ignoreArgIndex = args.findIndex((arg) => arg === "--ignore");
    if (ignoreArgIndex !== -1 && args[ignoreArgIndex + 1]) {
      const customPatterns = args[ignoreArgIndex + 1]
        .split(",")
        .map((p) => p.trim());
      customPatterns.forEach((p) => options.ignorePatterns.add(p));
    }
  }

  // Process concurrency flag
  const concurrencyArgIndex = args.findIndex((arg) => arg === "--concurrency");
  if (concurrencyArgIndex !== -1 && args[concurrencyArgIndex + 1]) {
    const concurrency = parseInt(args[concurrencyArgIndex + 1], 10);
    if (!isNaN(concurrency) && concurrency > 0) {
      options.concurrency = Math.min(concurrency, 16);
    }
  }

  if (args.includes("-h") || args.includes("--help")) {
    console.log("Usage: gitski [path] [options]");
    console.log("");
    console.log("Find Git repositories with uncommitted changes.");
    console.log("");
    console.log("Arguments:");
    console.log(
      "  path                    Directory to scan (default: current directory)",
    );
    console.log("");
    console.log("Options:");
    console.log("  -v, --verbose           Show last commit information");
    console.log(
      "  --max-depth <n>         Limit directory scanning to depth n (default: unlimited)",
    );
    console.log(
      "  --ignore <patterns>     Additional directories to ignore (comma-separated)",
    );
    console.log(
      '                          Example: --ignore "tmp,cache,*.log"',
    );
    console.log("  --no-default-ignore     Disable default ignore patterns");
    console.log(
      "  --concurrency <n>       Number of concurrent Git operations (default: CPU count, max: 16)",
    );
    console.log("  -h, --help              Show this help message");
    console.log("");
    console.log("Default ignored directories:");
    console.log("  " + Array.from(defaultIgnorePatterns).join(", "));
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

  console.log("Scanning for Git repositories...");
  const startTime = Date.now();

  const repos = findGitReposSync(
    options.path,
    options.ignorePatterns,
    options.maxDepth,
  );
  const scanTime = Date.now() - startTime;

  console.log(
    `\nFound ${repos.length} repositor${repos.length === 1 ? "y" : "ies"} in ${scanTime}ms. Checking status...\n`,
  );

  if (repos.length === 0) {
    console.log("No Git repositories found.");
    return;
  }

  // Process repositories with controlled concurrency
  const statusResults = await processRepositories(
    repos,
    options,
    options.concurrency,
  );

  let dirtyCount = 0;

  for (const {
    repo,
    status,
    branch,
    unpushed,
    stashCount,
    lastCommit,
    relPath,
  } of statusResults) {
    const hasChanges = status.length > 0;
    const hasUnpushed = unpushed > 0;
    const hasStash = stashCount > 0;

    let icon = "✅";
    const statusParts: string[] = [];

    if (hasChanges) {
      icon = "❌";
      statusParts.push("uncommitted changes");
      dirtyCount++;
    } else {
      statusParts.push("clean");
    }

    if (hasUnpushed) {
      icon = hasChanges ? "❌" : "⚠️";
      statusParts.push(`${unpushed} unpushed commit${unpushed > 1 ? "s" : ""}`);
      if (!hasChanges) dirtyCount++;
    }

    if (hasStash) {
      statusParts.push(`${stashCount} stash${stashCount > 1 ? "es" : ""}`);
    }

    const statusText = statusParts.join(", ");

    console.log(`${icon} ${relPath} → [${branch}] ${statusText}`);

    if (options.verbose && lastCommit) {
      console.log(`   Last commit: ${lastCommit.message}`);
      console.log(`   By ${lastCommit.author}, ${lastCommit.date}`);
      console.log("");
    }
  }

  const totalTime = Date.now() - startTime;

  if (dirtyCount > 0) {
    console.log(
      `\n⚠️  Found ${dirtyCount} repository(s) with uncommitted changes.`,
    );
  } else {
    console.log("\n🎉 All repositories are clean!");
  }

  console.log(`\nCompleted in ${totalTime}ms`);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
