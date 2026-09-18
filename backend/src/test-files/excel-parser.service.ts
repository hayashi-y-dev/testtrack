import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import type { ParsedData } from './test-files.types.js';

export interface ParseResult {
  success: boolean;
  data?: ParsedData;
  errorMessage?: string;
}

@Injectable()
export class ExcelParserService {
  private readonly SUPPORTED_EXTENSIONS = ['.xlsx', '.xls'];
  private readonly UNSUPPORTED_EXT_MESSAGE =
    '対応していないファイル形式です。.xlsxまたは.xls形式のファイルを選択してください。';
  private readonly NO_COLUMN_NOT_FOUND_MESSAGE =
    '「No」列が見つかりませんでした。';
  private readonly NO_VALID_ROWS_MESSAGE =
    '有効なテストケースが見つかりませんでした。';
  private readonly PARSE_ERROR_MESSAGE =
    'ファイルの解析に失敗しました。ファイルが破損している可能性があります。';

  /**
   * ファイルの拡張子をチェック
   */
  isSupportedExtension(fileName: string): boolean {
    const ext = this.getExtension(fileName);
    return this.SUPPORTED_EXTENSIONS.includes(ext);
  }

  /**
   * 拡張子を取得
   */
  private getExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return '';
    return fileName.slice(lastDot).toLowerCase();
  }

  /**
   * Excelファイルを解析
   */
  parseExcel(buffer: Buffer, fileName: string): ParseResult {
    // 拡張子チェック
    if (!this.isSupportedExtension(fileName)) {
      return {
        success: false,
        errorMessage: this.UNSUPPORTED_EXT_MESSAGE,
      };
    }

    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      // 最初のシートを取得
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return {
          success: false,
          errorMessage: this.PARSE_ERROR_MESSAGE,
        };
      }

      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
      });

      // No列を探す
      const noColumnName = this.findNoColumn(rows);
      if (!noColumnName) {
        return {
          success: false,
          errorMessage: this.NO_COLUMN_NOT_FOUND_MESSAGE,
        };
      }

      // 実施状態列を探す
      const statusColumnName = this.findStatusColumn(rows);

      // テストケース行を抽出して集計
      const data = this.aggregateTestCases(rows, noColumnName, statusColumnName);

      if (data.targetCount === 0 && data.excludedCount === 0) {
        return {
          success: false,
          errorMessage: this.NO_VALID_ROWS_MESSAGE,
        };
      }

      return { success: true, data };
    } catch {
      return {
        success: false,
        errorMessage: this.PARSE_ERROR_MESSAGE,
      };
    }
  }

  /**
   * No列を探す
   */
  private findNoColumn(rows: Record<string, unknown>[]): string | null {
    if (rows.length === 0) return null;

    const firstRow = rows[0];
    const keys = Object.keys(firstRow);

    // "No"または"no"という名前の列を探す
    for (const key of keys) {
      const normalizedKey = key.toLowerCase().trim();
      if (normalizedKey === 'no') {
        return key;
      }
    }

    return null;
  }

  /**
   * 実施状態列を探す
   */
  private findStatusColumn(rows: Record<string, unknown>[]): string | null {
    if (rows.length === 0) return null;

    const firstRow = rows[0];
    const keys = Object.keys(firstRow);

    // 「実施状態」「ステータス」「状態」「結果」などを探す
    const statusKeywords = ['実施状態', 'ステータス', '状態', '結果', 'status', 'result'];
    for (const key of keys) {
      const normalizedKey = key.toLowerCase().trim();
      for (const keyword of statusKeywords) {
        if (normalizedKey.includes(keyword.toLowerCase())) {
          return key;
        }
      }
    }

    return null;
  }

  /**
   * テストケースを集計
   */
  private aggregateTestCases(
    rows: Record<string, unknown>[],
    noColumnName: string,
    statusColumnName: string | null,
  ): ParsedData {
    let okCount = 0;
    let ngCount = 0;
    let notRunCount = 0;
    let excludedCount = 0;

    for (const row of rows) {
      const noValue = row[noColumnName];

      // No列が正の整数かチェック
      if (!this.isPositiveInteger(noValue)) {
        continue;
      }

      // 実施状態を取得
      const statusValue = statusColumnName ? row[statusColumnName] : '';
      const status = this.normalizeStatus(statusValue);

      switch (status) {
        case 'ok':
          okCount++;
          break;
        case 'ng':
          ngCount++;
          break;
        case 'excluded':
          excludedCount++;
          break;
        default:
          notRunCount++;
          break;
      }
    }

    const targetCount = okCount + ngCount + notRunCount;

    return {
      targetCount,
      okCount,
      ngCount,
      notRunCount,
      excludedCount,
    };
  }

  /**
   * 正の整数かチェック
   */
  private isPositiveInteger(value: unknown): boolean {
    if (typeof value === 'number') {
      return Number.isInteger(value) && value > 0;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return false;
      const num = parseInt(trimmed, 10);
      return !isNaN(num) && num > 0 && String(num) === trimmed;
    }
    return false;
  }

  /**
   * 実施状態を正規化
   */
  private normalizeStatus(value: unknown): 'ok' | 'ng' | 'excluded' | 'notRun' {
    if (value === null || value === undefined) {
      return 'notRun';
    }

    const strValue = String(value).trim().toUpperCase();

    if (strValue === 'OK' || strValue === '○' || strValue === 'O' || strValue === 'PASS') {
      return 'ok';
    }
    if (strValue === 'NG' || strValue === '×' || strValue === 'X' || strValue === 'FAIL') {
      return 'ng';
    }
    if (strValue === '-' || strValue === '－' || strValue === '対象外' || strValue === 'N/A') {
      return 'excluded';
    }

    return 'notRun';
  }

  /**
   * 進捗率を計算
   */
  calculateProgressRate(data: ParsedData): number | null {
    if (data.targetCount === 0) {
      return null;
    }
    const completedCount = data.okCount + data.ngCount;
    return Math.round((completedCount / data.targetCount) * 1000) / 10;
  }
}
