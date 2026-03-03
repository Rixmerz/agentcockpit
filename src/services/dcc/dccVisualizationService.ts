/**
 * DCC Visualization Service — architecture, matrix, timeline, heatmap, cube HTML
 */

import { readTextFile } from '@tauri-apps/plugin-fs';
import { dccState, callDccTool } from './_dccInternal';

export async function generateArchitecture(projectPath: string): Promise<string | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_generate_architecture', { project_path: projectPath }, projectPath);

    if (result && typeof result === 'object' && 'html' in (result as Record<string, unknown>)) {
      return String((result as Record<string, unknown>).html);
    }

    const data = result as Record<string, unknown>;
    if (data?.output_path) {
      const html = await readTextFile(String(data.output_path));
      return html;
    }

    return typeof result === 'string' ? result : null;
  } catch (e) {
    console.error('[DCC] Architecture error:', e);
    return null;
  }
}

export async function generateMatrix(projectPath: string): Promise<string | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_generate_matrix', { project_path: projectPath }, projectPath);

    if (result && typeof result === 'object' && 'html' in (result as Record<string, unknown>)) {
      return String((result as Record<string, unknown>).html);
    }

    const data = result as Record<string, unknown>;
    if (data?.output_path) {
      const html = await readTextFile(String(data.output_path));
      return html;
    }

    return typeof result === 'string' ? result : null;
  } catch (e) {
    console.error('[DCC] Matrix error:', e);
    return null;
  }
}

export async function generateTimeline(projectPath: string): Promise<string | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_generate_timeline', { project_path: projectPath }, projectPath);

    if (result && typeof result === 'object' && 'html' in (result as Record<string, unknown>)) {
      return String((result as Record<string, unknown>).html);
    }

    const data = result as Record<string, unknown>;
    if (data?.output_path) {
      const html = await readTextFile(String(data.output_path));
      return html;
    }

    return typeof result === 'string' ? result : null;
  } catch (e) {
    console.error('[DCC] Timeline error:', e);
    return null;
  }
}

export async function generateHeatmap(projectPath: string): Promise<string | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_generate_heatmap', { project_path: projectPath }, projectPath);

    if (result && typeof result === 'object' && 'html' in (result as Record<string, unknown>)) {
      return String((result as Record<string, unknown>).html);
    }

    const data = result as Record<string, unknown>;
    if (data?.output_path) {
      const html = await readTextFile(String(data.output_path));
      return html;
    }

    return typeof result === 'string' ? result : null;
  } catch (e) {
    console.error('[DCC] Heatmap error:', e);
    return null;
  }
}

export async function exportCubeHtml(projectPath: string): Promise<string | null> {
  if (dccState.indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_export_html', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    if (data.html) return String(data.html);
    if (data.path) {
      const html = await readTextFile(String(data.path));
      return html;
    }
    return null;
  } catch (e) {
    console.error('[DCC] Export HTML error:', e);
    return null;
  }
}
