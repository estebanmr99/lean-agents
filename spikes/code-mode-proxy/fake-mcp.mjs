import { readFileSync } from 'node:fs';

const TOOLS = Array.from({ length: 20 }, (_, i) => ({
  name: `fake_read_${i}`,
  // Sized like a typical real MCP tool (several described parameters), so tools/list bytes are realistic.
  description: `Fake tool ${i}: reads a resource by path and returns its text. Use it when you need the contents of a file, page or record; supports ranges, encodings and a size cap.`,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path or identifier of the resource to read" },
      offset: { type: "integer", description: "Line or byte offset to start reading from", minimum: 0 },
      limit: { type: "integer", description: "Maximum number of lines or bytes to return", minimum: 1 },
      encoding: { type: "string", enum: ["utf8", "base64", "latin1"], description: "Encoding of the returned text" },
      follow_links: { type: "boolean", description: "Follow symbolic links when resolving the path" }
    },
    required: ["path"]
  }
}));

async function handleRequest(request) {
  const { method, params, id } = request;

  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {},
      serverInfo: { name: "fake-mcp", version: "0.1.0" }
    };
  }

  if (method === "tools/list") {
    return { tools: TOOLS };
  }

  if (method === "tools/call") {
    const toolName = params.name;
    const index = parseInt(toolName.replace("fake_read_", ""), 10);
    if (!isNaN(index) && index >= 0 && index < 20) {
      return {
        content: [{ type: "text", text: `This is fixed text from tool ${index}.` }]
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Tool ${toolName} not found` }]
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: `Method ${method} not implemented` }]
  };
}

let buffer = "";
process.stdin.on("data", async (data) => {
  buffer += data.toString();
  let lines = buffer.split("\n");
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      if (request.id === undefined) continue; // notifications get no reply
      const result = await handleRequest(request);
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
    } catch (e) {
      process.stderr.write(`Error parsing request: ${e.message}\n`);
    }
  }
});
