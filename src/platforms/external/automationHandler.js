// automationHandler.js
import FormFieldAnalyzer from "./formFieldAnalyzer";
import ValueProvider from "./valueProvider";
import { SELECTORS } from "./selectors";

class StateManager {
  constructor() {
    this.state = {};
  }
  
  async saveState(newState) {
    this.state = { ...this.state, ...newState };
    return this.state;
  }
  
  async getState() {
    return this.state;
  }
}

class ExternalJobAutomation {
  constructor(data) {
    this.page = data.page || window;
    this.HOST = data.host;
    this.userId = data.userId;
    this.platform = data.platform || "unknown"; // Add platform context
    this.stateManager = new StateManager();
    this.userDetails = null;
    this.fieldAnalyzer = FormFieldAnalyzer;
    this.formState = new Map();
    this.isRunning = false;
    this.timeouts = [];
  }
  
  async initialize() {
    return await this.safeExecute(async () => {
      const userDetails = await this.fetchUserDetailsFromBackend(this.userId);
      console.log("USER DETAILS", userDetails);
      await this.stateManager.saveState({
        userId: this.userId,
        userDetails,
        preferences: userDetails.jobPreferences || {},
        availableCredits: userDetails.credits || 0,
        applicationsUsed: userDetails.applicationsUsed || 0,
        userPlan: userDetails.plan,
        isProcessing: false,
        currentJobIndex: 0,
        subscription: userDetails.subscription || null,
      });

      this.userData = userDetails;
      this.isRunning = true;
      this.setupTimeouts();
      
      // Initialize value provider
      this.valueProvider = new ValueProvider(userDetails);
      
      return true;
    }, "Initialization error");
  }
  
  setupTimeouts() {
    // Set a global timeout to prevent the automation from running too long
    const globalTimeout = setTimeout(() => {
      if (this.isRunning) {
        console.log("Global timeout reached, stopping automation");
        this.isRunning = false;
        this.notifyStatus("timeout", "Application process timed out");
      }
    }, 180000); // 3 minutes max
    
    this.timeouts.push(globalTimeout);
  }
  
  clearTimeouts() {
    this.timeouts.forEach(timeout => clearTimeout(timeout));
    this.timeouts = [];
  }

  async fetchUserDetailsFromBackend(userId) {
    return await this.safeExecute(async () => {
      const response = await fetch(`${this.HOST}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data) throw new Error("No user data received from backend");
      return data;
    }, "Error fetching user details");
  }

  async getCurrentState() {
    return await this.safeExecute(async () => {
      const state = await this.stateManager.getState();
      if (!state?.userId) {
        throw new Error("No valid state found - please reinitialize");
      }
      return state;
    }, "Error getting current state");
  }

  async init() {
    await this.initialize();
    const state = await this.getCurrentState();
    if (!state.userDetails) {
      throw new Error("User details required for automation");
    }
    
    if (!this.valueProvider) {
      this.valueProvider = new ValueProvider(state.userDetails);
    }
  }

  async handleApplication(jobDetails) {
    try {
      console.log(`Starting external application from ${this.platform}:`, jobDetails);
      
      // Wait for page to be fully loaded and stable
      await this.waitForStableDOM();
      
      // Find and click apply button if present (may not be present if we're already on the form)
      const applyButton = await this.findApplyButton();
      if (applyButton) {
        console.log("Apply button found, clicking...");
        await this.safeClick(applyButton);
        await this.waitForStableDOM();
      } else {
        console.log("No apply button found, assuming already on form page");
      }

      // Handle multi-step form
      const result = await this.handleMultiStepForm();

      // Notify completion with platform context
      this.notifyStatus("completed", "Application submitted successfully", result);

      return {
        success: true,
        message: "Application submitted successfully",
        details: result
      };
    } catch (error) {
      console.error("Application error:", error);
      this.notifyStatus("failed", error.message);
      return {
        success: false,
        error: error.message
      };
    } finally {
      // Clean up
      this.isRunning = false;
      this.clearTimeouts();
    }
  }
  
  notifyStatus(status, message, details = {}) {
    chrome.runtime.sendMessage({
      type: "APPLICATION_STATUS",
      data: {
        status: status,
        platform: this.platform,
        message: message,
        details: details
      }
    });
  }

  async findApplyButton() {
    for (const selector of SELECTORS.APPLY_BUTTON) {
      const elements = document.querySelectorAll(selector);

      for (const element of elements) {
        if (!this.isElementVisible(element)) continue;

        const text = element.textContent.toLowerCase();
        if (text.includes("apply") || text.includes("submit")) {
          return element;
        }
      }
    }
    return null;
  }

  async handleMultiStepForm() {
    let currentStep = 0;
    const maxSteps = 15; // Increased for complex forms
    const processedFields = new Set();
    let totalFieldsProcessed = 0;

    while (currentStep < maxSteps && this.isRunning) {
      await this.waitForStableDOM();

      // Get all visible form fields on current step
      const fields = await this.getFormFields();
      if (!fields || fields.length === 0) {
        console.log("No form fields found, trying to move to next step");
        const hasNext = await this.moveToNextStep();
        if (!hasNext) {
          console.log("No next button found, form may be complete");
          break;
        }
        currentStep++;
        continue;
      }

      console.log(`Step ${currentStep}: Found ${fields.length} fields`);
      
      // Filter for new fields we haven't processed yet
      const newFields = fields.filter(
        (field) => !processedFields.has(field.name || field.id)
      );

      if (newFields.length === 0) {
        // Try to move to next step
        console.log("No new fields, trying to move to next step");
        const hasNext = await this.moveToNextStep();
        if (!hasNext) {
          console.log("No next step available, form may be complete");
          break;
        }
        currentStep++;
        await this.sleep(1000); // Wait for next step to load
        continue;
      }

      // Process each new field
      for (const field of newFields) {
        if (!this.isRunning) break;
        
        try {
          const fieldData = await this.fieldAnalyzer.analyzeField(field);

          if (!fieldData.visible || fieldData.disabled) {
            continue;
          }

          if (fieldData.type === "file") {
            await this.handleFileUpload(fieldData);
          } else {
            const value = await this.valueProvider.getValueForField(fieldData);
            if (value) {
              await this.fillField(field, value, fieldData);
              totalFieldsProcessed++;
            }
          }

          processedFields.add(field.name || field.id);
          await this.sleep(Math.random() * 800 + 200); // More human-like timing
        } catch (error) {
          console.warn(`Failed to process field ${field.name || field.id}:`, error);
        }
      }

      currentStep++;
      
      // Try to move to next step if we processed fields
      if (newFields.length > 0) {
        await this.moveToNextStep();
        await this.sleep(1500); // Wait for next step to load
      }
    }

    return {
      fieldsProcessed: totalFieldsProcessed,
      stepsCompleted: currentStep,
    };
  }
  
  async getFormFields() {
    const fields = [];
    
    // Process all potential form inputs
    for (const [type, selector] of Object.entries(SELECTORS.FORM_INPUTS)) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isElementVisible(element)) {
          fields.push(element);
        }
      }
    }
    
    return fields;
  }

  isElementVisible(element) {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0 &&
      element.offsetParent !== null
    );
  }

  async waitForStableDOM(timeout = 5000) {
    return new Promise((resolve) => {
      let lastHTMLSize = 0;
      let checkCount = 0;
      const maxChecks = 30; // 3 seconds max
      
      const interval = setInterval(() => {
        const html = document.documentElement.innerHTML;
        const currentHTMLSize = html.length;

        if (currentHTMLSize === lastHTMLSize) {
          checkCount++;
          if (checkCount >= 3 || checkCount >= maxChecks) {
            clearInterval(interval);
            resolve(true);
          }
        } else {
          lastHTMLSize = currentHTMLSize;
          checkCount = 0;
        }
      }, 100);
      
      // Set a timeout to resolve anyway
      setTimeout(() => {
        clearInterval(interval);
        console.log("DOM stabilization timeout - continuing anyway");
        resolve(false);
      }, timeout);
    });
  }

  async safeClick(element, options = {}) {
    if (!element) return false;
    
    const defaultOptions = {
      waitForNavigation: false, // Changed to false by default
      navigationTimeout: 10000,
      retryCount: 3,
      retryDelay: 1000,
    };

    const opts = { ...defaultOptions, ...options };
    let attempt = 0;

    while (attempt < opts.retryCount) {
      try {
        // Try regular click first
        element.click();
        
        // If we need to wait for navigation
        if (opts.waitForNavigation) {
          await this.waitForPageChange(opts.navigationTimeout);
        }
        
        return true;
      } catch (error) {
        attempt++;
        console.log(`Click attempt ${attempt} failed:`, error);
        
        if (attempt === opts.retryCount) {
          // Try JavaScript click as last resort
          try {
            const result = this.executeJavascriptClick(element);
            if (result) {
              if (opts.waitForNavigation) {
                await this.waitForPageChange(opts.navigationTimeout);
              }
              return true;
            }
          } catch (e) {
            console.error("JavaScript click failed:", e);
            throw new Error(
              `Failed to click element after ${opts.retryCount} attempts: ${e.message}`
            );
          }
        }
        await this.sleep(opts.retryDelay);
      }
    }
    return false;
  }
  
  executeJavascriptClick(element) {
    // Create and dispatch mouse events
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    
    const mouseUp = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    
    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    
    element.dispatchEvent(mouseDown);
    element.dispatchEvent(mouseUp);
    return element.dispatchEvent(click);
  }
  
  async waitForPageChange(timeout = 10000) {
    return new Promise((resolve) => {
      const startUrl = window.location.href;
      const startTime = Date.now();
      
      const checkInterval = setInterval(() => {
        // Check if URL changed
        if (window.location.href !== startUrl) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve(true);
        }
        
        // Check if too much time has passed
        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 100);
      
      // Set a timeout to resolve anyway
      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, timeout);
    });
  }

  async fillField(element, value, fieldData) {
    if (!element) return false;
    
    const inputHandlers = {
      select: this.handleSelect.bind(this),
      "select-one": this.handleSelect.bind(this),
      text: this.handleTextInput.bind(this),
      email: this.handleTextInput.bind(this),
      tel: this.handleTextInput.bind(this),
      textarea: this.handleTextInput.bind(this),
      radio: this.handleRadio.bind(this),
      checkbox: this.handleCheckbox.bind(this),
      date: this.handleDateInput.bind(this),
      number: this.handleTextInput.bind(this),
    };

    const handler =
      inputHandlers[fieldData.type] || this.handleTextInput.bind(this);
    return await handler(element, value, fieldData);
  }

  async handleTextInput(element, value, fieldData) {
    try {
      // Focus on the element first
      element.focus();
      
      // Clear existing value
      element.value = "";
      
      // For React and other modern frameworks, trigger events
      element.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Type value with human-like delays
      for (const char of value.toString()) {
        element.value += char;
        
        // Trigger input event after each character
        element.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Random typing delay
        await this.sleep(Math.random() * (150 - 50) + 50);

        // Random pauses for more human-like typing
        if (Math.random() < 0.1) {
          await this.sleep(Math.random() * (500 - 200) + 200);
        }
      }

      // Trigger final events
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      return true;
    } catch (error) {
      console.error(`Failed to fill text input: ${error.message}`);
      
      // Fallback method
      try {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch (e) {
        console.error("Fallback text input method failed:", e);
        return false;
      }
    }
  }
  
  async handleDateInput(element, value, fieldData) {
    try {
      // Format date as YYYY-MM-DD
      let formattedDate = value;
      if (typeof value === 'string' && !value.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Try to convert to YYYY-MM-DD
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          formattedDate = date.toISOString().split('T')[0];
        }
      }
      
      element.value = formattedDate;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (error) {
      console.error(`Failed to fill date input: ${error.message}`);
      return false;
    }
  }

  async handleSelect(element, value, fieldData) {
    try {
      // Check for custom select implementations
      const isCustomSelect = element.classList.contains("select2") ||
        element.classList.contains("react-select") ||
        element.getAttribute("role") === "combobox";

      if (isCustomSelect) {
        return await this.handleCustomSelect(element, value, fieldData);
      }

      // Handle native select
      const success = this.setNativeSelectValue(element, value);
      return success;
    } catch (error) {
      console.error(`Failed to handle select: ${error.message}`);
      return false;
    }
  }
  
  setNativeSelectValue(selectElement, value) {
    const options = Array.from(selectElement.options);
    
    // Try to find an option that matches the value
    const option = options.find(opt => 
      opt.value.toLowerCase() === value.toString().toLowerCase() ||
      opt.text.toLowerCase().includes(value.toString().toLowerCase())
    );
    
    if (option) {
      selectElement.value = option.value;
      selectElement.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    
    // If no direct match, select first non-empty option
    const nonEmptyOption = options.find(opt => 
      opt.value && 
      opt.value !== "" && 
      !opt.disabled && 
      opt.text !== "Select" &&
      opt.text !== "Please select"
    );
    
    if (nonEmptyOption) {
      selectElement.value = nonEmptyOption.value;
      selectElement.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    
    return false;
  }

  async handleCustomSelect(element, value, fieldData) {
    try {
      // Click to open dropdown
      await this.safeClick(element, { waitForNavigation: false });
      await this.sleep(500);

      // Look for search input
      const searchSelectors = [
        'input[type="search"]',
        'input[type="text"]',
        '[class*="select-search__input"]', 
        '[class*="select2-search__field"]'
      ];
      
      let searchInput = null;
      for (const selector of searchSelectors) {
        const inputs = document.querySelectorAll(selector);
        for (const input of inputs) {
          if (this.isElementVisible(input)) {
            searchInput = input;
            break;
          }
        }
        if (searchInput) break;
      }
      
      if (searchInput) {
        await this.handleTextInput(searchInput, value);
        await this.sleep(1000);
      }

      // Find and click matching option
      const optionSelectors = [
        '[class*="select-option"]', 
        '[class*="select2-result"]',
        '[role="option"]',
        '.dropdown-item',
        'li'
      ];
      
      for (const selector of optionSelectors) {
        const options = document.querySelectorAll(selector);
        for (const option of options) {
          if (!this.isElementVisible(option)) continue;
          
          const optionText = option.textContent.toLowerCase();
          if (optionText.includes(value.toString().toLowerCase())) {
            await this.safeClick(option, { waitForNavigation: false });
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error(`Failed to handle custom select: ${error.message}`);
      return false;
    }
  }

  async handleRadio(element, value, fieldData) {
    try {
      // Get all radio buttons with the same name
      const radioGroup = document.querySelectorAll(`input[name="${fieldData.name}"]`);
      if (radioGroup.length === 0) return false;
      
      // Try to find the one that matches our value
      for (const radio of radioGroup) {
        if (!this.isElementVisible(radio)) continue;
        
        const radioValue = radio.value.toLowerCase();
        const labelText = radio.labels && radio.labels[0] ? 
          radio.labels[0].textContent.toLowerCase() : "";
        
        if (radioValue === value.toString().toLowerCase() ||
            labelText.includes(value.toString().toLowerCase())) {
          await this.safeClick(radio, { waitForNavigation: false });
          return true;
        }
      }
      
      // If no match found but it's a yes/no question, make a best guess
      if (typeof value === 'boolean' || value === 'yes' || value === 'no') {
        const isYes = value === true || value === 'yes' || value === 'true' || value === 1;
        
        // Try to find yes/no options
        for (const radio of radioGroup) {
          if (!this.isElementVisible(radio)) continue;
          
          const radioValue = radio.value.toLowerCase();
          const labelText = radio.labels && radio.labels[0] ? 
            radio.labels[0].textContent.toLowerCase() : "";
          
          if (isYes && (radioValue === 'yes' || radioValue === 'true' || 
              labelText.includes('yes') || labelText.includes('true'))) {
            await this.safeClick(radio, { waitForNavigation: false });
            return true;
          } else if (!isYes && (radioValue === 'no' || radioValue === 'false' || 
              labelText.includes('no') || labelText.includes('false'))) {
            await this.safeClick(radio, { waitForNavigation: false });
            return true;
          }
        }
      }
      
      // If still no match, select the first option
      if (radioGroup.length > 0 && this.isElementVisible(radioGroup[0])) {
        await this.safeClick(radioGroup[0], { waitForNavigation: false });
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Failed to handle radio: ${error.message}`);
      return false;
    }
  }

  async handleCheckbox(element, value, fieldData) {
    try {
      const shouldCheck =
        value === true || value === "true" || value === "yes" || value === 1;

      const isChecked = element.checked;
      if (isChecked !== shouldCheck) {
        await this.safeClick(element, { waitForNavigation: false });
      }
      return true;
    } catch (error) {
      console.error(`Failed to handle checkbox: ${error.message}`);
      return false;
    }
  }

  async handleFileUpload(fieldData) {
    try {
      const fileUrl = await this.valueProvider.getFileValue(fieldData.purpose);
      if (!fileUrl) return false;

      // Fetch the file data
      const response = await fetch(fileUrl);
      if (!response.ok)
        throw new Error(`Failed to fetch file: ${response.statusText}`);

      const blob = await response.blob();
      
      // Find the file input element
      const fileInput = document.querySelector(`input[name="${fieldData.name}"]`);
      if (!fileInput) return false;

      // Make file input visible and interactive if needed
      const originalDisplay = fileInput.style.display;
      const originalVisibility = fileInput.style.visibility;
      const originalOpacity = fileInput.style.opacity;
      
      fileInput.style.display = "block";
      fileInput.style.visibility = "visible";
      fileInput.style.opacity = "1";
      
      // Create a File object and assign to the input
      const file = new File([blob], `${fieldData.purpose}.pdf`, { type: 'application/pdf' });
      
      // Create a DataTransfer to set the file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      
      // Trigger change event
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Reset styles
      setTimeout(() => {
        fileInput.style.display = originalDisplay;
        fileInput.style.visibility = originalVisibility;
        fileInput.style.opacity = originalOpacity;
      }, 500);
      
      return true;
    } catch (error) {
      console.error(`File upload error: ${error.message}`);
      return false;
    }
  }

  async moveToNextStep() {
    const actionButton = await this.findActionButton();
    if (!actionButton) return false;

    const success = await this.safeClick(actionButton);
    if (success) {
      await this.waitForStableDOM();
      return true;
    }
    return false;
  }

  async findActionButton() {
    // First look for submit buttons
    const submitButtons = document.querySelectorAll('button[type="submit"], input[type="submit"]');
    for (const button of submitButtons) {
      if (this.isElementVisible(button)) {
        return button;
      }
    }
    
    // Then try other button patterns
    for (const selector of SELECTORS.ACTION_BUTTONS) {
      const elements = document.querySelectorAll(selector);

      for (const element of elements) {
        if (!this.isElementVisible(element)) continue;

        const text = element.textContent.toLowerCase();
        if (text.match(/next|continue|submit|apply|save|proceed|review/)) {
          return element;
        }
      }
    }
    
    return null;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  
  async safeExecute(fn, errorMessage) {
    try {
      return await fn();
    } catch (error) {
      console.error(`${errorMessage}: ${error.message}`);
      throw new Error(`${errorMessage}: ${error.message}`);
    }
  }
}

export default ExternalJobAutomation;