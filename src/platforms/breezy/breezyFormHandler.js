import { HOST } from "@shared/constants";
//fillFormWithProfile
/**
 * BreezyFormHandler - Functions for handling Breezy application forms
 */
export class BreezyFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || HOST;
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.answerCache = {}; // Cache for AI answers
  }

  /**
   * Get all form fields from a Breezy application form
   * @param {HTMLElement} form - The form element
   * @returns {Array} - Array of form field objects with element, label, type, and required status
   */
  getAllFormFields(form) {
    try {
      this.logger("Finding all form fields");

      const fields = [];

      // Find all visible input elements including Breezy's specific elements
      const formElements = form.querySelectorAll(
        'input:not([type="hidden"]), select, textarea, ' +
          '[role="radio"], [role="checkbox"], ' +
          'fieldset[role="radiogroup"], ' +
          "div.form-group, " + // Breezy specific classes
          'div[role="group"], ' +
          "div.custom-checkbox"
      );

      this.logger(`Found ${formElements.length} form elements`);

      // Process each element
      for (const element of formElements) {
        // Skip invisible elements
        if (!this.isElementVisible(element)) continue;

        const fieldInfo = {
          element,
          label: this.getFieldLabel(element),
          type: this.getFieldType(element),
          required: this.isFieldRequired(element),
        };

        // For radio groups, get the full fieldset when possible
        if (fieldInfo.type === "radio" && element.tagName !== "FIELDSET") {
          const radioGroup = element.closest('fieldset[role="radiogroup"]');
          if (radioGroup) {
            fieldInfo.element = radioGroup;
          }
        }

        fields.push(fieldInfo);
      }

      // Deduplicate fields - particularly important for radio groups
      const uniqueFields = [];
      const seenLabels = new Set();

      for (const field of fields) {
        // Only add fields with labels
        if (!field.label) continue;

        // For radio fields, only add the first instance of each label
        if (field.type === "radio") {
          if (!seenLabels.has(field.label)) {
            seenLabels.add(field.label);
            uniqueFields.push(field);
          }
        } else {
          uniqueFields.push(field);
        }
      }

      this.logger(`Processed ${uniqueFields.length} unique form fields`);
      return uniqueFields;
    } catch (error) {
      this.logger(`Error getting form fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Get label text for a form field
   * @param {HTMLElement} element - The form field element
   * @returns {string} - The label text or empty string if not found
   */
  getFieldLabel(element) {
    try {
      // Breezy specific label finding
      const breezyLabel = element
        .closest(".form-group")
        ?.querySelector("label");
      if (breezyLabel) {
        return this.cleanLabelText(breezyLabel.textContent);
      }

      // Handle file upload fields specifically
      if (
        element.type === "file" ||
        element.classList.contains("custom-file-input") ||
        element.closest(".custom-file")
      ) {
        // Look for custom file label
        const customFileLabel = element
          .closest(".custom-file")
          ?.querySelector(".custom-file-label");
        if (customFileLabel) {
          return this.cleanLabelText(customFileLabel.textContent);
        }

        // Look for the closest form-group and its label
        const formGroup = element.closest(".form-group");
        if (formGroup) {
          const label = formGroup.querySelector("label");
          if (label) {
            return this.cleanLabelText(label.textContent);
          }
        }
      }

      // If this is a checkbox/radio group, look for the label with aria-labelledby
      if (
        element.getAttribute("role") === "group" ||
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const labelledById = element.getAttribute("aria-labelledby");
        if (labelledById) {
          const labelEl = document.getElementById(labelledById);
          if (labelEl) {
            // Specifically exclude SVG descriptions
            const labelText = Array.from(labelEl.childNodes)
              .filter(
                (node) =>
                  node.nodeType === Node.TEXT_NODE ||
                  (node.nodeType === Node.ELEMENT_NODE &&
                    node.tagName !== "SVG")
              )
              .map((node) => node.textContent)
              .join(" ");
            return this.cleanLabelText(labelText);
          }
        }
      }

      // Method 1: Check for aria-labelledby attribute
      const labelledById = element.getAttribute("aria-labelledby");
      if (labelledById) {
        const labelElement = document.getElementById(labelledById);
        if (labelElement) {
          return this.cleanLabelText(labelElement.textContent);
        }
      }

      // Method 2: Check for explicit label element
      if (element.id) {
        const labelElement = document.querySelector(
          `label[for="${element.id}"]`
        );
        if (labelElement) {
          return this.cleanLabelText(labelElement.textContent);
        }
      }

      // Method 3: Check if element is inside a label
      const parentLabel = element.closest("label");
      if (parentLabel) {
        // Clone the label to avoid modifying the original
        const clone = parentLabel.cloneNode(true);

        // Remove the input element from the clone to get just the label text
        const inputElements = clone.querySelectorAll("input, select, textarea");
        for (const inputEl of inputElements) {
          if (inputEl.parentNode) {
            inputEl.parentNode.removeChild(inputEl);
          }
        }

        return this.cleanLabelText(clone.textContent);
      }

      // Method 4: Check if element is in a fieldset with legend
      const fieldset = element.closest("fieldset");
      if (fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend) {
          return this.cleanLabelText(legend.textContent);
        }
      }

      // Method 5: Look for nearby elements that could be labels
      const parent = element.parentElement;
      if (parent) {
        // Check for elements with label-like class names
        const labelElements = parent.querySelectorAll(
          '.label, .form-label, [class*="label"]'
        );
        if (labelElements.length > 0) {
          return this.cleanLabelText(labelElements[0].textContent);
        }
      }

      // Method 6: Use aria-label, placeholder, or name as fallback
      if (element.getAttribute("aria-label")) {
        return this.cleanLabelText(element.getAttribute("aria-label"));
      }

      if (element.placeholder) {
        return this.cleanLabelText(element.placeholder);
      }

      if (element.name) {
        // Convert camelCase or snake_case to spaces
        return this.cleanLabelText(
          element.name.replace(/([A-Z])/g, " $1").replace(/_/g, " ")
        );
      }

      // If nothing else works, return empty string
      return "";
    } catch (error) {
      this.logger(`Error getting field label: ${error.message}`);
      return "";
    }
  }

  /**
   * Clean up label text by removing asterisks and extra whitespace
   * @param {string} text - The original label text
   * @returns {string} - The cleaned label text
   */
  cleanLabelText(text) {
    if (!text) return "";

    return text
      .replace(/[*✱]/g, "") // Remove asterisks (both standard and special)
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/^\s+|\s+$/g, "") // Trim start and end
      .replace(/\(required\)/i, "") // Remove "(required)" text
      .replace(/\(optional\)/i, "") // Remove "(optional)" text
      .toLowerCase(); // Convert to lowercase for easier comparison
  }

  /**
   * Get the type of a form field
   * @param {HTMLElement} element - The form field element
   * @returns {string} - The field type
   */
  getFieldType(element) {
    const role = element.getAttribute("role");
    const tagName = element.tagName.toLowerCase();
    const className = element.className || "";

    // Radio groups
    if (
      role === "radiogroup" ||
      (tagName === "fieldset" && role === "radiogroup") ||
      element.closest(".custom-radio-group")
    ) {
      return "radio";
    }

    // Checkbox groups
    if (
      (role === "group" &&
        element.querySelector('[role="checkbox"], input[type="checkbox"]')) ||
      element.closest(".custom-checkbox-group")
    ) {
      return "checkbox";
    }

    // Individual radio or checkbox
    if (role === "radio" || role === "checkbox") {
      return role;
    }

    // Custom select
    if (role === "combobox" || element.classList.contains("custom-select")) {
      return "select";
    }

    // Upload fields
    if (
      className.includes("custom-file") ||
      element.querySelector('input[type="file"]') ||
      element.classList.contains("dropzone")
    ) {
      return "file";
    }

    // Standard HTML elements
    if (tagName === "select") return "select";
    if (tagName === "textarea") return "textarea";
    if (tagName === "input") {
      const type = element.type.toLowerCase();
      if (type === "file") return "file";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "tel") return "phone";
      return type || "text";
    }

    return "unknown";
  }

  /**
   * Check if a field is required
   * @param {HTMLElement} element - The form field element
   * @returns {boolean} - True if the field is required
   */
  isFieldRequired(element) {
    // Check required attribute
    if (element.required || element.getAttribute("aria-required") === "true") {
      return true;
    }

    // Check for Breezy-specific required indicators
    if (
      element.classList.contains("is-required") ||
      element.closest(".form-group")?.classList.contains("required")
    ) {
      return true;
    }

    // Check for asterisk in label or aria-labelledby element
    const labelledById = element.getAttribute("aria-labelledby");
    if (labelledById) {
      const labelElement = document.getElementById(labelledById);
      if (
        labelElement &&
        (labelElement.textContent.includes("*") ||
          labelElement.textContent.includes("✱"))
      ) {
        return true;
      }
    }

    // Check for explicit label with asterisk
    if (element.id) {
      const labelElement = document.querySelector(`label[for="${element.id}"]`);
      if (
        labelElement &&
        (labelElement.textContent.includes("*") ||
          labelElement.textContent.includes("✱"))
      ) {
        return true;
      }
    }

    // Check parent elements for required indicator
    let parent = element.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      // Only check up to 3 levels
      if (parent.querySelector('.required, .mandatory, [class*="required"]')) {
        return true;
      }
      parent = parent.parentElement;
    }

    return false;
  }

  /**
   * Get an appropriate answer from AI for a form field
   * @param {string} question - The field label/question
   * @param {Array<string>} options - Available options for select/radio fields
   * @param {string} fieldType - The type of field
   * @param {string} fieldContext - Additional context about the field
   * @returns {Promise<string>} - The AI-generated answer
   */
  async getAIAnswer(
    question,
    options = [],
    fieldType = "text",
    fieldContext = ""
  ) {
    try {
      // Check cache first
      const cacheKey = `${question}:${options.join(",")}`;
      if (this.answerCache[cacheKey]) {
        this.logger(`Using cached answer for "${question}"`);
        return this.answerCache[cacheKey];
      }

      this.logger(`Requesting AI answer for "${question}"`);

      // Get surrounding context from the form
      const formContext = this.extractFormContext();

      // Make API request to get answer
      const response = await fetch(`${this.host}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options,
          userData: this.userData,
          description: this.jobDescription || "",
          fieldType,
          fieldContext,
          formContext,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      const answer = data.answer;

      // Cache the answer for future use
      this.answerCache[cacheKey] = answer;

      return answer;
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);

      // Return appropriate fallback based on field type
      if (fieldType === "checkbox" || fieldType === "radio") {
        return options.length > 0 ? options[0] : "yes";
      } else if (fieldType === "select") {
        return options.length > 0 ? options[0] : "";
      } else {
        return "I prefer not to answer";
      }
    }
  }

  /**
   * Extract context from the form to help AI understand the application
   * @returns {Object} - Contextual information about the form
   */
  extractFormContext() {
    try {
      // Get the job title if available
      let jobTitle = "";
      const titleElements = document.querySelectorAll(
        'h1, h2, h3, .job-title, [class*="title"], .position-title'
      );
      for (const el of titleElements) {
        const text = el.textContent.trim();
        if (text && text.length < 100) {
          jobTitle = text;
          break;
        }
      }

      // Get the company name if available
      let companyName = "";
      const companyElements = document.querySelectorAll(
        '.company-name, [class*="company"], .company-info h2, .company-card h3'
      );
      for (const el of companyElements) {
        const text = el.textContent.trim();
        if (text && text.length < 100) {
          companyName = text;
          break;
        }
      }

      // Get form section headings
      const sections = [];
      const headings = document.querySelectorAll(
        "h2, h3, h4, .section-heading, .form-section-title"
      );
      for (const heading of headings) {
        if (this.isElementVisible(heading)) {
          sections.push(heading.textContent.trim());
        }
      }

      return {
        jobTitle,
        companyName,
        formSections: sections,
        url: window.location.href,
      };
    } catch (error) {
      this.logger(`Error extracting form context: ${error.message}`);
      return {};
    }
  }

  /**
   * Fill a form field with the appropriate value
   * @param {HTMLElement} element - The form field element
   * @param {string} value - The value to fill
   * @returns {Promise<boolean>} - True if successful
   */
  async fillField(element, value) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      // Get field type to determine how to fill it
      const fieldType = this.getFieldType(element);

      this.logger(`Filling ${fieldType} field with value: ${value}`);

      switch (fieldType) {
        case "text":
        case "email":
        case "tel":
        case "url":
        case "number":
        case "password":
          return await this.fillInputField(element, value);

        case "textarea":
          return await this.fillTextareaField(element, value);

        case "select":
          return await this.fillSelectField(element, value);

        case "phone":
          return await this.fillPhoneField(element, value);

        case "checkbox":
          return await this.fillCheckboxField(element, value);

        case "radio":
          return await this.fillRadioField(element, value);

        case "date":
          return await this.fillDateField(element, value);

        case "file":
          // File uploads handled separately
          return false;

        default:
          this.logger(`Unsupported field type: ${fieldType}`);
          return false;
      }
    } catch (error) {
      this.logger(`Error filling field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a text input field
   * @param {HTMLElement} element - The input element
   * @param {string} value - The value to fill
   * @returns {Promise<boolean>} - True if successful
   */
  async fillInputField(element, value) {
    try {
      // Focus on the element
      this.scrollToElement(element);
      element.focus();
      await this.wait(100);

      // Clear existing value
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(50);

      // Set new value
      element.value = value;

      // Trigger appropriate events
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));

      await this.wait(100);

      return true;
    } catch (error) {
      this.logger(`Error filling input field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a textarea field
   * @param {HTMLElement} element - The textarea element
   * @param {string} value - The value to fill
   * @returns {Promise<boolean>} - True if successful
   */
  async fillTextareaField(element, value) {
    // Textarea filling is basically the same as input filling
    return await this.fillInputField(element, value);
  }

  /**
   * Fill a select field
   * @param {HTMLElement} element - The select element
   * @param {string} value - The value to select
   * @returns {Promise<boolean>} - True if successful
   */
  async fillSelectField(element, value) {
    try {
      // Get the lowercase string value for comparison
      const valueStr = String(value).toLowerCase();

      // Standard <select> element
      if (element.tagName.toLowerCase() === "select") {
        this.scrollToElement(element);
        element.focus();
        await this.wait(200);

        // Find matching option
        let optionSelected = false;
        const options = Array.from(element.options);

        for (const option of options) {
          const optionText = option.textContent.trim().toLowerCase();
          const optionValue = option.value.toLowerCase();

          if (
            optionText === valueStr ||
            optionText.includes(valueStr) ||
            valueStr.includes(optionText) ||
            optionValue === valueStr
          ) {
            option.selected = true;
            optionSelected = true;
            break;
          }
        }

        // If no match found, select first non-empty option
        if (!optionSelected && options.length > 0) {
          for (const option of options) {
            if (
              option.value &&
              option.value !== "null" &&
              option.value !== "undefined"
            ) {
              option.selected = true;
              optionSelected = true;
              break;
            }
          }
        }

        // Trigger change event
        if (optionSelected) {
          element.dispatchEvent(new Event("change", { bubbles: true }));
          await this.wait(200);
          return true;
        }
      }
      // Bootstrap custom select
      else if (
        element.classList.contains("custom-select") ||
        element.closest(".custom-select-container")
      ) {
        const customSelect = element.classList.contains("custom-select")
          ? element
          : element.closest(".custom-select-container");

        // Click to open dropdown
        this.scrollToElement(customSelect);
        customSelect.click();
        await this.wait(500);

        // Look for dropdown container
        let dropdownMenu = document.querySelector(".dropdown-menu.show");
        if (!dropdownMenu) {
          // Try to find it by proximity
          const allDropdowns = document.querySelectorAll(".dropdown-menu");
          for (const dropdown of allDropdowns) {
            if (
              dropdown.getBoundingClientRect().top >
              customSelect.getBoundingClientRect().bottom
            ) {
              dropdownMenu = dropdown;
              break;
            }
          }
        }

        if (dropdownMenu) {
          // Find matching dropdown item
          const items = dropdownMenu.querySelectorAll(".dropdown-item");
          let itemSelected = false;

          for (const item of items) {
            const itemText = item.textContent.trim().toLowerCase();
            if (
              itemText === valueStr ||
              itemText.includes(valueStr) ||
              valueStr.includes(itemText)
            ) {
              item.click();
              itemSelected = true;
              await this.wait(200);
              break;
            }
          }

          // If no match found, select first item
          if (!itemSelected && items.length > 0) {
            items[0].click();
            await this.wait(200);
          }

          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger(`Error filling select field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a phone field with country code
   * @param {HTMLElement} element - The phone input element
   * @param {string} value - The phone number to fill
   * @returns {Promise<boolean>} - True if successful
   */
  async fillPhoneField(element, value) {
    try {
      // For Breezy, phone fields are often simple inputs
      if (element.tagName.toLowerCase() === "input") {
        return await this.fillInputField(element, value);
      }

      // Check if this is an international phone input
      const isIntlPhone =
        element.closest(".iti") ||
        document.querySelector(".iti__flag-container");

      if (isIntlPhone) {
        // Get the actual input
        const phoneInput =
          element.tagName.toLowerCase() === "input"
            ? element
            : element.querySelector('input[type="tel"]');

        if (!phoneInput) return false;

        // Find the country selector dropdown button
        const countrySelector =
          element.querySelector(".iti__selected-flag") ||
          element.closest(".iti").querySelector(".iti__selected-flag");

        if (countrySelector) {
          this.scrollToElement(countrySelector);
          countrySelector.click();
          await this.wait(500);

          // Get the dropdown list
          const countryList = document.querySelector(".iti__country-list");
          if (countryList) {
            // Look for United States or another default country
            const usOption = countryList.querySelector(
              '.iti__country[data-country-code="us"]'
            );
            if (usOption) {
              usOption.click();
              await this.wait(300);
            } else {
              // Just close the dropdown
              countrySelector.click();
              await this.wait(300);
            }
          }
        }

        // Now fill the phone input
        return await this.fillInputField(phoneInput, value);
      }

      // Default to standard input handling
      return await this.fillInputField(element, value);
    } catch (error) {
      this.logger(`Error filling phone field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a checkbox field
   * @param {HTMLElement} element - The checkbox element or container
   * @param {boolean|string} value - Whether to check the box
   * @returns {Promise<boolean>} - True if successful
   */
  async fillCheckboxField(element, value) {
    try {
      // Normalize the value to a boolean
      const shouldCheck =
        value === true ||
        value === "true" ||
        value === "yes" ||
        value === "on" ||
        value === 1;

      // Find the actual checkbox input if we were given a container
      let checkboxInput = element;
      if (element.tagName.toLowerCase() !== "input") {
        checkboxInput = element.querySelector('input[type="checkbox"]');

        // If no checkbox found, try custom checkbox
        if (!checkboxInput) {
          if (element.getAttribute("role") === "checkbox") {
            // This is a custom checkbox element
            const isChecked = element.getAttribute("aria-checked") === "true";

            // Only click if the current state doesn't match desired state
            if ((shouldCheck && !isChecked) || (!shouldCheck && isChecked)) {
              this.scrollToElement(element);
              element.click();
              await this.wait(200);
            }

            return true;
          }

          // For Breezy's custom checkboxes
          const customCheckbox = element.querySelector(".custom-checkbox");
          if (customCheckbox) {
            this.scrollToElement(customCheckbox);
            customCheckbox.click();
            await this.wait(200);
            return true;
          }
        }

        if (!checkboxInput) {
          return false;
        }
      }

      // Only change state if needed
      if (
        (shouldCheck && !checkboxInput.checked) ||
        (!shouldCheck && checkboxInput.checked)
      ) {
        this.scrollToElement(checkboxInput);

        // Try clicking the label if available (more reliable than clicking the input directly)
        const labelEl =
          checkboxInput.closest("label") ||
          document.querySelector(`label[for="${checkboxInput.id}"]`);

        if (labelEl) {
          labelEl.click();
        } else {
          checkboxInput.click();
        }

        await this.wait(200);

        // If the click didn't work, try setting the property directly
        if (checkboxInput.checked !== shouldCheck) {
          checkboxInput.checked = shouldCheck;
          checkboxInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      return true;
    } catch (error) {
      this.logger(`Error filling checkbox field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a radio button field
   * @param {HTMLElement} element - The radio element or container
   * @param {string} value - The value to select
   * @returns {Promise<boolean>} - True if successful
   */
  async fillRadioField(element, value) {
    try {
      // Get the lowercase string value for comparison
      const valueStr = String(value).toLowerCase();
      const isYes = valueStr === "yes" || valueStr === "true";

      // Handle Breezy's custom radio groups
      if (
        element.classList.contains("custom-radio-group") ||
        element.closest(".custom-radio-group")
      ) {
        const container = element.classList.contains("custom-radio-group")
          ? element
          : element.closest(".custom-radio-group");

        const radioLabels = container.querySelectorAll(
          "label.custom-control-label"
        );

        // Try to find matching radio by label
        let matchingLabel = null;

        for (const label of radioLabels) {
          const labelText = label.textContent.trim().toLowerCase();

          // Try exact and partial matches
          if (
            labelText === valueStr ||
            labelText.includes(valueStr) ||
            valueStr.includes(labelText) ||
            // Special handling for yes/no
            (valueStr === "yes" &&
              (labelText === "yes" || labelText === "YES")) ||
            (valueStr === "no" && (labelText === "no" || labelText === "NO"))
          ) {
            matchingLabel = label;
            break;
          }
        }

        // If no match by label, try yes/no special cases
        if (
          !matchingLabel &&
          (valueStr === "yes" ||
            valueStr === "no" ||
            valueStr === "true" ||
            valueStr === "false")
        ) {
          const isYes = valueStr === "yes" || valueStr === "true";

          // For yes/no questions, first radio is usually "yes" and second is "no"
          if (isYes && radioLabels.length > 0) {
            matchingLabel = radioLabels[0];
          } else if (!isYes && radioLabels.length > 1) {
            matchingLabel = radioLabels[1];
          }
        }

        // If still no match, use first option
        if (!matchingLabel && radioLabels.length > 0) {
          matchingLabel = radioLabels[0];
        }

        if (matchingLabel) {
          this.scrollToElement(matchingLabel);
          matchingLabel.click();
          await this.wait(300);
          return true;
        }
      }

      // Handle standard radio groups
      if (
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const radios = element.querySelectorAll(
          '[role="radio"], input[type="radio"]'
        );
        if (!radios.length) return false;

        // Try to find matching radio by label
        let matchingRadio = null;

        for (const radio of radios) {
          // Look for the label
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);

          if (label) {
            const labelText = label.textContent.trim().toLowerCase();

            // Try exact and partial matches
            if (
              labelText === valueStr ||
              labelText.includes(valueStr) ||
              valueStr.includes(labelText) ||
              // Special handling for yes/no
              (valueStr === "yes" &&
                (labelText === "yes" || labelText === "YES")) ||
              (valueStr === "no" && (labelText === "no" || labelText === "NO"))
            ) {
              matchingRadio = radio;
              break;
            }
          }
        }

        // If no match by label, try yes/no special cases
        if (
          !matchingRadio &&
          (valueStr === "yes" ||
            valueStr === "no" ||
            valueStr === "true" ||
            valueStr === "false")
        ) {
          const isYes = valueStr === "yes" || valueStr === "true";

          // For yes/no questions, first radio is usually "yes" and second is "no"
          if (isYes && radios.length > 0) {
            matchingRadio = radios[0];
          } else if (!isYes && radios.length > 1) {
            matchingRadio = radios[1];
          }
        }

        // If still no match, use first option
        if (!matchingRadio && radios.length > 0) {
          matchingRadio = radios[0];
        }

        if (matchingRadio) {
          this.scrollToElement(matchingRadio);

          // Try clicking the label (more reliable)
          const label =
            matchingRadio.closest("label") ||
            document.querySelector(`label[for="${matchingRadio.id}"]`);
          if (label) {
            label.click();
          } else {
            matchingRadio.click();
          }

          await this.wait(300);

          return true;
        }
      }

      // Standard input[type="radio"] handling
      const radioName = element.name;
      if (radioName) {
        const radios = document.querySelectorAll(
          `input[type="radio"][name="${radioName}"]`
        );

        // Find the matching radio
        let matchingRadio = null;

        for (const radio of radios) {
          // Check value attribute
          if (radio.value.toLowerCase() === valueStr) {
            matchingRadio = radio;
            break;
          }

          // Check label text
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);
          if (label) {
            const labelText = label.textContent.trim().toLowerCase();
            if (
              labelText === valueStr ||
              labelText.includes(valueStr) ||
              valueStr.includes(labelText)
            ) {
              matchingRadio = radio;
              break;
            }
          }
        }

        // Special handling for yes/no
        if (
          !matchingRadio &&
          (valueStr === "yes" ||
            valueStr === "no" ||
            valueStr === "true" ||
            valueStr === "false")
        ) {
          const isYes = valueStr === "yes" || valueStr === "true";

          if (isYes && radios.length > 0) {
            matchingRadio = radios[0];
          } else if (!isYes && radios.length > 1) {
            matchingRadio = radios[1];
          }
        }

        // If still no match, use first radio
        if (!matchingRadio && radios.length > 0) {
          matchingRadio = radios[0];
        }

        // Click the matching radio
        if (matchingRadio) {
          this.scrollToElement(matchingRadio);

          // Try clicking the label (more reliable)
          const label =
            matchingRadio.closest("label") ||
            document.querySelector(`label[for="${matchingRadio.id}"]`);
          if (label) {
            label.click();
          } else {
            matchingRadio.click();
          }

          await this.wait(300);

          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger(`Error filling radio field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a date field
   * @param {HTMLElement} element - The date input element
   * @param {string} value - The date value to fill
   * @returns {Promise<boolean>} - True if successful
   */
  async fillDateField(element, value) {
    try {
      // For native date inputs
      if (
        element.tagName.toLowerCase() === "input" &&
        element.type === "date"
      ) {
        return await this.fillInputField(element, value);
      }

      // For Breezy date pickers
      if (
        element.classList.contains("datepicker-input") ||
        element.classList.contains("datepicker")
      ) {
        this.scrollToElement(element);
        element.focus();
        await this.wait(100);

        // Clear existing value
        element.value = "";
        element.dispatchEvent(new Event("input", { bubbles: true }));
        await this.wait(50);

        // Parse and format date
        try {
          const dateObj = new Date(value);
          if (!isNaN(dateObj.getTime())) {
            // Format as MM/DD/YYYY
            const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
            const day = dateObj.getDate().toString().padStart(2, "0");
            const year = dateObj.getFullYear();

            const formattedDate = `${month}/${day}/${year}`;
            element.value = formattedDate;
          } else {
            // Fallback to original value
            element.value = value;
          }
        } catch (e) {
          // If date parsing fails, use original value
          element.value = value;
        }

        // Trigger events
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));

        return true;
      }

      // For other types of date fields, try standard input fill
      return await this.fillInputField(element, value);
    } catch (error) {
      this.logger(`Error filling date field: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle required checkbox fields (agreements, terms, etc.)
   * @param {HTMLElement} form - The form element
   * @returns {Promise<void>}
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Handling required checkboxes");

      // Find all checkboxes
      const checkboxFields = [];

      // Standard checkboxes
      const standardCheckboxes = form.querySelectorAll(
        'input[type="checkbox"]'
      );
      for (const checkbox of standardCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired = this.isFieldRequired(checkbox);
        const isAgreement = this.isAgreementCheckbox(label);

        if (isRequired || isAgreement) {
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
            isAgreement,
          });
        }
      }

      // Breezy custom checkboxes
      const customCheckboxes = form.querySelectorAll(
        '.custom-checkbox, [role="checkbox"]'
      );
      for (const checkbox of customCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired =
          this.isFieldRequired(checkbox) ||
          checkbox.closest(".form-group.required");
        const isAgreement = this.isAgreementCheckbox(label);

        if (isRequired || isAgreement) {
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
            isAgreement,
          });
        }
      }

      this.logger(
        `Found ${checkboxFields.length} required/agreement checkboxes`
      );

      // Check all required/agreement checkboxes
      for (const field of checkboxFields) {
        // For required fields and agreement checkboxes, always check them
        let shouldCheck = field.isRequired || field.isAgreement;

        // If not clearly required/agreement, get AI answer
        if (!shouldCheck) {
          // Get AI answer for this checkbox (true/false or yes/no)
          const answer = await this.getAIAnswer(
            field.label,
            ["yes", "no"],
            "checkbox",
            "This is a checkbox that may require consent or agreement."
          );

          shouldCheck = answer === "yes" || answer === "true";
        }

        this.logger(
          `${shouldCheck ? "Checking" : "Unchecking"} checkbox: ${field.label}`
        );
        await this.fillCheckboxField(field.element, shouldCheck);
        await this.wait(200);
      }
    } catch (error) {
      this.logger(`Error handling required checkboxes: ${error.message}`);
    }
  }

  /**
   * Check if a label indicates an agreement checkbox
   * @param {string} label - The checkbox label
   * @returns {boolean} - True if it's an agreement checkbox
   */
  isAgreementCheckbox(label) {
    if (!label) return false;

    const agreementTerms = [
      "agree",
      "accept",
      "consent",
      "terms",
      "privacy",
      "policy",
      "gdpr",
      "confirm",
      "acknowledge",
      "permission",
      "receive",
      "subscribe",
      "newsletter",
      "marketing",
      "communications",
    ];

    return agreementTerms.some((term) => label.includes(term));
  }

  /**
   * Fill a form with profile data using AI-generated answers
   * @param {HTMLElement} form - The form element
   * @param {Object} profile - The profile data (used as context for AI)
   * @returns {Promise<boolean>} - True if successful
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.logger("Filling form with AI-generated answers");

      // Store user profile data for context in AI requests
      this.userData = profile;

      // Get all form fields
      const formFields = this.getAllFormFields(form);
      this.logger(`Found ${formFields.length} form fields`);

      // Keep track of filled fields
      let filledCount = 0;

      // Process fields one by one
      for (const field of formFields) {
        // Skip if no label was found
        if (!field.label) continue;

        // Skip file upload fields
        if (field.type === "file") {
          this.logger(`Skipping file upload field: ${field.label}`);
          continue;
        }

        // Skip education fields that will be handled by fillEducation
        const isEducationField = this.isEducationField(field.element);
        if (isEducationField) {
          this.logger(`Skipping education field: ${field.label}`);
          continue;
        }

        // Skip work history fields that will be handled by fillWorkHistory
        const isWorkHistoryField = this.isWorkHistoryField(field.element);
        if (isWorkHistoryField) {
          this.logger(`Skipping work history field: ${field.label}`);
          continue;
        }

        try {
          this.logger(`Processing field: ${field.label} (${field.type})`);

          // Get available options for select and radio fields
          const options =
            field.type === "select" ||
            field.type === "radio" ||
            field.type === "checkbox"
              ? this.getFieldOptions(field.element)
              : [];

          // Get AI answer for this field
          const fieldContext = `This is a ${field.type} field${
            field.required ? " (required)" : ""
          }`;
          const answer = await this.getAIAnswer(
            field.label,
            options,
            field.type,
            fieldContext
          );

          if (answer) {
            this.logger(
              `Got AI answer for "${field.label}": ${answer.substring(0, 50)}${
                answer.length > 50 ? "..." : ""
              }`
            );
            const success = await this.fillField(field.element, answer);
            if (success) filledCount++;
          }

          // Small delay between fields
          await this.wait(300);
        } catch (fieldError) {
          this.logger(
            `Error processing field "${field.label}": ${fieldError.message}`
          );
        }
      }

      // Handle required checkboxes and agreements
      await this.handleRequiredCheckboxes(form);

      this.logger(`Successfully filled ${filledCount} fields with AI answers`);
      return true;
    } catch (error) {
      this.logger(`Error filling form with AI answers: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a field is part of the education section
   * @param {HTMLElement} element - The form field element
   * @returns {boolean} - True if the field is in the education section
   */
  isEducationField(element) {
    // Check if element is within an education list item
    const isInEducationItem = !!element.closest("li.experience");

    if (!isInEducationItem) return false;

    // Check if the element is in the education section by finding nearby education section header
    let currentNode = element;
    let educationHeading = null;

    // Search up the DOM tree for the parent section
    while (currentNode && !educationHeading) {
      currentNode = currentNode.parentElement;

      // Look for a section with "Education" heading
      if (currentNode && currentNode.classList.contains("section")) {
        const h3Elements = currentNode.querySelectorAll("h3");
        for (const h3 of h3Elements) {
          if (h3.textContent.includes("Education")) {
            educationHeading = h3;
            break;
          }
        }
      }
    }

    if (educationHeading) return true;

    // Check specific education field identifiers
    const educationIdentifiers = [
      'input[placeholder="School"]',
      'input[placeholder="Field of Study"]',
      'input[ng-model="candidateSchool.school_name"]',
      'input[ng-model="candidateSchool.field_of_study"]',
      'input[ng-model="candidateSchool.date_start"]',
      'input[ng-model="candidateSchool.date_end"]',
      'textarea[ng-model="candidateSchool.summary"]',
    ];

    for (const selector of educationIdentifiers) {
      if (element.matches(selector)) return true;
    }

    return false;
  }

  /**
   * Check if a field is part of the work history section
   * @param {HTMLElement} element - The form field element
   * @returns {boolean} - True if the field is in the work history section
   */
  isWorkHistoryField(element) {
    // Check if element is within a work history list item
    const isInWorkHistoryItem = !!element.closest("li.experience");

    if (!isInWorkHistoryItem) return false;

    // Check if the element is in the work history section by finding nearby work history section header
    let currentNode = element;
    let workHistoryHeading = null;

    // Search up the DOM tree for the parent section
    while (currentNode && !workHistoryHeading) {
      currentNode = currentNode.parentElement;

      // Look for a section with "Work History" heading
      if (currentNode && currentNode.classList.contains("section")) {
        const h3Elements = currentNode.querySelectorAll("h3");
        for (const h3 of h3Elements) {
          if (h3.textContent.includes("Work History")) {
            workHistoryHeading = h3;
            break;
          }
        }
      }
    }

    if (workHistoryHeading) return true;

    // Check specific work history field identifiers
    const workHistoryIdentifiers = [
      'input[placeholder="Company"]',
      'input[placeholder="Title"]',
      'input[ng-model="candidatePosition.company"]',
      'input[ng-model="candidatePosition.title"]',
      'input[ng-model="candidatePosition.date_start"]',
      'input[ng-model="candidatePosition.date_end"]',
      'textarea[ng-model="candidatePosition.summary"]',
    ];

    for (const selector of workHistoryIdentifiers) {
      if (element.matches(selector)) return true;
    }

    return false;
  }

  /**
   * Check if an element is visible on the page
   */
  isElementVisible(element) {
    if (!element) return false;

    // Check computed style
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    // Check dimensions and position
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    // Check for parent visibility
    let parent = element.parentElement;
    while (parent) {
      const parentStyle = window.getComputedStyle(parent);
      if (
        parentStyle.display === "none" ||
        parentStyle.visibility === "hidden"
      ) {
        return false;
      }
      parent = parent.parentElement;
    }

    return true;
  }

  /**
   * Scroll an element into view
   */
  scrollToElement(element) {
    if (!element) return;

    try {
      // Use modern scrollIntoView if available
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } catch (error) {
      // Fallback to basic scrollIntoView
      try {
        element.scrollIntoView();
      } catch (e) {
        // Silent fail if scrolling fails
      }
    }
  }

  /**
   * Wait for a specified amount of time
   */
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Find the submit button in a form
   */
  findSubmitButton(form) {
    // Try specific submit button selectors for Breezy
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      "button.submit-button",
      "button.submit",
      "button.apply-button",
      "button.apply",
      "button.btn-primary",
      "button.btn-success",
      ".btn.btn-primary",
      ".btn.btn-success",
      'button[data-ui="submit-application"]',
      ".application-submit",
    ];

    for (const selector of submitSelectors) {
      const buttons = form.querySelectorAll(selector);
      if (buttons.length) {
        // Return the first visible, enabled button
        for (const btn of buttons) {
          if (this.isElementVisible(btn) && !btn.disabled) {
            return btn;
          }
        }
      }
    }

    // Look for buttons with submit-like text
    const allButtons = form.querySelectorAll('button, input[type="button"]');
    for (const btn of allButtons) {
      if (!this.isElementVisible(btn) || btn.disabled) continue;

      const text = btn.textContent.toLowerCase();
      if (
        text.includes("submit") ||
        text.includes("apply") ||
        text.includes("send") ||
        text.includes("continue") ||
        text === "next"
      ) {
        return btn;
      }
    }

    // Last resort: get the last visible button in the form
    const visibleButtons = Array.from(form.querySelectorAll("button")).filter(
      (btn) => this.isElementVisible(btn) && !btn.disabled
    );

    if (visibleButtons.length) {
      return visibleButtons[visibleButtons.length - 1];
    }

    return null;
  }

  /**
   * Submit the form
   */
  async submitForm(form, options = {}) {
    const { dryRun = false } = options;

    try {
      this.logger("Submitting form...");

      // Find the submit button
      const submitButton = this.findSubmitButton(form);

      if (!submitButton) {
        this.logger("No submit button found");
        return false;
      }

      this.logger(
        `Found submit button: ${
          submitButton.textContent || submitButton.value || "Unnamed button"
        }`
      );

      // Make sure it's visible and enabled
      if (!this.isElementVisible(submitButton) || submitButton.disabled) {
        this.logger("Submit button is not clickable (hidden or disabled)");
        return false;
      }

      // Scroll to the button
      this.scrollToElement(submitButton);
      await this.wait(500);

      if (dryRun) {
        this.logger("DRY RUN: Would have clicked submit button");
        return true;
      }

      // Click the button
      submitButton.click();
      this.logger("Clicked submit button");

      // Wait for submission to process
      await this.wait(3000);

      // Check for success
      const success = await this.checkSubmissionSuccess();

      return success;
    } catch (error) {
      this.logger(`Error submitting form: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if form submission was successful
   */
  async checkSubmissionSuccess() {
    try {
      // Method 1: Check for success messages
      const successSelectors = [
        ".success-message",
        ".application-confirmation",
        ".thank-you",
        '[class*="success"]',
        '[class*="thank"]',
        ".application-submitted",
        ".confirmation-message",
      ];

      for (const selector of successSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (this.isElementVisible(element)) {
            this.logger(`Found success element: ${element.textContent}`);
            return true;
          }
        }
      }

      // Method 2: Check for success in page text
      const bodyText = document.body.textContent.toLowerCase();
      const successPhrases = [
        "thank you for applying",
        "application received",
        "application submitted",
        "successfully applied",
        "submission successful",
        "thank you for your interest",
        "we have received your application",
        "thank you for your application",
      ];

      for (const phrase of successPhrases) {
        if (bodyText.includes(phrase)) {
          this.logger(`Found success phrase in page: "${phrase}"`);
          return true;
        }
      }

      // Method 3: Check for URL change indicating success
      if (
        window.location.href.includes("thank") ||
        window.location.href.includes("success") ||
        window.location.href.includes("confirmation") ||
        window.location.href.includes("submitted")
      ) {
        this.logger("URL indicates successful submission");
        return true;
      }

      // Method 4: Check for errors
      const errorSelectors = [
        ".error-message",
        ".form-error",
        ".field-error",
        '[class*="error"]',
        ".invalid-feedback",
      ];

      let foundErrors = false;
      for (const selector of errorSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (this.isElementVisible(element) && element.textContent.trim()) {
            this.logger(`Found error element: ${element.textContent}`);
            foundErrors = true;
          }
        }
      }

      if (foundErrors) {
        this.logger("Submission failed due to validation errors");
        return false;
      }

      // If no clear indicators, assume success
      this.logger(
        "No clear success/error indicators. Assuming successful submission."
      );
      return true;
    } catch (error) {
      this.logger(`Error checking submission success: ${error.message}`);
      return false;
    }
  }

  /**
   * Get available options from select fields
   * @param {HTMLElement} element - The form field element
   * @returns {Array<string>} - Array of option texts
   */
  getFieldOptions(element) {
    try {
      const options = [];
      const fieldType = this.getFieldType(element);

      // Handle select elements
      if (fieldType === "select") {
        if (element.tagName.toLowerCase() === "select") {
          // Standard <select> element
          Array.from(element.options).forEach((option) => {
            const text = option.textContent.trim();
            if (text && option.value) {
              options.push(text);
            }
          });
        } else {
          // Custom select
          const customSelect = element.classList.contains("custom-select")
            ? element
            : element.closest(".custom-select-container");

          if (customSelect) {
            // Try to find dropdown items
            const dropdown = customSelect.querySelector(".dropdown-menu");
            if (dropdown) {
              const items = dropdown.querySelectorAll(".dropdown-item");
              items.forEach((item) => {
                options.push(item.textContent.trim());
              });
            }
          }
        }
      }
      // Handle radio buttons
      else if (fieldType === "radio") {
        // For fieldset radio groups
        const radios =
          element.tagName === "FIELDSET"
            ? element.querySelectorAll('[role="radio"], input[type="radio"]')
            : element
                .closest("fieldset, .custom-radio-group")
                ?.querySelectorAll('[role="radio"], input[type="radio"]') || [];

        // Process all radio options
        radios.forEach((radio) => {
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);
          if (label) {
            options.push(label.textContent.trim());
          }
        });

        // For custom radio buttons
        if (options.length === 0 && element.closest(".custom-radio-group")) {
          element
            .closest(".custom-radio-group")
            .querySelectorAll("label.custom-control-label")
            .forEach((label) => {
              options.push(label.textContent.trim());
            });
        }
      }
      // Handle checkboxes
      else if (fieldType === "checkbox") {
        if (
          element.getAttribute("role") === "group" ||
          element.closest(".custom-checkbox-group")
        ) {
          // Get all checkboxes in the group
          const container =
            element.getAttribute("role") === "group"
              ? element
              : element.closest(".custom-checkbox-group");

          const checkboxes = container.querySelectorAll(
            '[role="checkbox"], input[type="checkbox"]'
          );

          checkboxes.forEach((checkbox) => {
            const label =
              checkbox.closest("label") ||
              document.querySelector(`label[for="${checkbox.id}"]`);
            if (label) {
              options.push(label.textContent.trim());
            }
          });
        }
      }

      return options;
    } catch (error) {
      this.logger(`Error getting field options: ${error.message}`);
      return [];
    }
  }

  /**
   * Fill work history with provided project data
   * @param {HTMLElement} form - The form element containing work history
   * @param {Array} projects - Array of project data
   * @returns {Promise<boolean>} - True if successful
   */
  async fillWorkHistory(form, projects) {
    try {
      this.logger("Filling work history with project data");

      if (!projects || !Array.isArray(projects) || projects.length === 0) {
        this.logger("No project data provided");
        return false;
      }

      // Find the work history section - use standard DOM traversal
      const sections = form.querySelectorAll(".section");
      let workHistorySection = null;

      // Loop through sections to find the one with Work History heading
      for (const section of sections) {
        const heading = section.querySelector("h3");
        if (heading && heading.textContent.includes("Work History")) {
          workHistorySection = section;
          break;
        }
      }

      if (!workHistorySection) {
        this.logger("Work history section not found");
        return false;
      }

      // Find the "Add Position" button - more reliable selector
      const addPositionLinks = workHistorySection.querySelectorAll("a");
      let addPositionButton = null;

      for (const link of addPositionLinks) {
        if (link.textContent.includes("Add Position")) {
          addPositionButton = link;
          break;
        }
      }

      if (!addPositionButton) {
        this.logger("Add Position button not found");
        return false;
      }

      // For each project in the data, add and fill a position
      for (const project of projects) {
        // If we need to add a new position (except for the first one if it already exists)
        const existingPositions =
          workHistorySection.querySelectorAll("li.experience");
        if (existingPositions.length < projects.indexOf(project) + 1) {
          this.logger(`Adding new position for project: ${project.title}`);
          addPositionButton.click();
          // Wait for the new position to be added to the DOM
          await this.wait(500);
        }

        // Get the position element corresponding to this project
        const positions = workHistorySection.querySelectorAll("li.experience");
        const positionIndex = projects.indexOf(project);

        if (positionIndex >= positions.length) {
          this.logger(
            `Position element not found for project: ${project.title}`
          );
          continue;
        }

        const positionElement = positions[positionIndex];

        // Fill in the fields for this position
        const companyInput = positionElement.querySelector(
          'input[placeholder="Company"]'
        );
        const titleInput = positionElement.querySelector(
          'input[placeholder="Title"]'
        );
        const summaryTextarea = positionElement.querySelector(
          'textarea[placeholder="Summary"]'
        );

        // Find date inputs more reliably using the preceding span text
        let startDateInput = null;
        let endDateInput = null;

        // Get all spans in the position element
        const spans = positionElement.querySelectorAll("span");

        for (let i = 0; i < spans.length; i++) {
          const span = spans[i];
          // Check if this span contains the date label text
          if (span.textContent.includes("Start date")) {
            // The date input is the next input[type="date"] after this span
            startDateInput = span.nextElementSibling;
            while (
              startDateInput &&
              (startDateInput.tagName !== "INPUT" ||
                startDateInput.type !== "date")
            ) {
              startDateInput = startDateInput.nextElementSibling;
            }
          } else if (span.textContent.includes("End date")) {
            // The date input is the next input[type="date"] after this span
            endDateInput = span.nextElementSibling;
            while (
              endDateInput &&
              (endDateInput.tagName !== "INPUT" || endDateInput.type !== "date")
            ) {
              endDateInput = endDateInput.nextElementSibling;
            }
          }
        }

        // Alternative approach: Find inputs by ng-model attribute
        if (!startDateInput) {
          startDateInput = positionElement.querySelector(
            'input[ng-model="candidatePosition.date_start"]'
          );
        }

        if (!endDateInput) {
          endDateInput = positionElement.querySelector(
            'input[ng-model="candidatePosition.date_end"]'
          );
        }

        // Company name might not be in your data, set to a default or leave blank
        if (companyInput) {
          await this.fillInputField(companyInput, project.title); // Replace with actual company if available
        }

        if (titleInput && project.title) {
          await this.fillInputField(titleInput, project.title);
        }

        if (summaryTextarea && project.description) {
          await this.fillTextareaField(summaryTextarea, project.description);
        }

        // Parse and format dates
        if (startDateInput && project.startDate) {
          const startDate = this.parseDate(project.startDate);
          await this.fillDateField(startDateInput, startDate);
        } else if (project.startDate) {
          this.logger(
            `Start date input not found for project: ${project.title}`
          );
        }

        if (endDateInput && project.endDate) {
          const endDate = this.parseDate(project.endDate);
          await this.fillDateField(endDateInput, endDate);
        } else if (project.endDate) {
          this.logger(`End date input not found for project: ${project.title}`);
        }

        // Wait a bit between filling positions
        await this.wait(300);
      }

      this.logger(
        `Successfully filled ${projects.length} work history positions`
      );
      return true;
    } catch (error) {
      this.logger(`Error filling work history: ${error.message}`);
      return false;
    }
  }

  /**
   * Parse date from string format to ISO format
   * @param {string} dateString - Date string like "February 2015"
   * @returns {string} - ISO format date string
   */
  parseDate(dateString) {
    try {
      // Parse dates like "February 2015"
      const dateParts = dateString.split(" ");
      if (dateParts.length === 2) {
        const monthNames = [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ];
        const month = monthNames.indexOf(dateParts[0]) + 1;
        const year = parseInt(dateParts[1]);

        if (!isNaN(month) && !isNaN(year)) {
          return `${year}-${month.toString().padStart(2, "0")}-01`; // Default to 1st of the month
        }
      }

      // Fallback to original string
      return dateString;
    } catch (error) {
      this.logger(`Error parsing date "${dateString}": ${error.message}`);
      return dateString;
    }
  }

  /**
   * Fill education history with provided education data
   * @param {HTMLElement} form - The form element containing education history
   * @param {Object} educationData - Object containing education data
   * @returns {Promise<boolean>} - True if successful
   */
  async fillEducation(form, educationData) {
    try {
      this.logger("Filling education history with education data");

      if (!educationData || !educationData.education) {
        this.logger("No education data provided");
        return false;
      }

      // Direct selectors based on the HTML structure
      const educationAddButton = form.querySelector(
        'a[ng-click*="addEducation()"]'
      );

      if (!educationAddButton) {
        this.logger("Add Education button not found");
        return false;
      }

      // Get the UL that contains education items
      // It should be right before the section-footer with the add button
      const educationList =
        educationAddButton.closest(".section-footer").previousElementSibling;

      if (!educationList || educationList.tagName !== "UL") {
        this.logger("Education list not found");
        return false;
      }

      // Check if we need to add a new education entry
      const existingSchools = educationList.querySelectorAll("li.experience");
      if (existingSchools.length === 0) {
        this.logger("Adding new education entry");
        educationAddButton.click();
        // Wait for the new position to be added to the DOM
        await this.wait(500);
      }

      // Get the education element after possibly adding it
      const educationElement = educationList.querySelector("li.experience");

      if (!educationElement) {
        this.logger("Education element not found");
        return false;
      }

      // Fill in the fields using direct selectors
      const schoolInput = educationElement.querySelector(
        'input[placeholder="School"]'
      );
      const fieldOfStudyInput = educationElement.querySelector(
        'input[placeholder="Field of Study"]'
      );
      const summaryTextarea = educationElement.querySelector(
        'textarea[placeholder="Summary"]'
      );
      const startDateInput = educationElement.querySelector(
        'input[ng-model="candidateSchool.date_start"]'
      );
      const endDateInput = educationElement.querySelector(
        'input[ng-model="candidateSchool.date_end"]'
      );

      // Fill school name
      if (schoolInput && educationData.education.school) {
        await this.fillInputField(schoolInput, educationData.education.school);
      }

      // Fill field of study (major)
      if (fieldOfStudyInput && educationData.education.major) {
        await this.fillInputField(
          fieldOfStudyInput,
          educationData.education.major
        );
      }

      // Fill summary (can include degree information)
      if (summaryTextarea) {
        const summaryText = `${
          educationData.education.degree || ""
        } degree in ${educationData.education.major || ""}`.trim();
        await this.fillTextareaField(summaryTextarea, summaryText);
      }

      // Parse and format start date
      if (
        startDateInput &&
        educationData.educationStartMonth &&
        educationData.educationStartYear
      ) {
        const startDate = `${educationData.educationStartMonth} ${educationData.educationStartYear}`;
        const formattedStartDate = this.parseDate(startDate);
        console.log(fieldOfStudyInput);
        await this.fillDateField(startDateInput, formattedStartDate);
      }

      // Parse and format end date
      console.log(
        endDateInput,
        educationData.educationEndMonth,
        educationData.educationEndYear
      );
      if (
        endDateInput &&
        educationData.educationEndMonth &&
        educationData.educationEndYear
      ) {
        const endDate = `${educationData.educationEndMonth} ${educationData.educationEndYear}`;
        const formattedEndDate = this.parseDate(endDate);
        console.log(formattedEndDate);

        await this.fillDateField(endDateInput, formattedEndDate);
      }

      this.logger("Successfully filled education history");
      return true;
    } catch (error) {
      this.logger(`Error filling education history: ${error.message}`);
      return false;
    }
  }
}
