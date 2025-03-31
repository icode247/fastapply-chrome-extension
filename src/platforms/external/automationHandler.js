

import FormFieldAnalyzer from "./formFieldAnalyzer";
import ValueProvider from "./valueProvider";
import { SELECTORS } from "./selectors";

class ExternalJobAutomation {
  constructor(data) {
    this.page = data.page;
    this.HOST = data.host;
    this.userId = data.userId;
    this.platform = data.platform; // Add platform context
    this.stateManager = new StateManager();
    this.userDetails = null;
    this.fieldAnalyzer = FormFieldAnalyzer;
    this.formState = new Map();
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
    }, "Initialization error");
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
    this.valueProvider = new ValueProvider(state.userDetails);
  }

  async handleApplication(jobDetails) {
    try {
      await this.init();

      // Log application start with platform context
      console.log(`Starting external application from ${this.platform}:`, jobDetails);

      // Find and click apply button
      const applyButton = await this.findApplyButton();
      if (!applyButton) {
        throw new Error("Apply button not found");
      }
      await this.safeClick(applyButton);

      // Handle multi-step form
      const result = await this.handleMultiStepForm();

      // Notify completion with platform context
      chrome.runtime.sendMessage({
        type: "APPLICATION_STATUS",
        data: {
          status: "completed",
          platform: this.platform,
          details: result
        }
      });

      return {
        success: true,
        message: "Application submitted successfully",
        details: result
      };
    } catch (error) {
      console.error("Application error:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async findApplyButton() {
    for (const selector of SELECTORS.APPLY_BUTTON) {
      const elements = await this.page.$$(selector);

      for (const element of elements) {
        const visible = await this.isElementVisible(element);
        if (!visible) continue;

        const text = await element.evaluate((el) =>
          el.textContent.toLowerCase()
        );
        if (text.includes("apply") || text.includes("submit")) {
          return element;
        }
      }
    }
    return null;
  }

  async handleMultiStepForm() {
    let currentStep = 0;
    const maxSteps = 10;
    const processedFields = new Set();

    while (currentStep < maxSteps) {
      await this.waitForStableDOM();

      // Get all form fields on current step
      const fields = await this.getFormFields();
      const newFields = fields.filter(
        (field) => !processedFields.has(field.name)
      );

      if (newFields.length === 0) {
        // Try to move to next step
        const hasNext = await this.moveToNextStep();
        if (!hasNext) break;
        currentStep++;
        continue;
      }

      // Process each new field
      for (const field of newFields) {
        try {
          const fieldData = await this.fieldAnalyzer.analyzeField(
            field,
            this.page
          );

          if (!fieldData.visible || fieldData.disabled) {
            continue;
          }

          if (fieldData.type === "file") {
            await this.handleFileUpload(fieldData);
          } else {
            const value = await this.valueProvider.getValueForField(fieldData);
            if (value) {
              await this.fillField(field, value, fieldData);
            }
          }

          processedFields.add(field.name);
          await this.sleep(Math.random() * 1000 + 500);
        } catch (error) {
          console.warn(`Failed to process field ${field.name}:`, error);
        }
      }

      currentStep++;
    }

    return {
      fieldsProcessed: processedFields.size,
      stepsCompleted: currentStep,
    };
  }

  async isElementVisible(element) {
    return await element.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        el.offsetParent !== null
      );
    });
  }

  async waitForStableDOM(timeout = 5000) {
    await this.page
      .waitForFunction(
        () => {
          return new Promise((resolve) => {
            let lastHTMLSize = 0;
            let checkCount = 0;
            const interval = setInterval(() => {
              const html = document.documentElement.innerHTML;
              const currentHTMLSize = html.length;

              if (currentHTMLSize === lastHTMLSize) {
                checkCount++;
                if (checkCount >= 3) {
                  clearInterval(interval);
                  resolve(true);
                }
              } else {
                lastHTMLSize = currentHTMLSize;
                checkCount = 0;
              }
            }, 100);
          });
        },
        { timeout }
      )
      .catch(() => {
        console.log("DOM stabilization timeout - continuing anyway");
      });
  }

  async safeClick(element, options = {}) {
    const defaultOptions = {
      waitForNavigation: true,
      navigationTimeout: 30000,
      retryCount: 3,
      retryDelay: 1000,
    };

    const opts = { ...defaultOptions, ...options };
    let attempt = 0;

    while (attempt < opts.retryCount) {
      try {
        if (opts.waitForNavigation) {
          await Promise.all([
            this.page
              .waitForNavigation({
                waitUntil: "networkidle0",
                timeout: opts.navigationTimeout,
              })
              .catch(() => {}),
            element.click(),
          ]);
        } else {
          await element.click();
        }
        return true;
      } catch (error) {
        attempt++;
        if (attempt === opts.retryCount) {
          // Try JavaScript click as last resort
          try {
            await this.page.evaluate((el) => el.click(), element);
            return true;
          } catch (e) {
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

  async fillField(element, value, fieldData) {
    const inputHandlers = {
      select: this.handleSelect.bind(this),
      "select-one": this.handleSelect.bind(this),
      text: this.handleTextInput.bind(this),
      email: this.handleTextInput.bind(this),
      tel: this.handleTextInput.bind(this),
      textarea: this.handleTextInput.bind(this),
      radio: this.handleRadio.bind(this),
      checkbox: this.handleCheckbox.bind(this),
    };

    const handler =
      inputHandlers[fieldData.type] || this.handleTextInput.bind(this);
    return await handler(element, value, fieldData);
  }

  async handleTextInput(element, value, fieldData) {
    try {
      // Clear existing value
      await element.evaluate((el) => (el.value = ""));

      // Type value with human-like delays
      for (const char of value) {
        await element.type(char, {
          delay: Math.random() * (150 - 50) + 50,
        });

        // Random pauses for more human-like typing
        if (Math.random() < 0.1) {
          await this.sleep(Math.random() * (500 - 200) + 200);
        }
      }

      // Trigger necessary events
      await element.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      });

      return true;
    } catch (error) {
      console.error(`Failed to fill text input: ${error.message}`);
      return false;
    }
  }

  async handleSelect(element, value, fieldData) {
    try {
      // Check for custom select implementations
      const isCustomSelect = await element.evaluate((el) => {
        return (
          el.classList.contains("select2") ||
          el.classList.contains("react-select") ||
          el.getAttribute("role") === "combobox"
        );
      });

      if (isCustomSelect) {
        return await this.handleCustomSelect(element, value, fieldData);
      }

      // Handle native select
      const success = await element.evaluate((el, val) => {
        const options = Array.from(el.options);
        const option = options.find(
          (opt) =>
            opt.value.toLowerCase() === val.toLowerCase() ||
            opt.text.toLowerCase().includes(val.toLowerCase())
        );

        if (option) {
          el.value = option.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      }, value);

      return success;
    } catch (error) {
      console.error(`Failed to handle select: ${error.message}`);
      return false;
    }
  }

  async handleCustomSelect(element, value, fieldData) {
    try {
      // Click to open dropdown
      await this.safeClick(element, { waitForNavigation: false });
      await this.sleep(500);

      // Type into search input if available
      const searchInput = await this.page.$(
        '[class*="select-search__input"], [class*="select2-search__field"]'
      );
      if (searchInput) {
        await this.handleTextInput(searchInput, value);
        await this.sleep(1000);
      }

      // Find and click matching option
      const optionSelected = await this.page.evaluate((searchValue) => {
        const options = Array.from(
          document.querySelectorAll(
            '[class*="select-option"], [class*="select2-result"]'
          )
        );
        const option = options.find((opt) =>
          opt.textContent.toLowerCase().includes(searchValue.toLowerCase())
        );

        if (option) {
          option.click();
          return true;
        }
        return false;
      }, value);

      return optionSelected;
    } catch (error) {
      console.error(`Failed to handle custom select: ${error.message}`);
      return false;
    }
  }

  async handleRadio(element, value, fieldData) {
    try {
      const radioGroup = await this.page.$$(`input[name="${fieldData.name}"]`);

      for (const radio of radioGroup) {
        const matchesValue = await radio.evaluate((el, val) => {
          const radioValue = el.value.toLowerCase();
          const labelText = el.labels?.[0]?.textContent.toLowerCase() || "";
          return (
            radioValue === val.toLowerCase() ||
            labelText.includes(val.toLowerCase())
          );
        }, value);

        if (matchesValue) {
          await this.safeClick(radio, { waitForNavigation: false });
          return true;
        }
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

      const isChecked = await element.evaluate((el) => el.checked);
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

      const response = await fetch(fileUrl);
      if (!response.ok)
        throw new Error(`Failed to fetch file: ${response.statusText}`);

      const buffer = await response.arrayBuffer();
      const fileInput = await this.page.$(`input[name="${fieldData.name}"]`);

      if (!fileInput) return false;

      // Make file input visible and interactive
      await this.page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if (input) {
          input.style.opacity = "1";
          input.style.display = "block";
          input.style.visibility = "visible";
        }
      }, `input[name="${fieldData.name}"]`);

      await fileInput.uploadData(buffer, {
        name: `${fieldData.purpose}.pdf`,
        mimeType: "application/pdf",
      });

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
    for (const selector of SELECTORS.ACTION_BUTTONS) {
      const elements = await this.page.$$(selector);

      for (const element of elements) {
        const visible = await this.isElementVisible(element);
        if (!visible) continue;

        const text = await element.evaluate((el) =>
          el.textContent.toLowerCase()
        );
        if (text.match(/next|continue|submit|save|proceed|review/)) {
          return element;
        }
      }
    }
    return null;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ExternalJobAutomation;