import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}`);
    const proc = spawn(command, args, {
      cwd: cwd || __dirname,
      stdio: "inherit",
      shell: true,
    });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`Command failed with code ${code}`));
      else resolve();
    });
    proc.on("error", reject);
  });
}

async function main() {
  try {
    // Install dependencies
    await run("npm", ["install"]);

    // Start backend server (long-running)
    console.log("\n--- Starting backend server on port 3000 ---\n");
    const server = spawn("node", ["--import", "tsx/esm", "src/index.ts"], {
      cwd: path.join(__dirname, "be"),
      stdio: "inherit",
      shell: true,
    });

    server.on("error", (err) => {
      console.error("Server failed:", err.message);
      process.exit(1);
    });

    // Keep alive
    process.on("SIGINT", () => {
      server.kill();
      process.exit(0);
    });
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
}

main();
