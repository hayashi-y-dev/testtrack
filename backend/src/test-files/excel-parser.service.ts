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
  private readonly NO_TEST_SHEET_MESSAGE =
    'テストケースシート（「No」列と結果列を持つシート）が見つかりませんでした。';
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

      // 更新履歴シート等を誤って集計しないよう、「No」列と結果列の両方を持つ
      // シートのみを対象とし、それ以外のシートはエラーにせず無視する（仕様書6-1章）
      const sheetResults: ParsedData[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheetData = this.parseSheet(workbook.Sheets[sheetName]);
        if (sheetData) {
          sheetResults.push(sheetData);
        }
      }

      if (sheetResults.length === 0) {
        return {
          success: false,
          errorMessage: this.NO_TEST_SHEET_MESSAGE,
        };
      }

      // 対象シートが複数ある場合は全シート合算とする（MVP範囲、仕様書6-1章）
      const data = this.sumParsedData(sheetResults);

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
   * 1シートを解析する。テストケースシートでなければnullを返す
   */
  private parseSheet(sheet: XLSX.WorkSheet): ParsedData | null {
    // データ行のキーではなくヘッダー行から列を判定する。データ行が0件の
    // テストケースシートを「列なし」と誤判定して対象外にしないため
    const [headerRow] = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
    });
    const headers = Array.from(headerRow ?? [], (cell) =>
      cell === null || cell === undefined ? '' : String(cell),
    );

    const noColumnName = this.findNoColumn(headers);
    const statusColumnName = this.findStatusColumn(headers);
    if (!noColumnName || !statusColumnName) {
      return null;
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    return this.aggregateTestCases(rows, noColumnName, statusColumnName);
  }

  /**
   * No列を探す
   */
  private findNoColumn(headers: string[]): string | null {
    // "No"または"no"という名前の列を探す
    for (const header of headers) {
      const normalizedHeader = header.toLowerCase().trim();
      if (normalizedHeader === 'no') {
        return header;
      }
    }

    return null;
  }

  /**
   * 実施状況を示す列（結果列）を探す
   */
  private findStatusColumn(headers: string[]): string | null {
    // 「実施状況」「実施状態」「ステータス」「状態」「結果」などを探す
    const statusKeywords = [
      '実施状況',
      '実施状態',
      'ステータス',
      '状態',
      '結果',
      'status',
      'result',
    ];
    for (const header of headers) {
      const normalizedHeader = header.toLowerCase().trim();
      for (const keyword of statusKeywords) {
        if (normalizedHeader.includes(keyword.toLowerCase())) {
          return header;
        }
      }
    }

    return null;
  }

  /**
   * 複数シートの集計値を合算
   */
  private sumParsedData(dataList: ParsedData[]): ParsedData {
    return dataList.reduce(
      (sum, data) => ({
        targetCount: sum.targetCount + data.targetCount,
        okCount: sum.okCount + data.okCount,
        ngCount: sum.ngCount + data.ngCount,
        notRunCount: sum.notRunCount + data.notRunCount,
        excludedCount: sum.excludedCount + data.excludedCount,
      }),
      {
        targetCount: 0,
        okCount: 0,
        ngCount: 0,
        notRunCount: 0,
        excludedCount: 0,
      },
    );
  }

  /**
   * テストケースを集計
   */
  private aggregateTestCases(
    rows: Record<string, unknown>[],
    noColumnName: string,
    statusColumnName: string,
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
      const status = this.normalizeStatus(row[statusColumnName]);

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
