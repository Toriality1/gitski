# Gitski: Simple Git Scanner

A high-performance Git repository scanner that recursively finds Git repositories and reports uncommitted changes, unpushed commits, and stash information.

## Features

- 🔍 **Fast Scanning**: Optimized for large directory structures
- 📊 **Status Reporting**: Shows uncommitted changes, unpushed commits, and stashes
- 🎯 **Configurable**: Custom ignore patterns, depth limits, and concurrency control
- 📈 **Progress Tracking**: Real-time progress indicators
- 🔧 **Cross-Platform**: Works on Windows, macOS, and Linux

## Installation

```bash
npx gitski
# Or install it globally
npm install -g @toriality/gitski
```

## Usage

### Basic Usage

```bash
# Scan current directory
gitski

# Scan specific directory
gitski /path/to/projects

# Verbose mode (show last commit info)
gitski -v
```

### Performance Options

```bash
# Limit scanning depth
gitski --max-depth 3

# Control concurrency (default: CPU count, max: 16)
gitski --concurrency 8

# Custom ignore patterns
gitski --ignore "tmp,cache,*.log"

# Disable default ignore patterns
gitski --no-default-ignore
```

### Combined Example

```bash
gitski ~/projects --max-depth 5 --concurrency 12 --ignore "vendor,tmp" -v
```

## Output Format

```
✅ project-a → [main] clean
❌ project-b → [develop] uncommitted changes
⚠️  project-c → [feature-branch] 2 unpushed commits
❌ project-d → [main] uncommitted changes, 1 unpushed commit, 1 stash

⚠️  Found 2 repository(s) with uncommitted changes.
```

### Verbose Mode Output

```
✅ project-a → [main] clean
   Last commit: Add new feature
   By John Doe, 2 hours ago

❌ project-b → [develop] uncommitted changes
   Last commit: Fix bug in parser
   By Jane Smith, 1 day ago
```

## Default Ignore Patterns

The following directories are ignored by default:

- `node_modules` - Node.js dependencies
- `.venv`, `venv`, `env` - Python virtual environments
- `__pycache__` - Python cache
- `vendor` - Vendor dependencies
- `target` - Rust/Cargo build output
- `build`, `dist`, `out` - Build outputs
- `.next`, `.nuxt` - Framework build directories
- `.git`, `.svn`, `.hg` - Version control directories
- `tmp`, `temp`, `cache`, `.cache` - Temporary files

## Performance Optimizations

The scanner includes several performance optimizations:

1. **Synchronous Directory Scanning**: Faster than async/await for file operations
2. **Controlled Concurrency**: Prevents memory exhaustion with configurable parallelism
3. **Efficient Git Operations**: Minimizes process spawning
4. **Set-based Ignore Patterns**: O(1) lookups instead of O(n) array searches
5. **Batch Processing**: Reduces event loop blocking

## Exit Codes

- `0` - Success (all repositories clean or reported)
- `1` - Error (invalid path, permissions, etc.)

## Troubleshooting

### Git Commands Hanging
- The scanner includes 5-second timeouts for Git commands
- Check if Git is properly installed: `git --version`
- Verify repository permissions

### Memory Issues
- Reduce concurrency: `--concurrency 2`
- Limit scanning depth: `--max-depth 2`
- Add more ignore patterns: `--ignore "large-dir,cache"`

### Permission Errors
- Ensure read access to all directories being scanned
- Use `--max-depth` to avoid system directories
- Check Git repository permissions

## Contributing

Performance improvements and bug fixes are welcome!

## License

MIT License - Feel free to use and modify for personal and commercial projects.
