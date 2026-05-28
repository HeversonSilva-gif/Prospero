import { existsSync } from "node:fs";
import { join } from "node:path";

// On Windows, cross-spawn must wrap `claude.cmd` invocations through `cmd.exe /d /s /c "..."`.
// When the parent is the Electron main process, that cmd.exe wrapper breaks stdio handle
// inheritance — claude stays alive but emits zero bytes back. We resolve the real .exe
// (npm-installed adjacent to claude.cmd) and spawn it without cmd.exe. Falls back to
// cross-spawn on non-Windows or when the exe can't be located.
export const findClaudeExe = (): string | null => {
  if (process.platform !== "win32") return null;
  const pathDirs = (process.env["PATH"] ?? "").split(";").filter((d) => d !== "");
  for (const dir of pathDirs) {
    const directExe = join(dir, "claude.exe");
    if (existsSync(directExe)) return directExe;
  }
  for (const dir of pathDirs) {
    const cmd = join(dir, "claude.cmd");
    if (existsSync(cmd)) {
      const candidate = join(
        dir,
        "node_modules",
        "@anthropic-ai",
        "claude-code",
        "bin",
        "claude.exe",
      );
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
};

// On macOS and Linux the primary spawn path is cross-spawn("claude", args) which
// uses the shell PATH — this works for most installations. However, Electron GUI
// apps on macOS receive a restricted PATH (typically /usr/bin:/bin:/usr/sbin:/sbin)
// that omits node version manager shims (nvm/volta/fnm/asdf). If cross-spawn fails
// to find claude, this helper can locate the binary by scanning the full login
// PATH directly, allowing the adapter to use an absolute path instead.
//
// Returns the absolute path to `claude` if found in PATH, or null if not found
// or if called on Windows (Windows uses findClaudeExe instead).
export const findClaudePosix = (): string | null => {
  if (process.platform === "win32") return null;
  // POSIX PATH separator is ":". Split and scan each directory.
  const pathDirs = (process.env["PATH"] ?? "").split(":").filter((d) => d !== "");
  for (const dir of pathDirs) {
    const candidate = join(dir, "claude");
    if (existsSync(candidate)) return candidate;
  }
  return null;
};
