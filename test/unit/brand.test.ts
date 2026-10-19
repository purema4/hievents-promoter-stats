import { describe, expect, test } from 'bun:test';
import { accentWarnings, brandCss, contrast, darkAccent, getBrand, isHex, textOn, updateBrand } from '../../src/brand';

describe('contrast (WCAG)', () => {
  test('black on white is 21:1, and the order does not matter', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#2f5bea', '#2f5bea')).toBeCloseTo(1, 5);
  });

  test('known values', () => {
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('darkAccent', () => {
  test.each(['#2f5bea', '#000080', '#1c1c1a', '#000000', '#7a1f1f', '#0b6b3a', '#5b2a86'])('%p becomes readable on the dark surface', (accent) => {
    expect(contrast(darkAccent(accent), '#1c1c1a')).toBeGreaterThanOrEqual(4.5);
  });

  test('a colour that already reads well is kept', () => {
    expect(darkAccent('#ffcc00')).toBe('#ffcc00');
    expect(darkAccent('#ffffff')).toBe('#ffffff');
  });
});

describe('textOn', () => {
  test('picks white or near-black, whichever reads better', () => {
    expect(textOn('#ffffff')).toBe('#0b0b0a');
    expect(textOn('#ffcc00')).toBe('#0b0b0a');
    expect(textOn('#000000')).toBe('#ffffff');
    expect(textOn('#2f5bea')).toBe('#ffffff');
  });
});

describe('accentWarnings', () => {
  test('a pale accent is flagged, the default is not', () => {
    expect(accentWarnings('#2f5bea')).toEqual([]);
    expect(accentWarnings('#ffff66').length).toBeGreaterThan(0);
  });
});


describe('branding settings', () => {
  test('isHex', () => {
    expect(isHex('#A1b2C3')).toBe(true);
    expect(isHex('#abc')).toBe(false);
    expect(isHex('red')).toBe(false);
    expect(isHex('#a1b2c3;}body{')).toBe(false);
  });

  test('updateBrand stores trimmed values and brand.css follows the accent', () => {
    updateBrand({ name: '  TechnoNacht  ', accent: '#7A1F1F', loginMessage: ' Hi ', footer: ' Montréal ' });
    const brand = getBrand();
    expect(brand).toMatchObject({ name: 'TechnoNacht', accent: '#7a1f1f', loginMessage: 'Hi', footer: 'Montréal' });
    const css = brandCss();
    expect(css).toContain('--accent: #7a1f1f;');
    expect(css).toContain(`--accent-dark: ${darkAccent('#7a1f1f')};`);
    // An empty name falls back to the default.
    updateBrand({ name: '   ', accent: '#2f5bea', loginMessage: '', footer: '' });
    expect(getBrand().name).toBe('Promoter stats');
  });
});
