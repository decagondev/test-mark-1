import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { glob } from 'glob';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const DEFAULT_FILE_GLOBS = [
  'README.md',
  'readme.md',
  'package.json',
  'index.js', 'index.ts', 'app.js', 'app.ts', 'server.js', 'server.ts',
  'src/**/*.js', 'src/**/*.ts',
  'routes/**/*.js', 'routes/**/*.ts',
  'controllers/**/*.js', 'controllers/**/*.ts',
  'middleware/**/*.js', 'middleware/**/*.ts'
];

export const openaiService = {
  async analyzeCode(repoPath: string, testResult: any, rubric?: any, fileGlobs?: string[], npmRegistryData?: Record<string, string>) {
    const files = await readRepoFiles(repoPath, fileGlobs || DEFAULT_FILE_GLOBS);
    const prompt = buildPrompt(files, testResult, rubric, npmRegistryData);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.2,
      });

      const content = response.choices[0].message.content as string;
      const analysis = safeJsonParse(content);
      return {
        score: analysis.score || 0,
        report: analysis.report || 'No analysis provided'
      };
    } catch (error: any) {
      return {
        score: 0,
        report: `AI analysis failed: ${error.message}`
      };
    }
  }
};

async function readRepoFiles(repoPath: string, fileGlobs: string[]): Promise<string> {
  let fileContents = '';
  const matchedFiles = new Set<string>();
  for (const pattern of fileGlobs) {
    const matches = await glob(pattern, { cwd: repoPath, absolute: true, nodir: true });
    matches.forEach(f => matchedFiles.add(f));
  }
  for (const file of matchedFiles) {
    try {
      let content = await fs.readFile(file, 'utf-8');
      content = sanitizeCode(content);
      if (content.length > 10000) content = content.slice(0, 10000) + '\n// ...truncated...';
      fileContents += `// ${path.relative(repoPath, file)}\n${content}\n\n`;
    } catch {}
  }
  return fileContents;
}

function sanitizeCode(code: string): string {
  return code.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
}

function buildPrompt(files: string, testResult: any, rubric?: any, npmRegistryData?: Record<string, string>): string {
  return `
You are an expert code reviewer for educational projects. Analyze the following code for quality, best practices, and maintainability. Consider the test results and (if provided) the rubric. 

IMPORTANT:
- ONLY comment on dependencies and versions that are explicitly present in the provided package.json.
- Do NOT make assumptions about the latest versions of any package.
- If you do not see a dependency or version in the provided files, do not mention it.
- If you are unsure, say so, and do not guess.
- If you wish to comment on version recency, use ONLY the provided NPM Registry Data below. Do not guess or use your own knowledge.

**IMPORTANT:**
- ONLY return a valid JSON object as your response, nothing else.
- Do NOT include markdown code blocks or any text outside the JSON.
- If you must include newlines in the report, use \\n.
- Example output: {"score": 85, "report": "# Code Quality Report\\n\\n..."}

## Code
${files}

## Test Results
${JSON.stringify(testResult, null, 2)}

## Rubric
${rubric ? JSON.stringify(rubric, null, 2) : 'Default grading criteria'}

## NPM Registry Data
${npmRegistryData ? JSON.stringify(npmRegistryData, null, 2) : '{}'}

## Output Format
{"score": number, "report": "# Code Quality Report\\n\\n..."}
`;
}

function safeJsonParse(content: string): { score: number; report: string } {
  try {
    return JSON.parse(content);
  } catch {}
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return { score: 0, report: 'AI returned invalid JSON. Raw output:\n' + content };
} 