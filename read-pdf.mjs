import pdf from "pdf-parse";
import fs from "fs";

const pdfPath = "E:\\GatePass\\event_parking_project_summary (1).pdf";
const dataBuffer = fs.readFileSync(pdfPath);

pdf(dataBuffer).then((data) => {
  console.log(data.text);
});
