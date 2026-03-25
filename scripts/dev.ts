import { spawn } from "node:child_process";

spawn("node", ["--run", "build"], {
  stdio: "inherit",
});
