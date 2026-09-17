import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { marked } from "marked";

const root = process.cwd();
const mdName = process.argv[2] || "event_parking_project_summary_v3.md";
const mdPath = path.join(root, mdName);
const htmlPath = mdPath.replace(/\.md$/, ".html");
const pdfPath = mdPath.replace(/\.md$/, ".pdf");

if (!fs.existsSync(mdPath)) {
  console.error(`Markdown not found: ${mdPath}`);
  process.exit(1);
}

const md = fs.readFileSync(mdPath, "utf8");
const body = await marked.parse(md);

const styles = `
  @page { size: A4; margin: 18mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", -apple-system, Roboto, Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1a1a1a;
    margin: 0;
  }
  h1 { font-size: 22pt; margin: 0 0 4px; letter-spacing: -0.3px; }
  h2 {
    font-size: 13.5pt;
    margin: 26px 0 8px;
    padding-bottom: 5px;
    border-bottom: 2px solid #111;
  }
  h3 { font-size: 11.5pt; margin: 18px 0 6px; }
  p { margin: 8px 0; }
  ul { margin: 8px 0; padding-left: 20px; }
  li { margin: 4px 0; }
  strong { font-weight: 600; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0 16px;
    font-size: 9pt;
  }
  th, td {
    border: 1px solid #c9ccd1;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eef0f3; font-weight: 600; }
  tr { page-break-inside: avoid; }
  code {
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: 9pt;
    background: #f2f3f5;
    padding: 1px 4px;
    border-radius: 3px;
  }
  pre {
    background: #f7f8fa;
    border: 1px solid #e1e4e8;
    border-left: 3px solid #6b7280;
    border-radius: 4px;
    padding: 10px 12px;
    overflow-x: auto;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 8.5pt; }
  hr { border: none; border-top: 1px solid #d8dade; margin: 22px 0; }
  a { color: #1a56db; text-decoration: none; }
  em { color: #4b5563; }
  h1 + p em { display: block; margin-top: 6px; }
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>GatePass — Project Summary</title>
<style>${styles}</style>
</head>
<body>
${body}
</body>
</html>`;

fs.writeFileSync(htmlPath, html, "utf8");
console.log(`HTML written: ${htmlPath}`);

const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const browser = edgeCandidates.find((p) => fs.existsSync(p));
if (!browser) {
  console.error("No Edge/Chrome found. Open the HTML manually and print to PDF.");
  process.exit(1);
}

const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");

execFileSync(
  browser,
  [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    fileUrl,
  ],
  { stdio: "inherit" }
);

console.log(`PDF written: ${pdfPath}`);
