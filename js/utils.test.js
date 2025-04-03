/**
 * Tests for utility functions
 */

// Import Utils with manual mocking approach since we're not using module system
const Utils = global.Utils || require('./utils');

describe('Utils', () => {
  describe('generateUUID', () => {
    it('generates a valid UUID v4 string', () => {
      const uuid = Utils.generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
    
    it('generates unique UUIDs', () => {
      const uuid1 = Utils.generateUUID();
      const uuid2 = Utils.generateUUID();
      expect(uuid1).not.toEqual(uuid2);
    });
  });

  describe('formatNumber', () => {
    it('formats numbers with commas for thousands', () => {
      expect(Utils.formatNumber(1234)).toBe('1,234');
      expect(Utils.formatNumber(1234567)).toBe('1,234,567');
      expect(Utils.formatNumber(1234.567)).toBe('1,234.567');
    });
  });

  describe('formatBytes', () => {
    it('formats bytes into human-readable values', () => {
      expect(Utils.formatBytes(0)).toBe('0 Bytes');
      expect(Utils.formatBytes(1024)).toBe('1 KB');
      expect(Utils.formatBytes(1048576)).toBe('1 MB');
      expect(Utils.formatBytes(1073741824)).toBe('1 GB');
    });

    it('respects decimals parameter', () => {
      expect(Utils.formatBytes(1500, 0)).toBe('1 KB');
      expect(Utils.formatBytes(1500, 1)).toBe('1.5 KB');
      expect(Utils.formatBytes(1500, 2)).toBe('1.46 KB');
    });
  });

  describe('sanitizeForId', () => {
    it('sanitizes strings for use as HTML IDs', () => {
      expect(Utils.sanitizeForId('hello world')).toBe('hello_world');
      expect(Utils.sanitizeForId('hello$@#world')).toBe('hello___world');
      expect(Utils.sanitizeForId('Gene: ABC123')).toBe('Gene__ABC123');
    });
  });

  describe('truncateString', () => {
    it('truncates strings that exceed max length', () => {
      expect(Utils.truncateString('This is a long string', 10)).toBe('This is...');
      expect(Utils.truncateString('Short', 10)).toBe('Short');
    });

    it('respects custom suffix', () => {
      expect(Utils.truncateString('This is a long string', 10, '[...]')).toBe('This [...]');
    });

    it('handles empty or null inputs', () => {
      expect(Utils.truncateString('')).toBe('');
      expect(Utils.truncateString(null)).toBe('');
    });
  });
  
  describe('getColorFromPalette', () => {
    it('returns colors from the palette', () => {
      const firstColor = Utils.getColorFromPalette(0);
      expect(firstColor).toBe('#1f77b4');
      
      const secondColor = Utils.getColorFromPalette(1);
      expect(secondColor).toBe('#ff7f0e');
    });
    
    it('cycles through the palette for large indices', () => {
      const color1 = Utils.getColorFromPalette(0);
      const color2 = Utils.getColorFromPalette(20); // Should cycle back to index 0
      expect(color1).toBe(color2);
    });
  });

  describe('deepMerge', () => {
    it('merges two objects', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 3, c: 4 };
      const result = Utils.deepMerge(obj1, obj2);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('recursively merges nested objects', () => {
      const obj1 = { a: 1, b: { x: 1, y: 2 } };
      const obj2 = { b: { y: 3, z: 4 }, c: 5 };
      const result = Utils.deepMerge(obj1, obj2);
      expect(result).toEqual({ a: 1, b: { x: 1, y: 3, z: 4 }, c: 5 });
    });

    it('handles null or undefined source', () => {
      const obj = { a: 1 };
      expect(Utils.deepMerge(obj, null)).toEqual(obj);
      expect(Utils.deepMerge(obj, undefined)).toEqual(obj);
    });
  });

  describe('isUrl', () => {
    it('detects valid URLs', () => {
      expect(Utils.isUrl('https://example.com')).toBe(true);
      expect(Utils.isUrl('http://localhost:8080')).toBe(true);
    });
    
    it('rejects invalid URLs', () => {
      expect(Utils.isUrl('not a url')).toBe(false);
      expect(Utils.isUrl('example.com')).toBe(false); // Missing protocol
    });
  });

  describe('validateNumber', () => {
    it('returns the number if valid', () => {
      expect(Utils.validateNumber(123)).toBe(123);
      expect(Utils.validateNumber('123')).toBe(123);
    });
    
    it('returns default value for invalid numbers', () => {
      expect(Utils.validateNumber('abc')).toBe(0);
      expect(Utils.validateNumber(NaN, 10)).toBe(10);
    });
  });

  describe('calculateRangeStats', () => {
    it('calculates statistics for an array of numbers', () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const stats = Utils.calculateRangeStats(array);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(10);
      expect(stats.mean).toBe(5.5);
      expect(stats.median).toBe(5.5);
    });
    
    it('handles empty arrays', () => {
      const stats = Utils.calculateRangeStats([]);
      expect(stats).toEqual({ min: 0, max: 0, mean: 0, median: 0, q1: 0, q3: 0 });
    });
    
    it('filters out non-numeric values', () => {
      const array = [1, 2, 'a', 4, null, 6];
      const stats = Utils.calculateRangeStats(array);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(6);
      expect(stats.mean).toBe(3.25); // (1+2+4+6)/4
    });
  });

  describe('escapeHTML', () => {
    it('escapes HTML special characters', () => {
      const unsafe = '<script>alert("hello & world");</script>';
      const safe = Utils.escapeHTML(unsafe);
      expect(safe).toBe('&lt;script&gt;alert(&quot;hello &amp; world&quot;);&lt;/script&gt;');
    });
  });
});