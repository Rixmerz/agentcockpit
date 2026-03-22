/**
 * DCC CLAUDE.md Service — auto-generate codebase health section
 */

import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getIndexStats } from './dccAnalysisService';
import { getTensions, getDebt } from './dccAnalysisService';

const DCC_SECTION_START = '<!-- DeltaCodeCube:start -->';
const DCC_SECTION_END = '<!-- DeltaCodeCube:end -->';

export async function generateClaudeMdSection(projectPath: string): Promise<boolean> {
  try {
    const stats = await getIndexStats(projectPath);
    if (!stats) return false;

    const tensions = await getTensions(projectPath).catch(() => []);
    const debtList = await getDebt(projectPath).catch(() => []);

    const topDebt = debtList.slice(0, 5);
    const activeTensions = tensions.slice(0, 5);

    let section = `\n${DCC_SECTION_START}\n`;
    section += `## Codebase Health (DeltaCodeCube)\n\n`;
    section += `- **Score:** ${stats.codebaseScore} (Grade ${stats.grade})\n`;
    section += `- **Files indexed:** ${stats.totalFiles}\n`;
    section += `- **Distribution:** A:${stats.distribution.A} B:${stats.distribution.B} C:${stats.distribution.C} D:${stats.distribution.D} F:${stats.distribution.F}\n`;

    if (activeTensions.length > 0) {
      section += `\n### Active Tensions\n`;
      for (const t of activeTensions) {
        section += `- ${t.fileA} <-> ${t.fileB} (distance: ${t.distance.toFixed(2)})\n`;
      }
    }

    if (topDebt.length > 0) {
      section += `\n### Top Technical Debt\n`;
      for (const d of topDebt) {
        section += `- ${d.file} — Grade ${d.grade} (score: ${d.score})\n`;
      }
    }

    section += `\n${DCC_SECTION_END}\n`;

    const claudeMdPath = `${projectPath}/CLAUDE.md`;
    let content = '';

    const fileExists = await exists(claudeMdPath);
    if (fileExists) {
      content = await readTextFile(claudeMdPath);
    }

    const startIdx = content.indexOf(DCC_SECTION_START);
    const endIdx = content.indexOf(DCC_SECTION_END);

    if (startIdx !== -1 && endIdx !== -1) {
      content = content.substring(0, startIdx) + section.trim() + '\n' + content.substring(endIdx + DCC_SECTION_END.length);
    } else {
      content = content.trimEnd() + '\n' + section;
    }

    await writeTextFile(claudeMdPath, content);
    return true;
  } catch (e) {
    console.error('[DCC] CLAUDE.md generation error:', e);
    return false;
  }
}
