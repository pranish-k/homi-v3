import { describe, expect, it } from 'vitest';

import { MAX_AMOUNT_CENTS, parseAmount, parseCents } from './amount';

describe('parseAmount with a "." device separator', () => {
  const parse = (input: string) => parseAmount(input, '.');

  it('parses whole and fractional amounts digit-wise', () => {
    expect(parse('12')).toBe(1200);
    expect(parse('12.5')).toBe(1250);
    expect(parse('12.50')).toBe(1250);
    expect(parse('.5')).toBe(50);
    expect(parse('12.')).toBe(1200);
    expect(parse(' 7.25 ')).toBe(725);
  });

  it('never goes through a float', () => {
    // 19.99 * 100 is 1998.9999999999998
    expect(parse('19.99')).toBe(1999);
    expect(parse('0.29')).toBe(29);
    expect(parse('1.15')).toBe(115);
  });

  it('rejects a comma, because it is a grouping character here', () => {
    expect(parse('12,50')).toBeUndefined();
    expect(parse('1,234')).toBeUndefined();
    expect(parse('1,234.56')).toBeUndefined();
  });

  it('rejects more than two fraction digits rather than truncating', () => {
    expect(parse('1.234')).toBeUndefined();
    expect(parse('0.001')).toBeUndefined();
  });

  it('rejects a second separator', () => {
    expect(parse('1.2.3')).toBeUndefined();
    expect(parse('1..2')).toBeUndefined();
  });

  it('rejects signs, exponents, symbols, and other text', () => {
    expect(parse('-5')).toBeUndefined();
    expect(parse('+5')).toBeUndefined();
    expect(parse('1e3')).toBeUndefined();
    expect(parse('$5')).toBeUndefined();
    expect(parse('5 00')).toBeUndefined();
    expect(parse('abc')).toBeUndefined();
    expect(parse('Infinity')).toBeUndefined();
    expect(parse('0x10')).toBeUndefined();
  });

  it('treats empty and zero as no amount', () => {
    expect(parse('')).toBeUndefined();
    expect(parse('   ')).toBeUndefined();
    expect(parse('.')).toBeUndefined();
    expect(parse('0')).toBeUndefined();
    expect(parse('0.00')).toBeUndefined();
  });

  it('caps at the API maximum', () => {
    expect(parse('100000000')).toBe(MAX_AMOUNT_CENTS);
    expect(parse('100000000.01')).toBeUndefined();
    expect(parse('99999999999999999999')).toBeUndefined();
  });
});

describe('parseAmount with a "," device separator', () => {
  const parse = (input: string) => parseAmount(input, ',');

  it('accepts the device separator', () => {
    expect(parse('12,50')).toBe(1250);
    expect(parse('12,5')).toBe(1250);
    expect(parse(',99')).toBe(99);
  });

  it('still accepts "." as a decimal separator', () => {
    expect(parse('12.50')).toBe(1250);
  });

  it('rejects anything that could be a grouped thousand', () => {
    expect(parse('1.234')).toBeUndefined();
    expect(parse('1,234')).toBeUndefined();
    expect(parse('1.234,56')).toBeUndefined();
    expect(parse('1,2.3')).toBeUndefined();
  });
});

describe('parseAmount with an unusual device separator', () => {
  it('escapes the separator rather than treating it as a pattern', () => {
    expect(parseAmount('12٫50', '٫')).toBe(1250);
    expect(parseAmount('12x50', '*')).toBeUndefined();
    expect(parseAmount('12*50', '*')).toBe(1250);
  });
});

describe('parseCents', () => {
  it('allows zero, for an exact split that gives someone nothing', () => {
    expect(parseCents('0', '.')).toBe(0);
    expect(parseCents('0.00', '.')).toBe(0);
  });

  it('is otherwise as strict as parseAmount', () => {
    expect(parseCents('', '.')).toBeUndefined();
    expect(parseCents('12,50', '.')).toBeUndefined();
    expect(parseCents('-1', '.')).toBeUndefined();
  });
});
