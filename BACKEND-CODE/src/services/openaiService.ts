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
  async analyzeCode(repoPath: string, testResult: any, rubric?: any, fileGlobs?: string[], npmRegistryData?: Record<string, string>, projectType?: string) {
    const files = await readRepoFiles(repoPath, fileGlobs || DEFAULT_FILE_GLOBS);
    const prompt = buildPrompt(files, testResult, rubric, npmRegistryData, projectType);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.2,
      });

      const content = response.choices[0].message.content as string;
      if (projectType === 'c') {
        console.log('LLM raw response for C project:', content); // Log raw response
      }
      const analysis = safeJsonParse(content);
      if (projectType === 'c') {
        let codeSmellScore = analysis.codeSmellScore;
        let codeQualityScore = analysis.codeQualityScore;
        if (typeof codeSmellScore !== 'number' || typeof codeQualityScore !== 'number') {
          console.warn('LLM did not return codeSmellScore or codeQualityScore. Defaulting to 0. Raw:', content);
          codeSmellScore = 0;
          codeQualityScore = 0;
        }
        return {
          codeSmellScore,
          codeQualityScore,
          report: analysis.report || 'No analysis provided',
          breakdown: [
            { category: 'Code Quality', score: codeQualityScore, maxScore: 100, feedback: 'LLM code quality score' },
            { category: 'Code Smell', score: codeSmellScore, maxScore: 100, feedback: 'LLM code smell score' }
          ]
        };
      }
      return {
        score: analysis.score || 0,
        report: analysis.report || 'No analysis provided'
      };
    } catch (error: any) {
      if (projectType === 'c') {
        return {
          codeSmellScore: 0,
          codeQualityScore: 0,
          report: `AI analysis failed: ${error.message}`,
          breakdown: [
            { category: 'Code Quality', score: 0, maxScore: 100, feedback: 'LLM code quality score' },
            { category: 'Code Smell', score: 0, maxScore: 100, feedback: 'LLM code smell score' }
          ]
        };
      }
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

function buildPrompt(files: string, testResult: any, rubric?: any, npmRegistryData?: Record<string, string>, projectType?: string): string {
  if (projectType === 'c') {
    return `
You are an expert C/C++ code reviewer. You must output a JSON object with the following fields:
- "codeQualityScore": number (0-100)
- "codeSmellScore": number (0-100)
- "report": string (markdown, see below)

Your markdown report **must** start with a summary table of all scores, followed by a concise code review, and then a detailed section-by-section analysis. Use the following examples and template as a strict guide (do not include any triple backticks or code blocks in your output):

--- Example 1 (Concise) ---
# Concise Code Review Report: simple-c-profiler

## Summary Table
| Metric            | Score |
|-------------------|-------|
| Code Quality      | 85    |
| Code Smell        | 80    |

## Repository Overview
The simple-c-profiler repository provides a lightweight C library for profiling code execution time using macros (PROFILE_START, PROFILE_END, PROFILE_LOG) and generating JSON reports. It is simple, portable, and uses standard C libraries, but lacks robustness and thread safety.

- Repository URL: https://github.com/decagondev/simple-c-profiler
- Language: C
- License: MIT
- Files Analyzed: simple_c_profiler.h, simple_c_profiler.c, example.c, README.md

## Code Quality Assessment
### Strengths
- Simple, macro-based interface for profiling.
- Portable, using only standard C libraries.
- MIT license enables broad use.
- Includes example usage and JSON output.

### Weaknesses
- Limited error handling for file and memory operations.
- Sparse documentation in header and README.
- No memory cleanup, risking leaks.
- Not thread-safe due to global state.
- Limited modularity and scalability.

### Code Quality Score: 85/100
- Correctness (20/25): Functional but lacks error handling.
- Readability (22/25): Clear structure, needs better comments.
- Maintainability (20/25): Small codebase, but global state and leaks hinder maintenance.
- Performance (23/25): Low overhead, but clock() limits precision.

## Code Smell Assessment
### Identified Code Smells
- Missing error handling for file operations and memory allocation.
- Global state (profiler_data, profiler_count) limits thread safety.
- Hardcoded constants (e.g., 100 profilers).
- No memory cleanup for profiler_data.
- Macro overuse reduces flexibility.
- Fixed-size array limits scalability.

### Code Smell Score: 80/100
- Severity (40/50): Smells affect robustness and scalability.
- Maintainability (40/50): Small codebase mitigates impact, but issues persist.

## Detailed Code Analysis
... (as in your example) ...

## Suggested Fixes
- ...

## Conclusion
The simple-c-profiler library is a solid, simple profiler with a code quality score of 85/100 and code smell score of 80/100. It excels in ease of use but needs improvements in error handling, memory management, thread safety, and documentation. The listed fixes enhance robustness while preserving core functionality, making it suitable for broader use.

--- Example 2 (Full) ---
# Code Review Report: simple-c-profiler

## Repository Overview
The simple-c-profiler repository provides a lightweight C library for profiling code execution time. It allows developers to measure the duration of code blocks using macros (PROFILE_START, PROFILE_END, PROFILE_LOG) and generates a JSON report of the profiling results. The library is designed to be simple, with minimal dependencies (standard C libraries), and is intended for use in C/C++ projects to identify performance bottlenecks.

- Repository URL: https://github.com/decagondev/simple-c-profiler
- Language: C
- License: MIT
- Files Analyzed:
  - simple_c_profiler.h: Header file with macro definitions and function declarations.
  - simple_c_profiler.c: Implementation of the profiler logic.
  - example.c: Example usage of the profiler.
  - README.md: Documentation with setup and usage instructions.

## Code Quality Assessment
... (as in your full example) ...

## Code Quality Score: 85/100
## Code Smell Score: 80/100

## Code Smell Assessment
... (as in your full example) ...

## Detailed Code Analysis
... (as in your full example) ...

## Suggested Fixes
... (as in your full example) ...

## Conclusion
... (as in your full example) ...

--- Template ---
# Concise Code Review Report: <project-name>

## Summary Table
| Metric            | Score |
|-------------------|-------|
| Code Quality      | <score> |
| Code Smell        | <score> |

## Repository Overview
<short description>

## Code Quality Assessment
### Strengths
- ...
### Weaknesses
- ...

### Code Quality Score: <score>/100

## Code Smell Assessment
### Identified Code Smells
- ...

### Code Smell Score: <score>/100

## Detailed Code Analysis
... (section-by-section review) ...

## Suggested Fixes
- ...

## Conclusion
<summary>

**IMPORTANT:**
- If you do not include both codeQualityScore and codeSmellScore as top-level JSON fields, your response will be considered invalid.
- The markdown report must start with a summary table of all scores, then a concise review, then a detailed analysis, then actionable fixes, as in the examples above.
- Do NOT include any text outside the JSON object.
- If you must include newlines in the report, use \n.

## Code
${files}

## Rubric
${rubric ? JSON.stringify(rubric, null, 2) : 'Default grading criteria'}

## Output Format
{ "codeQualityScore": number, "codeSmellScore": number, "report": "..." }
`;
  }
  // Default (JS/TS/React/Express)
  return `
You are an expert code reviewer for ${projectType || 'JavaScript/TypeScript/React/Express'} educational projects. Analyze the following code for quality, best practices, maintainability, and test results. Consider the test results and (if provided) the rubric.

You must output a JSON object with the following fields:
- "codeQualityScore": number (0-100)
- "testScore": number (0-100, based on test results if available, otherwise 0)
- "report": string (markdown, see below)

Your markdown report **must** start with a summary table of all scores, followed by a concise code review, and then a detailed section-by-section analysis. Use the following template as a strict guide (do not include any triple backticks or code blocks in your output):

--- Template ---
# Code Review Report: <project-name>

## Summary Table
| Metric         | Score |
|---------------|-------|
| Code Quality  | <score> |
| Test Results  | <score> |

## Repository Overview
<short description>

## Code Quality Assessment
### Strengths
- ...
### Weaknesses
- ...

### Code Quality Score: <score>/100

## Test Results Assessment
- ...
### Test Score: <score>/100

## Detailed Code Analysis
... (section-by-section review) ...

## Suggested Fixes
- ...

## Conclusion
<summary>

**IMPORTANT:**
- If you do not include both codeQualityScore and testScore as top-level JSON fields, your response will be considered invalid.
- The markdown report must start with a summary table of all scores, then a concise review, then a detailed analysis, then actionable fixes, as in the template above.
- Do NOT include any text outside the JSON object.
- If you must include newlines in the report, use \n.

## Code
${files}

## Test Results
${JSON.stringify(testResult, null, 2)}

## Rubric
${rubric ? JSON.stringify(rubric, null, 2) : 'Default grading criteria'}

## NPM Registry Data
${npmRegistryData ? JSON.stringify(npmRegistryData, null, 2) : '{}'}

## Output Format
{ "codeQualityScore": number, "testScore": number, "report": "..." }
`;
}

function safeJsonParse(content: string): any {
  try {
    return JSON.parse(content);
  } catch {}
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return {};
} 