/**
 * Utility functions for Annzarro
 */

// Define Utils object
const Utils = {
    /**
     * Generates a UUID v4
     * @returns {string} A UUID v4 string
     */
    generateUUID: function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    /**
     * Formats a number with commas for thousands
     * @param {number} num - The number to format
     * @returns {string} The formatted number as a string
     */
    formatNumber: function(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    /**
     * Formats a byte size into a human-readable format
     * @param {number} bytes - The size in bytes
     * @param {number} decimals - The number of decimal places to show
     * @returns {string} The formatted size with units
     */
    formatBytes: function(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    /**
     * Sanitizes a string for use as an HTML ID
     * @param {string} str - The string to sanitize
     * @returns {string} A sanitized string safe for use as an HTML ID
     */
    sanitizeForId: function(str) {
        return str.replace(/[^a-zA-Z0-9_-]/g, '_');
    },

    /**
     * Truncates a string if it's longer than the specified max length
     * @param {string} str - The string to truncate
     * @param {number} maxLength - The maximum length allowed
     * @param {string} suffix - The suffix to append to truncated strings
     * @returns {string} The truncated string
     */
    truncateString: function(str, maxLength = 50, suffix = '...') {
        if (!str) return '';
        if (str.length <= maxLength) return str;
        return str.substring(0, maxLength - suffix.length) + suffix;
    },

    /**
     * Gets a color from a predefined color palette
     * @param {number} index - The index to use for choosing a color
     * @returns {string} A hex color code
     */
    getColorFromPalette: function(index) {
        const colorPalette = [
            '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
            '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
            '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
            '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5'
        ];
        return colorPalette[index % colorPalette.length];
    },

    /**
     * Merges two objects recursively
     * @param {object} target - The target object to merge into
     * @param {object} source - The source object to merge from
     * @returns {object} The merged object
     */
    deepMerge: function(target, source) {
        if (!source) return target;
        const output = { ...target };
        
        Object.keys(source).forEach(key => {
            if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
                output[key] = Utils.deepMerge(target[key], source[key]);
            } else {
                output[key] = source[key];
            }
        });
        
        return output;
    },

    /**
     * Creates a debounced function that delays invoking the provided function
     * @param {Function} func - The function to debounce
     * @param {number} wait - The delay in milliseconds
     * @returns {Function} The debounced function
     */
    debounce: function(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    },

    /**
     * Detects if a string is a URL
     * @param {string} str - The string to test
     * @returns {boolean} True if the string is a URL
     */
    isUrl: function(str) {
        try {
            new URL(str);
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Gets a data type description for a value
     * @param {*} value - The value to check
     * @returns {string} A string describing the data type
     */
    getDataType: function(value) {
        if (value === null) return 'null';
        if (Array.isArray(value)) return `Array(${value.length})`;
        if (value instanceof Float32Array || value instanceof Float64Array) {
            return `Float${value.BYTES_PER_ELEMENT * 8}Array(${value.length})`;
        }
        if (value instanceof Int8Array || value instanceof Int16Array || 
            value instanceof Int32Array || value instanceof Uint8Array || 
            value instanceof Uint16Array || value instanceof Uint32Array) {
            return `${value.constructor.name}(${value.length})`;
        }
        if (typeof value === 'object') {
            return `Object(${Object.keys(value).length} keys)`;
        }
        return typeof value;
    },

    /**
     * Formats a value for display
     * @param {*} value - The value to format
     * @param {number} maxArrayItems - Maximum number of array items to display
     * @returns {string} The formatted value as a string
     */
    formatValue: function(value, maxArrayItems = 5) {
        if (value === null || value === undefined) return 'null';
        
        if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            if (value.length <= maxArrayItems) {
                return `[${value.map(v => Utils.formatValue(v, 0)).join(', ')}]`;
            }
            return `[${value.slice(0, maxArrayItems).map(v => Utils.formatValue(v, 0)).join(', ')}, ... (${value.length - maxArrayItems} more)]`;
        }
        
        if (value instanceof Float32Array || value instanceof Float64Array ||
            value instanceof Int8Array || value instanceof Int16Array || 
            value instanceof Int32Array || value instanceof Uint8Array || 
            value instanceof Uint16Array || value instanceof Uint32Array) {
            
            if (value.length === 0) return '[]';
            if (value.length <= maxArrayItems) {
                return `[${Array.from(value).join(', ')}]`;
            }
            return `[${Array.from(value.slice(0, maxArrayItems)).join(', ')}, ... (${value.length - maxArrayItems} more)]`;
        }
        
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            if (keys.length === 0) return '{}';
            if (keys.length <= maxArrayItems) {
                return `{${keys.map(k => `${k}: ${Utils.formatValue(value[k], 0)}`).join(', ')}}`;
            }
            return `{${keys.slice(0, maxArrayItems).map(k => `${k}: ${Utils.formatValue(value[k], 0)}`).join(', ')}, ... (${keys.length - maxArrayItems} more)}`;
        }
        
        if (typeof value === 'string') {
            if (value.length > 50) {
                return `"${value.substring(0, 47)}..."`;
            }
            return `"${value}"`;
        }
        
        return String(value);
    },

    /**
     * Shows a loading overlay on an element
     * @param {string|Element} element - The element or selector to show the loading overlay on
     * @param {string} message - The message to display
     */
    showLoading: function(element, message = 'Loading...') {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return;
        
        // Set position relative if not already absolute or relative
        const position = window.getComputedStyle(el).getPropertyValue('position');
        if (position !== 'absolute' && position !== 'relative') {
            el.style.position = 'relative';
        }
        
        // Create and append the loading overlay
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="spinner-container">
                <div class="spinner-border text-primary" role="status"></div>
                <div class="mt-2">${message}</div>
            </div>
        `;
        
        el.appendChild(overlay);
    },

    /**
     * Hides the loading overlay from an element
     * @param {string|Element} element - The element or selector to hide the loading overlay from
     */
    hideLoading: function(element) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return;
        
        const overlay = el.querySelector('.loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    },

    /**
     * Validates a numeric value and returns a default if invalid
     * @param {*} value - The value to validate
     * @param {number} defaultValue - The default value to return if invalid
     * @returns {number} The validated number
     */
    validateNumber: function(value, defaultValue = 0) {
        const num = parseFloat(value);
        return isNaN(num) ? defaultValue : num;
    },

    /**
     * Calculates range statistics (min, max, mean, median, etc.) for an array
     * @param {Array} array - The array to analyze
     * @returns {Object} An object containing the statistics
     */
    calculateRangeStats: function(array) {
        if (!Array.isArray(array) || array.length === 0) {
            return { min: 0, max: 0, mean: 0, median: 0, q1: 0, q3: 0 };
        }
        
        // Filter out non-numeric values
        const numericArray = array.filter(v => typeof v === 'number' && !isNaN(v));
        if (numericArray.length === 0) {
            return { min: 0, max: 0, mean: 0, median: 0, q1: 0, q3: 0 };
        }
        
        // Sort the array
        const sorted = [...numericArray].sort((a, b) => a - b);
        
        // Calculate statistics
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const sum = sorted.reduce((acc, curr) => acc + curr, 0);
        const mean = sum / sorted.length;
        
        // Median
        const midIndex = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
            ? (sorted[midIndex - 1] + sorted[midIndex]) / 2
            : sorted[midIndex];
        
        // Quartiles
        const q1Index = Math.floor(sorted.length * 0.25);
        const q3Index = Math.floor(sorted.length * 0.75);
        const q1 = sorted[q1Index];
        const q3 = sorted[q3Index];
        
        return { min, max, mean, median, q1, q3 };
    },

    /**
     * Creates categorical bins for a numerical array
     * @param {Array} array - The array to bin
     * @param {number} numBins - The number of bins to create
     * @returns {Object} An object with bin information
     */
    createBins: function(array, numBins = 10) {
        if (!Array.isArray(array) || array.length === 0) {
            return { bins: [], binRanges: [] };
        }
        
        // Filter out non-numeric values
        const numericArray = array.filter(v => typeof v === 'number' && !isNaN(v));
        if (numericArray.length === 0) {
            return { bins: [], binRanges: [] };
        }
        
        // Find min and max
        const min = Math.min(...numericArray);
        const max = Math.max(...numericArray);
        
        // Create bins
        const binSize = (max - min) / numBins;
        const bins = Array(numBins).fill(0);
        const binRanges = Array(numBins).fill(0).map((_, i) => {
            const start = min + i * binSize;
            const end = min + (i + 1) * binSize;
            return { start, end };
        });
        
        // Count values in each bin
        numericArray.forEach(value => {
            // Special case for max value
            if (value === max) {
                bins[numBins - 1]++;
                return;
            }
            
            const binIndex = Math.floor((value - min) / binSize);
            bins[binIndex]++;
        });
        
        return { bins, binRanges };
    },

    /**
     * Download data as a JSON file
     * @param {Object} data - The data to download
     * @param {string} filename - The filename to use
     */
    downloadJSON: function(data, filename) {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    /**
     * Download data as a CSV file
     * @param {Array} data - The data to download as an array of objects
     * @param {string} filename - The filename to use
     */
    downloadCSV: function(data, filename) {
        if (!Array.isArray(data) || data.length === 0) return;
        
        // Get headers from the first object
        const headers = Object.keys(data[0]);
        
        // Create CSV content
        let csvContent = headers.join(',') + '\n';
        
        data.forEach(row => {
            const values = headers.map(header => {
                const value = row[header];
                // Handle strings with commas by wrapping in quotes
                if (typeof value === 'string' && value.includes(',')) {
                    return `"${value}"`;
                }
                return value;
            });
            csvContent += values.join(',') + '\n';
        });
        
        // Create and download the file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    /**
     * Escapes HTML special characters
     * @param {string} unsafe - The potentially unsafe string
     * @returns {string} The escaped string safe for inclusion in HTML
     */
    escapeHTML: function(unsafe) {
        return unsafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};

// Export for both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
} else if (typeof window !== 'undefined') {
    window.Utils = Utils;
}