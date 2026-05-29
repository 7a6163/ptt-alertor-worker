import { describe, it, expect } from 'vitest';
import { parseCommand, MAX_ITEMS_PER_COMMAND } from '../src/command/parser';

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

  it('caps items to MAX_ITEMS_PER_COMMAND and flags truncated', () => {
    const items = Array.from({ length: 25 }, (_, i) => `kw${i}`);
    const r = parseCommand(`新增 Stock 關鍵字 ${items.join(',')}`);
    expect(r.kind).toBe('subscribe_keyword');
    if (r.kind === 'subscribe_keyword') {
      expect(r.items).toHaveLength(MAX_ITEMS_PER_COMMAND);
      expect(r.truncated).toBe(true);
      expect(r.items[0]).toBe('kw0');
      expect(r.items[MAX_ITEMS_PER_COMMAND - 1]).toBe(`kw${MAX_ITEMS_PER_COMMAND - 1}`);
    }
  });

  it('keeps truncated false when within cap', () => {
    const r = parseCommand('新增 Stock 關鍵字 a,b,c');
    expect(r.kind).toBe('subscribe_keyword');
    if (r.kind === 'subscribe_keyword') {
      expect(r.items).toEqual(['a', 'b', 'c']);
      expect(r.truncated).toBe(false);
    }
  });
});
