import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const feDir = path.join(__dirname, "fe");

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}`);
    const proc = spawn(command, args, { cwd: cwd || __dirname, stdio: "inherit", shell: true });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Failed: ${command}`)));
    proc.on("error", reject);
  });
}

async function main() {
  try {
    await run("npx", ["expo", "install", "react-native-web", "react-dom"], feDir);
    console.log("\n--- Web deps installed. Starting Expo web... ---\n");
    const expo = spawn("npx", ["expo", "start", "--web"], { cwd: feDir, stdio: "inherit", shell: true });
    expo.on("error", (err) => { console.error("Error:", err.message); process.exit(1); });
    process.on("SIGINT", () => { expo.kill(); process.exit(0); });
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
