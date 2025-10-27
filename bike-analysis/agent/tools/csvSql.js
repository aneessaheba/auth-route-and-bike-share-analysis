gitconst duckdb = require('duckdb');
const path = require('path');
const dayjs = require('dayjs');

const READ_ONLY_PREFIXES = ['select', 'with', 'pragma', 'describe', 'explain', 'show'];

function normalizeRow(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') {
      normalized[key] = Number(value);
    } else if (value instanceof Date) {
      normalized[key] = value.toISOString();
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

class CsvSqlTool {
  constructor(csvPath) {
    this.csvPath = csvPath;
    this.db = null;
    this.connection = null;
    this.tableName = `trips_${Date.now()}`;
  }

  async init() {
    const dbPath = ':memory:';
    this.db = new duckdb.Database(dbPath);
    this.connection = this.db.connect();
    const escapedPath = this.csvPath.replace(/'/g, "''");
    const tableSql = `
      CREATE OR REPLACE TABLE ${this.tableName} AS
      SELECT * FROM read_csv_auto('${escapedPath}', HEADER=TRUE);
    `;
    await this._run(tableSql);
  }

  async query(sql) {
    const ts = dayjs().toISOString();
    if (!sql || typeof sql !== 'string') {
      return { success: false, error: 'SQL query must be a non-empty string.', ts };
    }

    const trimmed = sql.trim().toLowerCase();
    const isAllowed = READ_ONLY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));

    if (!isAllowed) {
      return { success: false, error: 'Only read-only SQL statements are permitted.', ts };
    }

    try {
      const rows = await this._all(sql);
      const normalized = rows.map(normalizeRow);
      return {
        success: true,
        data: {
          rows: normalized,
          row_count: normalized.length,
          source: 'uploaded.csv'
        },
        source: 'uploaded.csv',
        ts
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to execute SQL.',
        ts
      };
    }
  }

  async close() {
    await new Promise((resolve) => {
      if (!this.connection) return resolve();
      this.connection.close(() => resolve());
    });
    await new Promise((resolve) => {
      if (!this.db) return resolve();
      this.db.close(() => resolve());
    });
  }

  async _run(sql) {
    return new Promise((resolve, reject) => {
      this.connection.run(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async _all(sql) {
    return new Promise((resolve, reject) => {
      this.connection.all(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
}

module.exports = CsvSqlTool;
