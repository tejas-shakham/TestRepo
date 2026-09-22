import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publishDirectory = path.join(projectRoot, "dist", "client");

await mkdir(publishDirectory, { recursive: true });
await writeFile(
  path.join(publishDirectory, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Research API</title>
  </head>
  <body>
    <main>
      <h1>Research API</h1>
      <p>The service is available.</p>
    </main>
  </body>
</html>
`,
  "utf8",
);
