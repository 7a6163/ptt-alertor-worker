import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  parseGuidedReply,
  detectGuidedMode,
  parseGuideCallback,
  buildGuideCallback,
  parseRemoveCallback,
  buildRemoveCallback,
  guidePromptTitle,
  MAX_ITEMS_PER_COMMAND,
} from '../src/command/parser';

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

describe('slash commands', () => {
  it('parses /add as one-shot keyword subscribe', () => {
    const r = parseCommand('/add Stock 台積電,聯電');
    expect(r.kind).toBe('subscribe_keyword');
    if (r.kind === 'subscribe_keyword') {
      expect(r.board).toBe('Stock');
      expect(r.items).toEqual(['台積電', '聯電']);
    }
  });

  it('parses /add with space-separated items', () => {
    const r = parseCommand('/add Stock 台積電 聯電');
    expect(r.kind).toBe('subscribe_keyword');
    if (r.kind === 'subscribe_keyword') {
      expect(r.items).toEqual(['台積電', '聯電']);
    }
  });

  it('parses /delauthor as author unsubscribe', () => {
    const r = parseCommand('/delauthor Gossiping someuser');
    expect(r.kind).toBe('unsubscribe_author');
    if (r.kind === 'unsubscribe_author') {
      expect(r.board).toBe('Gossiping');
      expect(r.items).toEqual(['someuser']);
    }
  });

  it('strips @botname suffix in groups', () => {
    const r = parseCommand('/add@PttAlertorBot Stock 台積電');
    expect(r.kind).toBe('subscribe_keyword');
    if (r.kind === 'subscribe_keyword') {
      expect(r.board).toBe('Stock');
      expect(r.items).toEqual(['台積電']);
    }
  });

  it('maps /list, /ls, /help, /start', () => {
    expect(parseCommand('/list').kind).toBe('list');
    expect(parseCommand('/ls').kind).toBe('list');
    expect(parseCommand('/help').kind).toBe('help');
    expect(parseCommand('/start').kind).toBe('help');
  });

  it('caps slash items and flags truncated', () => {
    const items = Array.from({ length: 25 }, (_, i) => `kw${i}`);
    const r = parseCommand(`/add Stock ${items.join(',')}`);
    expect(r.kind).toBe('subscribe_keyword');
    if (r.kind === 'subscribe_keyword') {
      expect(r.items).toHaveLength(MAX_ITEMS_PER_COMMAND);
      expect(r.truncated).toBe(true);
    }
  });

  it('returns unknown for an unrecognised slash command', () => {
    expect(parseCommand('/frobnicate Stock x').kind).toBe('unknown');
  });
});

describe('guided two-step flow', () => {
  it('bare /add enters guide with no target (button step)', () => {
    const r = parseCommand('/add');
    expect(r.kind).toBe('guide');
    if (r.kind === 'guide') {
      expect(r.action).toBe('subscribe');
      expect(r.target).toBeUndefined();
    }
  });

  it('bare /addauthor enters guide with author target', () => {
    const r = parseCommand('/addauthor');
    expect(r.kind).toBe('guide');
    if (r.kind === 'guide') {
      expect(r.action).toBe('subscribe');
      expect(r.target).toBe('author');
    }
  });

  it('bare /del opens the keyword removal menu', () => {
    const r = parseCommand('/del');
    expect(r.kind).toBe('remove_menu');
    if (r.kind === 'remove_menu') {
      expect(r.target).toBe('keyword');
    }
  });

  it('bare /delauthor opens the author removal menu', () => {
    const r = parseCommand('/delauthor');
    expect(r.kind).toBe('remove_menu');
    if (r.kind === 'remove_menu') {
      expect(r.target).toBe('author');
    }
  });

  it('/del with args is still a one-shot keyword unsubscribe', () => {
    const r = parseCommand('/del Stock 2330');
    expect(r.kind).toBe('unsubscribe_keyword');
    if (r.kind === 'unsubscribe_keyword') {
      expect(r.board).toBe('Stock');
      expect(r.items).toEqual(['2330']);
    }
  });

  it('remove callback_data round-trips and rejects garbage', () => {
    expect(buildRemoveCallback('keyword', 42)).toBe('rk:42');
    expect(buildRemoveCallback('author', 7)).toBe('ra:7');
    expect(parseRemoveCallback('rk:42')).toEqual({ target: 'keyword', rowid: 42 });
    expect(parseRemoveCallback('ra:7')).toEqual({ target: 'author', rowid: 7 });
    expect(parseRemoveCallback('rk:')).toBeNull();
    expect(parseRemoveCallback('g:sub:kw')).toBeNull();
    expect(parseRemoveCallback('rk:abc')).toBeNull();
  });

  it('callback_data round-trips through build/parse', () => {
    const data = buildGuideCallback('subscribe', 'author');
    expect(data).toBe('g:sub:au');
    expect(parseGuideCallback(data)).toEqual({ action: 'subscribe', target: 'author' });
    expect(parseGuideCallback('g:unsub:kw')).toEqual({
      action: 'unsubscribe',
      target: 'keyword',
    });
    expect(parseGuideCallback('garbage')).toBeNull();
  });

  it('detects guided mode from the force_reply prompt title', () => {
    const title = guidePromptTitle('subscribe', 'keyword');
    const prompt = `${title}\n回覆此訊息並輸入：<板名> <關鍵字>`;
    expect(detectGuidedMode(prompt)).toEqual({ action: 'subscribe', target: 'keyword' });
    expect(detectGuidedMode('一般訊息沒有標題')).toBeNull();
  });

  it('parses the guided reply into the matching command', () => {
    const r = parseGuidedReply('subscribe', 'keyword', 'Stock 台積電 聯電');
    expect(r.kind).toBe('subscribe_keyword');
    if (r.kind === 'subscribe_keyword') {
      expect(r.board).toBe('Stock');
      expect(r.items).toEqual(['台積電', '聯電']);
    }
  });
});
