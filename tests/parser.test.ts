import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/command/parser';

describe('parseCommand', () => {
  it('parses help variants', () => {
    expect(parseCommand('help').kind).toBe('help');
    expect(parseCommand('幫助').kind).toBe('help');
    expect(parseCommand('?').kind).toBe('help');
  });

  it('parses list', () => {
    expect(parseCommand('清單').kind).toBe('list');
    expect(parseCommand('list').kind).toBe('list');
  });

  it('parses subscribe keyword', () => {
    const r = parseCommand('新增 Stock 關鍵字 台積電,聯電');
    expect(r.kind).toBe('subscribe_keyword');
    if (r.kind === 'subscribe_keyword') {
      expect(r.board).toBe('Stock');
      expect(r.items).toEqual(['台積電', '聯電']);
    }
  });

  it('parses unsubscribe author', () => {
    const r = parseCommand('刪除 Gossiping 作者 someuser');
    expect(r.kind).toBe('unsubscribe_author');
    if (r.kind === 'unsubscribe_author') {
      expect(r.board).toBe('Gossiping');
      expect(r.items).toEqual(['someuser']);
    }
  });

  it('returns unknown for gibberish', () => {
    expect(parseCommand('asdf').kind).toBe('unknown');
    expect(parseCommand('').kind).toBe('unknown');
  });
});
