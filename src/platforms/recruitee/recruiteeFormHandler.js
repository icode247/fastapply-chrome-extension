import { HOST } from "@shared/constants";

/**
 * Recruitee Form Handler - Specialized for Recruitee forms
 */
export class RecruiteeFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || (() => {});
    this.host = options.host || HOST;
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
  }

  /**
   * Fill out the form with profile data
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.logger("Starting to fill form with profile data");

      // Process fieldsets first (for grouped fields and questions)
      await this.processFieldsets(form, profile);

      // Get all form elements that can be filled
      const formElements = form.querySelectorAll("input, select, textarea");

      // Populate all fields
      for (const element of formElements) {
        // Skip hidden fields, submit buttons, and already filled fields
        if (
          element.type === "submit" ||
          element.type === "hidden" ||
          element.type === "file" ||
          !this.isElementVisible(element) ||
          (element.value &&
            element.type !== "checkbox" &&
            element.type !== "radio")
        ) {
          continue;
        }

        // Get field info
        const fieldInfo = this.getFieldInfo(element);
        if (!fieldInfo.shouldFill) {
          continue;
        }

        // Determine value to fill
        const valueToFill = await this.determineValueToFill(
          element,
          fieldInfo,
          profile
        );
        if (valueToFill === null || valueToFill === undefined) {
          continue;
        }

        // Fill the field
        await this.fillField(element, valueToFill);
      }

      // Handle special phone input field with country code
      await this.handleRecruiteePhoneInput(form, profile);
      this.logger("Completed filling form with profile data");
      return true;
    } catch (error) {
      this.logger(`Error filling form: ${error.message}`);
      return false;
    }
  }

  /**
   * Process fieldsets which may contain grouped fields
   */
  async processFieldsets(form, profile) {
    try {
      // Find all fieldsets
      const fieldsets = form.querySelectorAll("fieldset");

      for (const fieldset of fieldsets) {
        // Check if this is a question fieldset
        const legend = fieldset.querySelector("legend");
        if (!legend) continue;

        const questionText = legend.textContent.trim().replace(/\*$/, "");
        if (!questionText) continue;

        // Look for radio buttons in this fieldset
        const radioInputs = fieldset.querySelectorAll('input[type="radio"]');
        if (radioInputs.length > 0) {
          await this.handleRadioQuestion(
            fieldset,
            questionText,
            radioInputs,
            profile
          );
          continue;
        }

        // Look for checkboxes in this fieldset
        const checkboxInputs = fieldset.querySelectorAll(
          'div input[type="checkbox"]'
        );
        if (checkboxInputs.length > 0) {
          await this.handleCheckboxQuestion(
            fieldset,
            questionText,
            checkboxInputs,
            profile
          );
          continue;
        }
      }
    } catch (error) {
      this.logger(`Error processing fieldsets: ${error.message}`);
    }
  }

  /**
   * Handle radio button question
   */
  async handleRadioQuestion(fieldset, questionText, radioInputs, profile) {
    try {
      // Extract option texts and values
      const options = [];
      const radioMap = new Map();

      for (const radio of radioInputs) {
        const label = this.findRadioLabel(radio);
        if (label) {
          options.push(label);
          radioMap.set(label, radio);
        }
      }

      if (options.length === 0) return;

      // Get AI response if possible
      let selectedOption = null;
      try {
        const aiResponse = await this.getAISelectOption(
          questionText,
          options,
          profile
        );
        if (aiResponse) {
          // Find closest match
          selectedOption = this.findClosestMatch(aiResponse, options);
        }
      } catch (error) {
        this.logger(
          `AI response error: ${error.message}, using fallback logic`
        );

        // Handle common question patterns
        if (
          questionText.toLowerCase().includes("citizenship") ||
          questionText.toLowerCase().includes("eligible") ||
          questionText.toLowerCase().includes("authorized")
        ) {
          // Default to "Yes" for eligibility questions
          selectedOption = options.find((opt) => opt.toLowerCase() === "yes");
        }
      }

      // Select appropriate radio button
      if (selectedOption && radioMap.has(selectedOption)) {
        const radioToSelect = radioMap.get(selectedOption);
        await this.fillRadioButton(radioToSelect, true);
        this.logger(
          `Selected "${selectedOption}" for question: ${questionText}`
        );
      } else if (radioInputs.length > 0) {
        // Fallback: select first option for required fields or "Yes" if that exists
        const isRequired = this.isFieldRequired(radioInputs[0]);
        if (isRequired) {
          const yesOption = Array.from(radioInputs).find(
            (radio) => this.findRadioLabel(radio).toLowerCase() === "yes"
          );

          if (yesOption) {
            await this.fillRadioButton(yesOption, true);
            this.logger(
              `Selected "Yes" for required question: ${questionText}`
            );
          } else {
            await this.fillRadioButton(radioInputs[0], true);
            this.logger(
              `Selected first option for required question: ${questionText}`
            );
          }
        }
      }
    } catch (error) {
      this.logger(
        `Error handling radio question "${questionText}": ${error.message}`
      );
    }
  }

  /**
   * Handle checkbox group question
   */
  async handleCheckboxQuestion(
    fieldset,
    questionText,
    checkboxInputs,
    profile
  ) {
    try {
      // Get if this is a required field
      const isRequired = Array.from(checkboxInputs).some((checkbox) =>
        this.isFieldRequired(checkbox)
      );

      // Handle location checkboxes separately
      if (
        questionText.toLowerCase().includes("location") ||
        fieldset.querySelector('input[name="candidate.locations.value"]')
      ) {
        // Will be handled by handleLocationCheckboxes method
        return;
      }

      // For other checkbox groups
      if (isRequired) {
        // Get all options
        const options = [];
        const checkboxMap = new Map();

        for (const checkbox of checkboxInputs) {
          const label = this.findRadioLabel(checkbox);
          if (label) {
            options.push(label);
            checkboxMap.set(label, checkbox);
          }
        }

        // Try AI for multiple selection
        try {
          const aiResponse = await this.getAISelectOption(
            questionText,
            options,
            profile
          );
          if (aiResponse) {
            // AI may return comma-separated values for multiple selection
            const selectedOptions = aiResponse
              .split(",")
              .map((opt) => opt.trim());
            let selected = false;

            for (const option of selectedOptions) {
              const matchedOption = this.findClosestMatch(option, options);
              if (matchedOption && checkboxMap.has(matchedOption)) {
                await this.fillCheckbox(checkboxMap.get(matchedOption), true);
                selected = true;
                this.logger(
                  `Selected "${matchedOption}" for question: ${questionText}`
                );
              }
            }

            // If nothing was selected, select the first option
            if (!selected && checkboxInputs.length > 0) {
              await this.fillCheckbox(checkboxInputs[0], true);
              this.logger(
                `Selected first option for checkbox question: ${questionText}`
              );
            }
          }
        } catch (error) {
          this.logger(
            `AI error for checkboxes: ${error.message}, selecting first option`
          );

          // Fallback: select first checkbox for required fields
          if (checkboxInputs.length > 0) {
            await this.fillCheckbox(checkboxInputs[0], true);
            this.logger(
              `Selected first option for required checkbox group: ${questionText}`
            );
          }
        }
      }
    } catch (error) {
      this.logger(
        `Error handling checkbox question "${questionText}": ${error.message}`
      );
    }
  }

  /**
   * Handle location checkboxes
   */
  async handleLocationCheckboxes(form, profile) {
    try {
      // Find location fieldset
      const locationFieldset = form
        .querySelector('fieldset input[name="candidate.locations.value"]')
        ?.closest("fieldset");
      if (!locationFieldset) return;

      const legend = locationFieldset.querySelector("legend");
      if (!legend) return;

      const checkboxes = locationFieldset.querySelectorAll(
        'input[type="checkbox"]'
      );
      if (checkboxes.length === 0) return;

      // Check if field is required
      const isRequired = Array.from(checkboxes).some((checkbox) =>
        this.isFieldRequired(checkbox)
      );

      // Get user's location preference
      const userLocation = profile.city || profile.location || "";
      const isRemotePreferred =
        profile.workplaceType === "REMOTE" ||
        (profile.preferences && profile.preferences.remote) ||
        userLocation.toLowerCase().includes("remote");

      // Try to find matching locations
      let foundMatch = false;

      // First look for remote option if user prefers remote
      if (isRemotePreferred) {
        for (const checkbox of checkboxes) {
          const label = this.findRadioLabel(checkbox);
          if (label && label.toLowerCase().includes("remote")) {
            await this.fillCheckbox(checkbox, true);
            this.logger(`Selected remote location: ${label}`);
            foundMatch = true;
            break;
          }
        }
      }

      // Then look for city/location match
      if (!foundMatch && userLocation) {
        for (const checkbox of checkboxes) {
          const label = this.findRadioLabel(checkbox);
          if (
            label &&
            (label.toLowerCase().includes(userLocation.toLowerCase()) ||
              userLocation
                .toLowerCase()
                .includes(label.toLowerCase().split(",")[0]))
          ) {
            await this.fillCheckbox(checkbox, true);
            this.logger(`Selected matching location: ${label}`);
            foundMatch = true;
            break;
          }
        }
      }

      // If required and no match found, select first option
      if (isRequired && !foundMatch && checkboxes.length > 0) {
        await this.fillCheckbox(checkboxes[0], true);
        const label = this.findRadioLabel(checkboxes[0]);
        this.logger(`Selected first location option: ${label || "Unknown"}`);
      }
    } catch (error) {
      this.logger(`Error handling location checkboxes: ${error.message}`);
    }
  }

  /**
   * Handle Recruitee's phone input with country code selector
   */
  async handleRecruiteePhoneInput(form, profile) {
    try {
      // Find phone input
      const phoneInput = form.querySelector(
        'input[type="tel"], input[autocomplete="tel"]'
      );
      if (!phoneInput) return;

      // Get phone data from profile
      const phoneCode = profile.phoneCode || profile.phoneCountryCode || "+1";
      const phoneNumber = profile.phoneNumber || profile.phone || "";
      console.log(phoneCode, phoneNumber);
      if (!phoneNumber) return;

      // Find country code selector button
      const countrySelectButton = phoneInput
        .closest(".PhoneInput")
        ?.querySelector('button[aria-haspopup="listbox"]');

      // If there's a country code dropdown
      // if (countrySelectButton) {
      //   // Click to open dropdown
      //   countrySelectButton.click();
      //   await this.wait(500);

      //   // Try to find matching country
      //   const listboxId =
      //     countrySelectButton.getAttribute("aria-controls") ||
      //     document.querySelector('[role="listbox"]')?.id;

      //   if (listboxId) {
      //     const listbox = document.getElementById(listboxId);
      //     if (listbox) {
      //       // Look for option with matching country code
      //       const options = listbox.querySelectorAll('[role="option"]');
      //       let matchFound = false;

      //       for (const option of options) {
      //         // Recruitee has country code in div.PhoneInputCountryIcon
      //         const codeElement =
      //           option.querySelector(".PhoneInputCountryIcon") ||
      //           option.querySelector('[class*="country-code"]');

      //         // Also look at the option text for the code
      //         const optionText = option.textContent;

      //         if (
      //           (codeElement && codeElement.textContent.includes(phoneCode)) ||
      //           optionText.includes(phoneCode)
      //         ) {
      //           option.click();
      //           matchFound = true;
      //           await this.wait(300);
      //           break;
      //         }
      //       }

      //       // If no match found, use the currently selected option
      //       if (!matchFound) {
      //         // Just close the dropdown by clicking the button again
      //         countrySelectButton.click();
      //         await this.wait(300);
      //       }
      //     }
      //   }

      //   // Get only the number part (no country code)
      //   let formattedNumber = phoneNumber;
      //   if (formattedNumber.startsWith("+")) {
      //     // Remove country code
      //     formattedNumber = formattedNumber.replace(/^\+\d+\s*/, "");
      //   }

      //   // Set phone number
      //   await this.fillTextInput(phoneInput, formattedNumber);
      //   this.logger(`Set phone number: ${formattedNumber}`);
      // } else {
      // No country code dropdown, use specialized tel input fill
      await this.fillTelInput(phoneInput, phoneCode, phoneNumber);
      this.logger(`Set full phone with code: ${phoneCode} ${phoneNumber}`);
      // }
    } catch (error) {
      this.logger(`Error handling phone input: ${error.message}`);
    }
  }

  /**
   * Fill telephone input with formatted code + number
   * Handles the special case where the field expects "234 816593466" format
   * (country code without + followed by number)
   */
  async fillTelInput(element, phoneCode, phoneNumber) {
    try {
      // Process the code - remove any symbols
      let cleanCode = phoneCode.replace(/[+\-\s()]/g, "");

      // Process the number - remove any country code already in there
      let cleanNumber = phoneNumber;
      if (cleanNumber.startsWith("+")) {
        cleanNumber = cleanNumber.replace(/^\+\d+\s*/, "");
      }

      // Also remove any leading zeros which sometimes appear in local phone formats
      cleanNumber = cleanNumber.replace(/^0+/, "");

      // Combine the two parts with a space
      const formattedPhone = `${cleanCode} ${cleanNumber}`;
      console.log("formattedPhone", formattedPhone);
      // Focus the element
      element.focus();
      await this.wait(50);

      // Clear existing value
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(50);

      // Set new value
      element.value = formattedPhone;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await this.wait(50);

      // Blur the element
      element.blur();
      await this.wait(50);

      this.logger(
        `Set telephone input with formatted value: ${formattedPhone}`
      );
      return true;
    } catch (error) {
      this.logger(`Error filling telephone input: ${error.message}`);
      return false;
    }
  }

  /**
   * Get information about a form field
   */
  getFieldInfo(element) {
    const result = {
      id: element.id,
      name: element.name,
      type: element.type,
      label: this.getFieldLabel(element),
      placeholder: element.placeholder || "",
      required: this.isFieldRequired(element),
      shouldFill: true,
      fieldCategory: "unknown",
    };

    // Determine field category based on attributes
    const nameAndId = (
      result.name +
      " " +
      result.id +
      " " +
      result.label +
      " " +
      result.placeholder
    ).toLowerCase();

    if (element.name && element.name.includes("candidate.")) {
      // Recruitee specific naming pattern
      const nameParts = element.name.split(".");
      if (nameParts.length >= 2) {
        switch (nameParts[1]) {
          case "name":
            result.fieldCategory = "fullName";
            break;
          case "email":
            result.fieldCategory = "email";
            break;
          case "phone":
            result.fieldCategory = "phone";
            result.shouldFill = false; // Handled separately
            break;
          case "cv":
            result.fieldCategory = "resume";
            result.shouldFill = false; // Resume upload handled separately
            break;
          case "coverLetterFile":
            result.fieldCategory = "coverLetter";
            result.shouldFill = false; // File upload handled separately
            break;
          case "coverLetter":
            result.fieldCategory = "coverLetterText";
            break;
          case "openQuestionAnswers":
            // Custom question
            result.fieldCategory = "customQuestion";
            break;
          case "locations":
            result.fieldCategory = "location";
            result.shouldFill = false; // Handled separately
            break;
        }
      }
    } else if (nameAndId.includes("first") && nameAndId.includes("name")) {
      result.fieldCategory = "firstName";
    } else if (nameAndId.includes("last") && nameAndId.includes("name")) {
      result.fieldCategory = "lastName";
    } else if (nameAndId.includes("full") && nameAndId.includes("name")) {
      result.fieldCategory = "fullName";
    } else if (nameAndId.includes("email")) {
      result.fieldCategory = "email";
    } else if (nameAndId.includes("phone")) {
      result.fieldCategory = "phone";
    } else if (
      nameAndId.includes("location") ||
      nameAndId.includes("address") ||
      nameAndId.includes("city")
    ) {
      result.fieldCategory = "location";
    } else if (nameAndId.includes("linkedin")) {
      result.fieldCategory = "linkedin";
    } else if (nameAndId.includes("github")) {
      result.fieldCategory = "github";
    } else if (
      nameAndId.includes("website") ||
      nameAndId.includes("portfolio")
    ) {
      result.fieldCategory = "website";
    } else if (
      nameAndId.includes("salary") ||
      nameAndId.includes("compensation")
    ) {
      result.fieldCategory = "salary";
    } else if (nameAndId.includes("notice") || nameAndId.includes("period")) {
      result.fieldCategory = "noticePeriod";
    } else if (
      nameAndId.includes("experience") ||
      nameAndId.includes("years")
    ) {
      result.fieldCategory = "experience";
    } else if (nameAndId.includes("cv") || nameAndId.includes("resume")) {
      result.fieldCategory = "resume";
      result.shouldFill = false; // Resume upload handled separately
    }

    return result;
  }

  /**
   * Check if a field is required
   */
  isFieldRequired(element) {
    // Check direct required attribute
    if (element.required || element.getAttribute("aria-required") === "true") {
      return true;
    }

    // Check for asterisk in label (Recruitee specific)
    const label = this.getFieldLabelElement(element);
    if (label && label.querySelector(".sc-1glzqyg-1")) {
      return true;
    }

    // Check for required class
    if (
      element.classList.contains("required") ||
      element.classList.contains("c-form-control--required")
    ) {
      return true;
    }

    // For Recruitee, look for asterisk in parent legend for fieldsets
    const fieldset = element.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend && legend.querySelector(".sc-1glzqyg-1")) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the label element for a form field
   */
  getFieldLabelElement(element) {
    try {
      // Try to find label by for attribute
      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) {
          return label;
        }
      }

      // Try to find label as a parent or ancestor with label tag
      let parent = element.parentElement;
      while (parent) {
        if (parent.tagName === "LABEL") {
          return parent;
        }

        // Try to find label as a sibling element
        const siblingLabel = parent.querySelector("label");
        if (siblingLabel) {
          return siblingLabel;
        }

        // Look for Recruitee specific label patterns
        const recruiteeLabel = parent.querySelector(".sc-1glzqyg-0");
        if (recruiteeLabel) {
          return recruiteeLabel;
        }

        parent = parent.parentElement;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get the label text for a form field
   */
  getFieldLabel(element) {
    try {
      const labelElement = this.getFieldLabelElement(element);

      if (labelElement) {
        // Remove the asterisk and any hidden elements
        let labelText = labelElement.textContent.trim();

        // Remove asterisk and the text inside it
        labelText = labelText.replace(/\s*\*\s*$/, "");

        return labelText;
      }

      // For radio buttons and checkboxes, try to find the label right after
      if (element.type === "radio" || element.type === "checkbox") {
        return this.findRadioLabel(element);
      }

      // Fall back to placeholder or name
      return element.placeholder || element.name || "";
    } catch (error) {
      return element.name || "";
    }
  }

  /**
   * Find label for radio or checkbox
   */
  findRadioLabel(element) {
    // First try by for attribute
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        return label.textContent.trim();
      }
    }

    // Try to find label as a sibling
    let nextSibling = element.nextElementSibling;
    if (nextSibling && nextSibling.tagName === "LABEL") {
      return nextSibling.textContent.trim();
    }

    // Try to find span inside the parent (Recruitee pattern)
    const parent = element.closest(".sc-1omxthk-1, .sc-qci8q2-1");
    if (parent) {
      const labelEl = parent.querySelector("label");
      if (labelEl) {
        const span = labelEl.querySelector(
          "span:not([class]), span:last-child"
        );
        if (span) {
          return span.textContent.trim();
        }
        return labelEl.textContent.trim();
      }
    }

    return "";
  }

  /**
   * Determine the value to fill in a form field
   */
  async determineValueToFill(element, fieldInfo, profile) {
    try {
      const { fieldCategory, type, label, placeholder, name, id } = fieldInfo;

      // Different handling based on field category
      switch (fieldCategory) {
        case "firstName":
          return profile.firstName || profile.firstname || "";

        case "lastName":
          return profile.lastName || profile.lastname || "";

        case "fullName":
          return `${profile.firstName || profile.firstname || ""} ${
            profile.lastName || profile.lastname || ""
          }`.trim();

        case "email":
          return profile.email || "";

        case "phone":
          return profile.phone || profile.phoneNumber || "";

        case "location":
          if (
            label.toLowerCase().includes("city") ||
            placeholder.toLowerCase().includes("city")
          ) {
            return profile.city || profile.location || "";
          }
          return (
            profile.location ||
            `${profile.city || ""}, ${profile.country || ""}`.trim()
          );

        case "linkedin":
          return profile.linkedin || profile.linkedIn || "";

        case "github":
          return profile.githubURL || "";

        case "website":
          return (
            profile.website || profile.portfolio || profile.githubURL || ""
          );

        case "salary":
          return profile.salaryExpectation || "Negotiable";

        case "noticePeriod":
          return profile.noticePeriod || "2 weeks";

        case "experience":
          return profile.yearsOfExperience || "5";

        case "coverLetterText":
          return (
            profile.coverLetter ||
            "I am excited about the opportunity to join your team and contribute my skills and experience. My background aligns well with the requirements for this position, and I am confident that I would be a valuable addition to your organization. I have attached my resume for your review and would welcome the opportunity to discuss how I can contribute to your team's success."
          );

        case "customQuestion":
          return await this.getAIAnswerForQuestion(label, profile);
      }

      // If this is a checkbox or radio
      if (type === "checkbox" || type === "radio") {
        // Handle consent checkboxes
        if (
          label.toLowerCase().includes("consent") ||
          label.toLowerCase().includes("agree") ||
          label.toLowerCase().includes("terms") ||
          label.toLowerCase().includes("privacy")
        ) {
          return true;
        }

        // For other checkboxes/radios, use AI if available
        if (label) {
          try {
            return await this.getAIFieldValue(label, element);
          } catch (e) {
            // If AI fails, leave unchanged
            return null;
          }
        }
      }

      // For select elements, make an intelligent choice
      if (element.tagName === "SELECT") {
        return await this.handleSelectElement(element, fieldInfo, profile);
      }

      // For textareas, handle as potential cover letter or questions
      if (element.tagName === "TEXTAREA") {
        if (
          label.toLowerCase().includes("cover letter") ||
          label.toLowerCase().includes("motivation") ||
          label.toLowerCase().includes("introduction") ||
          placeholder.toLowerCase().includes("tell us about yourself")
        ) {
          return (
            profile.coverLetter ||
            "I am very interested in this position and believe my skills and experience make me a great fit. I have attached my resume for your review."
          );
        }

        // If this seems like a custom question
        if (label.length > 10 || label.includes("?")) {
          try {
            return await this.getAIAnswerForQuestion(label, profile);
          } catch (e) {
            return "Based on my skills and experience, I believe I would be a great fit for this role.";
          }
        }
      }

      // For fields we couldn't categorize, try an intelligent guess
      return await this.intelligentFieldGuess(element, fieldInfo, profile);
    } catch (error) {
      this.logger(`Error determining value for field: ${error.message}`);
      return null;
    }
  }

  /**
   * Handle select elements intelligently
   */
  async handleSelectElement(element, fieldInfo, profile) {
    try {
      const { label, placeholder, name, id } = fieldInfo;
      const options = Array.from(element.options).map((opt) => opt.text.trim());

      // Skip if no options or just placeholder option
      if (options.length <= 1) {
        return null;
      }

      // Get valid options (non-placeholder)
      const validOptions = options.filter(
        (opt) =>
          opt &&
          ![
            "select",
            "choose",
            "please select",
            "select an option",
            "-",
          ].includes(opt.toLowerCase())
      );

      if (validOptions.length === 0) {
        return null;
      }

      // Handle common select types
      const nameAndLabel = (
        name +
        " " +
        id +
        " " +
        label +
        " " +
        placeholder
      ).toLowerCase();

      // Country select
      if (nameAndLabel.includes("country")) {
        const userCountry = profile.country || "United States";
        const countryOption = validOptions.find((opt) =>
          opt.toLowerCase().includes(userCountry.toLowerCase())
        );
        return countryOption || validOptions[0];
      }

      // Gender select
      if (nameAndLabel.includes("gender")) {
        return profile.gender || "Prefer not to say";
      }

      // Experience/years select
      if (
        nameAndLabel.includes("experience") ||
        nameAndLabel.includes("years")
      ) {
        const yearsExp = parseInt(profile.yearsOfExperience || "5");

        // Find best match for years
        for (const opt of validOptions) {
          if (opt.includes(`${yearsExp}`)) {
            return opt;
          }
        }

        // Find ranges
        for (const opt of validOptions) {
          if (opt.includes("-")) {
            const [min, max] = opt.split("-").map((n) => parseInt(n.trim()));
            if (
              !isNaN(min) &&
              !isNaN(max) &&
              yearsExp >= min &&
              yearsExp <= max
            ) {
              return opt;
            }
          }

          if (opt.includes("+")) {
            const min = parseInt(opt);
            if (!isNaN(min) && yearsExp >= min) {
              return opt;
            }
          }
        }
      }

      // For other selects, use AI if available
      try {
        const aiValue = await this.getAISelectOption(
          label,
          validOptions,
          profile
        );
        if (aiValue) {
          // Find closest match
          const closestOption = this.findClosestMatch(aiValue, validOptions);
          return closestOption || validOptions[0];
        }
      } catch (e) {
        // If AI fails, make a reasonable guess
        return validOptions[0];
      }

      // Default to first valid option if nothing else matched
      return validOptions[0];
    } catch (error) {
      this.logger(`Error handling select element: ${error.message}`);
      return null;
    }
  }

  /**
   * Find the closest match for a string in an array of options
   */
  findClosestMatch(value, options) {
    if (!value || !options || options.length === 0) return null;

    const lowerValue = value.toLowerCase();

    // Exact match
    const exactMatch = options.find((opt) => opt.toLowerCase() === lowerValue);
    if (exactMatch) return exactMatch;

    // Contains match
    const containsMatch = options.find(
      (opt) =>
        opt.toLowerCase().includes(lowerValue) ||
        lowerValue.includes(opt.toLowerCase())
    );
    if (containsMatch) return containsMatch;

    // Word match (check if any words match)
    const valueWords = lowerValue.split(/\s+/);
    for (const option of options) {
      const optionWords = option.toLowerCase().split(/\s+/);
      for (const word of valueWords) {
        if (
          word.length > 3 &&
          optionWords.some((w) => w.includes(word) || word.includes(w))
        ) {
          return option;
        }
      }
    }

    return null;
  }

  /**
   * Try to intelligently guess what goes in a field we couldn't categorize
   */
  async intelligentFieldGuess(element, fieldInfo, profile) {
    const { label, placeholder, name, id, type } = fieldInfo;
    const nameAndLabel = (
      name +
      " " +
      id +
      " " +
      label +
      " " +
      placeholder
    ).toLowerCase();

    // Common field patterns
    if (
      nameAndId.includes("name") &&
      !nameAndId.includes("first") &&
      !nameAndId.includes("last")
    ) {
      return `${profile.firstName || profile.firstname || ""} ${
        profile.lastName || profile.lastname || ""
      }`.trim();
    }

    if (nameAndId.includes("phone")) {
      return profile.phone || profile.phoneNumber || "";
    }

    if (nameAndId.includes("address")) {
      return (
        profile.location ||
        `${profile.city || ""}, ${profile.country || ""}`.trim()
      );
    }

    // For questions or longer text fields
    if (
      element.tagName === "TEXTAREA" ||
      (nameAndLabel.includes("?") && nameAndLabel.length > 15)
    ) {
      try {
        // This appears to be a custom question
        return await this.getAIAnswerForQuestion(label || placeholder, profile);
      } catch (e) {
        return "";
      }
    }

    // For numeric fields
    if (type === "number") {
      if (
        nameAndLabel.includes("salary") ||
        nameAndLabel.includes("compensation")
      ) {
        return "75000";
      } else if (
        nameAndLabel.includes("years") ||
        nameAndLabel.includes("experience")
      ) {
        return profile.yearsOfExperience || "5";
      } else if (nameAndLabel.includes("age")) {
        return "30";
      }
    }

    // For date fields
    if (type === "date" || nameAndLabel.includes("date")) {
      const today = new Date();

      if (nameAndLabel.includes("birth") || nameAndLabel.includes("dob")) {
        return "1990-01-01";
      } else if (nameAndLabel.includes("start")) {
        // Two weeks from now for start date
        const startDate = new Date(today);
        startDate.setDate(today.getDate() + 14);
        return startDate.toISOString().split("T")[0];
      } else {
        // Default to today
        return today.toISOString().split("T")[0];
      }
    }

    // Default empty for fields we couldn't categorize
    return "";
  }

  /**
   * Fill a form field with the given value
   */
  async fillField(element, value) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      const type = element.type || element.tagName.toLowerCase();
      this.logger(
        `Filling field ${element.name || element.id} with type ${type}`
      );

      switch (type) {
        case "text":
        case "email":
        case "number":
        case "tel":
        case "url":
        case "date":
        case "textarea":
          await this.fillTextInput(element, value);
          break;

        case "select":
        case "select-one":
          await this.fillSelectInput(element, value);
          break;

        // case "checkbox":
        //   await this.fillCheckbox(element, value);
        //   break;

        // case "radio":
        //   await this.fillRadioButton(element, value);
        //   break;

        default:
          this.logger(`Unsupported field type: ${type}`);
          return false;
      }

      return true;
    } catch (error) {
      this.logger(`Error filling field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a text input field
   */
  async fillTextInput(element, value) {
    // Focus the element
    element.focus();
    await this.wait(50);

    // Clear existing value
    element.value = "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await this.wait(50);

    // Set new value
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await this.wait(50);

    // Blur the element
    element.blur();
    await this.wait(50);
  }

  /**
   * Fill a select input field
   */
  async fillSelectInput(element, value) {
    // If value is a string, try to find matching option
    if (typeof value === "string") {
      value = value.toLowerCase().trim();

      // Try exact match first
      for (let i = 0; i < element.options.length; i++) {
        const option = element.options[i];
        if (option.text.toLowerCase().trim() === value) {
          element.selectedIndex = i;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
      }

      // Try contains match
      for (let i = 0; i < element.options.length; i++) {
        const option = element.options[i];
        if (
          option.text.toLowerCase().includes(value) ||
          value.includes(option.text.toLowerCase())
        ) {
          element.selectedIndex = i;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
      }

      // If no match found but we have options, select first non-placeholder
      if (element.options.length > 0) {
        // Skip first option if it looks like a placeholder
        let startIndex = 0;
        if (
          element.options[0].text.toLowerCase().includes("select") ||
          element.options[0].text.toLowerCase().includes("choose") ||
          element.options[0].text === ""
        ) {
          startIndex = 1;
        }

        if (startIndex < element.options.length) {
          element.selectedIndex = startIndex;
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }
  }

  /**
   * Fill a checkbox field
   */
  async fillCheckbox(element, value) {
    if (value) {
      if (!element.checked) {
        element.checked = true;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        await this.wait(50);
      }
    } else if (element.checked) {
      element.checked = false;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await this.wait(50);
    }
  }

  /**
   * Fill a radio button field
   */
  async fillRadioButton(element, value) {
    if (value) {
      if (!element.checked) {
        element.checked = true;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        await this.wait(50);
      }
    }
  }

  async handleConsentCheckbox(checkbox) {
    console.log("Initial checkbox state:", checkbox.checked);

    // Only proceed if not already checked
    if (!checkbox.checked) {
      // Set the property
      checkbox.checked = true;

      // Create and dispatch a proper change event
      const changeEvent = new Event("change", {
        bubbles: true, // Allow event to bubble up
        cancelable: true, // Allow event to be canceled
      });

      // Dispatch the event
      checkbox.dispatchEvent(changeEvent);

      // Ensure React/Angular has time to process the event
      await new Promise((resolve) => setTimeout(resolve, 100));

      console.log("After checking, state is now:", checkbox.checked);
    }

    return checkbox.checked;
  }
  /**
   * Handle required checkboxes (typically consent checkboxes)
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Handling required checkboxes");

      // Find all required checkboxes
      const requiredCheckboxes = Array.from(
        form.querySelectorAll('input[type="checkbox"][required]')
      );

      // Also look for checkboxes with required class or aria-required
      const otherRequiredSelectors = [
        'input[type="checkbox"].required',
        'input[type="checkbox"][aria-required="true"]',
      ];

      for (const selector of otherRequiredSelectors) {
        const checkboxes = Array.from(form.querySelectorAll(selector));
        requiredCheckboxes.push(...checkboxes);
      }

      // Also check for Recruitee-specific required indicators
      const allCheckboxes = form.querySelectorAll('input[type="checkbox"]');
      for (const checkbox of allCheckboxes) {
        const label = this.getFieldLabelElement(checkbox);
        if (label && label.querySelector(".sc-1glzqyg-1")) {
          requiredCheckboxes.push(checkbox);
        }
      }

      // Check all required checkboxes
      for (const checkbox of requiredCheckboxes) {
        this.handleConsentCheckbox(checkbox);

        this.logger(
          `Checked required checkbox: ${this.getFieldLabel(checkbox)}`
        );
      }

      // Look for privacy consent checkboxes even if not explicitly required
      const consentCheckboxes = Array.from(
        form.querySelectorAll('input[type="checkbox"]')
      ).filter((checkbox) => {
        const label = this.getFieldLabel(checkbox).toLowerCase();
        return (
          label.includes("privacy") ||
          label.includes("consent") ||
          label.includes("agree") ||
          label.includes("terms") ||
          label.includes("policy")
        );
      });

      for (const checkbox of consentCheckboxes) {
        console.log(checkbox, checkbox.checked);
        this.handleConsentCheckbox(checkbox);
      }

      return true;
    } catch (error) {
      this.logger(`Error handling required checkboxes: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if an element is visible on the page
   */
  isElementVisible(element) {
    try {
      if (!element) return false;

      // Get element style
      const style = window.getComputedStyle(element);

      // Check if element is hidden
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      // Check if element has zero dimensions
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }

      // Check if any parent is hidden
      let parent = element.parentElement;
      while (parent) {
        const parentStyle = window.getComputedStyle(parent);
        if (
          parentStyle.display === "none" ||
          parentStyle.visibility === "hidden" ||
          parentStyle.opacity === "0"
        ) {
          return false;
        }
        parent = parent.parentElement;
      }

      return true;
    } catch (error) {
      return true; // Default to true on error
    }
  }

  /**
   * Find the submit button on a form
   */
  findSubmitButton(form) {
    try {
      this.logger("Looking for submit button");

      // Recruitee-specific submit button selector
      const recruiteeSubmitButton = document.querySelector(
        'button[data-testid="submit-application-form-button"], button.cNFhOU'
      );
      if (
        recruiteeSubmitButton &&
        this.isElementVisible(recruiteeSubmitButton) &&
        !recruiteeSubmitButton.disabled
      ) {
        this.logger(
          `Found Recruitee submit button: ${recruiteeSubmitButton.textContent.trim()}`
        );
        return recruiteeSubmitButton;
      }

      // Try multiple selector patterns for submit buttons
      const buttonSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        "button.btn-primary",
        "button.btn-submit",
        "button.button--primary",
        "button.next-step",
        "button.submit",
      ];

      // Try each selector
      for (const selector of buttonSelectors) {
        // First look within the form
        const formButtons = form.querySelectorAll(selector);
        for (const button of formButtons) {
          if (this.isElementVisible(button) && !button.disabled) {
            this.logger(
              `Found submit button in form: ${
                button.textContent.trim() || button.value
              }`
            );
            return button;
          }
        }

        // Then look on the page (for forms that have button outside)
        const pageButtons = document.querySelectorAll(selector);
        for (const button of pageButtons) {
          if (this.isElementVisible(button) && !button.disabled) {
            this.logger(
              `Found submit button on page: ${
                button.textContent.trim() || button.value
              }`
            );
            return button;
          }
        }
      }

      // Look for buttons with common submit text
      const buttonTexts = [
        "submit",
        "apply",
        "next",
        "continue",
        "save",
        "send",
      ];
      const allButtons = document.querySelectorAll(
        "button, input[type='submit'], input[type='button']"
      );

      for (const button of allButtons) {
        const buttonText =
          button.textContent?.toLowerCase() ||
          button.value?.toLowerCase() ||
          "";
        if (
          buttonTexts.some((text) => buttonText.includes(text)) &&
          this.isElementVisible(button) &&
          !button.disabled
        ) {
          this.logger(
            `Found submit button by text: ${
              button.textContent.trim() || button.value
            }`
          );
          return button;
        }
      }

      this.logger("No submit button found");
      return null;
    } catch (error) {
      this.logger(`Error finding submit button: ${error.message}`);
      return null;
    }
  }

  /**
   * Submit the form
   */
  async submitForm(form) {
    try {
      // Find the submit button
      const submitButton = this.findSubmitButton(form);
      console.log("submitButton", submitButton)
      if (!submitButton) {
        throw new Error("Submit button not found");
      }

      this.logger(
        `Clicking submit button: ${
          submitButton.textContent.trim() || submitButton.value
        }`
      );

      // Click the button
      submitButton.click();

      // Wait for form submission and page update
      await this.wait(18000);

      // // Check for success message
      // const successSelectors = [
      //   "div.application-confirmation",
      //   "div.success-message",
      //   "h1.success-message",
      //   "div[class*='success']",
      //   "div.thank-you",
      //   "div[class*='thankyou']",
      //   "div.application-confirmation-panel",
      // ];

      // for (const selector of successSelectors) {
      //   const successElement = document.querySelector(selector);
      //   if (successElement && this.isElementVisible(successElement)) {
      //     this.logger("Found success message, form submitted successfully");
      //     return true;
      //   }
      // }

      // // Check for common success indicators in page text
      // const pageText = document.body.textContent.toLowerCase();
      // if (
      //   pageText.includes("thank you") ||
      //   pageText.includes("application received") ||
      //   pageText.includes("application submitted") ||
      //   pageText.includes("successfully") ||
      //   pageText.includes("we have received your application")
      // ) {
      //   this.logger(
      //     "Found success text on page, form likely submitted successfully"
      //   );
      //   return true;
      // }

      // // Check if form is still present
      // if (!document.body.contains(form)) {
      //   this.logger("Form no longer in page, likely submitted successfully");
      //   return true;
      // }

      // // Check for validation errors
      // const hasErrors = !!document.querySelector(
      //   ".error-message, .field_with_errors, .has-error, .invalid-feedback, [aria-invalid='true']"
      // );
      // if (hasErrors) {
      //   this.logger("Form has validation errors, submission failed");
      //   return false;
      // }

      // this.logger(
      //   "No definitive success/error indicators found, assuming submission worked"
      // );
      return true;
    } catch (error) {
      this.logger(`Error submitting form: ${error.message}`);
      return false;
    }
  }

  /**
   * Get AI-powered answer for a question
   */
  async getAIAnswerForQuestion(question, userData) {
    try {
      this.logger(`Getting AI answer for: ${question}`);

      const response = await fetch(`${this.host}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          userData,
          description: this.jobDescription,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      return data.answer;
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get AI-powered field value
   */
  async getAIFieldValue(fieldLabel, element) {
    try {
      if (!fieldLabel) return null;

      // For checkboxes/radio buttons, just check if they're consent related
      if (element.type === "checkbox" || element.type === "radio") {
        const label = fieldLabel.toLowerCase();
        if (
          label.includes("consent") ||
          label.includes("agree") ||
          label.includes("terms") ||
          label.includes("privacy") ||
          label.includes("policy")
        ) {
          return true;
        }
      }

      // For other fields, use more advanced AI
      return await this.getAIAnswerForQuestion(fieldLabel, this.userData);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get AI-powered select option
   */
  async getAISelectOption(label, options, userData) {
    console.log("OPTIONS", options, "QUESTION ASKED:", label);
    try {
      this.logger(`Getting AI select option for: ${label}`);

      const response = await fetch(`${this.host}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: label,
          options,
          userData,
          description: this.jobDescription,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      console.log("AI ANSWERED", data.answer);
      return data.answer;
    } catch (error) {
      this.logger(`Error getting AI select option: ${error.message}`);
      throw error;
    }
  }

  /**
   * Wait for a specified amount of time
   */
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
