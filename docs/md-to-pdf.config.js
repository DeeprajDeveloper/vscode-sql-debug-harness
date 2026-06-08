module.exports = {
  stylesheet: ["https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css"],
  css: `
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
    }
    pre { font-size: 9pt; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-size: 10pt; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background: #f6f8fa; }
    code { font-size: 9pt; }
    h1 { font-size: 20pt; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    h2 { font-size: 16pt; margin-top: 1.5em; border-bottom: 1px solid #eee; }
    h3 { font-size: 13pt; }
  `,
  body_class: "markdown-body",
  pdf_options: {
    format: "A4",
    margin: { top: "18mm", right: "16mm", bottom: "18mm", left: "16mm" },
    printBackground: true,
  },
  launch_options: {
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
};
