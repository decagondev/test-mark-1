import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import { Submission } from '../models/Submission';
// import { groqService } from './groqService';
import { openaiService } from './openaiService';

const execPromise = util.promisify(exec);

interface GradingResult {
  grade: 'pass' | 'fail';
  score: {
    total: number;
    testScore: number;
    qualityScore: number;
    breakdown: any[];
  };
  report: string;
}

export class GradingService {
  async gradeSubmission(submission: any, fileGlobs?: string[]): Promise<GradingResult> {
    const tempDir = path.join(__dirname, `../../tmp/${submission._id}`);
    try {
      // Clone repository
      await this.cloneRepository(submission.githubUrl, tempDir);

      // Read package.json and fetch latest npm versions
      let npmRegistryData = {};
      try {
        const pkgPath = path.join(tempDir, 'package.json');
        const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgRaw);
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        npmRegistryData = await fetchNpmVersions(allDeps);
      } catch (e) {
        npmRegistryData = { error: 'Could not read or parse package.json' };
      }

      // Install dependencies
      await execPromise('npm install', { cwd: tempDir });

      // Run tests
      const testResult = await this.runTests(tempDir);

      // Analyze code quality (pass npmRegistryData)
      const qualityResult = await openaiService.analyzeCode(tempDir, testResult, submission.rubric, fileGlobs, npmRegistryData);

      // Calculate scores
      const testScore = this.calculateTestScore(testResult);
      const qualityScore = qualityResult.score;
      const totalScore = (testScore * 0.8) + (qualityScore * 0.2);

      // Generate report
      const report = this.generateReport(testResult, qualityResult);

      return {
        grade: totalScore >= 70 ? 'pass' : 'fail',
        score: { total: totalScore, testScore, qualityScore, breakdown: [] },
        report
      };
    } catch (error: any) {
      throw new Error(`Grading failed: ${error.message}`);
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('Cleanup failed:', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
      }
    }
  }

  private async cloneRepository(url: string, dest: string): Promise<void> {
    await execPromise(`git clone ${url} ${dest}`);
  }

  private async runTests(cwd: string): Promise<any> {
    try {
      const { stdout } = await execPromise('npm test', { cwd });
      return this.parseTestResults(stdout);
    } catch (error: any) {
      return { passed: 0, total: 0, details: error.message };
    }
  }

  private parseTestResults(output: string): any {
    // Parse test output (simplified example)
    const passedMatch = output.match(/(\d+) passing/);
    const failedMatch = output.match(/(\d+) failing/);
    return {
      passed: parseInt(passedMatch?.[1] || '0'),
      total: parseInt(passedMatch?.[1] || '0') + parseInt(failedMatch?.[1] || '0'),
      details: output
    };
  }

  private calculateTestScore(testResult: any): number {
    return testResult.total > 0 ? (testResult.passed / testResult.total) * 100 : 0;
  }

  private generateReport(testResult: any, qualityResult: any): string {
    return `# Grading Report\n\n## Test Results\n- Passed: ${testResult.passed}/${testResult.total}\n\n## Code Quality\n${qualityResult.report}`;
  }
}

export const gradingService = new GradingService();

// Helper to fetch latest npm versions
async function fetchNpmVersions(deps: Record<string, string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const fetch = (await import('node-fetch')).default;
  await Promise.all(Object.keys(deps || {}).map(async (dep) => {
    try {
      const res = await fetch(`https://registry.npmjs.org/${dep}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      result[dep] = data['dist-tags']?.latest || 'unknown';
    } catch {
      result[dep] = 'unknown';
    }
  }));
  return result;
} 