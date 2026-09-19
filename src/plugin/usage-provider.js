class UsageProvider {
  async getUsage() {
    throw new Error("UsageProvider.getUsage must be implemented");
  }
}

module.exports = { UsageProvider };
