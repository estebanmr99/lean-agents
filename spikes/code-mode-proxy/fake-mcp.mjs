import { readFileSync } from 'node:fs';

const TOOLS = Array.from({ length: 20 }, (_, i) => ({
  name: `fake_read_${i}`,
  description: `Fake tool ${i} that returns fixed text`,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" }
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
      const result = await handleRequest(request);
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
    } catch (e) {
      process.stderr.write(`Error parsing request: ${e.message}\n`);
    }
  }
});
