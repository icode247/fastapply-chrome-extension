import { HOST, BASE_URL } from "./constants";
import { StatusNotificationManager, resumeLoader } from "./utils";

export class LinkedInJobParser {
  constructor() {
    this.targetClass = "jobs-description--reformatted";
  }

  /**
   * Gets the raw text content from a selected element
   */
  getElementText(element) {
    if (element.tagName === "UL" || element.tagName === "OL") {
      return Array.from(element.querySelectorAll("li"))
        .map((li) => `• ${li.textContent.trim()}`)
        .filter((text) => text !== "• ")
        .join("\n");
    }
    return element.textContent.trim();
  }

  /**
   * Processes text blocks and maintains formatting
   */
  processTextBlock(text) {
    if (!text) return "";
    return text
      .replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim();
  }

  /**
   * Identifies the section name from a heading
   */
  getSectionName(headingText) {
    const text = headingText.toLowerCase().trim();
    if (text.includes("about the company")) return "aboutCompany";
    if (text.includes("about the role")) return "aboutRole";
    if (text.includes("what we offer")) return "benefits";
    if (text.includes("tech stack")) return "techStack";
    if (text.includes("responsibilities")) return "responsibilities";
    if (text.includes("qualifications")) return "qualifications";
    if (text.includes("preferred skills")) return "preferredSkills";
    if (text.includes("pay") || text.includes("compensation"))
      return "compensation";
    return "other";
  }

  /**
   * Extract description from LinkedIn job posting with multiple output formats
   * @param {string} format - Output format ('string' or 'structured')
   * @returns {string|Object} - The job description in requested format
   */
  scrapeDescription(format = "string") {
    try {
      const container = document.querySelector(`.${this.targetClass}`);
      if (!container) {
        throw new Error("Job description container not found");
      }

      const contentElements = container.querySelectorAll(
        ".jobs-box__html-content > div"
      );
      if (!contentElements.length) {
        throw new Error("No content elements found");
      }

      // For structured output
      const sections = {
        aboutCompany: [],
        aboutRole: [],
        benefits: [],
        techStack: [],
        responsibilities: [],
        qualifications: [],
        preferredSkills: [],
        compensation: [],
        other: [],
      };

      let currentSection = "other";
      let description = "";

      contentElements.forEach((element) => {
        // Handle headings
        const headings = element.querySelectorAll("h1, h2, h3, strong");
        headings.forEach((heading) => {
          const headingText = heading.textContent.trim();
          if (headingText) {
            currentSection = this.getSectionName(headingText);
            if (format === "string") {
              description += `\n${headingText}\n\n`;
            }
          }
        });

        // Handle paragraphs
        const paragraphs = element.querySelectorAll("p");
        paragraphs.forEach((p) => {
          const paragraphText = this.getElementText(p);
          if (paragraphText && !headings.length) {
            if (format === "string") {
              description += `${paragraphText}\n\n`;
            } else {
              sections[currentSection].push(paragraphText);
            }
          }
        });

        // Handle lists
        const lists = element.querySelectorAll("ul, ol");
        lists.forEach((list) => {
          const listText = this.getElementText(list);
          if (listText) {
            if (format === "string") {
              description += `${listText}\n\n`;
            } else {
              // Split bullet points into array for structured format
              const bulletPoints = listText
                .split("\n")
                .map((point) => point.replace("• ", "").trim())
                .filter((point) => point);
              sections[currentSection].push(...bulletPoints);
            }
          }
        });
      });

      // Return based on requested format
      if (format === "string") {
        return this.processTextBlock(description);
      } else {
        // Clean up empty sections
        Object.keys(sections).forEach((key) => {
          if (sections[key].length === 0) {
            delete sections[key];
          }
        });
        return sections;
      }
    } catch (error) {
      console.error("Error extracting job description:", error);
      return format === "string"
        ? `Error extracting job description: ${error.message}`
        : { error: error.message };
    }
  }

  /**
   * Initialize the parser and extract the description
   * @param {string} format - Output format ('string' or 'structured')
   * @returns {string|Object} - The extracted job description
   */
  static extract(format = "string") {
    const parser = new LinkedInJobParser();
    return parser.scrapeDescription(format);
  }
}

export class FileHandler {
  constructor() {
    this.statusManager = new StatusNotificationManager();
    this.loader = resumeLoader();
  }

  async handleFileUpload(container, userDetails, description) {
    try {
      const fileInput = container.querySelector('input[type="file"]');
      if (!fileInput) return;

      const labelText =
        container.querySelector("label span")?.textContent.toLowerCase() || "";
      if (!userDetails) return;

      let fileUrl;
      if (labelText.includes("resume") || labelText.includes("cv")) {
        fileUrl = userDetails.resumeUrl;
      } else if (labelText.includes("cover letter")) {
        fileUrl = userDetails.coverLetterUrl;
      }

      if (!fileUrl) return;
      return await this.uploadFileFromURL(
        fileInput,
        fileUrl,
        userDetails,
        description
      );
    } catch (error) {
      console.error("Error handling file upload:", error);
      return false;
    }
  }

  async uploadFileFromURL(fileInput, fileURL, userDetails, description) {
    try {
      //Check if user has unlimited plan and prefers custom resume
      if (
        userDetails.plan === "unlimited" &&
        userDetails.jobPreferences &&
        userDetails.jobPreferences.useCustomResume === true
      ) {
        this.statusManager.show(
          "Generating resume,  Please wait while we generate your resume",
          "info"
        );
        this.loader.start();
        // Run the resume generation flow
        const [parseURL, optimizeURL, generateURL] = [
          `${BASE_URL}/parse-resume`,
          `${BASE_URL}/optimize-resume`,
          `${BASE_URL}/generate-resume-pdf`,
        ];

        // Step 1: Parse Resume from URL
        const parseResponse = await fetch(parseURL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_url: fileURL[0] }),
        });

        if (!parseResponse.ok)
          throw new Error(`Parse Resume Failed: ${parseResponse.status}`);

        const { text: parsedResumeText } = await parseResponse.json();

        // Step 2: Optimize Resume
        const optimizeResponse = await fetch(optimizeURL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume_text: parsedResumeText,
            job_description: description || "",
            user_data: {
              summary: userDetails.summary,
              projects: userDetails.projects,
              fullPositions: userDetails.fullPositions,
              education: userDetails.education,
              educationStartMonth: userDetails.educationStartMonth,
              educationStartYear: userDetails.educationStartYear,
              educationEndMonth: userDetails.educationEndMonth,
              educationEndYear: userDetails.educationEndYear,
            },
          }),
        });

        if (!optimizeResponse.ok)
          throw new Error(`Optimize Resume Failed: ${optimizeResponse.status}`);

        const resumeData = await optimizeResponse.json();

        // Step 3: Generate Resume PDF
        const generateResponse = await fetch(generateURL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_data: {
              author: userDetails.name,
              email: userDetails.email,
              phone: `${userDetails.phoneCountryCode || ""}${
                userDetails.phoneNumber || ""
              }`,
              address: userDetails.streetAddress || userDetails.country,
            },
            resume_data: resumeData.data,
          }),
        });

        if (!generateResponse.ok) {
          this.statusManager.show(
            "Failed to generate resume, Please try again later",
            "error"
          );
          throw new Error(`Generate Resume Failed: ${generateResponse.status}`);
        }

        // The response is already the PDF content, not JSON
        const blob = await generateResponse.blob();
        console.log("PDF successfully generated");
        const fileName = `${userDetails.name.toLowerCase()} resume.pdf`;

        const file = new File([blob], fileName, {
          type: "application/pdf",
          lastModified: Date.now(),
        });

        if (file.size === 0) {
          throw new Error("Generated PDF file is empty");
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        this.loader.stop();

        this.statusManager.show("Resume generated successfully", "success");
      } else {
        // Use the existing code for non-unlimited plans or non-custom resume types
        this.statusManager.show(
          "matching your resume to the job description, Please wait",
          "info"
        );
        const description = LinkedInJobParser.extract("string");
        const matchedUrl = `https://resumify-6b8b3d9b7428.herokuapp.com/api/match`;
        const res = await fetch(matchedUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resume_urls: fileURL,
            job_description: description,
          }),
        });

        if (!res.ok) {
          throw new Error(`Resume matching service failed: ${res.status}`);
        }

        this.statusManager.show(
          "Uploading your resume, Please wait while we upload your resume",
          "info"
        );
        const data = await res.json();
        const proxyURL = `${HOST}/api/proxy-file?url=${encodeURIComponent(
          data.highest_ranking_resume
        )}`;

        const response = await fetch(proxyURL);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        const blob = await response.blob();
        let filename = `${userDetails.firstName || ""} ${
          userDetails.lastName || ""
        } resume.pdf`;

        // Get filename from Content-Disposition header
        const contentDisposition = response.headers.get("content-disposition");
        if (contentDisposition) {
          const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
            contentDisposition
          );
          if (matches?.[1]) {
            filename = matches[1].replace(/['"]/g, "");
          }
        }

        // Create file object
        const file = new File([blob], filename, {
          type: blob.type || "application/pdf",
          lastModified: Date.now(),
        });

        if (file.size === 0) {
          throw new Error("Created file is empty");
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
      }

      // Common code for both paths
      await this.dispatchFileEvents(fileInput);
      await this.waitForUploadProcess(fileInput);
      return true;
    } catch (error) {
      console.error("Upload failed:", error.message);
      try {
        fileInput.value = "";
      } catch (e) {
        console.error("Could not clear file input:", e);
      }
      return false;
    }
  }
  async waitForUploadProcess(fileInput, timeout = 10000) {
    const container = fileInput.closest("form") || fileInput.parentElement;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Check for error messages
      const errorElement = container.querySelector(
        ".artdeco-inline-feedback--error"
      );
      if (errorElement && errorElement.textContent.trim()) {
        throw new Error(`Upload failed: ${errorElement.textContent.trim()}`);
      }

      // Check for success indicators
      const successElement = container.querySelector(
        ".artdeco-inline-feedback--success"
      );
      if (successElement) {
        return true;
      }

      await this.sleep(500);
    }

    // If we still have a file in the input after timeout, consider it successful
    const hasFile = fileInput.files && fileInput.files.length > 0;
    return hasFile;
  }

  async dispatchFileEvents(fileInput) {
    const events = ["focus", "change", "input"];
    for (const event of events) {
      await this.sleep(100);
      fileInput.dispatchEvent(new Event(event, { bubbles: true }));
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * LeverFileHandler - Specialized file handling for Lever job applications
 * Handles resume uploads in Lever application forms
 */

class LeverFileHandler {
  constructor(statusManager) {
    this.statusManager = statusManager || {
      show: (message, type) => console.log(`[${type}] ${message}`),
    };

    // Create a simple loader API if not provided
    this.loader = {
      start: () => console.log("Loading started"),
      stop: () => console.log("Loading finished"),
    };

    // Bind methods to ensure 'this' always refers to the class instance
    this.handleResumeUpload = this.handleResumeUpload.bind(this);
    this.isResumeField = this.isResumeField.bind(this);
    this.isCoverLetterField = this.isCoverLetterField.bind(this);
    this.uploadFileFromUrl = this.uploadFileFromUrl.bind(this);
    this.createAndUploadTextFile = this.createAndUploadTextFile.bind(this);
    this.dispatchFileEvents = this.dispatchFileEvents.bind(this);
    this.verifyUpload = this.verifyUpload.bind(this);
    this.getFilenameFromUrl = this.getFilenameFromUrl.bind(this);
    this.sleep = this.sleep.bind(this);
    this.fallbackResumeUpload = this.fallbackResumeUpload.bind(this);
  }

  /**
   * Handle file upload for Lever application forms
   * @param {Object} profile - User profile with resume URL
   * @param {Element} formElement - The form element containing file inputs
   */
  async handleResumeUpload(profile, formElement) {
    try {
      // Find all file input fields in the form
      const fileInputs = formElement.querySelectorAll('input[type="file"]');
      if (!fileInputs || fileInputs.length === 0) {
        console.log("No file inputs found in the form");
        return false;
      }

      let uploadSuccess = false;

      // Try to identify resume upload field
      for (const fileInput of fileInputs) {
        // Look at surrounding elements to determine the purpose of this upload field
        const container =
          fileInput.closest(".application-field") || fileInput.parentElement;
        const labelText = (
          container.querySelector("label")?.textContent || ""
        ).toLowerCase();
        console.log(container, labelText);
        console.log(
          "IS THIS A RESUME FIELD",
          this.isResumeField(labelText, container)
        );
        // Check if this is a resume upload field
        if (this.isResumeField(labelText, container)) {
          this.statusManager.show("Uploading resume...", "info");

          const resumeUrl = profile.cv?.url;

          if (!resumeUrl) {
            this.statusManager.show("No resume URL found in profile", "error");
            continue;
          }

          const success = await this.uploadFileFromUrl(
            fileInput,
            resumeUrl,
            profile
          );
          if (success) {
            this.statusManager.show("Resume uploaded successfully", "success");
            uploadSuccess = true;
          } else {
            // Try fallback method if primary method fails
            const fallbackSuccess = await this.fallbackResumeUpload(
              fileInput,
              resumeUrl,
              profile
            );
            if (fallbackSuccess) {
              this.statusManager.show(
                "Resume uploaded successfully via fallback",
                "success"
              );
              uploadSuccess = true;
            }
          }
        }
      }

      return uploadSuccess;
    } catch (error) {
      console.error("Error in handleResumeUpload:", error);
      this.statusManager.show(
        `Resume upload failed: ${error.message}`,
        "error"
      );
      return false;
    }
  }

  /**
   * Handle file upload for Lever application forms
   * @param {Object} profile - User profile with resume URL
   * @param {Element} formElement - The form element containing file inputs
   */
  async handleLeverResumeUpload(profile, formElement) {
    try {
      // Find all file input fields in the form
      const fileInputs = formElement.querySelectorAll('input[type="file"]');
      if (!fileInputs || fileInputs.length === 0) {
        console.log("No file inputs found in the form");
        return false;
      }

      let uploadSuccess = false;

      // Try to identify resume upload field
      for (const fileInput of fileInputs) {
        // Look at surrounding elements to determine the purpose of this upload field
        const container =
          fileInput.closest(".application-field") || fileInput.parentElement;
        const labelText = (
          container.querySelector("label")?.textContent || ""
        ).toLowerCase();
        console.log(container, labelText);
        console.log(
          "IS THIS A RESUME FIELD",
          this.isResumeField(labelText, container)
        );
        // Check if this is a resume upload field
        // if (this.isResumeField(labelText, container)) {
        //   this.statusManager.show("Uploading resume...", "info");

        const resumeUrl = profile.cv?.url;

        if (!resumeUrl) {
          this.statusManager.show("No resume URL found in profile", "error");
          continue;
        }

        const success = await this.uploadFileFromUrl(
          fileInput,
          resumeUrl,
          profile
        );
        if (success) {
          this.statusManager.show("Resume uploaded successfully", "success");
          uploadSuccess = true;
        } else {
          // Try fallback method if primary method fails
          const fallbackSuccess = await this.fallbackResumeUpload(
            fileInput,
            resumeUrl,
            profile
          );
          if (fallbackSuccess) {
            this.statusManager.show(
              "Resume uploaded successfully via fallback",
              "success"
            );
            uploadSuccess = true;
          }
        }
        // }
      }

      return uploadSuccess;
    } catch (error) {
      console.error("Error in handleResumeUpload:", error);
      this.statusManager.show(
        `Resume upload failed: ${error.message}`,
        "error"
      );
      return false;
    }
  }

  /**
   * Upload a file from a URL to a file input element
   * Using server proxy to avoid CORS issues
   */
  async uploadFileFromUrl(fileInput, fileUrl, userDetails) {
    try {
      this.statusManager.show("Processing your resume, please wait...", "info");

      // CRITICAL: Use proxy to avoid CORS issues
      const proxyURL = `${HOST}/api/proxy-file?url=${encodeURIComponent(
        fileUrl
      )}`;

      const response = await fetch(proxyURL);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();

      // Create a proper filename
      const userName = `${userDetails.firstName || ""} ${
        userDetails.lastName || ""
      }`.trim();
      let filename = `${userName
        .toLowerCase()
        .replace(/\s+/g, "_")}_resume.pdf`;

      // Get filename from Content-Disposition header if available
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (matches?.[1]) {
          filename = matches[1].replace(/['"]/g, "");
        }
      }

      // Create file object
      const file = new File([blob], filename, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      if (file.size === 0) {
        throw new Error("Created file is empty");
      }

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Common code for both paths
      await this.dispatchFileEvents(fileInput);
      await this.verifyUpload(fileInput);
      return true;
    } catch (error) {
      console.error("Upload failed:", error.message);
      this.statusManager.show(
        `Resume upload failed: ${error.message}`,
        "error"
      );
      try {
        fileInput.value = "";
      } catch (e) {
        console.error("Could not clear file input:", e);
      }
      return false;
    }
  }

  /**
   * Fallback resume upload method
   * This uses your proxy service to avoid CORS issues
   */
  async fallbackResumeUpload(fileInput, fileUrl, userDetails) {
    console.log("USER DETAIL", userDetails);
    try {
      this.statusManager.show(
        "Trying fallback resume upload method...",
        "info"
      );

      // Calculate the base URL
      const BASE_URL =
        typeof HOST !== "undefined"
          ? HOST
          : "https://resumify-6b8b3d9b7428.herokuapp.com";

      // Instead of direct fetch, use the proxy service
      const proxyURL = `${HOST}/api/proxy-file?url=${encodeURIComponent(
        fileUrl
      )}`;

      const response = await fetch(proxyURL);
      if (!response.ok) {
        throw new Error(`Failed to fetch resume: ${response.statusText}`);
      }

      const blob = await response.blob();

      // Create a proper filename
      let filename = this.getFilenameFromUrl(fileUrl);
      // if (!filename || filename === "") {
      //   const userName = `${userDetails?.firstName || ""} ${
      //     userDetails?.lastName || ""
      //   }`.trim();
      //   filename = `${userName.toLowerCase().replace(/\s+/g, "_")}_resume.pdf`;
      // }

      // Create a File object from the blob
      const file = new File([blob], filename, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      if (file.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      // Create DataTransfer and assign to the file input
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch a more comprehensive set of events
      await this.dispatchFileEvents(fileInput);

      // Give more time for the upload to process
      await this.sleep(2000);

      return true;
    } catch (error) {
      console.error("Error in fallback resume upload:", error);
      this.statusManager.show(
        `Fallback upload failed: ${error.message}`,
        "error"
      );
      return false;
    }
  }

  isResumeField(labelText, container) {
    // First apply case insensitive check for safety
    const lowerLabelText = (labelText || "").toLowerCase();

    console.log("lowerLabelText:", lowerLabelText);

    // Check for keywords in the label text
    const keywords = [
      "resume",
      "cv",
      "curriculum vitae",
      "upload your resume",
      "resume/cv",
      "cresume",
      "candidate.cv",
    ];
    if (keywords.some((keyword) => lowerLabelText.includes(keyword))) {
      return true;
    }

    // Check if container exists
    if (!container) return false;

    // Check for the hidden input file element attributes
    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      // Check for resume indicators in the input
      if (
        ["resume", "cv", "file"].some((keyword) =>
          fileInput.name?.toLowerCase().includes(keyword)
        ) ||
        fileInput.id?.toLowerCase().includes(["resume", "candidate.cv"]) ||
        fileInput.getAttribute("data-qa")?.toLowerCase().includes("resume") ||
        (fileInput.className &&
          fileInput.className.toLowerCase().includes("resume"))
      ) {
        return true;
      }
    }

    // Check for "ATTACH RESUME/CV" text in any elements within the container
    const defaultLabel =
      container.querySelector(".default-label")?.textContent?.toLowerCase() ||
      "";
    if (keywords.some((keyword) => defaultLabel.includes(keyword))) {
      return true;
    }

    // Check for resume-related class names in any child elements
    const hasResumeClass = Array.from(container.querySelectorAll("*")).some(
      (el) =>
        el.className &&
        typeof el.className === "string" &&
        el.className.toLowerCase().includes("resume")
    );
    if (hasResumeClass) return true;

    // Search for resume-related strings in the whole container text as a fallback
    const allText = container.textContent?.toLowerCase() || "";
    return keywords.some((keyword) => allText.includes(keyword));
  }

  /**
   * Determine if a field is for cover letter uploads
   */
  isCoverLetterField(labelText, container) {
    const keywords = ["cover letter", "cover"];

    // Check label text
    if (keywords.some((keyword) => labelText.includes(keyword))) {
      return true;
    }

    // Check for field description or help text
    const helpText =
      container
        .querySelector(".help-text, .field-description")
        ?.textContent?.toLowerCase() || "";
    if (keywords.some((keyword) => helpText.includes(keyword))) {
      return true;
    }

    return (
      container.classList.contains("cover-letter-upload") ||
      container.id?.includes("cover")
    );
  }

  /**
   * Create and upload a text file (e.g., for cover letters)
   */
  async createAndUploadTextFile(fileInput, content, filename) {
    try {
      // Create a blob from the text content
      const blob = new Blob([content], { type: "text/plain" });

      // Create a File object from the blob
      const file = new File([blob], filename, {
        type: "text/plain",
        lastModified: Date.now(),
      });

      // Create DataTransfer and assign to the file input
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch events to trigger Lever's file upload handlers
      await this.dispatchFileEvents(fileInput);

      // Verify the upload was successful
      return await this.verifyUpload(fileInput);
    } catch (error) {
      console.error("Error creating and uploading text file:", error);
      return false;
    }
  }

  /**
   * Dispatch necessary events to simulate user interaction with the file input
   */
  async dispatchFileEvents(fileInput) {
    const events = ["focus", "click", "change", "input"];

    for (const eventName of events) {
      await this.sleep(100);
      const event = new Event(eventName, { bubbles: true });
      fileInput.dispatchEvent(event);
    }

    // Additional waiting time for upload processing
    await this.sleep(1000);
  }

  /**
   * Verify that the file was successfully uploaded
   */
  async verifyUpload(fileInput, maxWaitTime = 10000) {
    const startTime = Date.now();

    // Keep checking until timeout
    while (Date.now() - startTime < maxWaitTime) {
      // Check if file is still in the input
      if (fileInput.files && fileInput.files.length > 0) {
        // Check for success indicators in surrounding elements
        const container =
          fileInput.closest(".application-field") || fileInput.parentElement;

        // Look for error messages
        const errorElement = container.querySelector(
          ".error-message, .field-error"
        );
        if (
          errorElement &&
          errorElement.textContent.trim() &&
          errorElement.style.display !== "none"
        ) {
          throw new Error(`Upload failed: ${errorElement.textContent.trim()}`);
        }

        // Check for success indicators
        const successElement = container.querySelector(
          ".success-message, .upload-success"
        );
        if (successElement) {
          return true;
        }

        // Check if we can see the filename displayed
        const filenameElement = container.querySelector(
          ".filename, .file-name"
        );
        if (
          filenameElement &&
          filenameElement.textContent.includes(fileInput.files[0].name)
        ) {
          return true;
        }
      } else {
        // If files were cleared, it probably means an error
        return false;
      }

      await this.sleep(500);
    }

    // If we timeout but still have a file, consider it successful
    return fileInput.files && fileInput.files.length > 0;
  }

  /**
   * Extract filename from URL
   */
  getFilenameFromUrl(url) {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const filename = pathname.substring(pathname.lastIndexOf("/") + 1);

      // If filename has query parameters, remove them
      return filename.split("?")[0];
    } catch (e) {
      console.error("Error parsing URL:", e);
      return "resume.pdf";
    }
  }

  /**
   * Helper method to wait for a specified time
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class WorkableFileHandler extends LeverFileHandler {
  /**
   * Finds file upload elements in a Lever form and extracts their information
   *
   * @param {HTMLElement} formElement - The Lever application form
   * @returns {Array<Object>} - Array of upload field objects with element, label, and container information
   */
  findLeverUploadFields(formElement) {
    try {
      const uploadFields = [];

      // Method 1: Find elements with data-role="dropzone" attribute (Lever's standard)
      const dropzones = formElement.querySelectorAll('[data-role="dropzone"]');
      for (const dropzone of dropzones) {
        // Find the associated file input
        const fileInput = dropzone.querySelector('input[type="file"]');
        if (!fileInput) continue;

        // Find the parent container that holds the entire field structure
        const fieldContainer = this.findFieldContainer(dropzone);

        // Extract the label text from the container
        const label = this.extractLeverFieldLabel(fieldContainer);

        uploadFields.push({
          element: fileInput,
          dropzone: dropzone,
          container: fieldContainer,
          label: label,
          required:
            fileInput.hasAttribute("required") ||
            fileInput.getAttribute("aria-required") === "true",
          isResume: this.isResumeField(label, fieldContainer),
        });
      }

      // Method 2: Find all file inputs directly (backup method)
      const fileInputs = formElement.querySelectorAll('input[type="file"]');
      for (const fileInput of fileInputs) {
        // Skip if we already found this input through a dropzone
        if (uploadFields.some((field) => field.element === fileInput)) continue;

        // Find the parent container
        const fieldContainer = this.findFieldContainer(fileInput);

        // Extract the label
        const label = this.extractLeverFieldLabel(fieldContainer);

        uploadFields.push({
          element: fileInput,
          dropzone: fileInput.closest('[data-role="dropzone"]'),
          container: fieldContainer,
          label: label,
          required:
            fileInput.hasAttribute("required") ||
            fileInput.getAttribute("aria-required") === "true",
          isResume: this.isResumeField(label, fieldContainer),
        });
      }

      return uploadFields;
    } catch (error) {
      console.error("Error finding Lever upload fields:", error);
      return [];
    }
  }

  /**
   * Find the field container for a Lever form element
   *
   * @param {HTMLElement} element - The element to find the container for
   * @returns {HTMLElement|null} - The container element or null if not found
   */
  findFieldContainer(element) {
    // Start with the element itself
    let current = element;

    // Go up the DOM tree looking for the container (max 5 levels)
    for (let i = 0; i < 5 && current; i++) {
      // Check if this is a field container (Lever uses the styles--3aPac class)
      if (
        current.classList.contains("styles--3aPac") ||
        current.className.includes("styles--3aPac")
      ) {
        return current;
      }

      // Move up to parent
      current = current.parentElement;
    }

    // If no specific container found, return the closest div
    return element.closest("div");
  }

  /**
   * Extract the label text from a Lever field container
   *
   * @param {HTMLElement} container - The field container
   * @returns {string} - The extracted label text
   */
  extractLeverFieldLabel(container) {
    if (!container) return "";

    // Method 1: Look for the label element with styles--QTMDv class
    const labelEl = container.querySelector('.styles--QTMDv, [class*="QTMDv"]');
    if (labelEl) {
      return labelEl.textContent.trim();
    }

    // Method 2: Look for a label with id ending with "_label"
    const labelWithIdPattern = container.querySelector('span[id$="_label"]');
    if (labelWithIdPattern) {
      return labelWithIdPattern.textContent.trim();
    }

    // Method 3: Look for aria-labelledby references
    const fileInput = container.querySelector('input[type="file"]');
    if (fileInput) {
      const labelledById = fileInput.getAttribute("aria-labelledby");
      if (labelledById) {
        const labelEl = document.getElementById(labelledById);
        if (labelEl) {
          return labelEl.textContent.trim();
        }
      }
    }

    // Method 4: Just get the text content excluding the dropzone
    // Clone the container to avoid modifying the original
    const clone = container.cloneNode(true);

    // Remove the dropzone and input elements from the clone
    const elementsToRemove = clone.querySelectorAll(
      '[data-role="dropzone"], input[type="file"]'
    );
    for (const el of elementsToRemove) {
      el.parentNode.removeChild(el);
    }

    // Extract text from what remains, looking for anything that might be a label
    const possibleLabelElements = clone.querySelectorAll(
      "label, span, strong, div"
    );
    for (const el of possibleLabelElements) {
      const text = el.textContent.trim();
      if (text && text.length < 50) {
        // Reasonable label length
        return text;
      }
    }

    // Last resort: return any text from the container
    return clone.textContent.trim();
  }

  /**
   * Check if a field is for resume uploads based on label text and container context
   *
   * @param {string} labelText - The label text
   * @param {HTMLElement} container - The field container element
   * @returns {boolean} - True if this is a resume field
   */
  isResumeField(labelText, container) {
    if (!labelText) return false;

    // Clean up label text
    const cleanedLabel = labelText
      .toLowerCase()
      .replace(/\*|\s+|required/g, " ")
      .trim();

    // Check for resume-related keywords
    const resumeKeywords = [
      "resume",
      "cv",
      "curriculum",
      "curriculum vitae",
      "upload resume",
      "upload cv",
      "attach resume",
      "attach cv",
    ];

    // Direct match with resume keywords
    if (resumeKeywords.some((keyword) => cleanedLabel.includes(keyword))) {
      return true;
    }

    // If container is provided, look for contextual clues
    if (container) {
      // Look at file input's accept attribute
      const fileInput = container.querySelector('input[type="file"]');
      if (fileInput && fileInput.hasAttribute("accept")) {
        const acceptAttr = fileInput.getAttribute("accept");
        // Resume uploads typically accept PDF, DOC, DOCX
        if (acceptAttr.includes("pdf") || acceptAttr.includes("doc")) {
          return true;
        }
      }

      // Look for description text near the input
      const containerText = container.textContent.toLowerCase();
      if (resumeKeywords.some((keyword) => containerText.includes(keyword))) {
        return true;
      }
    }

    // If this is the only file upload field in the form, it's likely for a resume
    const form = container?.closest("form");
    if (form) {
      const totalFileInputs =
        form.querySelectorAll('input[type="file"]').length;
      if (totalFileInputs === 1) {
        return true;
      }
    }

    return false;
  }

  /**
   * Bridge method to use findLeverUploadFields with handleLeverResumeUpload
   *
   * @param {Object} profile - User profile with resume URL
   * @param {HTMLElement} formElement - The form element
   * @returns {Promise<boolean>} - True if upload was successful
   */
  async handleFormResumeUpload(profile, formElement) {
    try {
      // First find all upload fields in the form
      const uploadFields = this.findLeverUploadFields(formElement);

      if (uploadFields.length === 0) {
        console.log("No upload fields found in the form");
        return false;
      }

      console.log(`Found ${uploadFields.length} upload fields in form`);

      // Find resume upload fields
      const resumeFields = uploadFields.filter((field) => field.isResume);

      // If we found specific resume fields, use those
      const fieldsToTry = resumeFields.length > 0 ? resumeFields : uploadFields;

      // Try to upload to each field until one succeeds
      for (const field of fieldsToTry) {
        console.log(`Attempting upload to field: ${field.label}`);

        const success = await this.handleLeverResumeUpload(
          profile,
          field.element
        );
        if (success) {
          console.log(`Successfully uploaded resume to field: ${field.label}`);
          return true;
        }
      }

      console.log("Failed to upload resume to any field");
      return false;
    } catch (error) {
      console.error("Error in handleFormResumeUpload:", error);
      return false;
    }
  }
}

class RecruiteeFileHandler extends LeverFileHandler {}

class BreezyFileHandler extends LeverFileHandler {}

class IndeedFileHandler extends LeverFileHandler {}

class GlassdoorFileHandler extends LeverFileHandler {}

export {
  LeverFileHandler,
  WorkableFileHandler,
  BreezyFileHandler,
  RecruiteeFileHandler,
  IndeedFileHandler,
  GlassdoorFileHandler,
};
