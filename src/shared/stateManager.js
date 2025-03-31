export class StateManager {
  constructor() {
    this.storageKey = "FastApplyState";
  }

  async saveState(state) {
    try {
      await chrome.storage.local.set({
        [this.storageKey]: state,
      });
    } catch (error) {
      console.error("Error saving state:", error);
    }
  }

  async getState() {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      return result[this.storageKey] || null;
    } catch (error) {
      return null;
    }
  }

  async updateState(partialState) {
    try {
      const currentState = (await this.getState()) || {};
      const newState = { ...currentState, ...partialState };
      await this.saveState(newState);
      return newState;
    } catch (error) {
      console.error("Error updating state:", error);
      return null;
    }
  }

  async clearState() {
    try {
      await chrome.storage.local.remove(this.storageKey);
    } catch (error) {
      throw error;
    }
  }
}
