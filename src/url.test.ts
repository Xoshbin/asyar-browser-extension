import { describe, expect, it } from 'vitest';
import { isUrlLike, normaliseUrl } from './url';

describe('isUrlLike', () => {
  it.each([
    ['https://example.com', true],
    ['http://localhost:3000', true],
    ['example.com', true],
    ['example.com/path', true],
    ['example.com/path?q=1#frag', true],
    ['sub.example.co.uk', true],
    ['127.0.0.1:8080', true],
    ['file:///etc/hosts', true],
    ['ftp://example.com', true],
  ])('treats %s as URL-like', (input, expected) => {
    expect(isUrlLike(input)).toBe(expected);
  });

  it.each([
    ['', false],
    ['just words', false],
    ['hello world', false],
    ['oneword', false],
    ['has space.com', false],
    ['.com', false],
    ['multiple words.com', false],
    ['something.x', false],
  ])('rejects %s', (input, expected) => {
    expect(isUrlLike(input)).toBe(expected);
  });
});

describe('normaliseUrl', () => {
  it('adds https:// to bare hostnames', () => {
    expect(normaliseUrl('example.com')).toBe('https://example.com');
  });
  it('preserves explicit scheme', () => {
    expect(normaliseUrl('http://example.com')).toBe('http://example.com');
    expect(normaliseUrl('ftp://example.com')).toBe('ftp://example.com');
  });
  it('preserves path and query', () => {
    expect(normaliseUrl('example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });
});
