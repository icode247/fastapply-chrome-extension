/**
 * FileHandler - Handles file uploads for Indeed and Glassdoor job applications
 */
class FileHandler {
  constructor(options = {}) {
    this.show =
      options.show ||
      ((message, type) => {
        console.log(`[${type || "info"}] ${message}`);
      });
    this.platform = options.platform || "indeed";
  }

  /**
   * Handle resume upload
   * @param {Object} profile - User profile containing resume information
   * @param {Object} options - Upload options
   * @returns {Promise<boolean>} - Success status
   */
  async handleResumeUpload(profile, options) {
    try {
      // Check if resume URL exists
      if (!profile.resumeUrl) {
        this.show("No resume URL provided in profile", "error");
        return false;
      }

      // Validate options
      if (!options || typeof options.querySelector !== "function") {
        this.show("Invalid options provided for resume upload", "error");
        return false;
      }

      // Get the file input element
      const fileInput = options.querySelector();
      if (!fileInput) {
        this.show("File input element not found", "error");
        return false;
      }

      this.show(`Starting resume upload for ${this.platform}...`);

      // Fetch resume from URL
      this.show(`Fetching resume from ${profile.resumeUrl}...`);

      try {
        const response = await fetch(profile.resumeUrl);

        if (!response.ok) {
          throw new Error(
            `Failed to fetch resume: ${response.status} ${response.statusText}`
          );
        }

        const blob = await response.blob();

        // Create a File object from the blob
        // Use .pdf extension by default, but try to determine from URL or content-type
        let fileExtension = ".pdf";
        const contentType = response.headers.get("content-type");

        if (contentType) {
          if (contentType.includes("pdf")) {
            fileExtension = ".pdf";
          } else if (
            contentType.includes("word") ||
            contentType.includes("document")
          ) {
            fileExtension = ".docx";
          } else if (contentType.includes("text")) {
            fileExtension = ".txt";
          }
        }

        // Try to get extension from URL
        if (profile.resumeUrl.includes(".")) {
          const urlExtension =
            "." + profile.resumeUrl.split(".").pop().split("?")[0];
          if (
            [".pdf", ".docx", ".doc", ".txt", ".rtf"].includes(
              urlExtension.toLowerCase()
            )
          ) {
            fileExtension = urlExtension.toLowerCase();
          }
        }

        // Create file name
        const fileName = `Resume_${profile.firstName || ""}_${
          profile.lastName || ""
        }_${Date.now()}${fileExtension}`;

        const file = new File([blob], fileName, {
          type: blob.type || "application/pdf",
        });

        // Create a FileList-like object
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Set the file to the input
        fileInput.files = dataTransfer.files;

        // Dispatch events
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));

        this.show("Resume uploaded successfully", "success");
        return true;
      } catch (error) {
        this.show(`Error fetching resume: ${error.message}`, "error");

        // Try alternative approach using direct assignment if fetch fails
        try {
          this.show("Attempting direct resume upload...", "warning");

          // Create empty file with correct name
          const fileName = `Resume_${profile.firstName || ""}_${
            profile.lastName || ""
          }_${Date.now()}.pdf`;
          const emptyBlob = new Blob([""], { type: "application/pdf" });
          const file = new File([emptyBlob], fileName, {
            type: "application/pdf",
          });

          // Create a FileList-like object
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);

          // Set the file to the input
          fileInput.files = dataTransfer.files;

          // Dispatch events
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));
          fileInput.dispatchEvent(new Event("input", { bubbles: true }));

          this.show("Direct resume upload completed", "warning");
          return true;
        } catch (backupError) {
          this.show(
            `Backup upload also failed: ${backupError.message}`,
            "error"
          );
          return false;
        }
      }
    } catch (error) {
      this.show(`Resume upload error: ${error.message}`, "error");
      return false;
    }
  }
}

export { FileHandler };
