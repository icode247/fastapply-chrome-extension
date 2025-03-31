class ValueProvider {
  constructor(userDetails) {
    this.userDetails = userDetails;
  }

  async getValueForField(fieldData) {
    const { purpose, type } = fieldData;

    // Handle special input types
    if (type === "file") {
      return this.getFileValue(purpose);
    }

    if (type === "checkbox" || type === "radio") {
      return this.getBooleanValue(fieldData);
    }

    // Map field purpose to user data
    const valueMap = {
      fullName: () => this.userDetails.fullName,
      firstName: () => this.userDetails.firstName,
      lastName: () => this.userDetails.lastName,
      email: () => this.userDetails.email,
      phone: () => this.formatPhone(this.userDetails.phone),
      address: () => this.formatAddress(this.userDetails.address),
      linkedin: () => this.userDetails.linkedinUrl,
      portfolio: () => this.userDetails.portfolioUrl,
      experience: () => this.calculateExperience(),
      education: () => this.formatEducation(),
      skills: () => this.userDetails.skills.join(", "),
      salary: () => this.formatSalary(),
      availability: () => this.formatAvailability(),
      citizenship: () => this.userDetails.workAuthorization,
      references: () => this.formatReferences(),
    };

    return valueMap[purpose]?.() || "";
  }

  getFileValue(purpose) {
    const fileMap = {
      resume: this.userDetails.resumeUrl,
      coverLetter: this.userDetails.coverLetterUrl,
    };
    return fileMap[purpose];
  }

  getBooleanValue(fieldData) {
    const text = (fieldData.label + " " + fieldData.name).toLowerCase();

    // Handle common yes/no questions
    if (text.includes("willing to relocate")) {
      return this.userDetails.willingToRelocate;
    }
    if (text.includes("remote work")) {
      return this.userDetails.openToRemote;
    }
    if (text.includes("authorize") || text.includes("legally")) {
      return this.userDetails.workAuthorization === "authorized";
    }

    return null; // Let the application handle unknown boolean fields
  }

  // Helper methods for formatting various types of data
  formatPhone(phone) {
    return phone?.replace(/\D/g, "");
  }

  formatAddress(address) {
    if (!address) return "";
    return `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
  }

  calculateExperience() {
    if (!this.userDetails.workHistory?.length) return "0";

    const years = this.userDetails.workHistory.reduce((total, job) => {
      const start = new Date(job.startDate);
      const end = job.endDate ? new Date(job.endDate) : new Date();
      return total + (end - start) / (1000 * 60 * 60 * 24 * 365);
    }, 0);

    return Math.round(years).toString();
  }

  formatEducation() {
    if (!this.userDetails.education?.length) return "";

    const latest = this.userDetails.education[0];
    return `${latest.degree} in ${latest.field} from ${latest.school}`;
  }

  formatSalary() {
    const { minimum, maximum } = this.userDetails.salaryExpectation || {};
    if (!minimum) return "";
    return maximum ? `${minimum}-${maximum}` : minimum.toString();
  }

  formatAvailability() {
    return this.userDetails.availabilityDate || "Immediate";
  }

  formatReferences() {
    if (!this.userDetails.references?.length) return "Available upon request";

    return this.userDetails.references
      .map((ref) => `${ref.name} - ${ref.company}`)
      .join(", ");
  }
}
