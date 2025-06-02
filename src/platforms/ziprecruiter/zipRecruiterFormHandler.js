import { HOST } from "../../shared/constants";

/**
 * Enhanced form handler for ZipRecruiter job applications
 * Based on best practices from FormHandler class with improved question & option extraction
 */
class ZipRecruiterFormHandler {
  /**
   * Initialize the form handler with necessary configuration
   * @param {Object} config Configuration options
   */
  constructor(config = {}) {
    this.logger = config.logger || console.log;
    this.userData = config.userData || {};
    this.jobDescription = config.jobDescription || "";

    // Setup selectors
    this.selectors = {
      // Form elements
      INPUTS:
        'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="password"]',
      SELECTS: "select",
      TEXTAREAS: "textarea",
      RADIO_INPUTS: 'input[type="radio"]',
      CHECKBOX_INPUTS: 'input[type="checkbox"]',

      // Modal elements
      MODAL_CONTAINER: ".ApplyFlowApp",
      MODAL_HEADER: ".ApplyingToHeader",
      MODAL_QUESTIONS: ".question_form fieldset",
      MODAL_SELECT: "[role='combobox']",
      MODAL_SELECT_OPTIONS: "[role='listbox'] li",

      // Buttons
      CONTINUE_BUTTON: "button[type='submit']",
      SUBMIT_BUTTON: "button[type='submit']",
      ACTION_BUTTONS:
        'button[type="submit"], button[class*="submit"], button[class*="continue"], button[class*="next"], button[class*="apply"]',
    };

    // Setup timeout values
    this.timeouts = {
      SHORT: 500,
      STANDARD: 2000,
      EXTENDED: 5000,
    };

    // Answer cache to prevent redundant API calls
    this.answerCache = new Map();

    // Track processed elements to prevent redundant processing
    this.processedElements = new Set();

    // File handler for resume uploads
    this.fileHandler = config.fileHandler;
  }

  /**
   * Handle the complete form filling process
   * @returns {Promise<boolean>} Success or failure
   */
  async fillCompleteForm() {
    try {
      this.logger("Starting form filling process");

      // Wait for form to be fully loaded
      await this.sleep(this.timeouts.STANDARD);

      // Process all form steps
      let isComplete = false;
      let maxSteps = 10;
      let currentStep = 0;

      while (!isComplete && currentStep < maxSteps) {
        currentStep++;
        this.logger(`Processing form step ${currentStep}`);

        // Find the form container
        const formContainer =
          document.querySelector(this.selectors.MODAL_CONTAINER) ||
          document.querySelector("form") ||
          document.body;

        if (!formContainer) {
          throw new Error("No form container found after waiting");
        }

        // Fill all visible form elements in this step
        await this.fillFormStep(formContainer);

        // Find and click continue/submit button
        const actionButton = this.findActionButton();
        if (!actionButton) {
          this.logger("No action button found, checking if modal closed");
          // Check if modal is still visible - if not, we're done!
          if (
            !document.querySelector(this.selectors.MODAL_CONTAINER) ||
            !this.isElementVisible(
              document.querySelector(this.selectors.MODAL_CONTAINER)
            )
          ) {
            this.logger(
              "Modal no longer visible, assuming application complete"
            );
            isComplete = true;
            return true;
          } else {
            throw new Error("No action button found and modal still open");
          }
        }

        formContainer.addEventListener(
          "submit",
          function (e) {
            e.preventDefault();
            console.log("Form submission prevented - handling via JavaScript");
          },
          true
        );

        // Click the button
        this.logger(`Clicking ${actionButton.textContent.trim()} button`);
        actionButton.click();

        // Wait for next page to load or for modal to close
        await this.sleep(this.timeouts.STANDARD);

        // Check if modal closed after button click
        if (
          !document.querySelector(this.selectors.MODAL_CONTAINER) ||
          !this.isElementVisible(
            document.querySelector(this.selectors.MODAL_CONTAINER)
          )
        ) {
          this.logger("Modal closed after button click, application completed");
          isComplete = true;
          return true;
        }
      }

      // Final success check
      await this.sleep(this.timeouts.STANDARD);

      // One last check if the modal closed
      return (
        !document.querySelector(this.selectors.MODAL_CONTAINER) ||
        !this.isElementVisible(
          document.querySelector(this.selectors.MODAL_CONTAINER)
        )
      );
    } catch (error) {
      this.logger(`Error filling form: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill all form elements in the current step
   * @param {HTMLElement} container The form container
   * @returns {Promise<boolean>} Success or failure
   */
  async fillFormStep(container) {
    try {
      // Track if we found any visible fields
      let hasVisibleFields = false;

      // Try direct form element detection first for the initial application page (name, email, etc.)
      const directInputs = container.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"]'
      );
      const fileUploads = container.querySelectorAll(
        '.ApplyResumeUpload input[type="file"]'
      );

      // If we find a file upload input for resume, handle that first
      if (fileUploads.length > 0) {
        this.logger(
          "Found resume upload field on initial form, handling it first"
        );
        for (const fileInput of fileUploads) {
          if (fileInput.name === "resume" || fileInput.id === "resume") {
            await this.uploadFileWithDataTransfer(
              fileInput,
              this.userData.resumeUrl
            );
          }
        }
      }

      // Handle direct inputs like name, email, phone that appear on the first page
      if (directInputs.length > 0) {
        this.logger(`Found ${directInputs.length} direct input fields`);
        hasVisibleFields = true;

        for (const input of directInputs) {
          if (
            !this.isElementVisible(input) ||
            this.processedElements.has(input)
          ) {
            continue;
          }

          // Mark as processed
          this.processedElements.add(input);

          // Get label
          const labelText = this.getElementLabel(input);
          if (!labelText) continue;

          this.logger(`Processing direct input: ${labelText}`);

          // Handle different input types based on name or label
          const name = input.name?.toLowerCase() || "";
          const lowerLabel = labelText.toLowerCase();

          if (name.includes("first") || lowerLabel.includes("first")) {
            await this.setElementValue(
              input,
              this.userData.firstName || "John"
            );
          } else if (name.includes("last") || lowerLabel.includes("last")) {
            await this.setElementValue(input, this.userData.lastName || "Doe");
          } else if (name.includes("phone") || lowerLabel.includes("phone")) {
            await this.setElementValue(
              input,
              this.userData.phone || "1234567890"
            );
          } else if (name.includes("email") || lowerLabel.includes("email")) {
            await this.setElementValue(
              input,
              this.userData.email || "user@example.com"
            );
          } else if (
            name.includes("location") ||
            lowerLabel.includes("location") ||
            lowerLabel.includes("postal") ||
            lowerLabel.includes("city") ||
            lowerLabel.includes("zip")
          ) {
            await this.setElementValue(
              input,
              this.userData.location || this.userData.zip || "10001"
            );
          } else {
            // General text input
            await this.handleInputElement(input, labelText);
          }
        }
      }

      // Now process the structured question fieldsets - these appear on question screens
      const questionFields = container.querySelectorAll(
        this.selectors.MODAL_QUESTIONS
      );
      if (questionFields.length > 0) {
        this.logger(
          `Found ${questionFields.length} structured question fields`
        );

        for (const field of questionFields) {
          if (
            !this.isElementVisible(field) ||
            this.processedElements.has(field)
          ) {
            continue;
          }

          hasVisibleFields = true;

          // Mark as processed
          this.processedElements.add(field);

          // Get the question label
          const labelElement = field.querySelector("label");
          if (!labelElement) continue;

          const questionText = labelElement.textContent.trim();
          this.logger(`Processing question: ${questionText}`);

          // Process the question based on its type
          await this.processFieldsetQuestion(field, questionText);
        }
      }

      // Handle any required checkboxes as a final pass - especially consent checkboxes at bottom
      await this.handleRequiredCheckboxes(container);

      return hasVisibleFields;
    } catch (error) {
      this.logger(`Error filling form step: ${error.message}`);
      return false;
    }
  }

  /**
   * Process individual form elements that aren't in fieldsets
   * @param {HTMLElement} container The form container
   */
  async processIndividualFormElements(container) {
    // Define element types to process
    const elementTypes = [
      {
        selector: this.selectors.SELECTS,
        handler: this.handleSelectElement.bind(this),
      },
      {
        selector: this.selectors.INPUTS,
        handler: this.handleInputElement.bind(this),
      },
      {
        selector: this.selectors.TEXTAREAS,
        handler: this.handleTextAreaElement.bind(this),
      },
      {
        selector: this.selectors.RADIO_INPUTS,
        handler: this.handleRadioElement.bind(this),
      },
      {
        selector: this.selectors.CHECKBOX_INPUTS,
        handler: this.handleCheckboxElement.bind(this),
      },
    ];

    // Process each element type
    for (const { selector, handler } of elementTypes) {
      const elements = container.querySelectorAll(selector);

      for (const element of elements) {
        // Skip if not visible, is hidden, or already processed
        if (
          element.type === "hidden" ||
          !this.isElementVisible(element) ||
          this.processedElements.has(element) ||
          element.closest(this.selectors.MODAL_QUESTIONS)
        ) {
          // Skip if inside already processed fieldset
          continue;
        }

        // Mark as processed to avoid redundant processing
        this.processedElements.add(element);

        // Get label and process the element
        const labelText = this.getElementLabel(element);
        if (labelText) {
          await handler(element, labelText);
        }
      }
    }
  }

  /**
   * Process a fieldset question
   * @param {HTMLElement} fieldset The fieldset element
   * @param {string} questionText The question text
   */
  async processFieldsetQuestion(fieldset, questionText) {
    try {
      // First check if this is a resume upload field
      if (this.isResumeUploadField(fieldset)) {
        this.logger("Detected resume upload field, handling it first");
        await this.handleResumeUpload(fieldset);
        return;
      }

      // This pattern matches the examples provided - these have role="combobox"
      const combobox = fieldset.querySelector('[role="combobox"]');
      if (combobox) {
        await this.handleZipRecruiterDropdown(combobox, questionText);
        return;
      }

      // Check for textarea (commonly follows dropdown questions)
      const textarea = fieldset.querySelector("textarea");
      if (textarea) {
        await this.handleTextInput(textarea, questionText);
        return;
      }

      // Check for radio buttons
      const radioButtons = fieldset.querySelectorAll(
        this.selectors.RADIO_INPUTS
      );
      if (radioButtons.length > 0) {
        await this.handleRadioGroup(radioButtons, questionText);
        return;
      }

      // Check for checkboxes
      const checkboxes = fieldset.querySelectorAll(
        this.selectors.CHECKBOX_INPUTS
      );
      if (checkboxes.length > 0) {
        await this.handleCheckboxGroup(checkboxes, questionText);
        return;
      }

      // Check for text input
      const textInput = fieldset.querySelector(this.selectors.INPUTS);
      if (textInput) {
        await this.handleTextInput(textInput, questionText);
        return;
      }

      // If no specific input found, try to find any input element
      const anyInput = fieldset.querySelector("input, select, textarea");
      if (anyInput) {
        const handler = this.getHandlerForElement(anyInput);
        if (handler) {
          await handler(anyInput, questionText);
        }
      }
    } catch (error) {
      this.logger(`Error processing fieldset question: ${error.message}`);
    }
  }

  /**
   * Get the appropriate handler function for an element
   * @param {HTMLElement} element The element to get a handler for
   * @returns {Function} The handler function
   */
  getHandlerForElement(element) {
    if (!element) return null;

    const tagName = element.tagName.toLowerCase();
    const type = element.type?.toLowerCase();

    if (tagName === "select") {
      return this.handleSelectElement.bind(this);
    } else if (tagName === "textarea") {
      return this.handleTextAreaElement.bind(this);
    } else if (tagName === "input") {
      if (type === "radio") {
        return this.handleRadioElement.bind(this);
      } else if (type === "checkbox") {
        return this.handleCheckboxElement.bind(this);
      } else {
        return this.handleInputElement.bind(this);
      }
    }

    return null;
  }

  /**
   * Handle ZipRecruiter's custom dropdown - Always use API for answers
   * @param {HTMLElement} combobox The combobox element
   * @param {string} questionText The question text
   */
  async handleZipRecruiterDropdown(combobox, questionText) {
    try {
      this.logger(`Handling ZipRecruiter dropdown for: ${questionText}`);

      // Get the menu ID from aria-controls attribute
      const menuId = combobox.getAttribute("aria-controls");
      let menuElement = null;

      if (menuId) {
        menuElement = document.getElementById(menuId);
      }

      // Click to open the dropdown
      combobox.click();
      await this.sleep(500);

      // Extract all available options from the dropdown
      let availableOptions = [];

      // If the menu is visible after clicking, extract actual options
      if (menuElement && menuElement.style.visibility !== "hidden") {
        const optionElements = menuElement.querySelectorAll("li");
        if (optionElements.length > 0) {
          availableOptions = Array.from(optionElements)
            .filter((opt) => this.isElementVisible(opt))
            .map((opt) => opt.textContent.trim());

          this.logger(`Found ${availableOptions.length} options in dropdown`);
        }
      }

      // ALWAYS get answer from API - no local decision making
      const selectedValue = await this.getValueForField(
        questionText,
        availableOptions
      );

      // If the menu is now visible after clicking
      if (menuElement && menuElement.style.visibility !== "hidden") {
        // Find all option elements
        const options = menuElement.querySelectorAll("li");

        if (options.length > 0) {
          // Find matching option
          let optionToSelect = Array.from(options).find(
            (opt) =>
              opt.textContent.trim().toLowerCase() ===
              selectedValue.toLowerCase()
          );

          // If no exact match, try partial match
          if (!optionToSelect) {
            optionToSelect = Array.from(options).find(
              (opt) =>
                opt.textContent
                  .trim()
                  .toLowerCase()
                  .includes(selectedValue.toLowerCase()) ||
                selectedValue
                  .toLowerCase()
                  .includes(opt.textContent.trim().toLowerCase())
            );
          }

          // If still no match, select first option
          if (!optionToSelect && options.length > 0) {
            optionToSelect = options[0];
          }

          // Click the selected option
          if (optionToSelect) {
            this.logger(
              `Selecting option: ${optionToSelect.textContent.trim()}`
            );
            optionToSelect.click();
            await this.sleep(300);
            return;
          }
        }
      }

      // Fallback: Try to set value directly on combobox if we couldn't find/click options
      if (combobox.tagName === "INPUT") {
        combobox.value = selectedValue;
        combobox.dispatchEvent(new Event("input", { bubbles: true }));
        combobox.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (combobox.querySelector("input")) {
        const input = combobox.querySelector("input");
        input.value = selectedValue;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        // Try setting a text span if present
        const textSpan = combobox.querySelector("span.text-secondary");
        if (textSpan) {
          textSpan.textContent = selectedValue;
        }
      }

      await this.sleep(500);
    } catch (error) {
      this.logger(`Error handling dropdown: ${error.message}`);
    }
  }

  /**
   * Handle radio button group
   * @param {NodeList} radioButtons The radio buttons
   * @param {string} questionText The question text
   */
  async handleRadioGroup(radioButtons, questionText) {
    try {
      this.logger(`Handling radio group for: ${questionText}`);

      // Only get options from this specific radio group
      const options = Array.from(radioButtons)
        .map((radio) => {
          return {
            element: radio,
            label: this.getRadioLabel(radio),
          };
        })
        .filter((opt) => opt.label);

      // Extract option texts for AI
      const optionTexts = options.map((opt) => opt.label);

      // Get value based on question
      const selectedValue = await this.getValueForField(
        questionText,
        optionTexts
      );

      // Find matching option
      let optionToSelect = null;

      // Try exact match first
      optionToSelect = options.find(
        (opt) => opt.label.toLowerCase() === selectedValue.toLowerCase()
      );

      // If no exact match, try partial match
      if (!optionToSelect) {
        optionToSelect = options.find(
          (opt) =>
            opt.label.toLowerCase().includes(selectedValue.toLowerCase()) ||
            selectedValue.toLowerCase().includes(opt.label.toLowerCase())
        );
      }

      // If still no match, select first option
      if (!optionToSelect && options.length > 0) {
        optionToSelect = options[0];
      }

      // Click the selected option
      if (optionToSelect) {
        this.logger(`Selecting radio option: ${optionToSelect.label}`);
        optionToSelect.element.click();
      }

      await this.sleep(500);
    } catch (error) {
      this.logger(`Error handling radio group: ${error.message}`);
    }
  }

  /**
   * Handle checkbox group
   * @param {NodeList} checkboxes The checkboxes
   * @param {string} questionText The question text
   */
  async handleCheckboxGroup(checkboxes, questionText) {
    try {
      this.logger(`Handling checkbox group for: ${questionText}`);

      // If this appears to be a terms & conditions or agreement checkbox
      if (this.isAgreementQuestion(questionText)) {
        for (const checkbox of checkboxes) {
          if (!checkbox.checked) {
            checkbox.click();
            await this.sleep(200);
          }
        }
        return;
      }

      // For multi-option checkbox questions, handle each checkbox individually
      for (const checkbox of checkboxes) {
        // Get the label for this specific checkbox
        const checkboxLabel = this.getElementLabel(checkbox);
        if (!checkboxLabel) continue;

        // Combine the question text and checkbox label to form a proper question
        const fullQuestion = `For the question "${questionText}", should the option "${checkboxLabel}" be selected?`;

        // Get answer from AI
        const shouldCheck =
          (await this.getValueForField(fullQuestion, ["Yes", "No"])) === "Yes";

        // Set the checkbox state
        if (shouldCheck !== checkbox.checked) {
          checkbox.click();
          await this.sleep(200);
        }
      }
    } catch (error) {
      this.logger(`Error handling checkbox group: ${error.message}`);
    }
  }

  /**
   * Check if a question is about agreeing to terms & conditions
   * @param {string} questionText The question text
   * @returns {boolean} True if it's an agreement question
   */
  isAgreementQuestion(questionText) {
    const lowerText = questionText.toLowerCase();
    const agreementKeywords = [
      "agree",
      "consent",
      "terms",
      "conditions",
      "privacy",
      "policy",
      "accept",
      "agreement",
      "authorize",
      "permission",
    ];

    return agreementKeywords.some((keyword) => lowerText.includes(keyword));
  }

  /**
   * Handle text input
   * @param {HTMLElement} inputElement The input element
   * @param {string} questionText The question text
   */
  async handleTextInput(inputElement, questionText) {
    try {
      this.logger(`Handling text input for: ${questionText}`);

      // Check if this is a conditional follow-up question that should be skipped
      const lowerQuestion = questionText.toLowerCase();
      if (
        (lowerQuestion.includes("if yes") || lowerQuestion.includes("if so")) &&
        inputElement.tagName.toLowerCase() === "textarea"
      ) {
        // For these conditional fields, check if they're optional
        const isOptional = inputElement
          .closest("div")
          ?.querySelector('[id$="-helper"]')
          ?.textContent.includes("Optional");

        if (isOptional) {
          const value = await this.getValueForField(questionText, []);

          await this.setElementValue(inputElement, value);
          return;
        }
      }

      // Get appropriate value for this question
      const value = await this.getValueForField(questionText, []);

      // Apply value to input (simplified to avoid redundant events)
      await this.setElementValue(inputElement, value);
    } catch (error) {
      this.logger(`Error handling text input: ${error.message}`);
    }
  }

  /**
   * Handle select element
   * @param {HTMLElement} element The select element
   * @param {string} labelText The label text
   */
  async handleSelectElement(element, labelText) {
    try {
      this.logger(`Handling select element: ${labelText}`);

      if (!element.options || element.options.length === 0) {
        return;
      }

      // Get only the options from this specific select element
      const options = Array.from(element.options)
        .filter(
          (opt) =>
            opt.value &&
            !["", "select", "select an option"].includes(
              opt.value.toLowerCase()
            )
        )
        .map((opt) => opt.text.trim());

      // Get answer from AI
      const selectedValue = await this.getValueForField(labelText, options);

      // Find the matching option
      let foundOption = false;

      // Try to find an exact match first
      for (const option of element.options) {
        if (option.text.trim().toLowerCase() === selectedValue.toLowerCase()) {
          element.value = option.value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          this.logger(`Selected option: ${option.text.trim()}`);
          foundOption = true;
          break;
        }
      }

      // If no exact match, try partial match
      if (!foundOption) {
        for (const option of element.options) {
          if (
            option.text
              .trim()
              .toLowerCase()
              .includes(selectedValue.toLowerCase()) ||
            selectedValue
              .toLowerCase()
              .includes(option.text.trim().toLowerCase())
          ) {
            element.value = option.value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            this.logger(
              `Selected option (partial match): ${option.text.trim()}`
            );
            foundOption = true;
            break;
          }
        }
      }

      // If still no match, select first valid option
      if (!foundOption && element.options.length > 0) {
        // Skip the first option if it's empty or looks like a placeholder
        let startIndex = 0;
        if (
          element.options[0].value === "" ||
          element.options[0].text.toLowerCase().includes("select")
        ) {
          startIndex = 1;
        }

        if (element.options.length > startIndex) {
          element.value = element.options[startIndex].value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          this.logger(
            `Selected default option: ${element.options[
              startIndex
            ].text.trim()}`
          );
        }
      }
    } catch (error) {
      this.logger(`Error handling select element: ${error.message}`);
    }
  }

  /**
   * Handle input element
   * @param {HTMLElement} element The input element
   * @param {string} labelText The label text
   */
  async handleInputElement(element, labelText) {
    try {
      this.logger(`Handling input element: ${labelText} (${element.type})`);

      if (element.readOnly || element.disabled) {
        return;
      }

      // Handle special input types
      if (element.type === "tel" && element.closest(".PhoneInput")) {
        await this.handlePhoneInput(element, labelText);
        return;
      }

      // For regular text inputs
      const value = await this.getValueForField(labelText, []);
      await this.setElementValue(element, value);
    } catch (error) {
      this.logger(`Error handling input element: ${error.message}`);
    }
  }

  /**
   * Handle textarea element
   * @param {HTMLElement} element The textarea element
   * @param {string} labelText The label text
   */
  async handleTextAreaElement(element, labelText) {
    try {
      this.logger(`Handling textarea element: ${labelText}`);

      const value = await this.getValueForField(labelText, []);
      await this.setElementValue(element, value);
    } catch (error) {
      this.logger(`Error handling textarea element: ${error.message}`);
    }
  }

  /**
   * Handle radio element
   * @param {HTMLElement} element The radio element
   * @param {string} labelText The label text
   */
  async handleRadioElement(element, labelText) {
    try {
      this.logger(`Handling radio element: ${labelText}`);

      // Get all radio buttons in this group (same name)
      const radioGroup = document.querySelectorAll(
        `input[type="radio"][name="${element.name}"]`
      );

      // Group is already processed, skip
      if (
        radioGroup.length === 0 ||
        Array.from(radioGroup).some((radio) =>
          this.processedElements.has(radio)
        )
      ) {
        return;
      }

      // Mark all radios in this group as processed
      radioGroup.forEach((radio) => this.processedElements.add(radio));

      // Extract options from only this radio group
      const options = Array.from(radioGroup)
        .map((radio) => {
          return {
            element: radio,
            label: this.getRadioLabel(radio),
          };
        })
        .filter((opt) => opt.label);

      const optionTexts = options.map((opt) => opt.label);

      // Get value from AI
      const selectedValue = await this.getValueForField(labelText, optionTexts);

      // Find and select the matching option
      let optionToSelect = options.find(
        (opt) =>
          opt.label.toLowerCase() === selectedValue.toLowerCase() ||
          opt.label.toLowerCase().includes(selectedValue.toLowerCase()) ||
          selectedValue.toLowerCase().includes(opt.label.toLowerCase())
      );

      if (optionToSelect) {
        this.logger(`Selecting radio option: ${optionToSelect.label}`);
        optionToSelect.element.click();
      } else if (options.length > 0) {
        // Default to first option if no match
        this.logger(`Selecting default radio option: ${options[0].label}`);
        options[0].element.click();
      }
    } catch (error) {
      this.logger(`Error handling radio element: ${error.message}`);
    }
  }

  /**
   * Handle checkbox element
   * @param {HTMLElement} element The checkbox element
   * @param {string} labelText The label text
   */
  async handleCheckboxElement(element, labelText) {
    try {
      this.logger(`Handling checkbox element: ${labelText}`);

      // For agreement/consent checkboxes or required checkboxes, just check them
      if (
        this.isAgreementQuestion(labelText) ||
        element.hasAttribute("required") ||
        element.getAttribute("aria-required") === "true"
      ) {
        if (!element.checked) {
          element.click();
        }
        return;
      }

      // For regular checkboxes, ask the AI
      const shouldCheck =
        (await this.getValueForField(labelText, ["Yes", "No"])) === "Yes";

      if (shouldCheck !== element.checked) {
        element.click();
      }
    } catch (error) {
      this.logger(`Error handling checkbox element: ${error.message}`);
    }
  }

  /**
   * More efficiently set value on an element
   * @param {HTMLElement} element The element
   * @param {string} value The value to set
   */
  async setElementValue(element, value) {
    try {
      // Focus on the element
      element.focus();

      // For most elements, just set the value directly
      element.value = value;

      // Dispatch only the necessary events
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      // Blur to trigger any validation
      element.blur();

      this.logger(`Set value: "${value}" for input`);
    } catch (error) {
      this.logger(`Error setting element value: ${error.message}`);
    }
  }

  /**
   * Handle phone input element with country code
   * @param {HTMLElement} element The phone input
   * @param {string} labelText The label text
   */
  async handlePhoneInput(element, labelText) {
    try {
      this.logger(`Handling phone input: ${labelText}`);

      const value = await this.getValueForField(labelText, []);

      // Find the country select element
      const countrySelect = element
        .closest(".PhoneInput")
        ?.querySelector("select");
      if (!countrySelect) {
        // No country selector, just set phone directly
        await this.setElementValue(element, value);
        return;
      }

      // Parse phone number to extract country code and number
      const normalizedValue = value.replace(/[^\d+]/g, "");
      let countryCode = normalizedValue.match(/^\+?(\d{1,3})/)?.[1];
      let phoneNumber = normalizedValue.replace(/^\+?\d{1,3}/, "").trim();

      // Find matching country option
      const options = Array.from(countrySelect.options);
      const countryOption = options.find((opt) =>
        opt.text.includes(`(+${countryCode})`)
      );

      if (countryOption) {
        // Select country
        countrySelect.focus();
        countrySelect.value = countryOption.value;
        countrySelect.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Input phone number
      await this.setElementValue(element, phoneNumber);
    } catch (error) {
      this.logger(`Error handling phone input: ${error.message}`);
      // Fallback to direct input
      const value = await this.getValueForField(labelText, []);
      await this.setElementValue(element, value);
    }
  }

  /**
   * Handle all required checkboxes on the form
   * @param {HTMLElement} container The form container
   */
  async handleRequiredCheckboxes(container) {
    try {
      // First check for the specific consent checkbox pattern from the example
      const consentCheckboxes = container.querySelectorAll(
        'fieldset input[type="checkbox"].peer, input.pointer-event-auto.peer'
      );

      if (consentCheckboxes.length > 0) {
        this.logger(
          `Found ${consentCheckboxes.length} consent checkboxes with ZipRecruiter-specific pattern`
        );

        for (const checkbox of consentCheckboxes) {
          if (!checkbox.checked) {
            this.logger("Checking consent checkbox");
            checkbox.click();
            await this.sleep(200);
          }
        }
      }

      // Now find all other checkbox inputs
      const checkboxes = Array.from(
        container.querySelectorAll('input[type="checkbox"]')
      );

      for (const checkbox of checkboxes) {
        // Skip if not visible or already processed
        if (
          !this.isElementVisible(checkbox) ||
          this.processedElements.has(checkbox)
        )
          continue;

        // Mark as processed
        this.processedElements.add(checkbox);

        // Check if this is a consent/agreement checkbox
        const parentText =
          checkbox.parentElement?.textContent?.toLowerCase() || "";
        const isConsent =
          parentText.includes("consent") ||
          parentText.includes("agree") ||
          parentText.includes("terms") ||
          parentText.includes("privacy");

        // Check if this is required
        const isRequired =
          checkbox.hasAttribute("required") ||
          checkbox.hasAttribute("aria-required") ||
          checkbox.closest('[aria-required="true"]') ||
          checkbox.closest(".required") ||
          isConsent;

        if (isRequired && !checkbox.checked) {
          this.logger("Checking required/consent checkbox");
          checkbox.click();
          await this.sleep(200);
        }
      }

      // Check if there's a disabled continue button that might need checkbox checking
      const disabledContinueButton = container.querySelector(
        'button[type="submit"][disabled]'
      );
      if (disabledContinueButton) {
        const remainingCheckboxes = Array.from(
          container.querySelectorAll('input[type="checkbox"]:not(:checked)')
        );
        for (const checkbox of remainingCheckboxes) {
          if (this.isElementVisible(checkbox)) {
            this.logger("Checking additional checkbox to enable submit button");
            checkbox.click();
            await this.sleep(200);
          }
        }
      }
    } catch (error) {
      this.logger(`Error handling required checkboxes: ${error.message}`);
    }
  }

  /**
   * Get the label text for a form element
   * @param {HTMLElement} element The form element
   * @returns {string} The label text
   */
  getElementLabel(element) {
    // Try to get label from associated label element
    if (element.id) {
      const labelElement = document.querySelector(`label[for="${element.id}"]`);
      if (labelElement) {
        return labelElement.textContent.trim();
      }
    }

    // Try to get label from parent label element
    const parentLabel = element.closest("label");
    if (parentLabel) {
      // Get text content excluding nested input texts
      const labelText = Array.from(parentLabel.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();

      if (labelText) {
        return labelText;
      }
    }

    // For radio buttons, try to find the fieldset legend
    if (element.type === "radio") {
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend");
      if (legend) {
        return legend.textContent.trim();
      }
    }

    // Try to get from parent fieldset's label/span
    const parentFieldset = element.closest("fieldset");
    if (parentFieldset) {
      const fieldsetLabel = parentFieldset.querySelector(
        "label, span.text-primary"
      );
      if (fieldsetLabel) {
        return fieldsetLabel.textContent.trim();
      }
    }

    // Try to get label from aria-label
    if (element.getAttribute("aria-label")) {
      return element.getAttribute("aria-label").trim();
    }

    // Try to get label from placeholder
    if (element.placeholder) {
      return element.placeholder.trim();
    }

    // Try to find a label-like element near the input
    const parent = element.parentElement;
    if (parent) {
      const possibleLabels = parent.querySelectorAll(
        "label, div.label, span.label, .form-label"
      );
      for (const label of possibleLabels) {
        if (label.textContent.trim()) {
          return label.textContent.trim();
        }
      }

      // Look for previous siblings with text
      let sibling = element.previousElementSibling;
      while (sibling) {
        if (
          sibling.textContent.trim() &&
          !sibling.querySelector("input, select, textarea")
        ) {
          return sibling.textContent.trim();
        }
        sibling = sibling.previousElementSibling;
      }
    }

    // If no label found, return the name attribute or empty string
    return element.name || "";
  }

  /**
   * Get the label text for a radio button
   * @param {HTMLElement} radioButton The radio button
   * @returns {string} The label text
   */
  getRadioLabel(radioButton) {
    // Try to find label by for attribute
    if (radioButton.id) {
      const label = document.querySelector(`label[for="${radioButton.id}"]`);
      if (label) {
        return label.textContent.trim();
      }
    }

    // Try to find parent label
    const parentLabel = radioButton.closest("label");
    if (parentLabel) {
      // Extract text excluding the button's own value
      const labelText = Array.from(parentLabel.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();

      if (labelText) {
        return labelText;
      }

      // If no text nodes found, use the full text
      return parentLabel.textContent.trim();
    }

    // Try to find sibling or nearby text
    const nextSibling = radioButton.nextElementSibling;
    if (nextSibling && nextSibling.tagName !== "INPUT") {
      return nextSibling.textContent.trim();
    }

    // Try the radio container
    const radioContainer = radioButton.parentElement;
    if (radioContainer) {
      // Check for text nodes or spans
      const containerText = Array.from(radioContainer.childNodes)
        .filter(
          (node) =>
            node.nodeType === Node.TEXT_NODE ||
            (node.nodeType === Node.ELEMENT_NODE &&
              node.tagName.toLowerCase() === "span")
        )
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();

      if (containerText) {
        return containerText;
      }
    }

    return radioButton.value || "Unknown";
  }

  /**
   * Get a value for a form field based on label text
   * Enhanced with AI answer service and caching
   * @param {string} labelText The label text
   * @param {string[]} options Available options
   * @returns {Promise<string>} The value to use
   */
  async getValueForField(labelText, options = []) {
    try {
      const data = {
        question: labelText,
        options: options,
        userData: this.userData || {},
        description: this.jobDescription || "",
      };

      const response = await fetch(`${HOST}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`AI service returned ${response.status}`);
      }

      const result = await response.json();

      if (result.answer) {
        this.logger(`AI generated answer for "${labelText}": ${result.answer}`);
      }
    } catch (aiError) {
      this.logger(`AI service error: ${aiError.message}`);
    }
  }

  /**
   * Find the submit/continue button on the current form
   * @returns {HTMLElement} The button element
   */
  findActionButton() {
    // Look for buttons with clear action text
    const buttonTexts = ["submit", "continue", "next", "apply", "review"];

    for (const text of buttonTexts) {
      const button = this.findButtonByText(text);
      if (button && this.isElementVisible(button)) {
        return button;
      }
    }

    // Look for buttons with standard selectors
    const actionButton =
      document.querySelector(this.selectors.SUBMIT_BUTTON) ||
      document.querySelector(this.selectors.CONTINUE_BUTTON) ||
      document.querySelector(this.selectors.ACTION_BUTTONS);

    if (actionButton && this.isElementVisible(actionButton)) {
      return actionButton;
    }

    return null;
  }

  /**
   * Find any visible button as a last resort
   * @returns {HTMLElement} The button element
   */
  findAnyButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const button of buttons) {
      if (this.isElementVisible(button)) {
        return button;
      }
    }
    return null;
  }

  /**
   * Find a button by its text content
   * @param {string} text The text to search for
   * @returns {HTMLElement} The button element
   */
  findButtonByText(text) {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find(
      (button) =>
        button.textContent &&
        button.textContent.trim().toLowerCase().includes(text.toLowerCase()) &&
        this.isElementVisible(button)
    );
  }

  /**
   * Check if an element is visible
   * @param {HTMLElement} element The element to check
   * @returns {boolean} True if visible
   */
  isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.height > 0 &&
        rect.width > 0
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if the fieldset contains a resume upload field
   * @param {HTMLElement} fieldset - The fieldset element
   * @returns {boolean} True if it's a resume upload field
   */
  isResumeUploadField(fieldset) {
    // Look for various indicators that this is a resume upload field

    // 1. Check for file input with resume-related attributes
    const fileInput = fieldset.querySelector('input[type="file"]');
    if (!fileInput) return false;

    // 2. Check if the input name/id contains resume-related terms
    const inputAttrs = [
      fileInput.name,
      fileInput.id,
      fileInput.getAttribute("name"),
      fileInput.getAttribute("accept"),
    ];

    if (
      inputAttrs.some(
        (attr) =>
          attr &&
          (attr.toLowerCase().includes("resume") ||
            attr.toLowerCase().includes("cv") ||
            attr.includes(".pdf") ||
            attr.includes(".doc"))
      )
    ) {
      return true;
    }

    // 3. Check for resume-related text in the fieldset
    const fieldsetText = fieldset.textContent.toLowerCase();
    const resumeKeywords = [
      "resume",
      "cv",
      "upload",
      "attach",
      "curriculum vitae",
    ];
    if (resumeKeywords.some((keyword) => fieldsetText.includes(keyword))) {
      return true;
    }

    // 4. Check for specific UI elements that indicate resume upload
    const uploadButton = fieldset.querySelector(
      '.upload_resume_button, [for*="ResumeUploadInput"]'
    );
    if (uploadButton) return true;

    const uploadSpan = fieldset.querySelector(".ResumeUpload");
    if (uploadSpan) return true;

    // 5. Check for error messages about required resume
    const errorText = fieldsetText;
    if (
      errorText.includes("this field is required") &&
      (errorText.includes("resume") || errorText.includes("cv"))
    ) {
      return true;
    }

    return false;
  }

  /**
   * Handle resume upload in ZipRecruiter forms
   * @param {HTMLElement} fieldset - The fieldset containing the resume upload
   */
  async handleResumeUpload(fieldset) {
    try {
      this.logger("Handling resume upload");

      // Find the file input element
      const fileInput = fieldset.querySelector('input[type="file"]');
      if (!fileInput) {
        this.logger("No file input found for resume upload");
        return;
      }

      // Check if we have userData with resume URL
      if (!this.userData || !this.userData.resumeUrl) {
        this.logger("No resume URL found in user data");

        // Try to find it in different properties
        const possibleUrls = [
          this.userData?.cv?.url,
          this.userData?.resume?.url,
          this.userData?.resumeUrl,
        ];

        const validUrl = possibleUrls.find(
          (url) => url && typeof url === "string"
        );

        if (!validUrl) {
          this.logger("Could not find any valid resume URL in user data");
          return;
        }

        // Use the first valid URL we found
        this.userData.resumeUrl = validUrl;
      }

      // Use the file handler to upload the resume
      this.logger(`Uploading resume from URL: ${this.userData.resumeUrl}`);

      let success = false;

      // Try multiple approaches to upload the resume

      // Approach 1: Use a direct DataTransfer approach
      success = await this.uploadFileWithDataTransfer(
        fileInput,
        this.userData.resumeUrl
      );

      // If that fails, try the fileHandler if available
      if (!success && this.fileHandler) {
        this.logger("Using fileHandler as fallback");

        // Create dummy container for the fileHandler
        const form = fieldset.closest("form") || document.createElement("form");

        // Adapt profile format if needed for the fileHandler
        const adaptedProfile = {
          ...this.userData,
          cv: { url: this.userData.resumeUrl },
        };

        success = await this.fileHandler.handleLeverResumeUpload(
          adaptedProfile,
          form
        );
      }

      // If that still fails, try a simpler approach
      if (!success) {
        this.logger("Using direct XHR approach as last resort");
        success = await this.uploadFileWithXHR(
          fileInput,
          this.userData.resumeUrl
        );
      }

      if (success) {
        this.logger("Resume uploaded successfully");

        // Find any continue or next button and click it if the form is only for resume upload
        if (this.isResumeOnlyForm(fieldset)) {
          const continueButton = document.querySelector(
            'button[type="submit"], button:contains("Continue"), button:contains("Next")'
          );
          if (continueButton && this.isElementVisible(continueButton)) {
            this.logger("Clicking continue button after resume upload");
            continueButton.click();
            await this.sleep(2000);
          }
        }
      } else {
        this.logger("Failed to upload resume");
      }
    } catch (error) {
      this.logger(`Error handling resume upload: ${error.message}`);
    }
  }

  /**
   * Check if this is a form that only contains a resume upload
   * @param {HTMLElement} fieldset - The fieldset to check
   * @returns {boolean} True if it's a resume-only form
   */
  isResumeOnlyForm(fieldset) {
    // Check if the form only has one fieldset or input field
    const form = fieldset.closest("form");
    if (!form) return false;

    const allFieldsets = form.querySelectorAll("fieldset");
    if (allFieldsets.length <= 1) return true;

    // If there are only two fields and one is for zipcode (which we handle separately), consider it resume-only
    if (allFieldsets.length === 2) {
      const otherFieldset =
        allFieldsets[0] === fieldset ? allFieldsets[1] : allFieldsets[0];
      const otherFieldsetText = otherFieldset.textContent.toLowerCase();
      if (
        otherFieldsetText.includes("zipcode") ||
        otherFieldsetText.includes("zip code")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Upload a file using the DataTransfer API
   * @param {HTMLElement} fileInput - The file input element
   * @param {string} url - The URL of the file to upload
   * @returns {Promise<boolean>} True if successful
   */
  async uploadFileWithDataTransfer(fileInput, url) {
    try {
      this.logger("Uploading resume with DataTransfer API");

      // Get the file through a proxy to avoid CORS issues
      const proxyURL = `${
        window.HOST || "https://fastapply.co"
      }/api/proxy-file?url=${encodeURIComponent(url)}`;

      const response = await fetch(proxyURL);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch file: ${response.status} ${response.statusText}`
        );
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      // Create a file name
      let fileName = "resume.pdf";

      // Try to extract filename from URL or headers
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (matches && matches[1]) {
          fileName = matches[1].replace(/['"]/g, "");
        }
      } else {
        // Try to extract from URL
        const urlParts = url.split("/");
        const lastPart = urlParts[urlParts.length - 1].split("?")[0];
        if (lastPart && lastPart.includes(".")) {
          fileName = lastPart;
        }
      }

      // Use user data to create a better filename if possible
      if (this.userData && this.userData.firstName && this.userData.lastName) {
        const ext = fileName.split(".").pop();
        fileName = `${this.userData.firstName}_${
          this.userData.lastName
        }_resume.${ext || "pdf"}`;
      }

      // Create a File object
      const file = new File([blob], fileName, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      // Use DataTransfer to set the file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Trigger events to notify the form that a file was selected
      const events = ["focus", "click", "change", "input"];
      for (const event of events) {
        await this.sleep(100);
        fileInput.dispatchEvent(new Event(event, { bubbles: true }));
      }

      // Give time for the form to process
      await this.sleep(2000);

      // Verify file was uploaded
      return fileInput.files.length > 0;
    } catch (error) {
      this.logger(`Error in DataTransfer upload: ${error.message}`);
      return false;
    }
  }

  /**
   * Upload a file using XMLHttpRequest (XHR)
   * @param {HTMLElement} fileInput - The file input element
   * @param {string} url - The URL of the file to upload
   * @returns {Promise<boolean>} True if successful
   */
  async uploadFileWithXHR(fileInput, url) {
    return new Promise((resolve) => {
      try {
        this.logger("Uploading resume with XHR");

        // Get the file through a proxy to avoid CORS issues
        const proxyURL = `${
          window.HOST || "https://fastapply.co"
        }/api/proxy-file?url=${encodeURIComponent(url)}`;

        const xhr = new XMLHttpRequest();
        xhr.open("GET", proxyURL, true);
        xhr.responseType = "blob";

        xhr.onload = async () => {
          if (xhr.status !== 200) {
            this.logger(`XHR failed with status: ${xhr.status}`);
            resolve(false);
            return;
          }

          const blob = xhr.response;
          if (!blob || blob.size === 0) {
            this.logger("Downloaded file is empty");
            resolve(false);
            return;
          }

          // Create a file name
          let fileName = "resume.pdf";

          // Use user data to create a better filename if possible
          if (
            this.userData &&
            this.userData.firstName &&
            this.userData.lastName
          ) {
            fileName = `${this.userData.firstName}_${this.userData.lastName}_resume.pdf`;
          }

          // Create a File object
          const file = new File([blob], fileName, {
            type: blob.type || "application/pdf",
            lastModified: Date.now(),
          });

          // Use DataTransfer to set the file
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;

          // Trigger events to notify the form that a file was selected
          const events = ["focus", "click", "change", "input"];
          for (const event of events) {
            await this.sleep(100);
            fileInput.dispatchEvent(new Event(event, { bubbles: true }));
          }

          // Give time for the form to process
          await this.sleep(2000);

          // Verify file was uploaded
          resolve(fileInput.files.length > 0);
        };

        xhr.onerror = () => {
          this.logger("XHR network error");
          resolve(false);
        };

        xhr.send();
      } catch (error) {
        this.logger(`Error in XHR upload: ${error.message}`);
        resolve(false);
      }
    });
  }

  /**
   * Sleep for a specified time
   * @param {number} ms Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ZipRecruiterFormHandler;
