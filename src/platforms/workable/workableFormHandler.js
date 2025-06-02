// // import { HOST } from "@shared/constants";
// // //getAIAnswer
// // /**
// //  * WorkableFormHandler - Functions for handling Workable application forms
// //  */

// // export class WorkableFormHandler {
// //   constructor(options = {}) {
// //     this.logger = options.logger || console.log;
// //     this.host = options.host || HOST;
// //     this.userData = options.userData || {};
// //     this.jobDescription = options.jobDescription || "";
// //     this.answerCache = {}; // Cache for AI answers
// //   }

// //   /**
// //    * Get all form fields from a Workable application form
// //    * @param {HTMLElement} form - The form element
// //    * @returns {Array} - Array of form field objects with element, label, type, and required status
// //    */
// //   getAllFormFields(form) {
// //     try {
// //       this.logger("Finding all form fields");

// //       const fields = [];

// //       // Find all visible input elements including Workable's custom elements
// //       const formElements = form.querySelectorAll(
// //         'input:not([type="hidden"]), select, textarea, ' +
// //           '[role="radio"], [role="checkbox"], ' +
// //           'fieldset[role="radiogroup"], ' +
// //           'div[class*="styles--3IYUq"], ' + // Workable specific classes
// //           'div[role="group"], ' +
// //           "div.field-type-Boolean"
// //       );

// //       this.logger(`Found ${formElements.length} form elements`);

// //       // Process each element
// //       for (const element of formElements) {
// //         // Skip invisible elements
// //         if (!this.isElementVisible(element)) continue;

// //         const fieldInfo = {
// //           element,
// //           label: this.getFieldLabel(element),
// //           type: this.getFieldType(element),
// //           required: this.isFieldRequired(element),
// //         };

// //         // For radio groups, get the full fieldset when possible
// //         if (fieldInfo.type === "radio" && element.tagName !== "FIELDSET") {
// //           const radioGroup = element.closest('fieldset[role="radiogroup"]');
// //           if (radioGroup) {
// //             fieldInfo.element = radioGroup;
// //           }
// //         }

// //         fields.push(fieldInfo);
// //       }

// //       // Deduplicate fields - particularly important for radio groups
// //       const uniqueFields = [];
// //       const seenLabels = new Set();

// //       for (const field of fields) {
// //         // Only add fields with labels
// //         if (!field.label) continue;

// //         // For radio fields, only add the first instance of each label
// //         if (field.type === "radio") {
// //           if (!seenLabels.has(field.label)) {
// //             seenLabels.add(field.label);
// //             uniqueFields.push(field);
// //           }
// //         } else {
// //           uniqueFields.push(field);
// //         }
// //       }

// //       this.logger(`Processed ${uniqueFields.length} unique form fields`);
// //       return uniqueFields;
// //     } catch (error) {
// //       this.logger(`Error getting form fields: ${error.message}`);
// //       return [];
// //     }
// //   }

// //   /**
// //    * Get label text for a form field
// //    * @param {HTMLElement} element - The form field element
// //    * @returns {string} - The label text or empty string if not found
// //    */
// //   getFieldLabel(element) {
// //     try {
// //       const workableLabel = element
// //         .closest(".styles--3aPac")
// //         ?.querySelector(".styles--QTMDv");
// //       if (workableLabel) {
// //         return this.cleanLabelText(workableLabel.textContent);
// //       }

// //       // If this is a checkbox/radio group, look for the label with aria-labelledby
// //       if (
// //         element.getAttribute("role") === "group" ||
// //         element.getAttribute("role") === "radiogroup" ||
// //         (element.tagName === "FIELDSET" &&
// //           element.getAttribute("role") === "radiogroup")
// //       ) {
// //         const labelledById = element.getAttribute("aria-labelledby");
// //         if (labelledById) {
// //           const labelEl = document.getElementById(labelledById);
// //           if (labelEl) {
// //             // Specifically exclude SVG descriptions
// //             const labelText = Array.from(labelEl.childNodes)
// //               .filter(
// //                 (node) =>
// //                   node.nodeType === Node.TEXT_NODE ||
// //                   (node.nodeType === Node.ELEMENT_NODE &&
// //                     node.tagName !== "SVG")
// //               )
// //               .map((node) => node.textContent)
// //               .join(" ");
// //             return this.cleanLabelText(labelText);
// //           }
// //         }
// //       }

// //       // Special handling for Workable radio groups
// //       if (
// //         element.getAttribute("role") === "radiogroup" ||
// //         (element.tagName === "FIELDSET" &&
// //           element.getAttribute("role") === "radiogroup")
// //       ) {
// //         // Look for aria-labelledby first
// //         const labelledById = element.getAttribute("aria-labelledby");
// //         if (labelledById) {
// //           const labelEl = document.getElementById(labelledById);
// //           if (labelEl) {
// //             return this.cleanLabelText(labelEl.textContent);
// //           }
// //         }

// //         // If no aria-labelledby, try to find previous sibling with label class
// //         const prevSibling = element.previousElementSibling;
// //         if (prevSibling) {
// //           const labelEl = prevSibling.querySelector(
// //             '[class*="QTMDv"], [class*="label"], span[id*="_label"]'
// //           );
// //           if (labelEl) {
// //             return this.cleanLabelText(labelEl.textContent);
// //           }
// //         }
// //       }

// //       // Method 1: Check for aria-labelledby attribute
// //       const labelledById = element.getAttribute("aria-labelledby");
// //       if (labelledById) {
// //         const labelElement = document.getElementById(labelledById);
// //         if (labelElement) {
// //           return this.cleanLabelText(labelElement.textContent);
// //         }
// //       }

// //       // Method 2: Check for explicit label element
// //       if (element.id) {
// //         const labelElement = document.querySelector(
// //           `label[for="${element.id}"]`
// //         );
// //         if (labelElement) {
// //           return this.cleanLabelText(labelElement.textContent);
// //         }
// //       }

// //       // Method 3: Check if element is inside a label
// //       const parentLabel = element.closest("label");
// //       if (parentLabel) {
// //         // Clone the label to avoid modifying the original
// //         const clone = parentLabel.cloneNode(true);

// //         // Remove the input element from the clone to get just the label text
// //         const inputElements = clone.querySelectorAll("input, select, textarea");
// //         for (const inputEl of inputElements) {
// //           if (inputEl.parentNode) {
// //             inputEl.parentNode.removeChild(inputEl);
// //           }
// //         }

// //         return this.cleanLabelText(clone.textContent);
// //       }

// //       // Workable-specific: Check for styles--QTMDv class in parent container
// //       const parentContainer = element.closest('div[class*="styles--3aPac"]');
// //       if (parentContainer) {
// //         const labelEl = parentContainer.querySelector('[class*="QTMDv"]');
// //         if (labelEl) {
// //           return this.cleanLabelText(labelEl.textContent);
// //         }
// //       }

// //       // Method 4: Check if element is in a fieldset with legend
// //       const fieldset = element.closest("fieldset");
// //       if (fieldset) {
// //         const legend = fieldset.querySelector("legend");
// //         if (legend) {
// //           return this.cleanLabelText(legend.textContent);
// //         }
// //       }

// //       // Method 5: Look for nearby elements that could be labels
// //       const parent = element.parentElement;
// //       if (parent) {
// //         // Check for elements with label-like class names
// //         const labelElements = parent.querySelectorAll(
// //           '.label, .field-label, [class*="label"]'
// //         );
// //         if (labelElements.length > 0) {
// //           return this.cleanLabelText(labelElements[0].textContent);
// //         }

// //         // Check for special Workable structure
// //         if (
// //           parent.previousElementSibling &&
// //           parent.previousElementSibling.querySelector('[class*="QTMDv"]')
// //         ) {
// //           return this.cleanLabelText(parent.previousElementSibling.textContent);
// //         }
// //       }

// //       // Method 6: Use aria-label, placeholder, or name as fallback
// //       if (element.getAttribute("aria-label")) {
// //         return this.cleanLabelText(element.getAttribute("aria-label"));
// //       }

// //       if (element.placeholder) {
// //         return this.cleanLabelText(element.placeholder);
// //       }

// //       if (element.name) {
// //         // Convert camelCase or snake_case to spaces
// //         return this.cleanLabelText(
// //           element.name.replace(/([A-Z])/g, " $1").replace(/_/g, " ")
// //         );
// //       }

// //       // If nothing else works, return empty string
// //       return "";
// //     } catch (error) {
// //       this.logger(`Error getting field label: ${error.message}`);
// //       return "";
// //     }
// //   }

// //   /**
// //    * Clean up label text by removing asterisks and extra whitespace
// //    * @param {string} text - The original label text
// //    * @returns {string} - The cleaned label text
// //    */
// //   cleanLabelText(text) {
// //     if (!text) return "";

// //     return text
// //       .replace(/[*✱]/g, "") // Remove asterisks (both standard and special)
// //       .replace(/\s+/g, " ") // Normalize whitespace
// //       .replace(/^\s+|\s+$/g, "") // Trim start and end
// //       .replace(/\(required\)/i, "") // Remove "(required)" text
// //       .replace(/\(optional\)/i, "") // Remove "(optional)" text
// //       .toLowerCase(); // Convert to lowercase for easier comparison
// //   }

// //   /**
// //    * Get the type of a form field
// //    * @param {HTMLElement} element - The form field element
// //    * @returns {string} - The field type
// //    */
// //   getFieldType(element) {
// //     const role = element.getAttribute("role");
// //     const tagName = element.tagName.toLowerCase();

// //     // Radio groups
// //     if (
// //       role === "radiogroup" ||
// //       (tagName === "fieldset" && role === "radiogroup")
// //     ) {
// //       return "radio";
// //     }

// //     // Checkbox groups
// //     if (
// //       role === "group" &&
// //       element.querySelector('[role="checkbox"], input[type="checkbox"]')
// //     ) {
// //       return "checkbox";
// //     }

// //     // Individual radio or checkbox
// //     if (role === "radio" || role === "checkbox") {
// //       return role;
// //     }

// //     // Custom select (combobox not part of phone input)
// //     if (role === "combobox" && !element.closest('[data-ui="phone"]')) {
// //       return "select";
// //     }

// //     // Upload fields
// //     if (
// //       element.getAttribute("data-role") === "dropzone" ||
// //       element.querySelector('input[type="file"]')
// //     ) {
// //       return "file";
// //     }

// //     // Standard HTML elements
// //     if (tagName === "select") return "select";
// //     if (tagName === "textarea") return "textarea";
// //     if (tagName === "input") {
// //       const type = element.type.toLowerCase();
// //       if (type === "file") return "file";
// //       if (type === "checkbox") return "checkbox";
// //       if (type === "radio") return "radio";
// //       if (type === "tel" || element.closest('[data-ui="phone"]'))
// //         return "phone";
// //       return type || "text";
// //     }

// //     // Workable-specific custom fields (only apply if no other match)
// //     if (
// //       element.classList.contains("styles--2-TzV") &&
// //       element.querySelector('[role="radio"], input[type="radio"]')
// //     ) {
// //       return "radio";
// //     }

// //     return "unknown";
// //   }

// //   /**
// //    * Check if a field is required
// //    * @param {HTMLElement} element - The form field element
// //    * @returns {boolean} - True if the field is required
// //    */
// //   isFieldRequired(element) {
// //     // Check required attribute
// //     if (element.required || element.getAttribute("aria-required") === "true") {
// //       return true;
// //     }

// //     // Check for asterisk in label or aria-labelledby element
// //     const labelledById = element.getAttribute("aria-labelledby");
// //     if (labelledById) {
// //       const labelElement = document.getElementById(labelledById);
// //       if (
// //         labelElement &&
// //         (labelElement.textContent.includes("*") ||
// //           labelElement.textContent.includes("✱"))
// //       ) {
// //         return true;
// //       }
// //     }

// //     // Check for Workable-specific required indicators
// //     const hasWorkableRequired =
// //       element.parentElement?.querySelector('[class*="33eUF"]') ||
// //       element.closest("div")?.querySelector('[class*="33eUF"]');

// //     if (hasWorkableRequired) {
// //       return true;
// //     }

// //     // Check for explicit label with asterisk
// //     if (element.id) {
// //       const labelElement = document.querySelector(`label[for="${element.id}"]`);
// //       if (
// //         labelElement &&
// //         (labelElement.textContent.includes("*") ||
// //           labelElement.textContent.includes("✱"))
// //       ) {
// //         return true;
// //       }
// //     }

// //     // Check parent elements for required indicator
// //     let parent = element.parentElement;
// //     for (let i = 0; i < 3 && parent; i++) {
// //       // Only check up to 3 levels
// //       if (
// //         parent.querySelector('.required, .mandatory, [class*="required"]') ||
// //         parent.querySelector('[class*="33eUF"]') // Workable-specific class for required indicators
// //       ) {
// //         return true;
// //       }
// //       parent = parent.parentElement;
// //     }

// //     return false;
// //   }

// //   /**
// //    * Get an appropriate answer from AI for a form field
// //    * @param {string} question - The field label/question
// //    * @param {Array<string>} options - Available options for select/radio fields
// //    * @param {string} fieldType - The type of field
// //    * @param {string} fieldContext - Additional context about the field
// //    * @returns {Promise<string>} - The AI-generated answer
// //    */
// //   async getAIAnswer(
// //     question,
// //     options = [],
// //     fieldType = "text",
// //   ) {
// //     try {
// //       this.logger(`Requesting AI answer for "${question}"`);
// //       console.log(this.jobDescription)
// //       // Make API request to get answer
// //       const response = await fetch(`${this.host}/api/ai-answer`, {
// //         method: "POST",
// //         headers: { "Content-Type": "application/json" },
// //         body: JSON.stringify({
// //           question,
// //           options,
// //           userData: this.userData,
// //           description: this.jobDescription,
// //         }),
// //       });

// //       if (!response.ok) {
// //         throw new Error(`AI service error: ${response.status}`);
// //       }

// //       const data = await response.json();
// //       const answer = data.answer;

// //       return answer;
// //     } catch (error) {
// //       this.logger(`Error getting AI answer: ${error.message}`);
// //     }
// //   }

// //   /**
// //    * Extract context from the form to help AI understand the application
// //    * @returns {Object} - Contextual information about the form
// //    */
// //   extractFormContext() {
// //     try {
// //       // Get the job title if available
// //       let jobTitle = "";
// //       const titleElements = document.querySelectorAll(
// //         'h1, h2, h3, .job-title, [class*="title"]'
// //       );
// //       for (const el of titleElements) {
// //         const text = el.textContent.trim();
// //         if (text && text.length < 100) {
// //           jobTitle = text;
// //           break;
// //         }
// //       }

// //       // Get the company name if available
// //       let companyName = "";
// //       const companyElements = document.querySelectorAll(
// //         '.company-name, [class*="company"], [itemprop="hiringOrganization"]'
// //       );
// //       for (const el of companyElements) {
// //         const text = el.textContent.trim();
// //         if (text && text.length < 100) {
// //           companyName = text;
// //           break;
// //         }
// //       }

// //       // Get form section headings
// //       const sections = [];
// //       const headings = document.querySelectorAll(
// //         'h2, h3, h4, .section-heading, [class*="section-title"]'
// //       );
// //       for (const heading of headings) {
// //         if (this.isElementVisible(heading)) {
// //           sections.push(heading.textContent.trim());
// //         }
// //       }

// //       return {
// //         jobTitle,
// //         companyName,
// //         formSections: sections,
// //         url: window.location.href,
// //       };
// //     } catch (error) {
// //       this.logger(`Error extracting form context: ${error.message}`);
// //       return {};
// //     }
// //   }

// //   /**
// //    * Fill a form field with the appropriate value
// //    * @param {HTMLElement} element - The form field element
// //    * @param {string} value - The value to fill
// //    * @returns {Promise<boolean>} - True if successful
// //    */
// //   async fillField(element, value) {
// //     try {
// //       if (!element || value === undefined || value === null) {
// //         return false;
// //       }

// //       // Get field type to determine how to fill it
// //       const fieldType = this.getFieldType(element);

// //       this.logger(`Filling ${fieldType} field with value: ${value}`);

// //       switch (fieldType) {
// //         case "text":
// //         case "email":
// //         case "tel":
// //         case "url":
// //         case "number":
// //         case "password":
// //           return await this.fillInputField(element, value);

// //         case "textarea":
// //           return await this.fillTextareaField(element, value);

// //         // case "select":
// //         //   return await this.fillSelectField(element, value);

// //         // case "phone":
// //         //   return await this.fillPhoneField(element, value);

// //         case "checkbox":
// //           return await this.fillCheckboxField(element, value);

// //         case "radio":
// //           return await this.fillRadioField(element, value);

// //         case "date":
// //           return await this.fillDateField(element, value);

// //         case "file":
// //           // File uploads handled separately
// //           return false;

// //         default:
// //           this.logger(`Unsupported field type: ${fieldType}`);
// //           return false;
// //       }
// //     } catch (error) {
// //       this.logger(`Error filling field: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Fill a text input field
// //    * @param {HTMLElement} element - The input element
// //    * @param {string} value - The value to fill
// //    * @returns {Promise<boolean>} - True if successful
// //    */
// //   async fillInputField(element, value) {
// //     try {
// //       // Focus on the element
// //       this.scrollToElement(element);
// //       element.focus();
// //       await this.wait(100);

// //       // Clear existing value
// //       element.value = "";
// //       element.dispatchEvent(new Event("input", { bubbles: true }));
// //       await this.wait(50);

// //       // Set new value
// //       element.value = value;

// //       // Trigger appropriate events
// //       element.dispatchEvent(new Event("input", { bubbles: true }));
// //       element.dispatchEvent(new Event("change", { bubbles: true }));
// //       element.dispatchEvent(new Event("blur", { bubbles: true }));

// //       await this.wait(100);

// //       return true;
// //     } catch (error) {
// //       this.logger(`Error filling input field: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Fill a textarea field
// //    * @param {HTMLElement} element - The textarea element
// //    * @param {string} value - The value to fill
// //    * @returns {Promise<boolean>} - True if successful
// //    */
// //   async fillTextareaField(element, value) {
// //     // Textarea filling is basically the same as input filling
// //     return await this.fillInputField(element, value);
// //   }

// //   /**
// //    * Fill a checkbox field
// //    * @param {HTMLElement} element - The checkbox element or container
// //    * @param {boolean|string} value - Whether to check the box
// //    * @returns {Promise<boolean>} - True if successful
// //    */
// //   async fillCheckboxField(element, value) {
// //     try {
// //       // Normalize the value to a boolean
// //       const shouldCheck =
// //         value === true ||
// //         value === "true" ||
// //         value === "yes" ||
// //         value === "on" ||
// //         value === 1;

// //       // Find the actual checkbox input if we were given a container
// //       let checkboxInput = element;
// //       if (element.tagName.toLowerCase() !== "input") {
// //         checkboxInput = element.querySelector('input[type="checkbox"]');

// //         // If no checkbox found, try the Workable specific structure
// //         if (!checkboxInput) {
// //           if (element.getAttribute("role") === "checkbox") {
// //             // This is a custom checkbox element
// //             const isChecked = element.getAttribute("aria-checked") === "true";

// //             // Only click if the current state doesn't match desired state
// //             if ((shouldCheck && !isChecked) || (!shouldCheck && isChecked)) {
// //               this.scrollToElement(element);
// //               element.click();
// //               await this.wait(200);
// //             }

// //             return true;
// //           }
// //         }

// //         if (!checkboxInput) {
// //           return false;
// //         }
// //       }

// //       // Only change state if needed
// //       if (
// //         (shouldCheck && !checkboxInput.checked) ||
// //         (!shouldCheck && checkboxInput.checked)
// //       ) {
// //         this.scrollToElement(checkboxInput);

// //         // Try clicking the label if available (more reliable than clicking the input directly)
// //         const labelEl =
// //           checkboxInput.closest("label") ||
// //           document.querySelector(`label[for="${checkboxInput.id}"]`);

// //         if (labelEl) {
// //           labelEl.click();
// //         } else {
// //           checkboxInput.click();
// //         }

// //         await this.wait(200);

// //         // If the click didn't work, try setting the property directly
// //         if (checkboxInput.checked !== shouldCheck) {
// //           checkboxInput.checked = shouldCheck;
// //           checkboxInput.dispatchEvent(new Event("change", { bubbles: true }));
// //         }
// //       }

// //       return true;
// //     } catch (error) {
// //       this.logger(`Error filling checkbox field: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Fill a radio button field
// //    * @param {HTMLElement} element - The radio element or container
// //    * @param {string} value - The value to select
// //    * @returns {Promise<boolean>} - True if successful
// //    */
// //   async fillRadioField(element, value) {
// //     try {
// //       // Get the lowercase string value for comparison
// //       const valueStr = String(value).toLowerCase();
// //       const isYes = valueStr === "yes" || valueStr === "true";

// //       // Handle Workable's fieldset radio groups with the specific class patterns
// //       if (
// //         (element.getAttribute("role") === "radiogroup" ||
// //           (element.tagName === "FIELDSET" &&
// //             element.getAttribute("role") === "radiogroup")) &&
// //         (element.classList.contains("styles--2-TzV") ||
// //           element.classList.contains("styles--3u2Bk"))
// //       ) {
// //         this.logger(
// //           `Handling Workable-specific radio group for value: ${valueStr}`
// //         );

// //         // Get all radio divs (not inputs) with role="radio"
// //         const radioOptions = element.querySelectorAll('div[role="radio"]');
// //         if (!radioOptions.length) {
// //           this.logger("No radio options found with div[role='radio']");
// //           return false;
// //         }

// //         this.logger(`Found ${radioOptions.length} radio options`);

// //         // First try to find by exact label match
// //         let targetRadio = null;
// //         for (const radio of radioOptions) {
// //           // In Workable forms, the label is in a span with ID containing "radio_label"
// //           const labelSpan = radio.querySelector('span[id*="radio_label"]');
// //           if (labelSpan) {
// //             const labelText = labelSpan.textContent.trim().toLowerCase();
// //             this.logger(`Radio option label: "${labelText}"`);

// //             // Check for exact match with yes/no/true/false
// //             if (
// //               (isYes && (labelText === "yes" || labelText === "true")) ||
// //               (!isYes && (labelText === "no" || labelText === "false"))
// //             ) {
// //               targetRadio = radio;
// //               break;
// //             }
// //           }
// //         }

// //         // If no match found but we know it's a yes/no question, use position
// //         // In Workable, first option is usually YES, second is NO
// //         if (!targetRadio) {
// //           if (radioOptions.length >= 2) {
// //             targetRadio = isYes ? radioOptions[0] : radioOptions[1];
// //             this.logger(
// //               `Using position-based selection: ${
// //                 isYes ? "first (YES)" : "second (NO)"
// //               }`
// //             );
// //           } else if (radioOptions.length === 1) {
// //             // If only one option, use it
// //             targetRadio = radioOptions[0];
// //           }
// //         }

// //         // If we found a radio option to click
// //         if (targetRadio) {
// //           this.logger(
// //             `Clicking on radio option: ${targetRadio.id || "unknown id"}`
// //           );

// //           // Scroll to the element
// //           this.scrollToElement(targetRadio);
// //           await this.wait(300);

// //           // Direct click on the div with role="radio"
// //           targetRadio.click();
// //           await this.wait(400);

// //           // Verify the click worked - check aria-checked state
// //           if (targetRadio.getAttribute("aria-checked") !== "true") {
// //             this.logger("First click didn't work, trying alternative approach");

// //             // Try clicking the label inside
// //             const label = targetRadio.querySelector("label");
// //             if (label) {
// //               label.click();
// //               await this.wait(400);
// //             }

// //             // If that still didn't work, try the hidden input as a last resort
// //             if (targetRadio.getAttribute("aria-checked") !== "true") {
// //               const hiddenInput = targetRadio.querySelector("input");
// //               if (hiddenInput) {
// //                 // Can't click directly as it's hidden, but we can set the checked property
// //                 hiddenInput.checked = true;
// //                 hiddenInput.dispatchEvent(
// //                   new Event("change", { bubbles: true })
// //                 );

// //                 // And click the wrapper again
// //                 targetRadio.click();
// //               }
// //             }
// //           }

// //           // Final check
// //           const success = targetRadio.getAttribute("aria-checked") === "true";
// //           this.logger(`Radio selection ${success ? "successful" : "failed"}`);

// //           return success;
// //         } else {
// //           this.logger("No matching radio option found");
// //           return false;
// //         }
// //       }

// //       // Handle generic Workable's fieldset radio groups
// //       if (
// //         element.getAttribute("role") === "radiogroup" ||
// //         (element.tagName === "FIELDSET" &&
// //           element.getAttribute("role") === "radiogroup")
// //       ) {
// //         const radios = element.querySelectorAll('[role="radio"]');
// //         if (!radios.length) return false;

// //         // Try to find matching radio by label
// //         let matchingRadio = null;

// //         for (const radio of radios) {
// //           // Look for the label in span with id containing "radio_label"
// //           const labelSpan = radio.querySelector('span[id*="radio_label"]');

// //           if (labelSpan) {
// //             const labelText = labelSpan.textContent.trim().toLowerCase();

// //             // Try exact and partial matches
// //             if (
// //               labelText === valueStr ||
// //               labelText.includes(valueStr) ||
// //               valueStr.includes(labelText) ||
// //               // Special handling for yes/no
// //               (valueStr === "yes" &&
// //                 (labelText === "yes" || labelText === "YES")) ||
// //               (valueStr === "no" && (labelText === "no" || labelText === "NO"))
// //             ) {
// //               matchingRadio = radio;
// //               break;
// //             }
// //           }
// //         }

// //         // If no match by label, try yes/no special cases
// //         if (
// //           !matchingRadio &&
// //           (valueStr === "yes" ||
// //             valueStr === "no" ||
// //             valueStr === "true" ||
// //             valueStr === "false")
// //         ) {
// //           const isYes = valueStr === "yes" || valueStr === "true";

// //           // For yes/no questions, first radio is usually "yes" and second is "no"
// //           if (isYes && radios.length > 0) {
// //             matchingRadio = radios[0];
// //           } else if (!isYes && radios.length > 1) {
// //             matchingRadio = radios[1];
// //           }
// //         }

// //         // If still no match, use first option
// //         if (!matchingRadio && radios.length > 0) {
// //           matchingRadio = radios[0];
// //         }

// //         if (matchingRadio) {
// //           this.scrollToElement(matchingRadio);

// //           // Only click if not already selected
// //           if (matchingRadio.getAttribute("aria-checked") !== "true") {
// //             matchingRadio.click();
// //             await this.wait(300);

// //             // Verify the click worked
// //             if (matchingRadio.getAttribute("aria-checked") !== "true") {
// //               // Try a different approach - find the hidden input
// //               const hiddenInput = matchingRadio.querySelector(
// //                 'input[type="radio"]'
// //               );
// //               if (hiddenInput) {
// //                 hiddenInput.checked = true;
// //                 hiddenInput.dispatchEvent(
// //                   new Event("change", { bubbles: true })
// //                 );
// //               }
// //             }
// //           }

// //           return true;
// //         }
// //       }
// //       // For Workable's specific radio implementation (individual radio)
// //       else if (element.getAttribute("role") === "radio") {
// //         const radioGroup =
// //           element.closest('[role="radiogroup"]') || element.parentElement;
// //         if (!radioGroup) return false;

// //         const radios = radioGroup.querySelectorAll('[role="radio"]');
// //         const valueStr = String(value).toLowerCase();

// //         // Find the matching radio button
// //         let matchingRadio = null;

// //         for (const radio of radios) {
// //           // Get the label either from aria-labelledby or from child span
// //           let radioLabel = "";

// //           const labelledById = radio.getAttribute("aria-labelledby");
// //           if (labelledById) {
// //             const labelEl = document.getElementById(labelledById);
// //             if (labelEl) {
// //               radioLabel = labelEl.textContent.trim().toLowerCase();
// //             }
// //           }

// //           // If no label found via aria-labelledby, look for a span
// //           if (!radioLabel) {
// //             const labelSpan = radio.querySelector('span[id*="radio_label"]');
// //             if (labelSpan) {
// //               radioLabel = labelSpan.textContent.trim().toLowerCase();
// //             }
// //           }

// //           // Look for a matching label
// //           if (
// //             radioLabel === valueStr ||
// //             radioLabel.includes(valueStr) ||
// //             valueStr.includes(radioLabel) ||
// //             // Special handling for yes/no radios
// //             (valueStr === "yes" && radioLabel === "yes") ||
// //             (valueStr === "no" && radioLabel === "no")
// //           ) {
// //             matchingRadio = radio;
// //             break;
// //           }
// //         }

// //         // If no match found but we have yes/no value, look for specific yes/no patterns
// //         if (
// //           !matchingRadio &&
// //           (valueStr === "yes" ||
// //             valueStr === "no" ||
// //             valueStr === "true" ||
// //             valueStr === "false")
// //         ) {
// //           const isYes = valueStr === "yes" || valueStr === "true";

// //           for (const radio of radios) {
// //             // Special case for radio indexes - first is often Yes, second is often No
// //             if (isYes && radios[0] === radio) {
// //               matchingRadio = radio;
// //               break;
// //             } else if (!isYes && radios.length > 1 && radios[1] === radio) {
// //               matchingRadio = radio;
// //               break;
// //             }
// //           }
// //         }

// //         // If still no match, use first radio as default
// //         if (!matchingRadio && radios.length > 0) {
// //           matchingRadio = radios[0];
// //         }

// //         // Click the matching radio
// //         if (matchingRadio) {
// //           this.scrollToElement(matchingRadio);
// //           matchingRadio.click();
// //           await this.wait(200);
// //           return true;
// //         }
// //       }
// //       // Standard radio buttons
// //       else {
// //         // Find name attribute to identify the radio group
// //         let radioName = "";

// //         if (
// //           element.tagName.toLowerCase() === "input" &&
// //           element.type === "radio"
// //         ) {
// //           radioName = element.name;
// //         } else {
// //           // Find the first radio in the container
// //           const radioInput = element.querySelector('input[type="radio"]');
// //           if (radioInput) {
// //             radioName = radioInput.name;
// //           }
// //         }

// //         if (!radioName) return false;

// //         // Find all radios in the group
// //         const radios = document.querySelectorAll(
// //           `input[type="radio"][name="${radioName}"]`
// //         );
// //         const valueStr = String(value).toLowerCase();

// //         // Find the matching radio
// //         let matchingRadio = null;

// //         for (const radio of radios) {
// //           // Check value attribute
// //           if (radio.value.toLowerCase() === valueStr) {
// //             matchingRadio = radio;
// //             break;
// //           }

// //           // Check label text
// //           const label =
// //             radio.closest("label") ||
// //             document.querySelector(`label[for="${radio.id}"]`);
// //           if (label) {
// //             const labelText = label.textContent.trim().toLowerCase();
// //             if (
// //               labelText === valueStr ||
// //               labelText.includes(valueStr) ||
// //               valueStr.includes(labelText)
// //             ) {
// //               matchingRadio = radio;
// //               break;
// //             }
// //           }
// //         }

// //         // Special handling for yes/no
// //         if (
// //           !matchingRadio &&
// //           (valueStr === "yes" ||
// //             valueStr === "no" ||
// //             valueStr === "true" ||
// //             valueStr === "false")
// //         ) {
// //           const isYes = valueStr === "yes" || valueStr === "true";

// //           for (const radio of radios) {
// //             const label =
// //               radio.closest("label") ||
// //               document.querySelector(`label[for="${radio.id}"]`);
// //             if (label) {
// //               const labelText = label.textContent.trim().toLowerCase();
// //               if (
// //                 (isYes && labelText.includes("yes")) ||
// //                 (!isYes && labelText.includes("no"))
// //               ) {
// //                 matchingRadio = radio;
// //                 break;
// //               }
// //             }
// //           }
// //         }

// //         // If still no match, use first radio
// //         if (!matchingRadio && radios.length > 0) {
// //           matchingRadio = radios[0];
// //         }

// //         // Click the matching radio
// //         if (matchingRadio) {
// //           this.scrollToElement(matchingRadio);

// //           // Try clicking the label (more reliable)
// //           const label =
// //             matchingRadio.closest("label") ||
// //             document.querySelector(`label[for="${matchingRadio.id}"]`);
// //           if (label) {
// //             label.click();
// //           } else {
// //             matchingRadio.click();
// //           }

// //           await this.wait(200);

// //           // Check if click worked, if not try direct property
// //           if (!matchingRadio.checked) {
// //             matchingRadio.checked = true;
// //             matchingRadio.dispatchEvent(new Event("change", { bubbles: true }));
// //           }

// //           return true;
// //         }
// //       }

// //       return false;
// //     } catch (error) {
// //       this.logger(`Error filling radio field: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Fill a date field
// //    * @param {HTMLElement} element - The date input element
// //    * @param {string} value - The date value to fill
// //    * @returns {Promise<boolean>} - True if successful
// //    */
// //   async fillDateField(element, value) {
// //     try {
// //       // For native date inputs
// //       if (
// //         element.tagName.toLowerCase() === "input" &&
// //         element.type === "date"
// //       ) {
// //         return await this.fillInputField(element, value);
// //       }

// //       // For Workable custom date inputs
// //       // These often use MM/YYYY format and have a calendar icon
// //       const isDateInput =
// //         element.getAttribute("inputmode") === "tel" &&
// //         (element.placeholder?.includes("MM/YYYY") ||
// //           element.placeholder?.includes("MM/DD/YYYY"));

// //       if (isDateInput || element.closest(".react-datepicker-wrapper")) {
// //         this.scrollToElement(element);
// //         element.focus();
// //         await this.wait(100);

// //         // Clear existing value
// //         element.value = "";
// //         element.dispatchEvent(new Event("input", { bubbles: true }));
// //         await this.wait(50);

// //         // Format the date value appropriately based on placeholder
// //         let formattedDate = value;
// //         if (element.placeholder?.includes("MM/YYYY")) {
// //           // Parse the date value
// //           let dateObj;
// //           try {
// //             dateObj = new Date(value);
// //             if (isNaN(dateObj.getTime())) {
// //               // If parsing failed, try to extract month and year
// //               const parts = value.split(/[\s\/\-\.]/);
// //               if (parts.length >= 2) {
// //                 // Assuming format is MM/YYYY or similar
// //                 let month = parseInt(parts[0]);
// //                 let year = parseInt(parts[1]);

// //                 // Handle two-digit years
// //                 if (year < 100) {
// //                   year += year < 50 ? 2000 : 1900;
// //                 }

// //                 // Format as MM/YYYY
// //                 formattedDate = `${month.toString().padStart(2, "0")}/${year}`;
// //               }
// //             } else {
// //               // Format the date object as MM/YYYY
// //               const month = dateObj.getMonth() + 1; // getMonth() is 0-indexed
// //               const year = dateObj.getFullYear();
// //               formattedDate = `${month.toString().padStart(2, "0")}/${year}`;
// //             }
// //           } catch (e) {
// //             // Keep original value if parsing fails
// //           }
// //         } else if (element.placeholder?.includes("MM/DD/YYYY")) {
// //           // Parse the date value
// //           try {
// //             const dateObj = new Date(value);
// //             if (!isNaN(dateObj.getTime())) {
// //               // Format the date object as MM/DD/YYYY
// //               const month = dateObj.getMonth() + 1; // getMonth() is 0-indexed
// //               const day = dateObj.getDate();
// //               const year = dateObj.getFullYear();
// //               formattedDate = `${month.toString().padStart(2, "0")}/${day
// //                 .toString()
// //                 .padStart(2, "0")}/${year}`;
// //             }
// //           } catch (e) {
// //             // Keep original value if parsing fails
// //           }
// //         }

// //         // Set the formatted date
// //         element.value = formattedDate;
// //         element.dispatchEvent(new Event("input", { bubbles: true }));
// //         element.dispatchEvent(new Event("change", { bubbles: true }));
// //         element.dispatchEvent(new Event("blur", { bubbles: true }));

// //         return true;
// //       }

// //       // For other types of date fields, try standard input fill
// //       return await this.fillInputField(element, value);
// //     } catch (error) {
// //       this.logger(`Error filling date field: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Handle required checkbox fields (agreements, terms, etc.)
// //    * @param {HTMLElement} form - The form element
// //    * @returns {Promise<void>}
// //    */
// //   async handleRequiredCheckboxes(form) {
// //     try {
// //       this.logger("Handling required checkboxes");

// //       // Find all checkboxes
// //       const checkboxFields = [];

// //       // Standard checkboxes
// //       const standardCheckboxes = form.querySelectorAll(
// //         'input[type="checkbox"]'
// //       );
// //       for (const checkbox of standardCheckboxes) {
// //         if (!this.isElementVisible(checkbox)) continue;

// //         const label = this.getFieldLabel(checkbox);
// //         const isRequired = this.isFieldRequired(checkbox);
// //         const isAgreement = this.isAgreementCheckbox(label);

// //         if (isRequired || isAgreement) {
// //           checkboxFields.push({
// //             element: checkbox,
// //             label,
// //             isRequired,
// //             isAgreement,
// //           });
// //         }
// //       }

// //       // Workable custom checkboxes
// //       const customCheckboxes = form.querySelectorAll('[role="checkbox"]');
// //       for (const checkbox of customCheckboxes) {
// //         if (!this.isElementVisible(checkbox)) continue;

// //         const label = this.getFieldLabel(checkbox);
// //         const isRequired = this.isFieldRequired(checkbox);
// //         const isAgreement = this.isAgreementCheckbox(label);

// //         if (isRequired || isAgreement) {
// //           checkboxFields.push({
// //             element: checkbox,
// //             label,
// //             isRequired,
// //             isAgreement,
// //           });
// //         }
// //       }

// //       this.logger(
// //         `Found ${checkboxFields.length} required/agreement checkboxes`
// //       );

// //       // Check all required/agreement checkboxes, getting AI answers for each
// //       for (const field of checkboxFields) {
// //         // Get AI answer for this checkbox (true/false or yes/no)
// //         const answer = await this.getAIAnswer(
// //           field.label,
// //           ["yes", "no"],
// //           "checkbox",
// //           "This is a checkbox that may require consent or agreement. " +
// //             (field.isRequired
// //               ? "This checkbox is required."
// //               : "This checkbox is optional.")
// //         );

// //         const shouldCheck = answer === "yes" || answer === "true";

// //         this.logger(
// //           `${shouldCheck ? "Checking" : "Unchecking"} checkbox: ${field.label}`
// //         );
// //         await this.fillCheckboxField(field.element, shouldCheck);
// //         await this.wait(200);
// //       }
// //     } catch (error) {
// //       this.logger(`Error handling required checkboxes: ${error.message}`);
// //     }
// //   }

// //   /**
// //    * Check if a label indicates an agreement checkbox
// //    * @param {string} label - The checkbox label
// //    * @returns {boolean} - True if it's an agreement checkbox
// //    */
// //   isAgreementCheckbox(label) {
// //     if (!label) return false;

// //     const agreementTerms = [
// //       "agree",
// //       "accept",
// //       "consent",
// //       "terms",
// //       "privacy",
// //       "policy",
// //       "gdpr",
// //       "confirm",
// //       "acknowledge",
// //       "permission",
// //       "receive",
// //       "subscribe",
// //       "newsletter",
// //       "marketing",
// //       "communications",
// //     ];

// //     return agreementTerms.some((term) => label.includes(term));
// //   }

// //   /**
// //    * Fill a form with profile data using AI-generated answers
// //    * @param {HTMLElement} form - The form element
// //    * @param {Object} profile - The profile data (used as context for AI)
// //    * @returns {Promise<boolean>} - True if successful
// //    */
// //   async fillFormWithProfile(form, profile) {
// //     try {
// //       this.logger("Filling form with AI-generated answers");

// //       // Store user profile data for context in AI requests
// //       this.userData = profile;

// //       // Get all form fields
// //       const formFields = this.getAllFormFields(form);
// //       this.logger(`Found ${formFields.length} form fields`);

// //       // Keep track of filled fields
// //       let filledCount = 0;

// //       // Process fields one by one
// //       for (const field of formFields) {
// //         // Skip if no label was found
// //         if (!field.label) continue;

// //         // Skip file upload fields
// //         if (field.type === "file") {
// //           //handleLeverResumeUpload
// //           this.logger(`Skipping file upload field: ${field.label}`);
// //           continue;
// //         }

// //         try {
// //           this.logger(`Processing field: ${field.label} (${field.type})`);

// //           // Get available options for select and radio fields
// //           const options =
// //             field.type === "select" ||
// //             field.type === "radio" ||
// //             field.type === "checkbox"
// //               ? this.getFieldOptions(field.element, form)
// //               : [];

// //           // Get AI answer for this field
// //           const fieldContext = `This is a ${field.type} field${
// //             field.required ? " (required)" : ""
// //           }`;
// //           const answer = await this.getAIAnswer(
// //             field.label,
// //             options,
// //             field.type,
// //             fieldContext
// //           );

// //           if (answer) {
// //             this.logger(
// //               `Got AI answer for "${field.label}": ${answer.substring(0, 50)}${
// //                 answer.length > 50 ? "..." : ""
// //               }`
// //             );
// //             const success = await this.fillField(field.element, answer);
// //             if (success) filledCount++;
// //           }

// //           // Small delay between fields
// //           await this.wait(300);
// //         } catch (fieldError) {
// //           this.logger(
// //             `Error processing field "${field.label}": ${fieldError.message}`
// //           );
// //         }
// //       }

// //       // Handle required checkboxes and agreements
// //       await this.handleRequiredCheckboxes(form);

// //       this.logger(`Successfully filled ${filledCount} fields with AI answers`);
// //       return true;
// //     } catch (error) {
// //       this.logger(`Error filling form with AI answers: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Check if an element is visible on the page
// //    */
// //   isElementVisible(element) {
// //     if (!element) return false;

// //     // Check computed style
// //     const style = window.getComputedStyle(element);
// //     if (
// //       style.display === "none" ||
// //       style.visibility === "hidden" ||
// //       style.opacity === "0"
// //     ) {
// //       return false;
// //     }

// //     // Check dimensions and position
// //     const rect = element.getBoundingClientRect();
// //     if (rect.width === 0 || rect.height === 0) {
// //       return false;
// //     }

// //     // Check for parent visibility
// //     let parent = element.parentElement;
// //     while (parent) {
// //       const parentStyle = window.getComputedStyle(parent);
// //       if (
// //         parentStyle.display === "none" ||
// //         parentStyle.visibility === "hidden"
// //       ) {
// //         return false;
// //       }
// //       parent = parent.parentElement;
// //     }

// //     return true;
// //   }

// //   /**
// //    * Scroll an element into view
// //    */
// //   scrollToElement(element) {
// //     if (!element) return;

// //     try {
// //       // Use modern scrollIntoView if available
// //       element.scrollIntoView({
// //         behavior: "smooth",
// //         block: "center",
// //       });
// //     } catch (error) {
// //       // Fallback to basic scrollIntoView
// //       try {
// //         element.scrollIntoView();
// //       } catch (e) {
// //         // Silent fail if scrolling fails
// //       }
// //     }
// //   }

// //   /**
// //    * Wait for a specified amount of time
// //    */
// //   wait(ms) {
// //     return new Promise((resolve) => setTimeout(resolve, ms));
// //   }

// //   /**
// //    * Find the submit button in a form
// //    */
// //   findSubmitButton(form) {
// //     // Try specific submit button selectors for Workable
// //     const submitSelectors = [
// //       'button[type="submit"]',
// //       'input[type="submit"]',
// //       "button.submit-button",
// //       "button.submit",
// //       "button.apply-button",
// //       "button.apply",
// //       "button.btn-primary:last-child",
// //       "button.button--primary:last-child",
// //       'button[data-ui="submit-application"]',
// //     ];

// //     for (const selector of submitSelectors) {
// //       const buttons = form.querySelectorAll(selector);
// //       if (buttons.length) {
// //         // Return the first visible, enabled button
// //         for (const btn of buttons) {
// //           if (this.isElementVisible(btn) && !btn.disabled) {
// //             return btn;
// //           }
// //         }
// //       }
// //     }

// //     // Look for buttons with submit-like text
// //     const allButtons = form.querySelectorAll('button, input[type="button"]');
// //     for (const btn of allButtons) {
// //       if (!this.isElementVisible(btn) || btn.disabled) continue;

// //       const text = btn.textContent.toLowerCase();
// //       if (
// //         text.includes("submit") ||
// //         text.includes("apply") ||
// //         text.includes("send") ||
// //         text.includes("continue") ||
// //         text === "next"
// //       ) {
// //         return btn;
// //       }
// //     }

// //     // Last resort: get the last visible button in the form
// //     const visibleButtons = Array.from(form.querySelectorAll("button")).filter(
// //       (btn) => this.isElementVisible(btn) && !btn.disabled
// //     );

// //     if (visibleButtons.length) {
// //       return visibleButtons[visibleButtons.length - 1];
// //     }

// //     return null;
// //   }

// //   /**
// //    * Submit the form
// //    */
// //   async submitForm(form, options = {}) {
// //     const { dryRun = false } = options;

// //     try {
// //       this.logger("Submitting form...");

// //       // Find the submit button
// //       const submitButton = this.findSubmitButton(form);

// //       if (!submitButton) {
// //         this.logger("No submit button found");
// //         return false;
// //       }

// //       this.logger(
// //         `Found submit button: ${
// //           submitButton.textContent || submitButton.value || "Unnamed button"
// //         }`
// //       );

// //       // Make sure it's visible and enabled
// //       if (!this.isElementVisible(submitButton) || submitButton.disabled) {
// //         this.logger("Submit button is not clickable (hidden or disabled)");
// //         return false;
// //       }

// //       // Scroll to the button
// //       this.scrollToElement(submitButton);
// //       await this.wait(500);

// //       if (dryRun) {
// //         this.logger("DRY RUN: Would have clicked submit button");
// //         return true;
// //       }

// //       // Click the button
// //       submitButton.click();
// //       this.logger("Clicked submit button");

// //       return true;
// //     } catch (error) {
// //       this.logger(`Error submitting form: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Check if form submission was successful
// //    */
// //   async checkSubmissionSuccess() {
// //     try {
// //       // Method 1: Check for success messages
// //       const successSelectors = [
// //         ".success-message",
// //         ".application-confirmation",
// //         ".thank-you",
// //         '[class*="success"]',
// //         '[class*="thank"]',
// //       ];

// //       for (const selector of successSelectors) {
// //         const elements = document.querySelectorAll(selector);
// //         for (const element of elements) {
// //           if (this.isElementVisible(element)) {
// //             this.logger(`Found success element: ${element.textContent}`);
// //             return true;
// //           }
// //         }
// //       }

// //       // Method 2: Check for success in page text
// //       const bodyText = document.body.textContent.toLowerCase();
// //       const successPhrases = [
// //         "thank you for applying",
// //         "application received",
// //         "application submitted",
// //         "successfully applied",
// //         "submission successful",
// //         "thank you for your interest",
// //         "we have received your application",
// //       ];

// //       for (const phrase of successPhrases) {
// //         if (bodyText.includes(phrase)) {
// //           this.logger(`Found success phrase in page: "${phrase}"`);
// //           return true;
// //         }
// //       }

// //       // Method 3: Check for URL change indicating success
// //       if (
// //         window.location.href.includes("thank") ||
// //         window.location.href.includes("success") ||
// //         window.location.href.includes("confirmation")
// //       ) {
// //         this.logger("URL indicates successful submission");
// //         return true;
// //       }

// //       // Method 4: Check for errors
// //       const errorSelectors = [
// //         ".error-message",
// //         ".form-error",
// //         ".field-error",
// //         '[class*="error"]',
// //       ];

// //       let foundErrors = false;
// //       for (const selector of errorSelectors) {
// //         const elements = document.querySelectorAll(selector);
// //         for (const element of elements) {
// //           if (this.isElementVisible(element) && element.textContent.trim()) {
// //             this.logger(`Found error element: ${element.textContent}`);
// //             foundErrors = true;
// //           }
// //         }
// //       }

// //       if (foundErrors) {
// //         this.logger("Submission failed due to validation errors");
// //         return false;
// //       }

// //       // If no clear indicators, assume success
// //       this.logger(
// //         "No clear success/error indicators. Assuming successful submission."
// //       );
// //       return false;
// //     } catch (error) {
// //       this.logger(`Error checking submission success: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Fill a radio button field
// //    * @param {HTMLElement} element - The radio element or container
// //    * @param {string} value - The value to select
// //    * @returns {Promise<boolean>} - True if successful
// //    */
// //   async fillRadioField(element, value) {
// //     try {
// //       // Get the lowercase string value for comparison
// //       const valueStr = String(value).toLowerCase();
// //       const isYes = valueStr === "yes" || valueStr === "true";

// //       // Handle Workable's fieldset radio groups with the specific class patterns
// //       if (
// //         (element.getAttribute("role") === "radiogroup" ||
// //           (element.tagName === "FIELDSET" &&
// //             element.getAttribute("role") === "radiogroup")) &&
// //         (element.classList.contains("styles--2-TzV") ||
// //           element.classList.contains("styles--3u2Bk"))
// //       ) {
// //         this.logger(
// //           `Handling Workable-specific radio group for value: ${valueStr}`
// //         );

// //         // Get all radio divs (not inputs) with role="radio"
// //         const radioOptions = element.querySelectorAll('div[role="radio"]');
// //         if (!radioOptions.length) {
// //           this.logger("No radio options found with div[role='radio']");
// //           return false;
// //         }

// //         this.logger(`Found ${radioOptions.length} radio options`);

// //         // First try to find by exact label match
// //         let targetRadio = null;
// //         for (const radio of radioOptions) {
// //           // In Workable forms, the label is in a span with ID containing "radio_label"
// //           const labelSpan = radio.querySelector('span[id*="radio_label"]');
// //           if (labelSpan) {
// //             const labelText = labelSpan.textContent.trim().toLowerCase();
// //             this.logger(`Radio option label: "${labelText}"`);

// //             // Check for exact match with yes/no/true/false
// //             if (
// //               (isYes && (labelText === "yes" || labelText === "true")) ||
// //               (!isYes && (labelText === "no" || labelText === "false"))
// //             ) {
// //               targetRadio = radio;
// //               break;
// //             }
// //           }
// //         }

// //         // If no match found but we know it's a yes/no question, use position
// //         // In Workable, first option is usually YES, second is NO
// //         if (!targetRadio) {
// //           if (radioOptions.length >= 2) {
// //             targetRadio = isYes ? radioOptions[0] : radioOptions[1];
// //             this.logger(
// //               `Using position-based selection: ${
// //                 isYes ? "first (YES)" : "second (NO)"
// //               }`
// //             );
// //           } else if (radioOptions.length === 1) {
// //             // If only one option, use it
// //             targetRadio = radioOptions[0];
// //           }
// //         }

// //         // If we found a radio option to click
// //         if (targetRadio) {
// //           this.logger(
// //             `Clicking on radio option: ${targetRadio.id || "unknown id"}`
// //           );

// //           // Scroll to the element
// //           this.scrollToElement(targetRadio);
// //           await this.wait(300);

// //           // Direct click on the div with role="radio"
// //           targetRadio.click();
// //           await this.wait(400);

// //           // Verify the click worked - check aria-checked state
// //           if (targetRadio.getAttribute("aria-checked") !== "true") {
// //             this.logger("First click didn't work, trying alternative approach");

// //             // Try clicking the label inside
// //             const label = targetRadio.querySelector("label");
// //             if (label) {
// //               label.click();
// //               await this.wait(400);
// //             }

// //             // If that still didn't work, try the hidden input as a last resort
// //             if (targetRadio.getAttribute("aria-checked") !== "true") {
// //               const hiddenInput = targetRadio.querySelector("input");
// //               if (hiddenInput) {
// //                 // Can't click directly as it's hidden, but we can set the checked property
// //                 hiddenInput.checked = true;
// //                 hiddenInput.dispatchEvent(
// //                   new Event("change", { bubbles: true })
// //                 );

// //                 // And click the wrapper again
// //                 targetRadio.click();
// //               }
// //             }
// //           }

// //           // Final check
// //           const success = targetRadio.getAttribute("aria-checked") === "true";
// //           this.logger(`Radio selection ${success ? "successful" : "failed"}`);

// //           return success;
// //         } else {
// //           this.logger("No matching radio option found");
// //           return false;
// //         }
// //       }

// //       // Continue with the rest of the original function for other radio types...
// //       // (Keep the rest of your original implementation here)

// //       return false;
// //     } catch (error) {
// //       this.logger(`Error filling radio field: ${error.message}`);
// //       return false;
// //     }
// //   }

// //   /**
// //    * Get label text for a form field - UPDATED version with better file field support
// //    * @param {HTMLElement} element - The form field element
// //    * @returns {string} - The label text or empty string if not found
// //    */
// //   getFieldLabel(element) {
// //     try {
// //       // Handle file upload fields specifically
// //       if (
// //         element.type === "file" ||
// //         element.getAttribute("data-role") === "dropzone" ||
// //         element.closest('[data-role="dropzone"]')
// //       ) {
// //         // Start with the element and look for the container with styles--3aPac class
// //         let container = element;

// //         // If we received a file input, find its dropzone container
// //         if (element.tagName === "INPUT" && element.type === "file") {
// //           container =
// //             element.closest('[data-role="dropzone"]') || element.parentElement;
// //         }

// //         // Go up to find the parent field container with styles--3aPac class
// //         let fieldContainer = container;
// //         for (let i = 0; i < 5 && fieldContainer; i++) {
// //           if (
// //             fieldContainer.classList.contains("styles--3aPac") ||
// //             fieldContainer.className.includes("styles--3aPac")
// //           ) {
// //             break;
// //           }
// //           fieldContainer = fieldContainer.parentElement;
// //         }

// //         // From the field container, look for the span with styles--QTMDv class
// //         if (fieldContainer) {
// //           const labelEl = fieldContainer.querySelector(
// //             '.styles--QTMDv, [class*="QTMDv"]'
// //           );
// //           if (labelEl) {
// //             return this.cleanLabelText(labelEl.textContent);
// //           }
// //         }

// //         // Check for aria-labelledby attribute
// //         const labelledById = element.getAttribute("aria-labelledby");
// //         if (labelledById) {
// //           const labelElement = document.getElementById(labelledById);
// //           if (labelElement) {
// //             return this.cleanLabelText(labelElement.textContent);
// //           }
// //         }

// //         // Look for specific ID pattern used by Workable
// //         if (element.id) {
// //           const idParts = element.id.split("_");
// //           const prefix = idParts[0];

// //           // Try to find a label with ID containing the prefix and "_label"
// //           const labelEl = document.querySelector(
// //             `span[id="${prefix}_label"], span[id*="${prefix}_label"]`
// //           );
// //           if (labelEl) {
// //             return this.cleanLabelText(labelEl.textContent);
// //           }
// //         }
// //       }

// //       // Continue with the existing logic for non-file fields
// //       const workableLabel = element
// //         .closest(".styles--3aPac")
// //         ?.querySelector(".styles--QTMDv");
// //       if (workableLabel) {
// //         return this.cleanLabelText(workableLabel.textContent);
// //       }

// //       // If this is a checkbox/radio group, look for the label with aria-labelledby
// //       if (
// //         element.getAttribute("role") === "group" ||
// //         element.getAttribute("role") === "radiogroup" ||
// //         (element.tagName === "FIELDSET" &&
// //           element.getAttribute("role") === "radiogroup")
// //       ) {
// //         const labelledById = element.getAttribute("aria-labelledby");
// //         if (labelledById) {
// //           const labelEl = document.getElementById(labelledById);
// //           if (labelEl) {
// //             // Specifically exclude SVG descriptions
// //             const labelText = Array.from(labelEl.childNodes)
// //               .filter(
// //                 (node) =>
// //                   node.nodeType === Node.TEXT_NODE ||
// //                   (node.nodeType === Node.ELEMENT_NODE &&
// //                     node.tagName !== "SVG")
// //               )
// //               .map((node) => node.textContent)
// //               .join(" ");
// //             return this.cleanLabelText(labelText);
// //           }
// //         }
// //       }

// //       // Special handling for Workable radio groups
// //       if (
// //         element.getAttribute("role") === "radiogroup" ||
// //         (element.tagName === "FIELDSET" &&
// //           element.getAttribute("role") === "radiogroup")
// //       ) {
// //         // Look for aria-labelledby first
// //         const labelledById = element.getAttribute("aria-labelledby");
// //         if (labelledById) {
// //           const labelEl = document.getElementById(labelledById);
// //           if (labelEl) {
// //             return this.cleanLabelText(labelEl.textContent);
// //           }
// //         }

// //         // If no aria-labelledby, try to find previous sibling with label class
// //         const prevSibling = element.previousElementSibling;
// //         if (prevSibling) {
// //           const labelEl = prevSibling.querySelector(
// //             '[class*="QTMDv"], [class*="label"], span[id*="_label"]'
// //           );
// //           if (labelEl) {
// //             return this.cleanLabelText(labelEl.textContent);
// //           }
// //         }
// //       }

// //       // Method 1: Check for aria-labelledby attribute
// //       const labelledById = element.getAttribute("aria-labelledby");
// //       if (labelledById) {
// //         const labelElement = document.getElementById(labelledById);
// //         if (labelElement) {
// //           return this.cleanLabelText(labelElement.textContent);
// //         }
// //       }

// //       // Method 2: Check for explicit label element
// //       if (element.id) {
// //         const labelElement = document.querySelector(
// //           `label[for="${element.id}"]`
// //         );
// //         if (labelElement) {
// //           return this.cleanLabelText(labelElement.textContent);
// //         }
// //       }

// //       // Method 3: Check if element is inside a label
// //       const parentLabel = element.closest("label");
// //       if (parentLabel) {
// //         // Clone the label to avoid modifying the original
// //         const clone = parentLabel.cloneNode(true);

// //         // Remove the input element from the clone to get just the label text
// //         const inputElements = clone.querySelectorAll("input, select, textarea");
// //         for (const inputEl of inputElements) {
// //           if (inputEl.parentNode) {
// //             inputEl.parentNode.removeChild(inputEl);
// //           }
// //         }

// //         return this.cleanLabelText(clone.textContent);
// //       }

// //       // Workable-specific: Check for styles--QTMDv class in parent container
// //       const parentContainer = element.closest('div[class*="styles--3aPac"]');
// //       if (parentContainer) {
// //         const labelEl = parentContainer.querySelector('[class*="QTMDv"]');
// //         if (labelEl) {
// //           return this.cleanLabelText(labelEl.textContent);
// //         }
// //       }

// //       // Method 4: Check if element is in a fieldset with legend
// //       const fieldset = element.closest("fieldset");
// //       if (fieldset) {
// //         const legend = fieldset.querySelector("legend");
// //         if (legend) {
// //           return this.cleanLabelText(legend.textContent);
// //         }
// //       }

// //       // Method 5: Look for nearby elements that could be labels
// //       const parent = element.parentElement;
// //       if (parent) {
// //         // Check for elements with label-like class names
// //         const labelElements = parent.querySelectorAll(
// //           '.label, .field-label, [class*="label"]'
// //         );
// //         if (labelElements.length > 0) {
// //           return this.cleanLabelText(labelElements[0].textContent);
// //         }

// //         // Check for special Workable structure
// //         if (
// //           parent.previousElementSibling &&
// //           parent.previousElementSibling.querySelector('[class*="QTMDv"]')
// //         ) {
// //           return this.cleanLabelText(parent.previousElementSibling.textContent);
// //         }
// //       }

// //       // Method 6: Use aria-label, placeholder, or name as fallback
// //       if (element.getAttribute("aria-label")) {
// //         return this.cleanLabelText(element.getAttribute("aria-label"));
// //       }

// //       if (element.placeholder) {
// //         return this.cleanLabelText(element.placeholder);
// //       }

// //       if (element.name) {
// //         // Convert camelCase or snake_case to spaces
// //         return this.cleanLabelText(
// //           element.name.replace(/([A-Z])/g, " $1").replace(/_/g, " ")
// //         );
// //       }

// //       // If nothing else works, return empty string
// //       return "";
// //     } catch (error) {
// //       this.logger(`Error getting field label: ${error.message}`);
// //       return "";
// //     }
// //   }

// //   /**
// //    * Get available options from select fields including custom Lever dropdowns
// //    * @param {HTMLElement} element - The form field element
// //    * @returns {Array<string>} - Array of option texts
// //    */
// //   getFieldOptions(element, form) {
// //     try {
// //       const options = [];
// //       const fieldType = this.getFieldType(element);

// //       // Handle select elements
// //       if (fieldType === "select") {
// //         const listbox = form.querySelector('ul[role="listbox"]');
// //         console.log("listbox:", listbox);

// //         if (listbox) {
// //           const optionItems = listbox.querySelectorAll('li[role="option"]');
// //           console.log("optionItems count:", optionItems.length);
// //           optionItems.forEach((item) => {
// //             const targetSpan = item.querySelector("span.styles--f-uLT");
// //             console.log("targetSpan:", targetSpan);
// //             if (targetSpan) {
// //               options.push(targetSpan.textContent.trim());
// //             }
// //           });
// //         }
// //       }
// //       // Handle radio buttons
// //       else if (fieldType === "radio") {
// //         // Existing radio button handling logic...
// //         const radios =
// //           element.tagName === "FIELDSET"
// //             ? element.querySelectorAll('[role="radio"]')
// //             : element
// //                 .closest('fieldset[role="radiogroup"]')
// //                 ?.querySelectorAll('[role="radio"]') || [element];

// //         // Process all radio options at once
// //         radios.forEach((radio) => {
// //           const radioId = radio.id;
// //           const labelSpan =
// //             radio.parentElement.querySelector(
// //               `span[id="radio_label_${radioId.split("_").pop()}"]`
// //             ) ||
// //             document.querySelector(
// //               `span[id="radio_label_${radioId.split("_").pop()}"]`
// //             );
// //           const label = labelSpan
// //             ? labelSpan.textContent.trim()
// //             : this.getFieldLabel(radio);
// //           if (label) options.push(label);
// //         });
// //       }
// //       // Handle checkboxes
// //       else if (fieldType === "checkbox") {
// //         if (element.getAttribute("role") === "group") {
// //           // Get all checkboxes in the group
// //           const checkboxes = element.querySelectorAll('[role="checkbox"]');

// //           // Process all checkboxes at once - don't log individual items
// //           checkboxes.forEach((checkbox) => {
// //             const checkboxId = checkbox.id;

// //             const labelSpan = element.querySelector(
// //               `span[id="checkbox_label_${checkboxId}"]`
// //             );

// //             if (labelSpan && labelSpan.textContent) {
// //               options.push(labelSpan.textContent.trim());
// //             }
// //           });
// //         }
// //       }

// //       // Return the complete array of options at once
// //       return options;
// //     } catch (error) {
// //       this.appendStatusMessage(`Error getting field options: ${error.message}`);
// //       return [];
// //     }
import { HOST } from "@shared/constants";

/**
 * WorkableFormHandler - Pure AI-driven form handling with no assumptions or defaults
 */
export class WorkableFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || HOST;
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.answerCache = {}; // Cache for AI answers
  }

  /**
   * Get all form fields from a Workable application form
   * @param {HTMLElement} form - The form element
   * @returns {Array} - Array of form field objects with element, label, type, and required status
   */
  getAllFormFields(form) {
    try {
      this.logger("Finding all form fields");

      const fields = [];

      // Find all visible input elements including Workable's custom elements
      const formElements = form.querySelectorAll(
        'input:not([type="hidden"]), select, textarea, ' +
          '[role="radio"], [role="checkbox"], ' +
          'fieldset[role="radiogroup"], ' +
          'div[class*="styles--3IYUq"], ' + // Workable specific classes
          'div[role="group"], ' +
          "div.field-type-Boolean"
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
      // Handle file upload fields specifically
      if (
        element.type === "file" ||
        element.getAttribute("data-role") === "dropzone" ||
        element.closest('[data-role="dropzone"]')
      ) {
        let container = element;

        if (element.tagName === "INPUT" && element.type === "file") {
          container =
            element.closest('[data-role="dropzone"]') || element.parentElement;
        }

        let fieldContainer = container;
        for (let i = 0; i < 5 && fieldContainer; i++) {
          if (
            fieldContainer.classList.contains("styles--3aPac") ||
            fieldContainer.className.includes("styles--3aPac")
          ) {
            break;
          }
          fieldContainer = fieldContainer.parentElement;
        }

        if (fieldContainer) {
          const labelEl = fieldContainer.querySelector(
            '.styles--QTMDv, [class*="QTMDv"]'
          );
          if (labelEl) {
            return this.cleanLabelText(labelEl.textContent);
          }
        }

        const labelledById = element.getAttribute("aria-labelledby");
        if (labelledById) {
          const labelElement = document.getElementById(labelledById);
          if (labelElement) {
            return this.cleanLabelText(labelElement.textContent);
          }
        }

        if (element.id) {
          const idParts = element.id.split("_");
          const prefix = idParts[0];

          const labelEl = document.querySelector(
            `span[id="${prefix}_label"], span[id*="${prefix}_label"]`
          );
          if (labelEl) {
            return this.cleanLabelText(labelEl.textContent);
          }
        }
      }

      const workableLabel = element
        .closest(".styles--3aPac")
        ?.querySelector(".styles--QTMDv");
      if (workableLabel) {
        return this.cleanLabelText(workableLabel.textContent);
      }

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

      if (
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const labelledById = element.getAttribute("aria-labelledby");
        if (labelledById) {
          const labelEl = document.getElementById(labelledById);
          if (labelEl) {
            return this.cleanLabelText(labelEl.textContent);
          }
        }

        const prevSibling = element.previousElementSibling;
        if (prevSibling) {
          const labelEl = prevSibling.querySelector(
            '[class*="QTMDv"], [class*="label"], span[id*="_label"]'
          );
          if (labelEl) {
            return this.cleanLabelText(labelEl.textContent);
          }
        }
      }

      const labelledById = element.getAttribute("aria-labelledby");
      if (labelledById) {
        const labelElement = document.getElementById(labelledById);
        if (labelElement) {
          return this.cleanLabelText(labelElement.textContent);
        }
      }

      if (element.id) {
        const labelElement = document.querySelector(
          `label[for="${element.id}"]`
        );
        if (labelElement) {
          return this.cleanLabelText(labelElement.textContent);
        }
      }

      const parentLabel = element.closest("label");
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        const inputElements = clone.querySelectorAll("input, select, textarea");
        for (const inputEl of inputElements) {
          if (inputEl.parentNode) {
            inputEl.parentNode.removeChild(inputEl);
          }
        }
        return this.cleanLabelText(clone.textContent);
      }

      const parentContainer = element.closest('div[class*="styles--3aPac"]');
      if (parentContainer) {
        const labelEl = parentContainer.querySelector('[class*="QTMDv"]');
        if (labelEl) {
          return this.cleanLabelText(labelEl.textContent);
        }
      }

      const fieldset = element.closest("fieldset");
      if (fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend) {
          return this.cleanLabelText(legend.textContent);
        }
      }

      const parent = element.parentElement;
      if (parent) {
        const labelElements = parent.querySelectorAll(
          '.label, .field-label, [class*="label"]'
        );
        if (labelElements.length > 0) {
          return this.cleanLabelText(labelElements[0].textContent);
        }

        if (
          parent.previousElementSibling &&
          parent.previousElementSibling.querySelector('[class*="QTMDv"]')
        ) {
          return this.cleanLabelText(parent.previousElementSibling.textContent);
        }
      }

      if (element.getAttribute("aria-label")) {
        return this.cleanLabelText(element.getAttribute("aria-label"));
      }

      if (element.placeholder) {
        return this.cleanLabelText(element.placeholder);
      }

      if (element.name) {
        return this.cleanLabelText(
          element.name.replace(/([A-Z])/g, " $1").replace(/_/g, " ")
        );
      }

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
      .replace(/[*✱]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "")
      .replace(/\(required\)/i, "")
      .replace(/\(optional\)/i, "")
      .toLowerCase();
  }

  /**
   * Get the type of a form field
   * @param {HTMLElement} element - The form field element
   * @returns {string} - The field type
   */
  getFieldType(element) {
    const role = element.getAttribute("role");
    const tagName = element.tagName.toLowerCase();

    if (
      role === "radiogroup" ||
      (tagName === "fieldset" && role === "radiogroup")
    ) {
      return "radio";
    }

    if (
      role === "group" &&
      element.querySelector('[role="checkbox"], input[type="checkbox"]')
    ) {
      return "checkbox";
    }

    if (role === "radio" || role === "checkbox") {
      return role;
    }

    if (role === "combobox" && !element.closest('[data-ui="phone"]')) {
      return "select";
    }

    if (
      element.getAttribute("data-role") === "dropzone" ||
      element.querySelector('input[type="file"]')
    ) {
      return "file";
    }

    if (tagName === "select") return "select";
    if (tagName === "textarea") return "textarea";
    if (tagName === "input") {
      const type = element.type.toLowerCase();
      if (type === "file") return "file";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "tel" || element.closest('[data-ui="phone"]'))
        return "phone";
      return type || "text";
    }

    if (
      element.classList.contains("styles--2-TzV") &&
      element.querySelector('[role="radio"], input[type="radio"]')
    ) {
      return "radio";
    }

    return "unknown";
  }

  /**
   * Check if a field is required
   * @param {HTMLElement} element - The form field element
   * @returns {boolean} - True if the field is required
   */
  isFieldRequired(element) {
    if (element.required || element.getAttribute("aria-required") === "true") {
      return true;
    }

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

    const hasWorkableRequired =
      element.parentElement?.querySelector('[class*="33eUF"]') ||
      element.closest("div")?.querySelector('[class*="33eUF"]');

    if (hasWorkableRequired) {
      return true;
    }

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

    let parent = element.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      if (
        parent.querySelector('.required, .mandatory, [class*="required"]') ||
        parent.querySelector('[class*="33eUF"]')
      ) {
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
      this.logger(`Requesting AI answer for "${question}"`);
      console.log(this.jobDescription);

      const response = await fetch(`${this.host}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options,
          userData: this.userData,
          description: this.jobDescription,
          fieldType,
          fieldContext,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      const answer = data.answer;

      return answer;
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract context from the form to help AI understand the application
   * @returns {Object} - Contextual information about the form
   */
  extractFormContext() {
    try {
      let jobTitle = "";
      const titleElements = document.querySelectorAll(
        'h1, h2, h3, .job-title, [class*="title"]'
      );
      for (const el of titleElements) {
        const text = el.textContent.trim();
        if (text && text.length < 100) {
          jobTitle = text;
          break;
        }
      }

      let companyName = "";
      const companyElements = document.querySelectorAll(
        '.company-name, [class*="company"], [itemprop="hiringOrganization"]'
      );
      for (const el of companyElements) {
        const text = el.textContent.trim();
        if (text && text.length < 100) {
          companyName = text;
          break;
        }
      }

      const sections = [];
      const headings = document.querySelectorAll(
        'h2, h3, h4, .section-heading, [class*="section-title"]'
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
   * Convert AI response to boolean value with flexible interpretation
   * @param {string} value - The AI response
   * @returns {boolean} - The interpreted boolean value
   */
  parseAIBoolean(value) {
    if (!value) return false;

    const normalizedValue = String(value).toLowerCase().trim();

    // Positive responses
    const positiveResponses = [
      "yes",
      "true",
      "agree",
      "accept",
      "confirm",
      "ok",
      "okay",
      "sure",
      "definitely",
      "absolutely",
      "correct",
      "right",
      "affirmative",
      "positive",
      "1",
      "checked",
      "check",
      "select",
    ];

    // Negative responses
    const negativeResponses = [
      "no",
      "false",
      "disagree",
      "decline",
      "deny",
      "refuse",
      "never",
      "negative",
      "incorrect",
      "wrong",
      "0",
      "unchecked",
      "uncheck",
      "deselect",
      "skip",
    ];

    if (
      positiveResponses.some((response) => normalizedValue.includes(response))
    ) {
      return true;
    }

    if (
      negativeResponses.some((response) => normalizedValue.includes(response))
    ) {
      return false;
    }

    // If unclear, return null to indicate we should skip this field
    return null;
  }

  /**
   * Find best matching option using fuzzy matching
   * @param {string} aiValue - The AI's response
   * @param {Array<string>} options - Available options
   * @returns {string|null} - Best matching option or null if no good match
   */
  findBestMatchingOption(aiValue, options) {
    if (!aiValue || !options || options.length === 0) return null;

    const normalizedAIValue = String(aiValue).toLowerCase().trim();

    // First try exact match
    for (const option of options) {
      if (option.toLowerCase().trim() === normalizedAIValue) {
        return option;
      }
    }

    // Then try substring matches
    for (const option of options) {
      const normalizedOption = option.toLowerCase().trim();
      if (
        normalizedOption.includes(normalizedAIValue) ||
        normalizedAIValue.includes(normalizedOption)
      ) {
        return option;
      }
    }

    // Try word-based matching
    const aiWords = normalizedAIValue.split(/\s+/);
    let bestMatch = null;
    let bestScore = 0;

    for (const option of options) {
      const optionWords = option.toLowerCase().trim().split(/\s+/);
      let matchingWords = 0;

      for (const aiWord of aiWords) {
        if (
          optionWords.some(
            (optionWord) =>
              optionWord.includes(aiWord) || aiWord.includes(optionWord)
          )
        ) {
          matchingWords++;
        }
      }

      const score =
        matchingWords / Math.max(aiWords.length, optionWords.length);
      if (score > bestScore && score > 0.5) {
        // Require at least 50% word match
        bestScore = score;
        bestMatch = option;
      }
    }

    return bestMatch;
  }

  /**
   * Fill a form field with the appropriate value - PURE AI VERSION
   * @param {HTMLElement} element - The form field element
   * @param {string} value - The value to fill
   * @returns {Promise<boolean>} - True if successful
   */
  async fillField(element, value) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      const fieldType = this.getFieldType(element);
      this.logger(`Filling ${fieldType} field with AI value: ${value}`);

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
      this.scrollToElement(element);
      element.focus();
      await this.wait(100);

      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(50);

      element.value = value;

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
    return await this.fillInputField(element, value);
  }

  /**
   * Fill a select field (dropdown) - PURE AI VERSION
   * @param {HTMLElement} element - The select element or container
   * @param {string} aiAnswer - The AI's suggested option text
   * @returns {Promise<boolean>} - True if successful
   */
  async fillSelectField(element, aiAnswer) {
    try {
      if (!aiAnswer) {
        this.logger("No AI answer provided for select field - skipping");
        return false;
      }
      this.logger(
        `Attempting to fill select field with AI answer: "${aiAnswer}"`
      );

      // Assuming 'element' is the combobox div or a container for it
      const combobox = element.matches('[role="combobox"]')
        ? element
        : element.querySelector('[role="combobox"]');

      if (!combobox) {
        this.logger("Could not find combobox element for select field.");
        // Attempt to handle standard select as a fallback
        if (element.tagName === "SELECT") {
          const options = Array.from(element.options).map((opt) => opt.text);
          const bestMatch = this.findBestMatchingOption(aiAnswer, options);
          if (bestMatch) {
            const matchedOption = Array.from(element.options).find(
              (opt) => opt.text === bestMatch
            );
            if (matchedOption) {
              element.value = matchedOption.value;
              element.dispatchEvent(new Event("change", { bubbles: true }));
              this.logger(`Filled standard select with option: "${bestMatch}"`);
              return true;
            }
          }
          this.logger(
            `No matching option for standard select for AI answer: "${aiAnswer}"`
          );
          return false;
        }
        this.logger("Not a standard select element either.");
        return false;
      }

      // Click the combobox to open the dropdown
      this.scrollToElement(combobox);
      combobox.click();
      await this.wait(500); // Wait for dropdown to appear

      // Get the listbox (dropdown menu)
      // Workable's listbox might be appended to body or near the combobox
      // We need to find the correct listbox associated with this combobox
      const listboxId = combobox.getAttribute("aria-controls");
      let listbox = null;
      if (listboxId) {
        listbox = document.getElementById(listboxId);
      }

      // If not found by ID, try a more generic search (less reliable)
      if (!listbox || !this.isElementVisible(listbox)) {
        listbox = document.querySelector('ul[role="listbox"]:not([aria-hidden="true"])');
      }
      
      // Try to find the listbox as a sibling or child of a parent of the combobox (common pattern)
      if (!listbox || !this.isElementVisible(listbox)) {
        let parent = combobox.parentElement;
        for(let i=0; i<3 && parent && (!listbox || !this.isElementVisible(listbox)); i++) {
            listbox = parent.querySelector('ul[role="listbox"]');
            parent = parent.parentElement;
        }
      }


      if (!listbox || !this.isElementVisible(listbox)) {
        this.logger("Could not find open listbox for select field.");
        // Attempt to close the combobox if it was opened
        if (document.activeElement === combobox || combobox.getAttribute('aria-expanded') === 'true') {
            combobox.click(); // Try to close it
        }
        return false;
      }

      this.logger(`Found listbox: ${listbox.id}`);

      const optionElements = listbox.querySelectorAll('li[role="option"]');
      const availableOptions = [];
      const optionMap = new Map();

      optionElements.forEach((item) => {
        // Workable options often have text in a specific span structure
        const textSpan =
          item.querySelector("span.styles--f-uLT") || // Common Workable class
          item.querySelector("span:not([class])") || // Generic span if specific not found
          item; // Fallback to item itself
        const optionText = textSpan.textContent.trim();
        if (optionText) {
          availableOptions.push(optionText);
          optionMap.set(optionText, item);
        }
      });

      if (availableOptions.length === 0) {
        this.logger("No options found in the listbox.");
         if (document.activeElement === combobox || combobox.getAttribute('aria-expanded') === 'true') {
            combobox.click(); // Try to close it
        }
        return false;
      }

      const bestMatch = this.findBestMatchingOption(
        aiAnswer,
        availableOptions
      );

      if (!bestMatch) {
        this.logger(
          `No matching option found for "${aiAnswer}" among: ${availableOptions.join(", ")}`
        );
         if (document.activeElement === combobox || combobox.getAttribute('aria-expanded') === 'true') {
            combobox.click(); // Try to close it
        }
        return false;
      }

      const targetOptionElement = optionMap.get(bestMatch);
      if (targetOptionElement) {
        this.logger(`Found matching option: "${bestMatch}". Clicking it.`);
        this.scrollToElement(targetOptionElement);
        targetOptionElement.click();
        await this.wait(300); // Wait for selection to process

        // Verify selection by checking combobox text (if possible)
        // Workable often updates a span within the combobox
        const displaySpan = combobox.querySelector('span[class*="placeholder"], span[class*="text"], div[class*="content"]');
        if (displaySpan && displaySpan.textContent.trim() !== bestMatch) {
            this.logger(`Verification failed: Combobox text ("${displaySpan.textContent.trim()}") does not match selected option ("${bestMatch}").`);
            // Try clicking again if verification fails
            // targetOptionElement.click(); 
            // await this.wait(300);
        } else if (displaySpan) {
             this.logger(`Selection verified on displaySpan: "${displaySpan.textContent.trim()}"`);
        } else {
            this.logger("Could not find display span for verification, assuming success.");
        }
        
        // Close dropdown if it's still open (some auto-close, some don't)
        if (this.isElementVisible(listbox)) {
            combobox.click(); // This often closes it
            await this.wait(100);
        }
        
        return true;
      }

      this.logger("Could not click the matched option.");
      if (this.isElementVisible(listbox)) {
        combobox.click(); // Try to close it
      }
      return false;
    } catch (error) {
      this.logger(`Error filling select field: ${error.message}`);
      // Ensure dropdown is closed on error too
      try {
        const combobox = element.matches('[role="combobox"]') ? element : element.querySelector('[role="combobox"]');
        if (combobox) {
            const listboxId = combobox.getAttribute("aria-controls");
            if (listboxId) {
                const listbox = document.getElementById(listboxId);
                if (listbox && this.isElementVisible(listbox)) {
                     combobox.click();
                }
            } else { // Generic attempt if no aria-controls
                const listbox = document.querySelector('ul[role="listbox"]:not([aria-hidden="true"])');
                if (listbox && this.isElementVisible(listbox)) {
                    combobox.click();
                }
            }
        }
      } catch (closeError) {
        this.logger(`Error trying to close dropdown after error: ${closeError.message}`);
      }
      return false;
    }
  }

  /**
   * Fill a checkbox field - PURE AI VERSION (no assumptions)
   * @param {HTMLElement} element - The checkbox element or container
   * @param {boolean|string} value - AI response for checkbox
   * @returns {Promise<boolean>} - True if successful
   */
  async fillCheckboxField(element, value) {
    try {
      // Parse AI response to boolean, return false if unclear
      const shouldCheck = this.parseAIBoolean(value);
      if (shouldCheck === null) {
        this.logger(
          `AI response "${value}" is unclear for checkbox - skipping field`
        );
        return false;
      }

      // Find the actual checkbox input if we were given a container
      let checkboxInput = element;
      if (element.tagName.toLowerCase() !== "input") {
        checkboxInput = element.querySelector('input[type="checkbox"]');

        if (!checkboxInput) {
          if (element.getAttribute("role") === "checkbox") {
            const isChecked = element.getAttribute("aria-checked") === "true";

            if ((shouldCheck && !isChecked) || (!shouldCheck && isChecked)) {
              this.scrollToElement(element);
              element.click();
              await this.wait(200);
            }
            return true;
          }
        }

        if (!checkboxInput) {
          return false;
        }
      }

      if (
        (shouldCheck && !checkboxInput.checked) ||
        (!shouldCheck && checkboxInput.checked)
      ) {
        this.scrollToElement(checkboxInput);

        const labelEl =
          checkboxInput.closest("label") ||
          document.querySelector(`label[for="${checkboxInput.id}"]`);

        if (labelEl) {
          labelEl.click();
        } else {
          checkboxInput.click();
        }

        await this.wait(200);

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
   * Fill a radio button field - PURE AI VERSION (no assumptions or defaults)
   * @param {HTMLElement} element - The radio element or container
   * @param {string} value - The AI response value to select
   * @returns {Promise<boolean>} - True if successful
   */
  async fillRadioField(element, value) {
    try {
      if (!value) {
        this.logger("No AI value provided for radio field - skipping");
        return false;
      }

      const aiValue = String(value).toLowerCase().trim();
      this.logger(
        `Looking for radio option matching AI response: "${aiValue}"`
      );

      // Handle Workable's fieldset radio groups
      if (
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const radioOptions = element.querySelectorAll('div[role="radio"]');
        if (!radioOptions.length) {
          this.logger("No radio options found");
          return false;
        }

        // Get all available options for fuzzy matching
        const availableOptions = [];
        const optionMap = new Map();

        for (const radio of radioOptions) {
          const labelSpan = radio.querySelector('span[id*="radio_label"]');
          if (labelSpan) {
            const labelText = labelSpan.textContent.trim();
            availableOptions.push(labelText);
            optionMap.set(labelText, radio);
          }
        }

        // Use fuzzy matching to find best option
        const bestMatch = this.findBestMatchingOption(
          aiValue,
          availableOptions
        );
        if (!bestMatch) {
          this.logger(
            `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
              ", "
            )}`
          );
          return false;
        }

        const targetRadio = optionMap.get(bestMatch);
        if (targetRadio) {
          this.logger(`Found matching radio option: "${bestMatch}"`);
          this.scrollToElement(targetRadio);
          await this.wait(300);

          targetRadio.click();
          await this.wait(400);

          const success = targetRadio.getAttribute("aria-checked") === "true";
          this.logger(`Radio selection ${success ? "successful" : "failed"}`);
          return success;
        }
      }

      // Handle generic radio groups
      else if (
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const radios = element.querySelectorAll('[role="radio"]');
        if (!radios.length) return false;

        const availableOptions = [];
        const optionMap = new Map();

        for (const radio of radios) {
          const labelSpan = radio.querySelector('span[id*="radio_label"]');
          if (labelSpan) {
            const labelText = labelSpan.textContent.trim();
            availableOptions.push(labelText);
            optionMap.set(labelText, radio);
          }
        }

        const bestMatch = this.findBestMatchingOption(
          aiValue,
          availableOptions
        );
        if (!bestMatch) {
          this.logger(
            `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
              ", "
            )}`
          );
          return false;
        }

        const matchingRadio = optionMap.get(bestMatch);
        if (matchingRadio) {
          this.scrollToElement(matchingRadio);

          if (matchingRadio.getAttribute("aria-checked") !== "true") {
            matchingRadio.click();
            await this.wait(300);
          }
          return true;
        }
      }

      // Handle individual radio buttons
      else if (element.getAttribute("role") === "radio") {
        const radioGroup =
          element.closest('[role="radiogroup"]') || element.parentElement;
        if (!radioGroup) return false;

        const radios = radioGroup.querySelectorAll('[role="radio"]');
        const availableOptions = [];
        const optionMap = new Map();

        for (const radio of radios) {
          let radioLabel = "";

          const labelledById = radio.getAttribute("aria-labelledby");
          if (labelledById) {
            const labelEl = document.getElementById(labelledById);
            if (labelEl) {
              radioLabel = labelEl.textContent.trim();
            }
          }

          if (!radioLabel) {
            const labelSpan = radio.querySelector('span[id*="radio_label"]');
            if (labelSpan) {
              radioLabel = labelSpan.textContent.trim();
            }
          }

          if (radioLabel) {
            availableOptions.push(radioLabel);
            optionMap.set(radioLabel, radio);
          }
        }

        const bestMatch = this.findBestMatchingOption(
          aiValue,
          availableOptions
        );
        if (!bestMatch) {
          this.logger(
            `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
              ", "
            )}`
          );
          return false;
        }

        const matchingRadio = optionMap.get(bestMatch);
        if (matchingRadio) {
          this.scrollToElement(matchingRadio);
          matchingRadio.click();
          await this.wait(200);
          return true;
        }
      }

      // Handle standard radio buttons
      else {
        let radioName = "";

        if (
          element.tagName.toLowerCase() === "input" &&
          element.type === "radio"
        ) {
          radioName = element.name;
        } else {
          const radioInput = element.querySelector('input[type="radio"]');
          if (radioInput) {
            radioName = radioInput.name;
          }
        }

        if (!radioName) return false;

        const radios = document.querySelectorAll(
          `input[type="radio"][name="${radioName}"]`
        );

        const availableOptions = [];
        const optionMap = new Map();

        for (const radio of radios) {
          // Check value attribute first
          if (radio.value) {
            availableOptions.push(radio.value);
            optionMap.set(radio.value, radio);
          }

          // Check label text
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);
          if (label) {
            const labelText = label.textContent.trim();
            if (labelText && !availableOptions.includes(labelText)) {
              availableOptions.push(labelText);
              optionMap.set(labelText, radio);
            }
          }
        }

        const bestMatch = this.findBestMatchingOption(
          aiValue,
          availableOptions
        );
        if (!bestMatch) {
          this.logger(
            `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
              ", "
            )}`
          );
          return false;
        }

        const matchingRadio = optionMap.get(bestMatch);
        if (matchingRadio) {
          this.scrollToElement(matchingRadio);

          const label =
            matchingRadio.closest("label") ||
            document.querySelector(`label[for="${matchingRadio.id}"]`);
          if (label) {
            label.click();
          } else {
            matchingRadio.click();
          }

          await this.wait(200);

          if (!matchingRadio.checked) {
            matchingRadio.checked = true;
            matchingRadio.dispatchEvent(new Event("change", { bubbles: true }));
          }

          return true;
        }
      }

      this.logger(`Unable to fill radio field - no matching option found`);
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
      if (
        element.tagName.toLowerCase() === "input" &&
        element.type === "date"
      ) {
        return await this.fillInputField(element, value);
      }

      const isDateInput =
        element.getAttribute("inputmode") === "tel" &&
        (element.placeholder?.includes("MM/YYYY") ||
          element.placeholder?.includes("MM/DD/YYYY"));

      if (isDateInput || element.closest(".react-datepicker-wrapper")) {
        this.scrollToElement(element);
        element.focus();
        await this.wait(100);

        element.value = "";
        element.dispatchEvent(new Event("input", { bubbles: true }));
        await this.wait(50);

        let formattedDate = value;
        if (element.placeholder?.includes("MM/YYYY")) {
          let dateObj;
          try {
            dateObj = new Date(value);
            if (isNaN(dateObj.getTime())) {
              const parts = value.split(/[\s\/\-\.]/);
              if (parts.length >= 2) {
                let month = parseInt(parts[0]);
                let year = parseInt(parts[1]);

                if (year < 100) {
                  year += year < 50 ? 2000 : 1900;
                }

                formattedDate = `${month.toString().padStart(2, "0")}/${year}`;
              }
            } else {
              const month = dateObj.getMonth() + 1;
              const year = dateObj.getFullYear();
              formattedDate = `${month.toString().padStart(2, "0")}/${year}`;
            }
          } catch (e) {
            // Keep original value if parsing fails
          }
        } else if (element.placeholder?.includes("MM/DD/YYYY")) {
          try {
            const dateObj = new Date(value);
            if (!isNaN(dateObj.getTime())) {
              const month = dateObj.getMonth() + 1;
              const day = dateObj.getDate();
              const year = dateObj.getFullYear();
              formattedDate = `${month.toString().padStart(2, "0")}/${day
                .toString()
                .padStart(2, "0")}/${year}`;
            }
          } catch (e) {
            // Keep original value if parsing fails
          }
        }

        element.value = formattedDate;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));

        return true;
      }

      return await this.fillInputField(element, value);
    } catch (error) {
      this.logger(`Error filling date field: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle required checkbox fields - PURE AI VERSION (no hard-coded assumptions)
   * @param {HTMLElement} form - The form element
   * @returns {Promise<void>}
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Handling checkboxes with AI guidance (no assumptions)");

      const checkboxFields = [];
      let totalFound = 0;
      let visibleCount = 0;
      let withLabels = 0;

      // Find standard checkboxes
      const standardCheckboxes = form.querySelectorAll(
        'input[type="checkbox"]'
      );
      this.logger(
        `Found ${standardCheckboxes.length} standard input[type="checkbox"] elements`
      );

      for (const checkbox of standardCheckboxes) {
        totalFound++;

        if (!this.isElementVisible(checkbox)) {
          this.logger(`Checkbox ${totalFound} not visible - skipping`);
          continue;
        }
        visibleCount++;

        const label = this.getFieldLabel(checkbox);
        const isRequired = this.isFieldRequired(checkbox);

        this.logger(
          `Checkbox ${totalFound}: label="${label}", required=${isRequired}`
        );

        // Include checkbox if it has a label OR if it's required (even without label)
        if (label || isRequired) {
          withLabels++;
          checkboxFields.push({
            element: checkbox,
            label: label || `Checkbox ${totalFound}`, // Fallback label
            isRequired,
          });
        } else {
          this.logger(
            `Checkbox ${totalFound} has no label and is not required - skipping`
          );
        }
      }

      // Find Workable custom checkboxes
      const customCheckboxes = form.querySelectorAll('[role="checkbox"]');
      this.logger(
        `Found ${customCheckboxes.length} custom [role="checkbox"] elements`
      );

      for (const checkbox of customCheckboxes) {
        totalFound++;

        if (!this.isElementVisible(checkbox)) {
          this.logger(`Custom checkbox ${totalFound} not visible - skipping`);
          continue;
        }
        visibleCount++;

        const label = this.getFieldLabel(checkbox);
        const isRequired = this.isFieldRequired(checkbox);

        this.logger(
          `Custom checkbox ${totalFound}: label="${label}", required=${isRequired}`
        );

        // Include checkbox if it has a label OR if it's required (even without label)
        if (label || isRequired) {
          withLabels++;
          checkboxFields.push({
            element: checkbox,
            label: label || `Custom checkbox ${totalFound}`, // Fallback label
            isRequired,
          });
        } else {
          this.logger(
            `Custom checkbox ${totalFound} has no label and is not required - skipping`
          );
        }
      }

      this.logger(
        `Checkbox summary: ${totalFound} total, ${visibleCount} visible, ${withLabels} with labels/required`
      );
      this.logger(`Found ${checkboxFields.length} checkboxes to process`);

      // Process each checkbox with AI guidance
      for (const field of checkboxFields) {
        try {
          // Build context for AI decision
          const fieldContext = [
            `This is a checkbox field`,
            field.isRequired
              ? "This checkbox is required"
              : "This checkbox is optional",
            "Please decide whether to check this checkbox based on the user profile and the checkbox label/purpose",
          ].join(". ");

          // Get AI answer for this checkbox
          const answer = await this.getAIAnswer(
            field.label,
            ["yes", "no"],
            "checkbox",
            fieldContext
          );

          if (answer !== null && answer !== undefined && answer !== "") {
            const shouldCheck = this.parseAIBoolean(answer);

            if (shouldCheck !== null) {
              this.logger(
                `AI decision for checkbox "${field.label}": ${
                  shouldCheck ? "CHECK" : "UNCHECK"
                }`
              );
              await this.fillCheckboxField(field.element, shouldCheck);
              await this.wait(200);
            } else {
              this.logger(
                `AI response unclear for checkbox "${field.label}" - skipping`
              );
            }
          } else {
            this.logger(
              `No AI answer for checkbox "${field.label}" - skipping`
            );
          }
        } catch (fieldError) {
          this.logger(
            `Error processing checkbox "${field.label}": ${fieldError.message}`
          );
        }
      }
    } catch (error) {
      this.logger(`Error handling checkboxes: ${error.message}`);
    }
  }

  /**
   * Fill a form with profile data using AI-generated answers - PURE AI VERSION
   * @param {HTMLElement} form - The form element
   * @param {Object} profile - The profile data (used as context for AI)
   * @returns {Promise<boolean>} - True if successful
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.logger(
        "Filling form with pure AI-generated answers (no assumptions)"
      );

      this.userData = profile;
      const formFields = this.getAllFormFields(form);
      this.logger(`Found ${formFields.length} form fields`);

      let filledCount = 0;
      let skippedCount = 0;

      for (const field of formFields) {
        if (!field.label) {
          this.logger(`Skipping field without label`);
          continue;
        }

        if (field.type === "file") {
          this.logger(`Skipping file upload field: ${field.label}`);
          continue;
        }

        try {
          this.logger(`Processing field: ${field.label} (${field.type})`);

          // Get available options for select/radio fields
          const options =
            field.type === "select" ||
            field.type === "radio" ||
            field.type === "checkbox"
              ? this.getFieldOptions(field.element, form)
              : [];

          // Build comprehensive context for AI
          const fieldContext = [
            `Field type: ${field.type}`,
            field.required
              ? "This field is required"
              : "This field is optional",
            options.length > 0
              ? `Available options: ${options.join(", ")}`
              : "",
            "Please provide your response based solely on the user profile data provided.",
          ]
            .filter(Boolean)
            .join(". ");

          // Get AI answer with full context
          const answer = await this.getAIAnswer(
            field.label,
            options,
            field.type,
            fieldContext
          );

          if (answer !== null && answer !== undefined && answer !== "") {
            this.logger(
              `AI answer for "${field.label}": ${String(answer).substring(
                0,
                50
              )}${String(answer).length > 50 ? "..." : ""}`
            );

            const success = await this.fillField(field.element, answer);
            if (success) {
              filledCount++;
              this.logger(`✓ Successfully filled field: ${field.label}`);
            } else {
              this.logger(`✗ Failed to fill field: ${field.label}`);
              skippedCount++;
            }
          } else {
            this.logger(
              `✗ AI provided no answer for field: ${field.label} - skipping`
            );
            skippedCount++;
          }

          await this.wait(300);
        } catch (fieldError) {
          this.logger(
            `Error processing field "${field.label}": ${fieldError.message}`
          );
          skippedCount++;
        }
      }

      // Handle checkboxes with AI guidance
      await this.handleRequiredCheckboxes(form);

      this.logger(
        `Form filling complete: ${filledCount} filled, ${skippedCount} skipped`
      );
      return filledCount > 0;
    } catch (error) {
      this.logger(`Error filling form with AI answers: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if an element is visible on the page
   */
  isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

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
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } catch (error) {
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
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      "button.submit-button",
      "button.submit",
      "button.apply-button",
      "button.apply",
      "button.btn-primary:last-child",
      "button.button--primary:last-child",
      'button[data-ui="submit-application"]',
    ];

    for (const selector of submitSelectors) {
      const buttons = form.querySelectorAll(selector);
      if (buttons.length) {
        for (const btn of buttons) {
          if (this.isElementVisible(btn) && !btn.disabled) {
            return btn;
          }
        }
      }
    }

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

      if (!this.isElementVisible(submitButton) || submitButton.disabled) {
        this.logger("Submit button is not clickable (hidden or disabled)");
        return false;
      }

      this.scrollToElement(submitButton);
      await this.wait(500);

      if (dryRun) {
        this.logger("DRY RUN: Would have clicked submit button");
        return true;
      }

      submitButton.click();
      this.logger("Clicked submit button");

      return true;
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
      const successSelectors = [
        ".success-message",
        ".application-confirmation",
        ".thank-you",
        '[class*="success"]',
        '[class*="thank"]',
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

      const bodyText = document.body.textContent.toLowerCase();
      const successPhrases = [
        "thank you for applying",
        "application received",
        "application submitted",
        "successfully applied",
        "submission successful",
        "thank you for your interest",
        "we have received your application",
      ];

      for (const phrase of successPhrases) {
        if (bodyText.includes(phrase)) {
          this.logger(`Found success phrase in page: "${phrase}"`);
          return true;
        }
      }

      if (
        window.location.href.includes("thank") ||
        window.location.href.includes("success") ||
        window.location.href.includes("confirmation")
      ) {
        this.logger("URL indicates successful submission");
        return true;
      }

      const errorSelectors = [
        ".error-message",
        ".form-error",
        ".field-error",
        '[class*="error"]',
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

      this.logger(
        "No clear success/error indicators. Assuming successful submission."
      );
      return false;
    } catch (error) {
      this.logger(`Error checking submission success: ${error.message}`);
      return false;
    }
  }

  /**
   * Get available options from select fields including custom Lever dropdowns
   * @param {HTMLElement} element - The form field element
   * @returns {Array<string>} - Array of option texts
   */
  getFieldOptions(element, form) {
    try {
      const options = [];
      const fieldType = this.getFieldType(element);

      if (fieldType === "select") {
        const listbox = form.querySelector('ul[role="listbox"]');
        console.log("listbox:", listbox);

        if (listbox) {
          const optionItems = listbox.querySelectorAll('li[role="option"]');
          console.log("optionItems count:", optionItems.length);
          optionItems.forEach((item) => {
            const targetSpan = item.querySelector("span.styles--f-uLT");
            console.log("targetSpan:", targetSpan);
            if (targetSpan) {
              options.push(targetSpan.textContent.trim());
            }
          });
        }
      } else if (fieldType === "radio") {
        const radios =
          element.tagName === "FIELDSET"
            ? element.querySelectorAll('[role="radio"]')
            : element
                .closest('fieldset[role="radiogroup"]')
                ?.querySelectorAll('[role="radio"]') || [element];

        radios.forEach((radio) => {
          const radioId = radio.id;
          const labelSpan =
            radio.parentElement.querySelector(
              `span[id="radio_label_${radioId.split("_").pop()}"]`
            ) ||
            document.querySelector(
              `span[id="radio_label_${radioId.split("_").pop()}"]`
            );
          const label = labelSpan
            ? labelSpan.textContent.trim()
            : this.getFieldLabel(radio);
          if (label) options.push(label);
        });
      } else if (fieldType === "checkbox") {
        if (element.getAttribute("role") === "group") {
          const checkboxes = element.querySelectorAll('[role="checkbox"]');

          checkboxes.forEach((checkbox) => {
            const checkboxId = checkbox.id;
            const labelSpan = element.querySelector(
              `span[id="checkbox_label_${checkboxId}"]`
            );

            if (labelSpan && labelSpan.textContent) {
              options.push(labelSpan.textContent.trim());
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
}
