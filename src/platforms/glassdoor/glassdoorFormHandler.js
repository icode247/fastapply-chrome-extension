import { HOST } from "@shared/constants";
//AI Answer
/**
 * GlassdoorFormHandler - Specialized handler for Glassdoor application forms
 * Handles form filling, field matching, and AI-assisted question answering
 */
class GlassdoorFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || HOST;
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";

    // Define field mapping for common form fields
    this.fieldMapping = {
      // Contact information
      first_name: [
        "first",
        "firstName",
        "first-name",
        "fname",
        "given-name",
        "givenName",
      ],
      last_name: [
        "last",
        "lastName",
        "last-name",
        "lname",
        "family-name",
        "familyName",
        "surname",
      ],
      full_name: ["name", "fullName", "full-name", "full_name"],
      email: ["email", "e-mail", "emailAddress", "email-address"],
      phone: [
        "phone",
        "phoneNumber",
        "phone-number",
        "mobile",
        "cell",
        "telephone",
      ],

      // Address fields
      address: ["address", "street", "streetAddress", "street-address"],
      address_line1: ["address1", "addressLine1", "street_address"],
      address_line2: ["address2", "addressLine2", "apartment", "unit", "suite"],
      city: ["city", "locality", "town"],
      state: ["state", "region", "province", "administrative-area"],
      zip: [
        "zip",
        "zipcode",
        "postal",
        "postalCode",
        "postal-code",
        "zip-code",
      ],
      country: ["country", "nation"],

      // Education
      education: ["education", "degree", "qualification"],
      school: ["school", "university", "college", "institution"],
      graduation_date: [
        "graduation",
        "graduationDate",
        "graduation-date",
        "grad-date",
        "completion-date",
      ],
      major: ["major", "field", "study", "concentration", "degree"],
      gpa: ["gpa", "grade", "gradepoint", "grade-point"],

      // Experience
      experience: [
        "experience",
        "work-experience",
        "workExperience",
        "employment",
      ],
      years_experience: [
        "yearsExperience",
        "years-experience",
        "years_of_experience",
        "experience-years",
      ],
      current_employer: [
        "currentEmployer",
        "current-employer",
        "employer",
        "company",
      ],
      current_title: [
        "currentTitle",
        "current-title",
        "title",
        "position",
        "job-title",
        "jobTitle",
      ],

      // Resume and cover letter
      resume: ["resume", "cv", "curriculum-vitae", "curriculum_vitae"],
      cover_letter: ["cover", "coverLetter", "cover-letter", "letter"],

      // Demographic and other
      gender: ["gender", "sex"],
      race: ["race", "ethnicity"],
      veteran: ["veteran", "military"],
      disability: ["disability", "disabled", "differently-abled"],
      salary: [
        "salary",
        "compensation",
        "desired-salary",
        "expected-salary",
        "wage",
      ],
      start_date: [
        "start-date",
        "startDate",
        "available-from",
        "availableFrom",
      ],

      // Social and web presence
      linkedin: ["linkedin", "linkedinUrl", "linkedin-url", "linkedin_url"],
      portfolio: ["portfolio", "website", "personal-website", "portfolioUrl"],
      github: ["github", "githubUrl", "github-url", "github_url"],

      // Skills and proficiencies
      skills: ["skills", "abilities", "proficiencies", "expertise"],
      languages: ["languages", "spoken-languages", "spokenLanguages"],

      // References
      references: ["references", "referrals", "referees"],

      // Indeed-specific fields
      indeed_resume: ["indeed-resume", "indeed_resume", "indeedResume"],
    };

    // Special handlers for complex questions
    this.questionHandlers = {
      salary: this.handleSalaryQuestion.bind(this),
      available: this.handleAvailabilityQuestion.bind(this),
      relocate: this.handleRelocationQuestion.bind(this),
      legal: this.handleLegalQuestion.bind(this),
      eligible: this.handleEligibilityQuestion.bind(this),
      authorized: this.handleAuthorizationQuestion.bind(this),
      sponsor: this.handleSponsorshipQuestion.bind(this),
      experience: this.handleExperienceQuestion.bind(this),
      remote: this.handleRemoteQuestion.bind(this),
      willing: this.handleWillingnessQuestion.bind(this),
    };
  }

  /**
   * Fill a form with profile data
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.logger("Starting form filling with profile data");

      // Process all relevant input fields
      const inputs = form.querySelectorAll("input, select, textarea");
      const processedInputs = [];

      for (const input of inputs) {
        // Skip hidden, disabled, or already filled inputs
        if (
          input.type === "hidden" ||
          input.disabled ||
          input.readOnly ||
          input.closest('[style*="display: none"]') ||
          !this.isElementVisible(input)
        ) {
          continue;
        }

        // Skip inputs that are already in processed list
        if (processedInputs.includes(input)) {
          continue;
        }

        // Process the input based on its type
        await this.processInput(input, profile);
        processedInputs.push(input);
      }

      // Handle special form structures like grid questions
      await this.handleSpecialFormElements(form, profile);

      this.logger("Form filling completed");
      return true;
    } catch (error) {
      this.logger(`Error filling form: ${error.message}`);
      console.error("Error in fillFormWithProfile:", error);
      return false;
    }
  }

  /**
   * Process a single input element
   */
  async processInput(input, profile) {
    try {
      const inputType = input.type?.toLowerCase();
      const inputName = (input.name || "").toLowerCase();
      const inputId = (input.id || "").toLowerCase();
      const inputPlaceholder = (input.placeholder || "").toLowerCase();
      const inputLabel = this.getLabelText(input)?.toLowerCase() || "";
      const ariaLabel = (input.getAttribute("aria-label") || "").toLowerCase();

      // Combine all possible identifiers
      const identifiers = [
        inputName,
        inputId,
        inputPlaceholder,
        inputLabel,
        ariaLabel,
      ].filter(Boolean);

      // Skip if it's a submit, button, or image type
      if (
        inputType === "submit" ||
        inputType === "button" ||
        inputType === "image" ||
        inputType === "reset" ||
        inputType === "file" // File inputs are handled separately
      ) {
        return;
      }

      this.logger(`Processing input: ${inputType} - ${identifiers.join(", ")}`);

      // Special handling for radio buttons and checkboxes
      if (inputType === "radio" || inputType === "checkbox") {
        await this.handleCheckboxOrRadio(input, profile, identifiers);
        return;
      }

      // Map the input to a profile field
      let value = this.mapInputToProfile(identifiers, profile);

      // If value is not found in profile, try special field handlers based on identifiers
      if (value === null) {
        value = await this.handleSpecialField(input, identifiers, profile);
      }

      // If value is still null, check if it's a required field, and if so
      // try to use AI to generate a value
      if (
        value === null &&
        (input.required ||
          input.getAttribute("aria-required") === "true" ||
          input.closest(".required") ||
          inputLabel.includes("*"))
      ) {
        value = await this.getAIGeneratedAnswer(input, identifiers);
      }

      // Set the value if we have one
      if (value !== null) {
        await this.setInputValue(input, value);
      }
    } catch (error) {
      this.logger(`Error processing input: ${error.message}`);
      console.error("Error in processInput:", error);
    }
  }

  /**
   * Handle checkbox or radio input
   */
  async handleCheckboxOrRadio(input, profile, identifiers) {
    try {
      let shouldCheck = false;

      // Get the label text
      const labelText = this.getLabelText(input)?.toLowerCase() || "";

      // Check if this is a terms acceptance checkbox
      if (
        labelText.includes("terms") ||
        labelText.includes("agree") ||
        labelText.includes("consent") ||
        labelText.includes("policy") ||
        identifiers.some(
          (id) =>
            id.includes("terms") ||
            id.includes("agree") ||
            id.includes("consent") ||
            id.includes("policy")
        )
      ) {
        shouldCheck = true;
      }
      // Check if this is a contact permission checkbox
      else if (
        labelText.includes("contact") ||
        labelText.includes("email me") ||
        labelText.includes("newsletter")
      ) {
        shouldCheck = true;
      }
      // For yes/no radio buttons about qualifications
      else if (
        (labelText.includes("yes") || labelText === "yes") &&
        identifiers.some(
          (id) =>
            id.includes("eligible") ||
            id.includes("authorized") ||
            id.includes("legal") ||
            id.includes("experience") ||
            id.includes("qualified")
        )
      ) {
        shouldCheck = true;
      }
      // For preferred contact method radio buttons
      else if (
        identifiers.some(
          (id) => id.includes("preferred") && id.includes("contact")
        ) &&
        (labelText.includes("email") || labelText === "email")
      ) {
        shouldCheck = true;
      }
      // Handle gender radio buttons - select "prefer not to say" option if available
      else if (
        identifiers.some((id) => id.includes("gender") || id.includes("sex"))
      ) {
        if (
          labelText.includes("prefer not") ||
          labelText.includes("not to say") ||
          labelText.includes("decline")
        ) {
          shouldCheck = true;
        }
      }
      // Handle ethnicity/race radio buttons - select "prefer not to say" option if available
      else if (
        identifiers.some(
          (id) => id.includes("race") || id.includes("ethnicity")
        )
      ) {
        if (
          labelText.includes("prefer not") ||
          labelText.includes("not to say") ||
          labelText.includes("decline")
        ) {
          shouldCheck = true;
        }
      }
      // Special handling for Indeed-specific questions
      else if (input.name && input.name.startsWith("sc-")) {
        // This is likely a Screener Question on Indeed
        if (labelText.includes("yes") && !labelText.includes("no")) {
          // For positive answers to screening questions
          const questionContainer = input.closest(".ia-Questions-item");
          const questionText = questionContainer
            ? questionContainer
                .querySelector(".ia-Questions-item-label")
                ?.textContent.toLowerCase()
            : "";

          if (
            questionText.includes("experience") ||
            questionText.includes("years") ||
            questionText.includes("degree") ||
            questionText.includes("certification") ||
            questionText.includes("qualification") ||
            questionText.includes("eligible") ||
            questionText.includes("authorized") ||
            questionText.includes("skilled") ||
            questionText.includes("competent")
          ) {
            shouldCheck = true;
          }
        }
      }

      // Apply selection if determined
      if (shouldCheck) {
        this.logger(
          `Setting ${input.type} - ${identifiers.join(", ")} to checked`
        );
        if (!input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("click", { bubbles: true }));
        }
      }
    } catch (error) {
      this.logger(`Error handling checkbox/radio: ${error.message}`);
    }
  }

  /**
   * Map input identifiers to profile data
   */
  mapInputToProfile(identifiers, profile) {
    // Early check for empty identifiers
    if (!identifiers.length) return null;

    // Iterate through all field mapping categories
    for (const [profileField, patterns] of Object.entries(this.fieldMapping)) {
      for (const identifier of identifiers) {
        if (!identifier) continue;

        // Check if identifier matches any pattern for this field
        if (
          patterns.some(
            (pattern) =>
              identifier === pattern ||
              identifier.includes(pattern) ||
              // For ID and name fields that might have suffixes like "first-name-input"
              (pattern.length > 4 && identifier.includes(pattern + "-")) ||
              (pattern.length > 4 && identifier.includes(pattern + "_"))
          )
        ) {
          // Extract the value from profile based on the mapped field
          return this.getProfileValue(profileField, profile);
        }
      }
    }

    return null;
  }

  /**
   * Extract a value from profile data
   */
  getProfileValue(field, profile) {
    if (!profile) return null;

    // Direct fields
    if (profile[field] !== undefined) {
      return profile[field];
    }

    // Handle nested fields and complex mappings
    switch (field) {
      case "first_name":
        return (
          profile.firstName ||
          (profile.name ? profile.name.split(" ")[0] : null)
        );

      case "last_name":
        return (
          profile.lastName ||
          (profile.name ? profile.name.split(" ").slice(1).join(" ") : null)
        );

      case "full_name":
        return (
          profile.name ||
          (profile.firstName && profile.lastName
            ? `${profile.firstName} ${profile.lastName}`
            : null)
        );

      case "email":
        return profile.email || profile.emailAddress;

      case "phone":
        return profile.phone || profile.phoneNumber || profile.mobile;

      case "address":
        if (profile.address) {
          if (typeof profile.address === "string") {
            return profile.address;
          } else {
            // Combine address components
            const addressParts = [];
            if (profile.address.street)
              addressParts.push(profile.address.street);
            if (profile.address.line1) addressParts.push(profile.address.line1);
            if (profile.address.line2) addressParts.push(profile.address.line2);
            if (profile.address.city) addressParts.push(profile.address.city);
            if (profile.address.state) addressParts.push(profile.address.state);
            if (profile.address.zip) addressParts.push(profile.address.zip);

            return addressParts.join(", ");
          }
        }
        return null;

      case "address_line1":
        return (
          profile.address?.line1 ||
          profile.address?.street ||
          profile.addressLine1
        );

      case "address_line2":
        return profile.address?.line2 || profile.addressLine2;

      case "city":
        return profile.address?.city || profile.city;

      case "state":
        return profile.address?.state || profile.state;

      case "zip":
        return (
          profile.address?.zip ||
          profile.address?.postalCode ||
          profile.zipCode ||
          profile.zip
        );

      case "country":
        return profile.address?.country || profile.country;

      case "education":
        // If education is an array, get the highest degree
        if (Array.isArray(profile.education) && profile.education.length > 0) {
          // Sort education by endDate descending (most recent first)
          const sortedEducation = [...profile.education].sort((a, b) => {
            const dateA = a.endDate ? new Date(a.endDate) : new Date(0);
            const dateB = b.endDate ? new Date(b.endDate) : new Date(0);
            return dateB - dateA;
          });

          return sortedEducation[0].degree || "Bachelor's Degree";
        }
        return profile.highestDegree || profile.degree || "Bachelor's Degree";

      case "school":
        if (Array.isArray(profile.education) && profile.education.length > 0) {
          // Sort education by endDate descending (most recent first)
          const sortedEducation = [...profile.education].sort((a, b) => {
            const dateA = a.endDate ? new Date(a.endDate) : new Date(0);
            const dateB = b.endDate ? new Date(b.endDate) : new Date(0);
            return dateB - dateA;
          });

          return sortedEducation[0].institution || sortedEducation[0].school;
        }
        return profile.school || profile.university || profile.college;

      case "major":
        if (Array.isArray(profile.education) && profile.education.length > 0) {
          const sortedEducation = [...profile.education].sort((a, b) => {
            const dateA = a.endDate ? new Date(a.endDate) : new Date(0);
            const dateB = b.endDate ? new Date(b.endDate) : new Date(0);
            return dateB - dateA;
          });

          return sortedEducation[0].major || sortedEducation[0].fieldOfStudy;
        }
        return profile.major || profile.fieldOfStudy;

      case "graduation_date":
        if (Array.isArray(profile.education) && profile.education.length > 0) {
          const sortedEducation = [...profile.education].sort((a, b) => {
            const dateA = a.endDate ? new Date(a.endDate) : new Date(0);
            const dateB = b.endDate ? new Date(b.endDate) : new Date(0);
            return dateB - dateA;
          });

          if (sortedEducation[0].endDate) {
            const date = new Date(sortedEducation[0].endDate);
            return date.getMonth() + 1 + "/" + date.getFullYear();
          }
        }
        return profile.graduationDate || "";

      case "years_experience":
        if (
          Array.isArray(profile.workExperience) &&
          profile.workExperience.length > 0
        ) {
          // Calculate total years from all work experiences
          let totalYears = 0;

          for (const exp of profile.workExperience) {
            if (exp.startDate && exp.endDate) {
              const start = new Date(exp.startDate);
              const end = exp.isCurrent ? new Date() : new Date(exp.endDate);

              // Calculate difference in years
              totalYears += (end - start) / (1000 * 60 * 60 * 24 * 365);
            }
          }

          return Math.round(totalYears).toString();
        }
        return profile.yearsOfExperience || profile.experienceYears || "3";

      case "current_employer":
        if (
          Array.isArray(profile.workExperience) &&
          profile.workExperience.length > 0
        ) {
          // Find current job
          const currentJob = profile.workExperience.find(
            (job) => job.isCurrent
          );

          if (currentJob) {
            return currentJob.company || currentJob.employer;
          }

          // If no current job, return most recent
          const sortedExperience = [...profile.workExperience].sort((a, b) => {
            const dateA = a.endDate ? new Date(a.endDate) : new Date();
            const dateB = b.endDate ? new Date(b.endDate) : new Date();
            return dateB - dateA;
          });

          return sortedExperience[0].company || sortedExperience[0].employer;
        }
        return profile.currentEmployer || profile.employer || "";

      case "current_title":
        if (
          Array.isArray(profile.workExperience) &&
          profile.workExperience.length > 0
        ) {
          // Find current job
          const currentJob = profile.workExperience.find(
            (job) => job.isCurrent
          );

          if (currentJob) {
            return currentJob.title || currentJob.position;
          }

          // If no current job, return most recent
          const sortedExperience = [...profile.workExperience].sort((a, b) => {
            const dateA = a.endDate ? new Date(a.endDate) : new Date();
            const dateB = b.endDate ? new Date(b.endDate) : new Date();
            return dateB - dateA;
          });

          return sortedExperience[0].title || sortedExperience[0].position;
        }
        return profile.currentTitle || profile.jobTitle || profile.title || "";

      case "skills":
        if (Array.isArray(profile.skills)) {
          return profile.skills.join(", ");
        }
        return profile.skills || "";

      case "languages":
        if (Array.isArray(profile.languages)) {
          return profile.languages.join(", ");
        }
        return profile.languages || "English";

      case "linkedin":
        return profile.linkedin || profile.linkedinUrl || "";

      case "portfolio":
        return profile.portfolio || profile.website || "";

      case "github":
        return profile.github || profile.githubUrl || "";

      case "salary":
        // Format salary expectation
        if (profile.salaryExpectation) {
          // If it's already a string with $ or other formatting, return as is
          if (
            typeof profile.salaryExpectation === "string" &&
            profile.salaryExpectation.includes("$")
          ) {
            return profile.salaryExpectation;
          }

          // If it's a number, format it
          const salary = parseInt(profile.salaryExpectation);
          if (!isNaN(salary)) {
            return salary >= 1000
              ? `$${salary.toLocaleString()}`
              : `$${salary.toLocaleString()}/hr`;
          }
        }

        // Default competitive salary
        return "$85,000";

      default:
        return null;
    }
  }

  /**
   * Handle special fields that need custom logic
   */
  async handleSpecialField(input, identifiers, profile) {
    const joinedIdentifiers = identifiers.join(" ").toLowerCase();

    // Find matching question handlers
    for (const [keyword, handler] of Object.entries(this.questionHandlers)) {
      if (joinedIdentifiers.includes(keyword)) {
        return await handler(input, identifiers, profile);
      }
    }

    // Default handling for select elements
    if (input.tagName.toLowerCase() === "select") {
      return this.handleSelectInput(input, identifiers, profile);
    }

    return null;
  }

  /**
   * Handle select input elements
   */
  async handleSelectInput(select, identifiers, profile) {
    try {
      // Skip if no options or if already selected
      if (select.options.length <= 1 || select.value) return null;

      const joinedIdentifiers = identifiers.join(" ").toLowerCase();

      // Handle country select
      if (
        joinedIdentifiers.includes("country") ||
        select.name.toLowerCase().includes("country")
      ) {
        const country =
          profile.country || profile.address?.country || "United States";
        return this.findBestSelectOption(select, country);
      }

      // Handle state/province select
      if (
        joinedIdentifiers.includes("state") ||
        joinedIdentifiers.includes("province") ||
        select.name.toLowerCase().includes("state")
      ) {
        const state = profile.state || profile.address?.state || "";
        return this.findBestSelectOption(select, state);
      }

      // Handle education degree select
      if (
        joinedIdentifiers.includes("degree") ||
        joinedIdentifiers.includes("education")
      ) {
        let degree = "";

        if (Array.isArray(profile.education) && profile.education.length > 0) {
          const sortedEducation = [...profile.education].sort((a, b) => {
            const dateA = a.endDate ? new Date(a.endDate) : new Date(0);
            const dateB = b.endDate ? new Date(b.endDate) : new Date(0);
            return dateB - dateA;
          });

          degree = sortedEducation[0].degree || "";
        } else {
          degree = profile.highestDegree || profile.degree || "";
        }

        if (degree) {
          return this.findBestSelectOption(select, degree);
        }

        // Default to Bachelor's if no education info
        return this.findBestSelectOption(select, "Bachelor's");
      }

      // Handle years of experience select
      if (
        joinedIdentifiers.includes("years") &&
        joinedIdentifiers.includes("experience")
      ) {
        let yearsExp = "";

        if (profile.yearsOfExperience) {
          yearsExp = profile.yearsOfExperience.toString();
        } else if (
          Array.isArray(profile.workExperience) &&
          profile.workExperience.length > 0
        ) {
          // Calculate total years
          let totalYears = 0;

          for (const exp of profile.workExperience) {
            if (exp.startDate) {
              const start = new Date(exp.startDate);
              const end = exp.isCurrent
                ? new Date()
                : exp.endDate
                ? new Date(exp.endDate)
                : new Date();

              // Calculate difference in years
              totalYears += (end - start) / (1000 * 60 * 60 * 24 * 365);
            }
          }

          yearsExp = Math.round(totalYears).toString();
        }

        if (yearsExp) {
          // Handle ranges like "3-5 years"
          for (let i = 0; i < select.options.length; i++) {
            const option = select.options[i];
            const text = option.text.toLowerCase();

            if (text.includes("years") && text.includes("-")) {
              const match = text.match(/(\d+)\s*-\s*(\d+)/);
              if (match) {
                const min = parseInt(match[1]);
                const max = parseInt(match[2]);
                const years = parseInt(yearsExp);

                if (
                  !isNaN(min) &&
                  !isNaN(max) &&
                  !isNaN(years) &&
                  years >= min &&
                  years <= max
                ) {
                  return option.value;
                }
              }
            }
          }

          return this.findBestSelectOption(select, yearsExp);
        }
      }

      // For default selects where we don't have a specific mapping,
      // try to pick a reasonable option

      // Avoid empty or "select" placeholder options
      for (let i = 0; i < select.options.length; i++) {
        const option = select.options[i];
        if (
          option.value &&
          !option.text.toLowerCase().includes("select") &&
          !option.text.toLowerCase().includes("choose")
        ) {
          return option.value;
        }
      }

      // If no option found, return null
      return null;
    } catch (error) {
      this.logger(`Error handling select input: ${error.message}`);
      return null;
    }
  }

  /**
   * Find the best matching option in a select element
   */
  findBestSelectOption(select, targetValue) {
    if (!targetValue) return null;

    const targetLower = targetValue.toString().toLowerCase();

    // First pass: exact match
    for (let i = 0; i < select.options.length; i++) {
      const option = select.options[i];
      if (option.value && option.text.toLowerCase() === targetLower) {
        return option.value;
      }
    }

    // Second pass: contains match
    for (let i = 0; i < select.options.length; i++) {
      const option = select.options[i];
      if (
        option.value &&
        (option.text.toLowerCase().includes(targetLower) ||
          targetLower.includes(option.text.toLowerCase()))
      ) {
        return option.value;
      }
    }

    // Third pass: first letter match (e.g., "CA" for "California")
    if (targetValue.length >= 2) {
      const firstTwoLetters = targetValue.substring(0, 2).toLowerCase();
      for (let i = 0; i < select.options.length; i++) {
        const option = select.options[i];
        if (
          option.value &&
          option.text.toLowerCase().startsWith(firstTwoLetters)
        ) {
          return option.value;
        }
      }
    }

    // Fourth pass: just get first valid option
    for (let i = 0; i < select.options.length; i++) {
      const option = select.options[i];
      if (
        option.value &&
        !option.text.toLowerCase().includes("select") &&
        !option.text.toLowerCase().includes("choose") &&
        option.text.trim() !== ""
      ) {
        return option.value;
      }
    }

    return null;
  }

  /**
   * Get label text for an input element
   */
  getLabelText(input) {
    // Check for explicit label
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        return label.textContent.trim();
      }
    }

    // Check for wrapping label
    const parentLabel = input.closest("label");
    if (parentLabel) {
      // Get label text, excluding any nested input text
      const clone = parentLabel.cloneNode(true);

      // Remove nested inputs, selects, buttons
      const toRemove = clone.querySelectorAll(
        "input, select, button, textarea"
      );
      toRemove.forEach((el) => el.remove());

      return clone.textContent.trim();
    }

    // Look for label-like elements nearby
    let element = input;

    // Check previous siblings
    while (element.previousElementSibling) {
      element = element.previousElementSibling;

      if (
        element.tagName === "LABEL" ||
        element.tagName === "DIV" ||
        element.tagName === "SPAN" ||
        element.tagName === "P"
      ) {
        const text = element.textContent.trim();
        if (text && text.length < 100) {
          // Avoid long text blocks
          return text;
        }
      }
    }

    // Check parent's previous sibling (common pattern)
    if (input.parentElement && input.parentElement.previousElementSibling) {
      const prevSibling = input.parentElement.previousElementSibling;
      const text = prevSibling.textContent.trim();
      if (text && text.length < 100) {
        return text;
      }
    }

    // Check for form-group pattern with label
    const formGroup = input.closest(
      ".form-group, .field, .input-group, .form-field"
    );
    if (formGroup) {
      const labels = formGroup.querySelectorAll(
        "label, .label, .field-label, legend"
      );
      if (labels.length > 0) {
        return labels[0].textContent.trim();
      }
    }

    return "";
  }

  /**
   * Set a value on an input element with proper events
   */
  async setInputValue(input, value) {
    if (!input || value === undefined || value === null) return;

    try {
      const inputType = input.type?.toLowerCase();

      // Handle different input types
      if (
        inputType === "select-one" ||
        input.tagName.toLowerCase() === "select"
      ) {
        // For select elements
        if (input.value !== value) {
          input.value = value;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (inputType === "checkbox" || inputType === "radio") {
        // For checkboxes and radios
        if (input.value === value || value === true) {
          if (!input.checked) {
            input.checked = true;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("click", { bubbles: true }));
          }
        }
      } else {
        // For text inputs and textareas
        if (input.value !== value) {
          // Clear existing value
          input.value = "";

          // Focus the input
          input.focus();
          await new Promise((resolve) => setTimeout(resolve, 50));

          // Set the new value
          input.value = value;

          // Dispatch events to simulate typing
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("blur", { bubbles: true }));

          // Wait a bit for any JS to process
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    } catch (error) {
      this.logger(`Error setting input value: ${error.message}`);
      console.error("Error in setInputValue:", error);
    }
  }

  /**
   * Handle special form elements like grid questions
   */
  async handleSpecialFormElements(form, profile) {
    try {
      // Handle Indeed-specific question groups
      const indeedQuestionGroups = form.querySelectorAll(".ia-Questions-item");
      for (const group of indeedQuestionGroups) {
        await this.handleIndeedQuestionGroup(group, profile);
      }

      // Handle Glassdoor multi-select skills sections
      const skillsSections = form.querySelectorAll(
        ".skills-section, .multi-select"
      );
      for (const section of skillsSections) {
        await this.handleSkillsSection(section, profile);
      }

      // Handle star rating questions (often for skills assessment)
      const ratingGroups = form.querySelectorAll(".rating-group, .star-rating");
      for (const group of ratingGroups) {
        await this.handleRatingGroup(group, profile);
      }
    } catch (error) {
      this.logger(`Error handling special form elements: ${error.message}`);
    }
  }

  /**
   * Handle Indeed question groups
   */
  async handleIndeedQuestionGroup(group, profile) {
    try {
      const questionText =
        group.querySelector(".ia-Questions-item-label")?.textContent || "";

      // Find all inputs in this group
      const inputs = group.querySelectorAll("input");
      if (inputs.length === 0) return;

      // Check if any inputs are already selected
      const anySelected = Array.from(inputs).some(
        (input) =>
          (input.type === "checkbox" || input.type === "radio") && input.checked
      );

      if (anySelected) return; // Skip if already answered

      // Try to determine best answer based on question
      const lowerQuestion = questionText.toLowerCase();

      // Handle work authorization
      if (
        lowerQuestion.includes("authorized") ||
        lowerQuestion.includes("legal") ||
        lowerQuestion.includes("eligible")
      ) {
        // Find "Yes" option
        const yesOption = Array.from(inputs).find((input) => {
          const label = this.getLabelText(input).toLowerCase();
          return label === "yes" || label.includes("yes");
        });

        if (yesOption) {
          yesOption.checked = true;
          yesOption.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      // Handle experience questions
      else if (
        lowerQuestion.includes("experience") ||
        lowerQuestion.includes("years")
      ) {
        // If it's asking about specific experience
        const experienceMatch = lowerQuestion.match(/(\d+)\+?\s*years?/i);
        const requiredYears = experienceMatch
          ? parseInt(experienceMatch[1])
          : 0;

        // Calculate user's experience
        let userYears = 0;
        if (profile.yearsOfExperience) {
          userYears = parseInt(profile.yearsOfExperience);
        } else if (Array.isArray(profile.workExperience)) {
          for (const exp of profile.workExperience) {
            if (exp.startDate) {
              const start = new Date(exp.startDate);
              const end = exp.isCurrent
                ? new Date()
                : exp.endDate
                ? new Date(exp.endDate)
                : new Date();
              userYears += (end - start) / (1000 * 60 * 60 * 24 * 365);
            }
          }
        }

        // Select appropriate option
        if (isNaN(userYears) || userYears >= requiredYears) {
          // Find "Yes" option
          const yesOption = Array.from(inputs).find((input) => {
            const label = this.getLabelText(input).toLowerCase();
            return label === "yes" || label.includes("yes");
          });

          if (yesOption) {
            yesOption.checked = true;
            yesOption.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else {
          // Find "No" option
          const noOption = Array.from(inputs).find((input) => {
            const label = this.getLabelText(input).toLowerCase();
            return label === "no" || label.includes("no");
          });

          if (noOption) {
            noOption.checked = true;
            noOption.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
      // Handle skills questions
      else if (
        lowerQuestion.includes("skill") ||
        lowerQuestion.includes("proficient") ||
        lowerQuestion.includes("knowledge")
      ) {
        // Default to "Yes" for skills questions
        const yesOption = Array.from(inputs).find((input) => {
          const label = this.getLabelText(input).toLowerCase();
          return label === "yes" || label.includes("yes");
        });

        if (yesOption) {
          yesOption.checked = true;
          yesOption.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    } catch (error) {
      this.logger(`Error handling Indeed question group: ${error.message}`);
    }
  }

  /**
   * Handle skills section or multi-select components
   */
  async handleSkillsSection(section, profile) {
    try {
      // Extract skills from profile
      let skills = [];

      if (Array.isArray(profile.skills)) {
        skills = profile.skills;
      } else if (typeof profile.skills === "string") {
        skills = profile.skills.split(/,\s*/);
      }

      if (skills.length === 0) {
        // Default skills for common job categories
        if (profile.jobTitle) {
          const title = profile.jobTitle.toLowerCase();

          if (title.includes("developer") || title.includes("engineer")) {
            skills = [
              "JavaScript",
              "Python",
              "React",
              "Node.js",
              "SQL",
              "Git",
              "AWS",
            ];
          } else if (title.includes("data")) {
            skills = ["SQL", "Python", "Excel", "Tableau", "R", "Statistics"];
          } else if (title.includes("marketing")) {
            skills = [
              "Social Media",
              "Content Marketing",
              "SEO",
              "Google Analytics",
              "CRM",
            ];
          } else if (title.includes("design")) {
            skills = [
              "Figma",
              "Adobe Creative Suite",
              "UI/UX",
              "Wireframing",
              "Prototyping",
            ];
          } else {
            skills = [
              "Microsoft Office",
              "Communication",
              "Project Management",
              "Problem Solving",
            ];
          }
        } else {
          skills = [
            "Microsoft Office",
            "Communication",
            "Project Management",
            "Problem Solving",
          ];
        }
      }

      // Find input fields or checkboxes in the skills section
      const inputs = section.querySelectorAll(
        'input[type="checkbox"], input[type="text"]'
      );

      for (const input of inputs) {
        if (input.type === "checkbox") {
          // For checkbox inputs, check if label matches any skill
          const label = this.getLabelText(input).toLowerCase();

          const matchingSkill = skills.find(
            (skill) =>
              label.includes(skill.toLowerCase()) ||
              skill.toLowerCase().includes(label)
          );

          if (matchingSkill && !input.checked) {
            input.checked = true;
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (input.type === "text" && !input.value) {
          // For text inputs, add relevant skills
          if (skills.length > 0) {
            const skillsToAdd = skills.slice(0, 3).join(", ");
            await this.setInputValue(input, skillsToAdd);
          }
        }
      }
    } catch (error) {
      this.logger(`Error handling skills section: ${error.message}`);
    }
  }

  /**
   * Handle star rating groups (often for skill self-assessment)
   */
  async handleRatingGroup(group, profile) {
    try {
      // Find the question or skill being rated
      const questionEl = group.querySelector("label, .question, .skill-name");
      const question = questionEl ? questionEl.textContent.toLowerCase() : "";

      // Find all rating inputs (usually radio buttons)
      const ratingInputs = group.querySelectorAll('input[type="radio"]');
      if (ratingInputs.length === 0) return;

      // Check if already rated
      const alreadyRated = Array.from(ratingInputs).some(
        (input) => input.checked
      );
      if (alreadyRated) return;

      // Determine skill level (0-5, with 5 being highest)
      let skillLevel = 4; // Default to high but not maximum

      // Check if we have any skills that match the question
      if (Array.isArray(profile.skills) && question) {
        const matchingSkill = profile.skills.find(
          (skill) =>
            question.includes(skill.toLowerCase()) ||
            skill.toLowerCase().includes(question)
        );

        if (matchingSkill) {
          skillLevel = 5; // If it's in our skills list, rate it highly
        }
      }

      // Adjust based on common skills expectations
      if (
        question.includes("excel") ||
        question.includes("word") ||
        question.includes("office") ||
        question.includes("email")
      ) {
        skillLevel = 5; // Everyone claims to be good at Office
      }

      // For skills that often require certification, be more modest
      if (
        question.includes("certification") ||
        question.includes("licensed") ||
        question.includes("specialized")
      ) {
        skillLevel = 3;
      }

      // Select the appropriate rating
      if (ratingInputs.length <= skillLevel) {
        // If we don't have enough options, select the highest
        ratingInputs[ratingInputs.length - 1].checked = true;
        ratingInputs[ratingInputs.length - 1].dispatchEvent(
          new Event("change", { bubbles: true })
        );
      } else {
        // Select our skill level
        ratingInputs[skillLevel].checked = true;
        ratingInputs[skillLevel].dispatchEvent(
          new Event("change", { bubbles: true })
        );
      }
    } catch (error) {
      this.logger(`Error handling rating group: ${error.message}`);
    }
  }

  /**
   * Check all required checkboxes in a form (like terms of service)
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Checking required checkboxes");

      // Find all checkbox inputs
      const checkboxes = form.querySelectorAll('input[type="checkbox"]');

      for (const checkbox of checkboxes) {
        // Skip if already checked or hidden
        if (checkbox.checked || !this.isElementVisible(checkbox)) {
          continue;
        }

        // Check if it's required
        const isRequired =
          checkbox.required ||
          checkbox.getAttribute("aria-required") === "true" ||
          checkbox.closest(".required") ||
          checkbox.classList.contains("required");

        if (isRequired) {
          this.logger("Found required checkbox, checking it");
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          // Even if not required, check common consent checkboxes
          const label = this.getLabelText(checkbox).toLowerCase();

          if (
            label.includes("terms") ||
            label.includes("agree") ||
            label.includes("consent") ||
            label.includes("privacy")
          ) {
            this.logger("Found terms checkbox, checking it");
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      }
    } catch (error) {
      this.logger(`Error handling required checkboxes: ${error.message}`);
    }
  }

  /**
   * Find the submit button in a form
   */
  findSubmitButton(form) {
    // Try various button selectors
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      ".submit-button",
      ".submitButton",
      "button.submit",
      "button.primary",
      "button.btn-primary",
      'button:contains("Submit")',
      'button:contains("Apply")',
      'input[value="Submit"]',
      'input[value="Apply"]',
    ];

    for (const selector of submitSelectors) {
      try {
        const button = form.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          return button;
        }
      } catch (error) {
        // Some selectors might not be supported, continue to next
      }
    }

    // Try finding buttons with submit/apply text
    const buttons = form.querySelectorAll('button, input[type="button"]');
    for (const button of buttons) {
      if (!this.isElementVisible(button)) continue;

      const buttonText =
        button.textContent.toLowerCase() || button.value?.toLowerCase() || "";

      if (
        buttonText.includes("submit") ||
        buttonText.includes("apply") ||
        buttonText.includes("send") ||
        buttonText.includes("finish")
      ) {
        return button;
      }
    }

    return null;
  }

  /**
   * Submit a form and wait for response
   */
  async submitForm(form) {
    try {
      this.logger("Preparing to submit form");

      // Find submit button
      const submitButton = this.findSubmitButton(form);

      if (!submitButton) {
        this.logger("Submit button not found");
        return false;
      }

      this.logger("Submit button found, clicking");

      // Click the button
      submitButton.click();

      // Wait for confirmation or next page
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check for success indicators
      if (
        document.body.textContent.toLowerCase().includes("success") ||
        document.body.textContent.toLowerCase().includes("thank you") ||
        document.body.textContent
          .toLowerCase()
          .includes("application submitted") ||
        document.body.textContent.toLowerCase().includes("application received")
      ) {
        this.logger("Submission successful");
        return true;
      }

      // Check if we're still on the same page
      if (document.contains(submitButton)) {
        // Check for error messages
        const errorMessages = document.querySelectorAll(
          ".error, .alert, .validation-error"
        );
        if (errorMessages.length > 0) {
          this.logger("Form submission failed with validation errors");
          return false;
        }

        // No errors but still on same page - might be multi-step form
        this.logger(
          "No confirmation found, but no errors either - likely moved to next step"
        );
        return true;
      }

      // Assume success if we're on a different page
      this.logger("Form submitted and page changed");
      return true;
    } catch (error) {
      this.logger(`Error submitting form: ${error.message}`);
      return false;
    }
  }

  /**
   * Get AI-generated answer for a form field
   */
  async getAIGeneratedAnswer(input, identifiers) {
    try {
      const label = this.getLabelText(input);
      if (!label) return null;

      this.logger(`Getting AI answer for: ${label}`);

      const question = label;
      const inputType =
        input.type?.toLowerCase() || input.tagName.toLowerCase();
      let options = [];

      // For select elements, get the options
      if (inputType === "select" || inputType === "select-one") {
        for (const option of input.options) {
          if (option.value && option.text.trim() !== "") {
            options.push(option.text.trim());
          }
        }
      }

      // For radio buttons, get the options
      if (inputType === "radio") {
        const name = input.name;
        if (name) {
          const radios = document.querySelectorAll(
            `input[type="radio"][name="${name}"]`
          );
          for (const radio of radios) {
            const radioLabel = this.getLabelText(radio);
            if (radioLabel) {
              options.push(radioLabel);
            }
          }
        }
      }

      // Prepare the API request
      const data = {
        question,
        options,
        userData: this.userData,
        description: this.jobDescription,
      };

      // Send to AI service
      try {
        const response = await fetch(`${this.host}/api/ai-answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          throw new Error(`AI service returned ${response.status}`);
        }

        const result = await response.json();

        if (result.answer) {
          this.logger(`AI generated answer: ${result.answer}`);
          return result.answer;
        }
      } catch (error) {
        this.logger(`AI service error: ${error.message}`);

        // Fall back to default values
        return this.getDefaultAnswer(question, inputType, options);
      }

      return null;
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);
      return null;
    }
  }

  /**
   * Get a default answer when AI is unavailable
   */
  getDefaultAnswer(question, inputType, options) {
    const q = question.toLowerCase();

    // Handle select or radio inputs with options
    if (options.length > 0) {
      // For yes/no questions, prefer yes
      if (options.some((opt) => opt.toLowerCase() === "yes")) {
        return options.find((opt) => opt.toLowerCase() === "yes");
      }

      // For legal authorization/work eligibility questions
      if (
        q.includes("authorized") ||
        q.includes("eligible") ||
        q.includes("legally")
      ) {
        return options.find((opt) => opt.toLowerCase() === "yes") || options[0];
      }

      // For experience level questions
      if (q.includes("experience") || q.includes("years")) {
        // Try to find an intermediate option
        const middleIndex = Math.floor(options.length / 2);
        return options[middleIndex];
      }

      // For salary expectations
      if (q.includes("salary")) {
        return options[Math.floor(options.length * 0.7)]; // Aim for 70th percentile
      }

      // Default to first non-empty option
      return options[0];
    }

    // Handle text inputs without options

    // Salary expectations
    if (q.includes("salary") || q.includes("compensation")) {
      return "$85,000";
    }

    // Reason for applying
    if (q.includes("why") || q.includes("reason")) {
      return "I am passionate about this role and believe my skills and experience align perfectly with the position requirements. I'm excited about the opportunity to contribute to your team.";
    }

    // Notice period
    if (q.includes("notice") || q.includes("start")) {
      return "2 weeks";
    }

    // Default for unknown questions
    return "Yes";
  }

  /**
   * Check if element is visible
   */
  isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (error) {
      return false;
    }
  }

  // Special question handlers

  /**
   * Handle salary questions
   */
  async handleSalaryQuestion(input, identifiers, profile) {
    let salary = "";

    if (profile.salaryExpectation) {
      if (typeof profile.salaryExpectation === "string") {
        salary = profile.salaryExpectation;
      } else {
        salary = "$" + profile.salaryExpectation.toLocaleString();
      }
    } else {
      // Default reasonable salary
      salary = "$85,000";
    }

    return salary;
  }

  /**
   * Handle availability questions
   */
  async handleAvailabilityQuestion(input, identifiers, profile) {
    // If current availability is specified, use that
    if (profile.availability) {
      return profile.availability;
    }

    // Default to 2 weeks notice
    return "2 weeks";
  }

  /**
   * Handle relocation questions
   */
  async handleRelocationQuestion(input, identifiers, profile) {
    // Check input type
    if (input.type === "checkbox" || input.type === "radio") {
      // For checkbox or radio, usually prefer "yes"
      return true;
    }

    // For text input, give specific response
    return "Yes, I am willing to relocate for the right opportunity.";
  }

  /**
   * Handle legal to work questions
   */
  async handleLegalQuestion(input, identifiers, profile) {
    if (input.type === "checkbox" || input.type === "radio") {
      return true;
    }
    return "Yes";
  }

  /**
   * Handle eligibility questions
   */
  async handleEligibilityQuestion(input, identifiers, profile) {
    if (input.type === "checkbox" || input.type === "radio") {
      return true;
    }
    return "Yes";
  }

  /**
   * Handle work authorization questions
   */
  async handleAuthorizationQuestion(input, identifiers, profile) {
    if (input.type === "checkbox" || input.type === "radio") {
      return true;
    }
    return "Yes, I am authorized to work in the United States.";
  }

  /**
   * Handle sponsorship questions
   */
  async handleSponsorshipQuestion(input, identifiers, profile) {
    if (input.type === "checkbox" || input.type === "radio") {
      // Generally indicate no sponsorship needed
      const label = this.getLabelText(input).toLowerCase();

      if (label.includes("no") || label.includes("not")) {
        return true;
      } else {
        return false;
      }
    }
    return "No, I do not require sponsorship.";
  }

  /**
   * Handle experience questions
   */
  async handleExperienceQuestion(input, identifiers, profile) {
    // Calculate years of experience
    let years = "";

    if (profile.yearsOfExperience) {
      years = profile.yearsOfExperience.toString();
    } else if (Array.isArray(profile.workExperience)) {
      let totalYears = 0;

      for (const exp of profile.workExperience) {
        if (exp.startDate) {
          const start = new Date(exp.startDate);
          const end = exp.isCurrent
            ? new Date()
            : exp.endDate
            ? new Date(exp.endDate)
            : new Date();

          totalYears += (end - start) / (1000 * 60 * 60 * 24 * 365);
        }
      }

      years = Math.round(totalYears).toString();
    } else {
      // Default to safe value
      years = "3";
    }

    if (
      input.type === "select-one" ||
      input.tagName.toLowerCase() === "select"
    ) {
      // For select elements, try to find matching option
      return this.findBestSelectOption(input, years);
    }

    return years;
  }

  /**
   * Handle remote work questions
   */
  async handleRemoteQuestion(input, identifiers, profile) {
    if (input.type === "checkbox" || input.type === "radio") {
      return true;
    }
    return "Yes, I am comfortable working remotely.";
  }

  /**
   * Handle willingness questions
   */
  async handleWillingnessQuestion(input, identifiers, profile) {
    if (input.type === "checkbox" || input.type === "radio") {
      return true;
    }
    return "Yes, I am willing to adapt to the requirements of this role.";
  }
}

export { GlassdoorFormHandler };
