const { PDFParse } = require("pdf-parse");
const fs = require("fs");

const pdfPath = "E:\\GatePass\\event_parking_project_summary (1).pdf";
const dataBuffer = new Uint8Array(fs.readFileSync(pdfPath));

const parser = new PDFParse(dataBuffer);
parser.getText().then((data) => {
  console.log(data.text);
});
