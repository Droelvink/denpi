import type { ToolSchema } from '../llm/types.js';
import { askUserTool } from './ask-user.js';
import { editFileTool } from './edit-file.js';
import { fetchTool } from './fetch.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { readFileTool } from './read-file.js';
import { shellTool } from './shell.js';
import type { ToolDefinition } from './types.js';
import { writeFileTool } from './write-file.js';

export const allTools: ToolDefinition[] = [
  shellTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  grepTool,
  fetchTool,
  askUserTool,
];

export function findTool(name: string): ToolDefinition | undefined {
  return allTools.find((tool) => tool.name === name);
}

export function toolSchemas(tools: ToolDefinition[]): ToolSchema[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
