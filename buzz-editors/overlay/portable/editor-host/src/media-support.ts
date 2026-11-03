import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Inspect the Linux automatic audio output required by WebKit before rendering imported media.
 * @returns Availability and a platform-specific setup instruction; no packages are installed.
 */
export function checkMediaSupport(): {
  available: boolean;
  instruction: string;
} {
  if (process.platform !== "linux") return { available: true, instruction: "" };
  let release = "";
  try {
    release = readFileSync("/etc/os-release", "utf8");
  } catch (error) {
    // Unknown Linux distributions retain generic package-manager instructions.
    if (!(error instanceof Error)) throw error;
  }
  const arch = /^(?:ID|ID_LIKE)=["']?(?:arch|[^\n]*\barch\b)/m.test(release);
  const instruction = arch
    ? "Run sudo pacman -S --needed gst-plugins-good in Terminal, then fully quit and reopen Buzz."
    : "Install your distribution’s GStreamer tools and good plugins package, then fully quit and reopen Buzz.";
  try {
    execFileSync("/usr/bin/gst-inspect-1.0", ["autoaudiosink"], {
      stdio: "ignore",
      timeout: 5000,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { available: false, instruction };
  }
  return { available: true, instruction: "" };
}
