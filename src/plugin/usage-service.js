class UsageService {
  constructor(providerFactory) {
    this.providerFactory = providerFactory;
  }

  async refresh(settings) {
    try {
      return await this.providerFactory(settings).getUsage();
    } catch {
      return { kind: "unavailable", reason: "request_failed" };
    }
  }
}

module.exports = { UsageService };
