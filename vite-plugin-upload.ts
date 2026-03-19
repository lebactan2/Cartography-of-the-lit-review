import type { Plugin } from "vite";
import fs from "fs";
import path from "path";

/**
 * Vite plugin that provides a POST /api/upload endpoint
 * to save base64-encoded files to public/uploads/.
 * Returns the relative URL to the saved file.
 */
export function uploadPlugin(): Plugin {
  return {
    name: "vite-plugin-upload",
    configureServer(server) {
      server.middlewares.use("/api/upload", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const { dataUrl, filename } = JSON.parse(body);
            if (!dataUrl || !filename) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing dataUrl or filename" }));
              return;
            }

            // Extract base64 data from data URL
            const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (!match) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid data URL" }));
              return;
            }

            const buffer = Buffer.from(match[2], "base64");

            // Sanitize filename and add timestamp to avoid collisions
            const ext = path.extname(filename) || ".png";
            const baseName = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
            const safeName = `${baseName}_${Date.now()}${ext}`;

            const uploadsDir = path.resolve(process.cwd(), "public", "uploads");
            if (!fs.existsSync(uploadsDir)) {
              fs.mkdirSync(uploadsDir, { recursive: true });
            }

            const filePath = path.join(uploadsDir, safeName);
            fs.writeFileSync(filePath, buffer);

            // Return the URL path that Vite serves from public/
            const url = `/uploads/${safeName}`;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ url, path: filePath }));
          } catch (err: unknown) {
            res.statusCode = 500;
            const msg = err instanceof Error ? err.message : String(err);
            res.end(JSON.stringify({ error: msg }));
          }
        });
      });
    },
  };
}
