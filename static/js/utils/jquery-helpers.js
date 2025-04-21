/**
 * jQuery helper utilities for AnnZarro
 * Provides common jQuery-based DOM manipulation helpers
 */

/**
 * Get element by ID with jQuery
 * @param {string} id - Element ID (with or without #)
 * @returns {jQuery} jQuery object
 */
export function $(id) {
  const selector = id.startsWith('#') ? id : `#${id}`;
  return jQuery(selector);
}

/**
 * Safely get element by selector
 * @param {string} selector - CSS selector
 * @param {jQuery|Element|string} [context] - Optional context
 * @returns {jQuery} jQuery object
 */
export function $$(selector, context = null) {
  return context ? jQuery(selector, context) : jQuery(selector);
}

/**
 * Toggles class(es) on an element
 * @param {jQuery|Element|string} element - Element, jQuery object, or selector
 * @param {string} className - Class(es) to toggle
 * @param {boolean} [state] - Optional state (true=add, false=remove)
 * @returns {jQuery} The jQuery object for chaining
 */
export function toggleClass(element, className, state) {
  return jQuery(element).toggleClass(className, state);
}

/**
 * Update button state (active/inactive)
 * @param {jQuery|Element|string} button - Button element or selector
 * @param {boolean} isActive - Whether button should be active
 * @param {string} [activeClass='active btn-primary'] - Classes to apply when active
 * @param {string} [inactiveClass='btn-outline-secondary'] - Classes to apply when inactive
 */
export function updateButtonState(button, isActive, activeClass = 'active btn-primary', inactiveClass = 'btn-outline-secondary') {
  const $button = jQuery(button);
  
  if (isActive) {
    $button.addClass(activeClass).removeClass(inactiveClass);
    $button.attr('aria-pressed', 'true');
  } else {
    $button.removeClass(activeClass).addClass(inactiveClass);
    $button.attr('aria-pressed', 'false');
  }
  
  return $button;
}

/**
 * Sets the value of a select element and triggers change events
 * @param {jQuery|Element|string} select - Select element or selector
 * @param {string} value - Value to set
 * @param {boolean} [triggerEvents=true] - Whether to trigger change events
 */
export function setSelectValue(select, value, triggerEvents = true) {
  const $select = jQuery(select);
  $select.val(value);
  
  if (triggerEvents) {
    // Trigger standard change event
    $select.trigger('change');
    
    // If it's a Select2, trigger Select2 specific events
    if ($select.hasClass('select2-hidden-accessible')) {
      $select.trigger('change.select2');
    }
  }
  
  return $select;
}

/**
 * Show or hide an element with optional animation
 * @param {jQuery|Element|string} element - Element or selector
 * @param {boolean} show - Whether to show or hide
 * @param {string} [displayType='block'] - Display type when showing
 * @param {boolean} [animate=false] - Whether to animate
 */
export function showHide(element, show, displayType = 'block', animate = false) {
  const $element = jQuery(element);
  
  if (animate) {
    if (show) {
      $element.css('display', displayType).fadeIn(200);
    } else {
      $element.fadeOut(200);
    }
  } else {
    $element.css('display', show ? displayType : 'none');
  }
  
  return $element;
}

/**
 * Setup event delegation on a container
 * @param {jQuery|Element|string} container - Container element or selector
 * @param {string} eventType - Event type (click, change, etc.)
 * @param {string} selector - Child selector for delegation
 * @param {Function} handler - Event handler function
 */
export function delegate(container, eventType, selector, handler) {
  return jQuery(container).on(eventType, selector, handler);
}

/**
 * Create and populate a select element with options
 * @param {Array<{value: string, text: string, selected?: boolean}>} options - Array of option objects
 * @param {jQuery|Element|string} [select] - Existing select element to populate (optional)
 * @returns {jQuery} The populated select element
 */
export function createSelect(options, select = null) {
  const $select = select ? jQuery(select) : jQuery('<select></select>');
  
  // Clear existing options if necessary
  $select.empty();
  
  // Add new options
  options.forEach(option => {
    const $option = jQuery('<option></option>')
      .val(option.value)
      .text(option.text);
    
    if (option.selected) {
      $option.prop('selected', true);
    }
    
    $select.append($option);
  });
  
  return $select;
}

/**
 * Attach event handlers to DOM elements
 * @param {Object} handlers - Object mapping selectors to event handler objects
 * @param {Element|jQuery|string} [context=document] - Context element or selector
 * @example
 * // Usage:
 * attachHandlers({
 *   '#myButton': {
 *     'click': (e) => { console.log('clicked!') },
 *     'mouseenter': (e) => { console.log('hover!') }
 *   },
 *   '.someClass': {
 *     'change': (e) => { console.log('changed!') }
 *   }
 * }, '#container');
 */
export function attachHandlers(handlers, context = document) {
  const $context = jQuery(context);
  
  Object.entries(handlers).forEach(([selector, events]) => {
    Object.entries(events).forEach(([eventType, handler]) => {
      jQuery(selector, $context).on(eventType, handler);
    });
  });
}

/**
 * Create a DOM element with attributes and content
 * @param {string} tag - Tag name
 * @param {Object} [attrs={}] - Attributes to set
 * @param {string|Element|jQuery|Array} [content] - Content to append
 * @returns {jQuery} The created element
 */
export function createElement(tag, attrs = {}, content = null) {
  const $element = jQuery(`<${tag}></${tag}>`);
  
  // Set attributes
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class' || key === 'className') {
      $element.addClass(value);
    } else {
      $element.attr(key, value);
    }
  });
  
  // Set content if provided
  if (content) {
    if (Array.isArray(content)) {
      content.forEach(item => $element.append(item));
    } else {
      $element.append(content);
    }
  }
  
  return $element;
}

/**
 * Find elements but return a native array instead of jQuery collection
 * @param {string} selector - CSS selector
 * @param {Element|jQuery|string} [context=document] - Context element
 * @returns {Array<Element>} Array of matched elements
 */
export function findAll(selector, context = document) {
  return Array.from(jQuery(selector, context));
}

/**
 * Enhanced hover effect for elements
 * @param {jQuery|Element|string} element - Element or selector
 * @param {string} [hoverClass='hover'] - Class to apply on hover
 */
export function enhancedHover(element, hoverClass = 'hover') {
  const $element = jQuery(element);
  
  $element
    .on('mouseenter', function() {
      jQuery(this).addClass(hoverClass);
    })
    .on('mouseleave', function() {
      jQuery(this).removeClass(hoverClass);
    });
  
  return $element;
}

/**
 * Debounced event handler
 * @param {Function} fn - Function to debounce
 * @param {number} [delay=200] - Debounce delay in ms
 * @returns {Function} Debounced function
 */
export function debounce(fn, delay = 200) {
  let timeoutId;
  return function(...args) {
    const context = this;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(context, args), delay);
  };
}

/**
 * Easy form data collection
 * @param {jQuery|Element|string} form - Form element or selector
 * @returns {Object} Collected form data as object
 */
export function collectFormData(form) {
  const formData = {};
  jQuery(form).find(':input').each(function() {
    const $input = jQuery(this);
    const name = $input.attr('name');
    
    if (name) {
      if ($input.is(':checkbox')) {
        formData[name] = $input.is(':checked');
      } else {
        formData[name] = $input.val();
      }
    }
  });
  
  return formData;
}

/**
 * Show a visual loading indicator on an element
 * @param {jQuery|Element|string} element - Element to show loading on
 * @param {boolean} [isLoading=true] - Whether to show or hide loading state
 * @param {string} [loadingClass='loading'] - Class to apply when loading
 */
export function toggleLoading(element, isLoading = true, loadingClass = 'loading') {
  const $element = jQuery(element);
  
  if (isLoading) {
    // Save original text if present
    const originalText = $element.text().trim();
    if (originalText && !$element.data('original-text')) {
      $element.data('original-text', originalText);
    }
    
    $element.addClass(loadingClass);
    
    // If it's a button, optionally add spinner
    if ($element.is('button, .btn')) {
      if (!$element.find('.spinner-border').length) {
        $element.prepend('<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>');
      }
      $element.prop('disabled', true);
    }
  } else {
    $element.removeClass(loadingClass);
    
    // Remove spinner if exists
    $element.find('.spinner-border').remove();
    
    // If it's a button, restore original text
    if ($element.is('button, .btn')) {
      $element.prop('disabled', false);
    }
  }
  
  return $element;
}