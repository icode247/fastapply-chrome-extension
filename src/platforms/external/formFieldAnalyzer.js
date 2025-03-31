class FormFieldAnalyzer {
  static async analyzeField(element, page) {
    const fieldData = await page.evaluate((el) => {
      const getLabel = (element) => {
        // Direct label
        const labelFor = document.querySelector(`label[for="${element.id}"]`);
        if (labelFor) return labelFor.textContent.trim();

        // Aria label
        if (element.getAttribute("aria-label"))
          return element.getAttribute("aria-label");

        // Parent label
        const parentLabel = element.closest("label");
        if (parentLabel) return parentLabel.textContent.trim();

        // Nearby heading
        const heading = element
          .closest("div")
          ?.querySelector("h1,h2,h3,h4,h5,h6");
        if (heading) return heading.textContent.trim();

        // Placeholder
        if (element.placeholder) return element.placeholder;

        return element.name || "Unknown Field";
      };

      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          el.offsetParent !== null
        );
      };

      return {
        type: el.type || "text",
        name: el.name,
        id: el.id,
        label: getLabel(el),
        required:
          el.required ||
          el.getAttribute("aria-required") === "true" ||
          el.closest("[required]") !== null,
        visible: isVisible(el),
        disabled: el.disabled,
        maxLength: el.maxLength,
        pattern: el.pattern,
        placeholder: el.placeholder,
        value: el.value,
        options:
          el.tagName.toLowerCase() === "select"
            ? Array.from(el.options).map((opt) => ({
                value: opt.value,
                text: opt.text,
                selected: opt.selected,
              }))
            : null,
      };
    });

    // Analyze field purpose
    fieldData.purpose = this.determineFieldPurpose(fieldData);
    return fieldData;
  }

  static determineFieldPurpose(fieldData) {
    const text = (
      fieldData.label +
      " " +
      fieldData.name +
      " " +
      fieldData.placeholder
    ).toLowerCase();

    const patterns = {
      fullName: /(full|complete)\s*name/i,
      firstName: /first\s*name|given\s*name/i,
      lastName: /last\s*name|family\s*name|surname/i,
      email: /email|e-mail/i,
      phone: /phone|mobile|cell|telephone/i,
      address: /address|street|city|state|zip|postal/i,
      resume: /resume|cv|curriculum|vitae/i,
      coverLetter: /cover\s*letter|letter\s*of\s*interest/i,
      linkedin: /linkedin|social\s*profile/i,
      portfolio: /portfolio|personal\s*site|website/i,
      experience: /years\s*of\s*experience|work\s*experience/i,
      education: /education|degree|qualification/i,
      skills: /skills|expertise|proficiency/i,
      salary: /salary|compensation|pay\s*expectations?/i,
      availability: /start\s*date|available|notice\s*period/i,
      citizenship: /citizenship|work\s*permit|visa|authorization/i,
      references: /references|referral|referee/i,
    };

    for (const [purpose, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) {
        return purpose;
      }
    }

    return "unknown";
  }
}
