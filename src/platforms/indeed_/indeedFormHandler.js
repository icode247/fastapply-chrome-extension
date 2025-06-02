import { HOST } from "@shared/constants";

/**
 * IndeedFormHandler - Handles Indeed application form filling
 */
class IndeedFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || HOST;
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.answerCache = new Map();
    this.requestTimeout = 10000; // 10 second timeout
  }

  /**
   * Check if an element is visible
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
        rect.height > 0
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Find submit button in form
   */
  findSubmitButton(form) {
    // Try specific selectors for continue/submit buttons
    const buttonSelectors = [
      'button[type="submit"]',
      "button.ia-continueButton",
      "button.ia-SubmitButton",
      "button.IndeedApplyButton",
      "button.ia-continueButton-continue",
      'button[data-testid="continueButton"]',
      'input[type="submit"]',
      'button:contains("Submit")',
      'button:contains("Apply")',
      'button:contains("Continue")',
      'button:contains("Next")',
    ];

    // Try each selector
    for (const selector of buttonSelectors) {
      try {
        const buttons = form.querySelectorAll(selector);
        for (const button of buttons) {
          if (this.isElementVisible(button)) {
            return button;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Look for any button with submit, continue, apply text
    const allButtons = form.querySelectorAll('button, input[type="submit"]');
    for (const button of allButtons) {
      if (!this.isElementVisible(button)) continue;

      const buttonText = button.textContent.toLowerCase().trim();
      if (
        buttonText.includes("submit") ||
        buttonText.includes("apply") ||
        buttonText.includes("continue") ||
        buttonText.includes("next") ||
        button.getAttribute("aria-label")?.toLowerCase().includes("continue")
      ) {
        return button;
      }
    }

    return null;
  }

  /**
   * Fill form with profile data
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.logger("Filling form with profile data");

      // Get all form elements
      const formElements = form.querySelectorAll("input, select, textarea");

      for (const element of formElements) {
        // Skip hidden inputs, submit buttons
        if (
          element.type === "hidden" ||
          element.type === "submit" ||
          element.type === "button" ||
          element.type === "file" || // File uploads handled separately
          !this.isElementVisible(element)
        ) {
          continue;
        }

        const elementName = element.name || "";
        const elementId = element.id || "";
        const elementPlaceholder = element.placeholder || "";

        // Try to identify field by label, name, or placeholder
        const labelText = this.getElementLabel(element);

        this.logger(
          `Processing field: ${labelText || elementName || elementId}`
        );

        // Handle different input types
        await this.handleInputElement(element, labelText, profile);
      }

      return true;
    } catch (error) {
      this.logger(`Error filling form: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle required checkboxes (terms, consent boxes)
   */
  async handleRequiredCheckboxes(form) {
    try {
      const checkboxes = form.querySelectorAll('input[type="checkbox"]');

      for (const checkbox of checkboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const labelText = this.getElementLabel(checkbox).toLowerCase();

        // Check boxes that are likely required terms/conditions/consent
        if (
          labelText.includes("agree") ||
          labelText.includes("terms") ||
          labelText.includes("consent") ||
          labelText.includes("policy") ||
          labelText.includes("confirm") ||
          labelText.includes("authorize")
        ) {
          if (!checkbox.checked) {
            checkbox.click();
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
      }

      return true;
    } catch (error) {
      this.logger(`Error handling checkboxes: ${error.message}`);
      return false;
    }
  }

  /**
   * Submit the form
   */
  async submitForm(form) {
    try {
      // Find submit button
      const submitButton = this.findSubmitButton(form);

      if (!submitButton) {
        this.logger("No submit button found");
        return false;
      }

      this.logger(`Clicking submit button: ${submitButton.textContent.trim()}`);

      // Click the button
      submitButton.click();

      // Wait for potential loading or confirmation
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check for success indicators or next steps
      return this.checkSubmissionResult();
    } catch (error) {
      this.logger(`Error submitting form: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if form submission was successful
   */
  checkSubmissionResult() {
    try {
      // Check for common success indicators
      const successSelectors = [
        ".ia-ApplicationMessage-successMessage",
        ".ia-JobActionConfirmation-container",
        ".ia-SuccessPage",
        ".ia-JobApplySuccess",
        'div:contains("Application submitted")',
        'div:contains("Your application has been submitted")',
      ];

      for (const selector of successSelectors) {
        try {
          const successElement = document.querySelector(selector);
          if (successElement && this.isElementVisible(successElement)) {
            this.logger("Found success indicator");
            return true;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Check for next form page
      const continueButton = this.findSubmitButton(document);
      if (continueButton) {
        this.logger("Form continues to next step");
        return true;
      }

      // Check page text
      const pageText = document.body.innerText.toLowerCase();
      if (
        pageText.includes("application submitted") ||
        pageText.includes("successfully applied") ||
        pageText.includes("thank you for applying")
      ) {
        this.logger("Found success text in page");
        return true;
      }

      this.logger("No clear success indicators found");
      return false;
    } catch (error) {
      this.logger(`Error checking submission: ${error.message}`);
      return false;
    }
  }

  /**
   * Get label text for a form element
   */
  getElementLabel(element) {
    if (!element) return "";

    // Check for explicit label
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        return label.textContent.trim();
      }
    }

    // Check for parent label
    const parentLabel = element.closest("label");
    if (parentLabel) {
      // Filter out nested form control text
      const clone = parentLabel.cloneNode(true);
      const controls = clone.querySelectorAll(
        "input, select, textarea, button"
      );
      controls.forEach((el) => el.remove());

      return clone.textContent.trim();
    }

    // Check for label in parent div
    const parentDiv = element.closest("div");
    if (parentDiv) {
      const labels = parentDiv.querySelectorAll(
        'label, div[class*="label"], span[class*="label"]'
      );
      for (const label of labels) {
        const labelText = label.textContent.trim();
        if (labelText) {
          return labelText;
        }
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

    // Check for aria-label
    if (element.getAttribute("aria-label")) {
      return element.getAttribute("aria-label");
    }

    // Check for placeholder
    if (element.getAttribute("placeholder")) {
      return element.getAttribute("placeholder");
    }

    // Use name as fallback
    return element.name || "";
  }

  /**
   * Handle an individual input element based on its type
   */
  async handleInputElement(element, labelText, profile) {
    if (!labelText) return;

    const normalizedLabel = labelText.toLowerCase().trim();

    // Skip elements that appear to be search fields
    if (
      normalizedLabel.includes("search") &&
      !normalizedLabel.includes("job search")
    ) {
      return;
    }

    try {
      switch (element.type) {
        case "text":
        case "email":
        case "tel":
        case "url":
          await this.handleTextField(element, normalizedLabel, profile);
          break;

        case "textarea":
          await this.handleTextArea(element, normalizedLabel, profile);
          break;

        case "select-one":
          await this.handleSelectField(element, normalizedLabel, profile);
          break;

        case "radio":
          await this.handleRadioButton(element, normalizedLabel, profile);
          break;

        case "checkbox":
          await this.handleCheckbox(element, normalizedLabel, profile);
          break;
      }

      // Wait briefly after handling each element
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      this.logger(
        `Error handling ${element.type} field "${normalizedLabel}": ${error.message}`
      );
    }
  }

  /**
   * Handle text input fields
   */
  async handleTextField(element, labelText, profile) {
    let value = "";

    // Determine field type from label
    if (labelText.includes("first name") || labelText.includes("firstname")) {
      value = profile.firstName;
    } else if (
      labelText.includes("last name") ||
      labelText.includes("lastname")
    ) {
      value = profile.lastName;
    } else if (labelText.includes("full name") || labelText === "name") {
      value = `${profile.firstName} ${profile.lastName}`;
    } else if (labelText.includes("email")) {
      value = profile.email;
    } else if (labelText.includes("phone") || labelText.includes("mobile")) {
      value = profile.phoneNumber || profile.phone;
    } else if (labelText.includes("address")) {
      value = profile.address || profile.streetAddress || "";
    } else if (labelText.includes("city")) {
      value = profile.city || "";
    } else if (labelText.includes("state") || labelText.includes("province")) {
      value = profile.state || "";
    } else if (labelText.includes("zip") || labelText.includes("postal")) {
      value = profile.zip || profile.postalCode || "";
    } else if (labelText.includes("country")) {
      value = profile.country || "";
    } else if (labelText.includes("linkedin")) {
      value = profile.linkedin || profile.linkedinUrl || "";
    } else if (
      labelText.includes("website") ||
      labelText.includes("portfolio")
    ) {
      value = profile.website || profile.websiteUrl || "";
    } else if (labelText.includes("github")) {
      value = profile.github || profile.githubUrl || "";
    } else if (
      labelText.includes("salary") ||
      labelText.includes("compensation")
    ) {
      value = profile.desiredSalary || "Negotiable";
    } else if (labelText.includes("headline") || labelText.includes("title")) {
      value = profile.currentTitle || profile.jobTitle || "";
    } else if (element.type === "tel" && element.closest(".PhoneInput")) {
      // Phone input with potential country code component
      await this.handlePhoneInput(
        element,
        profile.phoneNumber || profile.phone
      );
      return;
    } else {
      // For unrecognized fields, try to get an AI answer
      value = await this.getValueForField(labelText);
    }

    if (!value) return;

    try {
      // Focus and clear field
      element.focus();
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Set new value
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      element.blur();
    } catch (error) {
      this.logger(`Error filling ${labelText}: ${error.message}`);
    }
  }

  /**
   * Handle textarea fields (like cover letters, additional info)
   */
  async handleTextArea(element, labelText, profile) {
    let value = "";

    if (labelText.includes("cover letter")) {
      value = this.generateCoverLetter(profile);
    } else if (
      labelText.includes("additional information") ||
      labelText.includes("anything else")
    ) {
      value = this.generateAdditionalInfo(profile);
    } else if (
      labelText.includes("summary") ||
      labelText.includes("about you")
    ) {
      value =
        profile.summary ||
        profile.profileSummary ||
        this.generateSummary(profile);
    } else {
      // For unrecognized fields, try to get an AI answer
      value = await this.getValueForField(labelText);
    }

    if (!value) return;

    try {
      // Focus and clear field
      element.focus();
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Set new value
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));

      element.blur();
    } catch (error) {
      this.logger(`Error filling ${labelText}: ${error.message}`);
    }
  }

  /**
   * Handle select dropdown fields
   */
  async handleSelectField(element, labelText, profile) {
    if (!element.options || element.options.length === 0) return;

    // Extract options
    const options = Array.from(element.options).map((opt) => opt.text.trim());

    // Determine appropriate value based on label
    let valueToSelect = "";

    if (labelText.includes("country")) {
      valueToSelect = profile.country || "United States";
    } else if (labelText.includes("state") || labelText.includes("province")) {
      valueToSelect = profile.state || "";
    } else if (
      labelText.includes("education") ||
      labelText.includes("degree")
    ) {
      valueToSelect = profile.highestDegree || profile.degree || "Bachelor's";
    } else if (
      labelText.includes("experience") ||
      labelText.includes("years")
    ) {
      valueToSelect = profile.yearsOfExperience || "3";
    } else if (labelText.includes("gender") || labelText.includes("pronouns")) {
      valueToSelect = "Prefer not to say";
    } else if (labelText.includes("race") || labelText.includes("ethnicity")) {
      valueToSelect = "Prefer not to say";
    } else if (labelText.includes("veterans")) {
      valueToSelect = "I am not a protected veteran";
    } else if (labelText.includes("disability")) {
      valueToSelect = "No, I don't have a disability";
    } else if (
      labelText.includes("sponsorship") ||
      labelText.includes("visa")
    ) {
      valueToSelect = "No";
    } else if (
      labelText.includes("citizenship") ||
      labelText.includes("authorized")
    ) {
      valueToSelect = "Yes";
    } else {
      // For unrecognized fields, use AI to pick the best option
      valueToSelect = await this.getValueForField(labelText, options);
    }

    // Try to find and select the appropriate option
    await this.selectOption(element, valueToSelect, options);
  }

  /**
   * Handle radio button inputs
   */
  async handleRadioButton(element, labelText, profile) {
    // Skip if already checked
    if (element.checked) return;

    // Get all radio buttons in the group
    const name = element.name;
    if (!name) return;

    const radioGroup = document.getElementsByName(name);
    if (radioGroup.length <= 1) return;

    // Get radio button options
    const options = Array.from(radioGroup).map(
      (radio) => this.getElementLabel(radio) || radio.value
    );

    // Determine which option to select
    let valueToSelect = "";

    if (labelText.includes("sponsorship") || labelText.includes("visa")) {
      valueToSelect = "No";
    } else if (
      labelText.includes("authorized") ||
      labelText.includes("citizen")
    ) {
      valueToSelect = "Yes";
    } else if (labelText.includes("gender") || labelText.includes("pronouns")) {
      valueToSelect = "Prefer not to say";
    } else if (labelText.includes("disability")) {
      valueToSelect = "No";
    } else if (labelText.includes("relocate")) {
      valueToSelect = "Yes";
    } else if (labelText.includes("remote")) {
      valueToSelect = "Yes";
    } else if (labelText.includes("background check")) {
      valueToSelect = "Yes";
    } else if (labelText.includes("drug test")) {
      valueToSelect = "Yes";
    } else if (labelText.includes("notice")) {
      valueToSelect = "2 weeks";
    } else if (labelText.includes("travel")) {
      valueToSelect = "Yes";
    } else {
      // For unrecognized fields, use AI to pick the best option
      valueToSelect = await this.getValueForField(labelText, options);
    }

    // Find and click the matching radio button
    await this.selectRadioOption(radioGroup, valueToSelect);
  }

  /**
   * Handle checkbox inputs
   */
  async handleCheckbox(element, labelText, profile) {
    // Terms/consent/policy checkboxes handled separately
    if (
      labelText.includes("agree") ||
      labelText.includes("terms") ||
      labelText.includes("consent") ||
      labelText.includes("policy") ||
      labelText.includes("confirm") ||
      labelText.includes("authorize")
    ) {
      return;
    }

    // Handle specific checkbox types
    let shouldCheck = false;

    if (labelText.includes("newsletter") || labelText.includes("subscribe")) {
      shouldCheck = false;
    } else if (
      labelText.includes("contact me") ||
      labelText.includes("notifications")
    ) {
      shouldCheck = false;
    } else if (labelText.includes("save") || labelText.includes("store")) {
      shouldCheck = true;
    } else {
      // For unrecognized checkboxes, get AI answer
      const value = await this.getValueForField(labelText, ["Yes", "No"]);
      shouldCheck = value.toLowerCase() === "yes";
    }

    // Set checkbox state
    if (
      (shouldCheck && !element.checked) ||
      (!shouldCheck && element.checked)
    ) {
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Handle phone input with country code
   */
  async handlePhoneInput(element, phoneValue) {
    if (!phoneValue) return;

    try {
      // Find the country select element
      const countrySelect = element
        .closest(".PhoneInput")
        ?.querySelector("select");

      if (countrySelect) {
        // Parse phone number to extract country code and number
        const normalizedValue = phoneValue.replace(/[^\d+]/g, "");
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
        element.focus();
        element.value = "";
        element.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));

        element.value = phoneNumber;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));

        element.blur();
      } else {
        // No country select, just input the whole phone number
        element.focus();
        element.value = "";
        element.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));

        element.value = phoneValue;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));

        element.blur();
      }
    } catch (error) {
      this.logger(`Error handling phone input: ${error.message}`);
    }
  }

  /**
   * Select an option from a dropdown
   */
  async selectOption(element, value, options) {
    if (!value || !element.options || element.options.length === 0) return;

    const normalizedValue = value.toLowerCase().trim();

    // Array of matching strategies from exact to fuzzy
    const strategies = [
      // Exact matches
      (opt) => opt.value.toLowerCase().trim() === normalizedValue,
      (opt) => opt.text.toLowerCase().trim() === normalizedValue,
      // Partial matches
      (opt) => opt.value.toLowerCase().includes(normalizedValue),
      (opt) => opt.text.toLowerCase().includes(normalizedValue),
      // Word matches
      (opt) =>
        normalizedValue
          .split(" ")
          .some((word) => opt.text.toLowerCase().includes(word)),
      // First non-empty option as fallback (if not placeholder)
      (opt) =>
        opt.value && opt.value.trim() !== "" && !opt.text.includes("Select"),
    ];

    for (const strategy of strategies) {
      const matchedOption = Array.from(element.options).find(strategy);
      if (matchedOption) {
        element.focus();
        element.value = matchedOption.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        this.logger(`Selected "${matchedOption.text}" for dropdown`);
        return;
      }
    }

    // If no match found and this is not the first call, try with a more general value
    if (value !== "any" && options.length > 0) {
      // Try with 'any' or select first non-placeholder option
      const nonPlaceholders = Array.from(element.options).filter(
        (opt) => opt.value && !opt.text.toLowerCase().includes("select")
      );

      if (nonPlaceholders.length > 0) {
        element.focus();
        element.value = nonPlaceholders[0].value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        this.logger(
          `Selected first valid option: "${nonPlaceholders[0].text}"`
        );
      }
    }
  }

  /**
   * Select a radio button option
   */
  async selectRadioOption(radioGroup, value) {
    if (!value || !radioGroup || radioGroup.length === 0) return;

    const normalizedValue = value.toLowerCase().trim();

    // Try to find the best matching radio button
    let selectedRadio = null;

    // Try exact match on label or value
    for (const radio of radioGroup) {
      const radioLabel = this.getElementLabel(radio).toLowerCase();
      const radioValue = radio.value.toLowerCase();

      if (radioLabel === normalizedValue || radioValue === normalizedValue) {
        selectedRadio = radio;
        break;
      }
    }

    // Try partial match
    if (!selectedRadio) {
      for (const radio of radioGroup) {
        const radioLabel = this.getElementLabel(radio).toLowerCase();
        const radioValue = radio.value.toLowerCase();

        if (
          radioLabel.includes(normalizedValue) ||
          normalizedValue.includes(radioLabel) ||
          radioValue.includes(normalizedValue) ||
          normalizedValue.includes(radioValue)
        ) {
          selectedRadio = radio;
          break;
        }
      }
    }

    // Specific logic for yes/no questions
    if (
      !selectedRadio &&
      (normalizedValue === "yes" || normalizedValue === "no")
    ) {
      for (const radio of radioGroup) {
        const radioLabel = this.getElementLabel(radio).toLowerCase();
        if (
          (normalizedValue === "yes" &&
            (radioLabel.includes("yes") || radioLabel === "y")) ||
          (normalizedValue === "no" &&
            (radioLabel.includes("no") || radioLabel === "n"))
        ) {
          selectedRadio = radio;
          break;
        }
      }
    }

    // Default to first radio if no match and not already selected
    if (!selectedRadio && radioGroup.length > 0 && !radioGroup[0].checked) {
      selectedRadio = radioGroup[0];
    }

    // Click the selected radio
    if (selectedRadio && !selectedRadio.checked) {
      selectedRadio.focus();
      selectedRadio.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      selectedRadio.blur();
      this.logger(
        `Selected radio option: ${this.getElementLabel(selectedRadio)}`
      );
    }
  }

  /**
   * Get AI-generated value for a field
   */
  async getValueForField(labelText, options = []) {
    try {
      const normalizedLabel = labelText.toLowerCase().trim();

      // Check cache first
      const cachedAnswer = this.answerCache.get(normalizedLabel);
      if (cachedAnswer) {
        return cachedAnswer;
      }

      // Common fields with fixed answers
      if (
        normalizedLabel.includes("authorized") ||
        normalizedLabel.includes("legal right")
      ) {
        return "Yes";
      } else if (
        normalizedLabel.includes("sponsorship") ||
        normalizedLabel.includes("visa sponsor")
      ) {
        return "No";
      } else if (
        normalizedLabel.includes("notice period") ||
        normalizedLabel.includes("start date")
      ) {
        return "2 weeks";
      } else if (
        normalizedLabel.includes("relocate") ||
        normalizedLabel.includes("relocation")
      ) {
        return "Yes";
      } else if (
        normalizedLabel.includes("remote") ||
        normalizedLabel.includes("work from home")
      ) {
        return "Yes";
      } else if (normalizedLabel.includes("background check")) {
        return "Yes";
      } else if (normalizedLabel.includes("drug test")) {
        return "Yes";
      } else if (normalizedLabel.includes("travel")) {
        return "Yes";
      } else if (
        normalizedLabel.includes("availability") ||
        normalizedLabel.includes("interview")
      ) {
        return this.generateAvailabilityDates();
      }

      // Call AI service for other fields
      try {
        const response = await fetch(`${this.host}/api/ai-answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: normalizedLabel,
            options: options,
            userData: this.userData,
            description: this.jobDescription,
          }),
        });

        if (!response.ok) {
          throw new Error(`AI service error: ${response.status}`);
        }

        const data = await response.json();

        // Cache the response
        this.answerCache.set(normalizedLabel, data.answer);

        return data.answer;
      } catch (error) {
        this.logger(`AI answer error: ${error.message}`);

        // Return default values for common fields
        if (options.length > 0) {
          // Return first option that's not a placeholder
          const validOption = options.find(
            (opt) =>
              !opt.toLowerCase().includes("select") &&
              !opt.toLowerCase().includes("choose")
          );
          return validOption || options[0];
        }

        return "";
      }
    } catch (error) {
      this.logger(`Error getting value for field: ${error.message}`);
      return options.length > 0 ? options[0] : "";
    }
  }

  /**
   * Generate cover letter based on profile and job
   */
  generateCoverLetter(profile) {
    const name = `${profile.firstName} ${profile.lastName}`;
    const jobTitle =
      document.querySelector("h1")?.textContent?.trim() || "this position";
    const company =
      document
        .querySelector('[data-testid="company-name"]')
        ?.textContent?.trim() || "your company";

    return `Dear Hiring Manager,

I am writing to express my interest in the ${jobTitle} role at ${company}. With my background in ${
      profile.role || "this field"
    } and experience in ${
      profile.skills?.[0] || "relevant skills"
    }, I believe I would be a strong candidate for this position.

My previous experience has equipped me with the skills necessary to succeed in this role. I am particularly attracted to ${company} because of its reputation for ${
      company.includes("tech") ? "innovation" : "excellence"
    } in the industry.

I am excited about the opportunity to bring my skills to your team and contribute to your continued success. Thank you for considering my application.

Sincerely,
${name}`;
  }

  /**
   * Generate summary based on profile
   */
  generateSummary(profile) {
    return `Experienced ${profile.role || "professional"} with ${
      profile.yearsOfExperience || "several"
    } years of experience in ${
      profile.industry || "the industry"
    }. Skilled in ${
      profile.skills?.join(", ") || "relevant technical skills"
    } with a proven track record of ${
      profile.achievements?.[0] || "delivering results"
    }.`;
  }

  /**
   * Generate additional information text
   */
  generateAdditionalInfo(profile) {
    return `I am particularly interested in this role because it aligns with my professional goals of advancing in the ${
      profile.role || "field"
    }. My background in ${
      profile.skills?.[0] || "relevant areas"
    } has prepared me well for the responsibilities outlined in the job description. I am confident I can make a positive contribution to your team.`;
  }

  /**
   * Generate availability dates for interviews
   */
  generateAvailabilityDates() {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const now = new Date();

    // Find next Monday
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7));

    // Generate dates for next week
    const dates = [];
    for (let i = 0; i < 5; i++) {
      const date = new Date(nextMonday);
      date.setDate(nextMonday.getDate() + i);
      dates.push(
        `${days[i]}, ${date.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
        })}`
      );
    }

    return `I am available for interviews on ${dates[0]}, ${dates[2]}, and ${dates[4]} between 9:00 AM and 5:00 PM.`;
  }
}

export { IndeedFormHandler };
