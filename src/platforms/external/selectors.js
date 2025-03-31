export const SELECTORS = {
  APPLY_BUTTON: [
    "button:not([disabled])",
    'a[href*="apply" i]',
    '[role="button"]',
    'input[type="submit"]',
    ".apply-button",
    "#apply-button",
    '[data-testid*="apply"]',
    '[class*="apply"]',
    // Platform-specific selectors
    '[class*="jobs-apply"]',
    '[aria-label*="apply" i]',
    'a[href*="job-apply"]',
  ],

  FORM_INPUTS: {
    TEXT: 'input[type="text"], input:not([type])',
    EMAIL: 'input[type="email"]',
    PHONE: 'input[type="tel"]',
    FILE: 'input[type="file"]',
    SELECT: 'select, [role="combobox"]',
    TEXTAREA: "textarea",
    RADIO: 'input[type="radio"]',
    CHECKBOX: 'input[type="checkbox"]',
    DATE: 'input[type="date"]',
    NUMBER: 'input[type="number"]',
  },

  ACTION_BUTTONS: [
    "button:not([disabled])",
    'input[type="submit"]:not([disabled])',
    '[role="button"]:not([disabled])',
    'a[href*="submit" i]',
    '[data-testid*="submit"]',
    '[data-testid*="next"]',
    '[class*="submit"]',
    '[class*="next"]',
  ],

  FORM_CONTAINERS: [
    "form",
    '[role="form"]',
    ".application-form",
    '[class*="form-container"]',
    '[class*="application-container"]',
  ],
};
