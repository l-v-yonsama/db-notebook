import * as fs from "fs";
import { window } from "vscode";

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function createPreferredTerminal(name: string) {
  if (process.platform !== "win32") {
    return window.createTerminal({ name });
  }

  // 1. WSL
  const wslPath = "C:\\Windows\\System32\\wsl.exe";
  if (exists(wslPath)) {
    return window.createTerminal({
      name,
      shellPath: wslPath,
      shellArgs: ["--"],
    });
  }

  // 2. Git Bash
  const gitBashCandidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];

  for (const bashPath of gitBashCandidates) {
    if (exists(bashPath)) {
      return window.createTerminal({
        name,
        shellPath: bashPath,
        shellArgs: ["-l"],
      });
    }
  }

  // 3. fallback
  return window.createTerminal({ name });
}
